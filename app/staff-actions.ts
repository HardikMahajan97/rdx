'use server';

import { refresh } from 'next/cache';
import { sql, type Booking, type Membership, type Player } from '@/lib/db';
import { normalizePhone, requireStaff } from '@/lib/auth';
import { back, int, str, withLockedSession } from '@/lib/action-utils';
import { covers, planLive, resetAutoBookings } from '@/lib/members';
import { getBatch } from '@/lib/sessions';
import { istDate, dayOfWeek } from '@/lib/time';
import type { Key } from '@/lib/i18n';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Validate that startsOn and endsOn only contain allowed days. */
function validateDateRange(startsOn: string, endsOn: string | null, allowedDays: number[]): string | null {
  if (!endsOn) return null;
  if (startsOn > endsOn) return 'errDateRange';
  for (let d = new Date(`${startsOn}T12:00:00Z`); d <= new Date(`${endsOn}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!allowedDays.includes(d.getUTCDay())) {
      return 'errDatePattern';
    }
  }
  return null;
}

// ---------- Roster ----------

/** Tick / untick a player. Ticking uses one plan session if the plan covers this session. */
export async function togglePresent(form: FormData) {
  const staff = await requireStaff('roster');
  const sid = int(form, 'sessionId');
  await withLockedSession(sid, async (tx, session) => {
    if (session.cancelled) return;
    const [b] = await tx<Booking[]>`
      select * from bookings where id = ${int(form, 'bookingId')} and session_id = ${sid} for update`;
    if (!b || b.status === 'withdrawn') return;

    if (b.status === 'present') {
      if (b.membership_id) {
        await tx`update memberships set sessions_used = sessions_used - 1 where id = ${b.membership_id}`;
      }
      await tx`
        update bookings set status = ${session.closed ? 'no_show' : 'booked'}, membership_id = null,
          checked_by = ${staff.id}, updated_at = now()
        where id = ${b.id}`;
      return;
    }

    const [plan] = await tx<Membership[]>`
      select * from memberships where player_id = ${b.player_id} and status = 'active' for update`;
    const usePlan = covers(plan, session);
    await tx`
      update bookings set status = 'present', membership_id = ${usePlan ? plan.id : null},
        checked_by = ${staff.id}, updated_at = now()
      where id = ${b.id}`;
    if (usePlan) {
      await tx`update memberships set sessions_used = sessions_used + 1 where id = ${plan.id}`;
      // Last session used: drop their other auto-bookings so they aren't counted as coming.
      // (Runs after this booking is 'present', so it only touches other sessions.)
      if (plan.sessions_used + 1 >= plan.sessions_total) await resetAutoBookings(tx, b.player_id);
    }
  });
  refresh(); // re-render the roster in place, no navigation or scroll jump
}

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
  await requireStaff('cancel');
  const sid = int(form, 'sessionId');
  if (str(form, 'confirm') !== 'CANCEL') back(`/roster?sid=${sid}`, 'cancelConfirm');
  await withLockedSession(sid, async (tx) => {
    // Give back any plan sessions already used by ticks.
    await tx`
      update memberships m set sessions_used = sessions_used - x.n
      from (select membership_id, count(*)::int as n from bookings
            where session_id = ${sid} and membership_id is not null group by membership_id) x
      where m.id = x.membership_id`;
    await tx`
      update bookings set status = 'withdrawn', membership_id = null, updated_at = now()
      where session_id = ${sid}`;
    await tx`update sessions set cancelled = true, closed = true where id = ${sid}`;
  });
  back(`/roster?sid=${sid}`, 'cancelDone');
}

// ---------- Memberships ----------

/** Create a plan (from a request, or for any phone number) or edit an existing one. */
export async function savePlan(form: FormData) {
  const staff = await requireStaff('members');
  const planId = int(form, 'planId');
  const requestId = int(form, 'requestId');
  const days = [...new Set(form.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  const total = Math.min(400, int(form, 'sessionsTotal'));
  const startsOn = isDate(str(form, 'startsOn')) ? str(form, 'startsOn') : istDate();
  const endsOn = isDate(str(form, 'endsOn')) ? str(form, 'endsOn') : null;
  const batchId = str(form, 'batchId');
  const note = str(form, 'note').slice(0, 200) || null;
  if (!(await getBatch(batchId))) back('/members', 'errSessions');
  if (days.length === 0) back('/members', 'errDays');
  if (total < 1) back('/members', 'errSessions');
  const dateErr = validateDateRange(startsOn, endsOn, days);
  if (dateErr) back('/members', dateErr as Key);

  const [key, vars] = await sql.begin(async (tx): Promise<[Parameters<typeof back>[1], Record<string, string>?]> => {
    // Edit
    if (planId) {
      const [m] = await tx<(Membership & { name: string })[]>`
        update memberships m set batch_id = ${batchId}, days = ${days}, starts_on = ${startsOn}, ends_on = ${endsOn},
          sessions_total = greatest(${total}, m.sessions_used), note = ${note}
        from players p where m.id = ${planId} and p.id = m.player_id and m.status = 'active'
        returning m.*, p.name`;
      if (!m) return ['errSessions'];
      await resetAutoBookings(tx, m.player_id);
      return ['planSaved', { name: m.name }];
    }

    // New: from a request, or by phone number
    let player: Player | undefined;
    if (requestId) {
      [player] = await tx<Player[]>`
        select p.* from membership_requests r join players p on p.id = r.player_id
        where r.id = ${requestId} and r.status = 'pending'`;
    } else {
      const phone = normalizePhone(str(form, 'phone'));
      if (!phone) return ['errPhone'];
      [player] = await tx<Player[]>`select * from players where phone = ${phone}`;
      if (!player) {
        const name = str(form, 'name').slice(0, 60);
        if (!name) return ['errName'];
        [player] = await tx<Player[]>`insert into players (name, phone) values (${name}, ${phone}) returning *`;
      }
    }
    if (!player) return ['noRequests'];

    const [old] = await tx<Membership[]>`
      select * from memberships where player_id = ${player.id} and status = 'active' for update`;
    if (old && planLive(old)) return ['errHasPlan', { name: player.name }];
    if (old) await tx`update memberships set status = 'ended' where id = ${old.id}`;

    await tx`
      insert into memberships (player_id, batch_id, days, sessions_total, starts_on, ends_on, note, created_by)
      values (${player.id}, ${batchId}, ${days}, ${total}, ${startsOn}, ${endsOn}, ${note}, ${staff.id})`;
    await tx`
      update membership_requests set status = 'approved', handled_by = ${staff.id}, handled_at = now()
      where player_id = ${player.id} and status = 'pending'`;
    await resetAutoBookings(tx, player.id);
    return ['planSaved', { name: player.name }];
  });
  back('/members', key, vars);
}

export async function endPlan(form: FormData) {
  await requireStaff('members');
  await sql.begin(async (tx) => {
    const [m] = await tx<Membership[]>`
      update memberships set status = 'ended' where id = ${int(form, 'planId')} and status = 'active' returning *`;
    if (m) await resetAutoBookings(tx, m.player_id);
  });
  back('/members', 'planEnded');
}

export async function rejectRequest(form: FormData) {
  const staff = await requireStaff('members');
  await sql`
    update membership_requests set status = 'rejected', handled_by = ${staff.id}, handled_at = now()
    where id = ${int(form, 'requestId')} and status = 'pending'`;
  back('/members', 'requestRejected');
}

// ---------- Admin ----------

/** Register (or promote) someone as core/admin by phone. They set their own PIN at first sign-in. */
export async function saveStaff(form: FormData) {
  const admin = await requireStaff('staff');
  const phone = normalizePhone(str(form, 'phone'));
  const name = str(form, 'name').slice(0, 60);
  const role = str(form, 'role') === 'admin' ? 'admin' : 'core';
  if (!phone) back('/admin', 'errPhone');
  if (phone === admin.phone) back('/admin', 'errSelf');

  const [p] = await sql<Player[]>`select * from players where phone = ${phone!}`;
  if (!p && !name) back('/admin', 'errName');
  const [saved] = p
    ? await sql<Player[]>`update players set role = ${role} where id = ${p.id} returning *`
    : await sql<Player[]>`insert into players (name, phone, role) values (${name}, ${phone!}, ${role}) returning *`;
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
