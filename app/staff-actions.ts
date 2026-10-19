'use server';

import { refresh } from 'next/cache';
import { sql, type Membership, type Player, type PlanType } from '@/lib/db';
import { normalizePhone, requireStaff } from '@/lib/auth';
import { back, int, personName, str, withLockedSession } from '@/lib/action-utils';
import { ALL_DAYS, ledger, planLive, recheckBookings, refundBookings } from '@/lib/members';
import { getBatch } from '@/lib/sessions';
import { istDate } from '@/lib/time';
import type { Key } from '@/lib/i18n';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- Roster ----------
// Attendance is the players' own job now ("I'm coming" / "I played"); staff only track money and courts.

/** Fee collected, or (for someone who backed out after paying) refunded. */
export async function togglePaid(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  await sql`
    update bookings set paid = not paid, updated_at = now()
    where id = ${int(form, 'bookingId')} and session_id = ${sid}`;
  refresh(); // re-render the roster in place, no navigation or scroll jump
}

export async function changeCourts(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  const delta = int(form, 'delta') > 0 ? 1 : -1;
  await sql`
    update sessions s set capacity = greatest(0, s.capacity + ${delta} * b.players_per_court)
    from batches b where s.id = ${sid} and b.id = s.batch_id`;
  refresh(); // re-render the roster in place, no navigation or scroll jump
}

export async function cancelSession(form: FormData) {
  const staff = await requireStaff('cancel');
  const sid = int(form, 'sessionId');
  if (str(form, 'confirm') !== 'CANCEL') back(`/roster?sid=${sid}`, 'cancelConfirm');
  await withLockedSession(sid, async (tx) => {
    // Give back any plan sessions already charged.
    const charged = await tx<{ id: number }[]>`select id from bookings where session_id = ${sid} and charged`;
    await refundBookings(tx, charged.map((b) => b.id), staff.id);
    await tx`
      update bookings set status = 'withdrawn', membership_id = null, updated_at = now()
      where session_id = ${sid}`;
    await tx`update sessions set cancelled = true, locked = true, closed = true where id = ${sid}`;
  });
  back(`/roster?sid=${sid}`, 'cancelDone');
}

// ---------- Memberships ----------

/** Step 1 of a request: tell the player what to pay. They see the amount on their home screen. */
export async function quoteRequest(form: FormData) {
  const staff = await requireStaff('members');
  const amount = Math.max(0, int(form, 'amount'));
  if (amount < 1) back('/members', 'errAmount');
  const sessions = Math.min(400, Math.max(0, int(form, 'sessions'))) || null;
  const [r] = await sql<{ name: string }[]>`
    update membership_requests r set status = 'quoted', amount_rupees = ${amount},
      sessions_requested = coalesce(${sessions}, r.sessions_requested), handled_by = ${staff.id}, handled_at = now()
    from players p where r.id = ${int(form, 'requestId')} and p.id = r.player_id and r.status in ('pending', 'quoted')
    returning p.name`;
  back('/members', r ? 'quoteSent' : 'noRequests', { name: r?.name ?? '', amount });
}

/**
 * Step 2: payment received → activate. Also creates a plan for any phone number, edits a plan,
 * or (wallet + live wallet) tops the existing balance up.
 */
export async function savePlan(form: FormData) {
  const staff = await requireStaff('members');
  const planId = int(form, 'planId');
  const requestId = int(form, 'requestId');
  const kind: PlanType = str(form, 'kind') === 'wallet' ? 'wallet' : 'fixed';
  const days = kind === 'wallet' ? ALL_DAYS
    : [...new Set(form.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const total = Math.min(400, int(form, 'sessionsTotal'));
  const startsOn = isDate(str(form, 'startsOn')) ? str(form, 'startsOn') : istDate();
  const endsOn = isDate(str(form, 'endsOn')) ? str(form, 'endsOn') : null;
  const batchId = kind === 'wallet' ? null : str(form, 'batchId');
  const note = str(form, 'note').slice(0, 200) || null;
  const amount = Math.max(0, int(form, 'amount')) || null;
  if (batchId !== null && !(await getBatch(batchId))) back('/members', 'errSessions');
  if (days.length === 0) back('/members', 'errDays');
  if (total < 1) back('/members', 'errSessions');
  if (endsOn && startsOn > endsOn) back('/members', 'errDateRange');

  const [key, vars] = await sql.begin(async (tx): Promise<[Key, Record<string, string | number>?]> => {
    // Edit
    if (planId) {
      const [old] = await tx<Membership[]>`select * from memberships where id = ${planId} and status = 'active' for update`;
      if (!old) return ['errSessions'];
      const newTotal = Math.max(total, old.sessions_used);
      const [m] = await tx<(Membership & { name: string })[]>`
        update memberships m set kind = ${kind}, batch_id = ${batchId}, days = ${days}, starts_on = ${startsOn},
          ends_on = ${endsOn}, sessions_total = ${newTotal}, note = ${note}, amount_rupees = coalesce(${amount}, m.amount_rupees)
        from players p where m.id = ${planId} and p.id = m.player_id
        returning m.*, p.name`;
      if (newTotal !== old.sessions_total) {
        await ledger(tx, { membershipId: m.id, delta: newTotal - old.sessions_total, reason: 'adjust', note, by: staff.id });
      }
      await recheckBookings(tx, m.player_id);
      return ['planSaved', { name: m.name }];
    }

    // New: from a request, or by phone number
    let player: Player | undefined;
    if (requestId) {
      [player] = await tx<Player[]>`
        select p.* from membership_requests r join players p on p.id = r.player_id
        where r.id = ${requestId} and r.status in ('pending', 'quoted')`;
    } else {
      const phone = normalizePhone(str(form, 'phone'));
      if (!phone) return ['errPhone'];
      [player] = await tx<Player[]>`select * from players where phone = ${phone}`;
      if (!player) {
        const name = personName(form);
        if (!name) return ['errName'];
        [player] = await tx<Player[]>`
          insert into players (first_name, last_name, phone) values (${name.first}, ${name.last}, ${phone}) returning *`;
      }
    }
    if (!player) return ['noRequests'];

    const [old] = await tx<Membership[]>`
      select * from memberships where player_id = ${player.id} and status = 'active' for update`;
    let result: [Key, Record<string, string | number>];
    if (old && planLive(old) && old.kind === 'wallet' && kind === 'wallet') {
      // Top-up: same wallet, bigger balance, later expiry if one was given.
      await tx`
        update memberships set sessions_total = sessions_total + ${total},
          ends_on = case when ends_on is null then null else greatest(ends_on, ${endsOn}::date) end,
          note = coalesce(${note}, note)
        where id = ${old.id}`;
      await ledger(tx, { membershipId: old.id, delta: total, reason: 'topup', amount, note, by: staff.id });
      result = ['walletToppedUp', { name: player.name, n: total }];
    } else {
      if (old && planLive(old)) return ['errHasPlan', { name: player.name }];
      if (old) await tx`update memberships set status = 'ended' where id = ${old.id}`;
      const [m] = await tx<{ id: number }[]>`
        insert into memberships (player_id, kind, batch_id, days, sessions_total, starts_on, ends_on, note, amount_rupees, created_by)
        values (${player.id}, ${kind}, ${batchId}, ${days}, ${total}, ${startsOn}, ${endsOn}, ${note}, ${amount}, ${staff.id})
        returning id`;
      await ledger(tx, { membershipId: m.id, delta: total, reason: 'activate', amount, note, by: staff.id });
      result = ['planSaved', { name: player.name }];
    }
    await tx`
      update membership_requests set status = 'approved', handled_by = ${staff.id}, handled_at = now()
      where player_id = ${player.id} and status in ('pending', 'quoted')`;
    await recheckBookings(tx, player.id);
    return result;
  });
  back('/members', key, vars);
}

export async function endPlan(form: FormData) {
  await requireStaff('members');
  await sql.begin(async (tx) => {
    const [m] = await tx<Membership[]>`
      update memberships set status = 'ended' where id = ${int(form, 'planId')} and status = 'active' returning *`;
    if (m) await recheckBookings(tx, m.player_id);
  });
  back('/members', 'planEnded');
}

export async function rejectRequest(form: FormData) {
  const staff = await requireStaff('members');
  await sql`
    update membership_requests set status = 'rejected', handled_by = ${staff.id}, handled_at = now()
    where id = ${int(form, 'requestId')} and status in ('pending', 'quoted')`;
  back('/members', 'requestRejected');
}

// ---------- Admin ----------

/** Register (or promote) someone as core/admin by phone. They set their own PIN at first sign-in. */
export async function saveStaff(form: FormData) {
  const admin = await requireStaff('staff');
  const phone = normalizePhone(str(form, 'phone'));
  const name = personName(form);
  const role = str(form, 'role') === 'admin' ? 'admin' : 'core';
  if (!phone) back('/admin', 'errPhone');
  if (phone === admin.phone) back('/admin', 'errSelf');

  const [p] = await sql<Player[]>`select * from players where phone = ${phone!}`;
  if (!p && !name) back('/admin', 'errName');
  const [saved] = p
    ? await sql<Player[]>`update players set role = ${role} where id = ${p.id} returning *`
    : await sql<Player[]>`
        insert into players (first_name, last_name, phone, role) values (${name!.first}, ${name!.last}, ${phone!}, ${role}) returning *`;
  back('/admin', 'staffSaved', { name: saved.name, role });
}

export async function resetPin(form: FormData) {
  await requireStaff('staff');
  await sql`update players set pin_hash = null where id = ${int(form, 'id')} and role <> 'player'`;
  back('/admin', 'pinReset');
}

export async function removeStaff(form: FormData) {
  const admin = await requireStaff('staff');
  const id = int(form, 'id');
  if (id === admin.id) back('/admin', 'errSelf');
  const [p] = await sql<Player[]>`
    update players set role = 'player', pin_hash = null where id = ${id} returning *`;
  back('/admin', 'staffRemoved', { name: p?.name ?? '' });
}

export async function saveBatch(form: FormData) {
  await requireStaff('batches');
  const id = str(form, 'id');
  const courts = Math.max(0, int(form, 'courts'));
  const perCourt = Math.max(1, int(form, 'playersPerCourt'));
  await sql`
    update batches set courts = ${courts}, players_per_court = ${perCourt}, price_rupees = ${Math.max(0, int(form, 'price'))}
    where id = ${id}`;
  // Sessions that haven't started pick up the new court count.
  await sql`update sessions set capacity = ${courts * perCourt} where batch_id = ${id} and starts_at > now()`;
  back('/admin', 'batchSaved');
}
