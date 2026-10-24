'use server';

import { refresh } from 'next/cache';
import { sql, type Booking, type BookingStatus, type Membership, type Player, type PlanType } from '@/lib/db';
import { canResetPin, normalizePhone, requireStaff } from '@/lib/auth';
import { back, int, personName, safePath, str, withLockedSession } from '@/lib/action-utils';
import { ALL_DAYS, assignPlan, chargeBookings, ledger, planLive, recheckBookings, refundBookings } from '@/lib/members';
import { getBatch, staffStatuses, timing } from '@/lib/sessions';
import { clear } from '@/lib/ratelimit';
import { istDate } from '@/lib/time';
import type { Key } from '@/lib/i18n';

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- Roster ----------
// Players mark their own attendance ("I'm coming" / "I played"); staff can correct it when someone forgets or can't.

/** Fee collected, or (for someone who backed out after paying) refunded. */
export async function togglePaid(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  await sql`
    update bookings set paid = not paid, updated_at = now()
    where id = ${int(form, 'bookingId')} and session_id = ${sid}`;
  refresh(); // re-render the roster in place, no navigation or scroll jump
}

/**
 * Staff correct a player's status (forgot to tap, tapped by mistake, called in sick). Allowed statuses depend on
 * the time (staffStatuses). Plan sessions follow the same rule as everywhere else: once the slot is final
 * (30 min before start) any booking that isn't "backed out" uses its plan session.
 *   → backed out: a used plan session goes back on the balance; a floater who paid shows up as a refund.
 *   ← back in from "backed out": plan cover is worked out again, since the balance may have changed.
 * Reviving someone can take the session over capacity; the roster shows that, and staff can add a court.
 */
export async function setBookingStatus(form: FormData) {
  const staff = await requireStaff('roster');
  const sid = int(form, 'sessionId');
  const status = str(form, 'status') as BookingStatus;
  const key = await withLockedSession(sid, async (tx, session): Promise<Key> => {
    const batch = (await getBatch(session.batch_id))!;
    const { phase } = timing(session, batch);
    if (!staffStatuses(phase).includes(status)) return 'statusNotNow';
    const [b] = await tx<Booking[]>`
      select * from bookings where id = ${int(form, 'bookingId')} and session_id = ${sid} for update`;
    if (!b) return 'noBooking';
    if (b.status === status) return 'statusSaved';

    await tx`
      update bookings set status = ${status}, checked_by = ${staff.id}, updated_at = now(),
        confirmed_at = case when ${status} = 'booked' then null
                            when ${status} in ('confirmed', 'present') then coalesce(confirmed_at, now())
                            else confirmed_at end,
        attended_at = case when ${status} = 'present' then coalesce(attended_at, now()) else null end
      where id = ${b.id}`;
    if (status === 'withdrawn') {
      await refundBookings(tx, [b.id], staff.id);
    } else {
      if (b.status === 'withdrawn') await assignPlan(tx, b.id);
      if (phase !== 'open') await chargeBookings(tx, [b.id]);
    }
    return 'statusSaved';
  });
  back(`/roster?sid=${sid}`, key);
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

// ---------- Players ----------

/** Core/admin register a floater. They sign in with this number and set their own PIN, like staff do. */
export async function addPlayer(form: FormData) {
  await requireStaff('members');
  const phone = normalizePhone(str(form, 'phone'));
  const name = personName(form);
  if (!phone) back('/members', 'errPhone');
  if (!name) back('/members', 'errName');
  const [added] = await sql<Player[]>`
    insert into players (first_name, last_name, phone) values (${name.first}, ${name.last}, ${phone})
    on conflict (phone) do nothing returning *`;
  if (!added) {
    const [p] = await sql<Player[]>`select * from players where phone = ${phone}`;
    back('/members', 'errPlayerExists', { name: p?.name ?? phone });
  }
  back('/members', 'playerAdded', { name: added.name });
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

/** Clear someone's PIN (they forgot it). They're signed out everywhere and set a new one at next sign-in. */
export async function resetPin(form: FormData) {
  const staff = await requireStaff('pins');
  const path = safePath(str(form, 'back') || '/members');
  const [target] = await sql<Player[]>`select * from players where id = ${int(form, 'id')}`;
  if (!target || !canResetPin(staff, target)) back(path, 'errCantReset');
  await sql`update players set pin_hash = null, pin_reset_requested_at = null where id = ${target.id}`;
  await clear(`pin:${target.id}`);
  back(path, 'pinReset', { name: target.name });
}

/** Same, but found by phone number, for someone who calls instead of tapping "Forgot PIN". */
export async function resetPinByPhone(form: FormData) {
  const staff = await requireStaff('pins');
  const phone = normalizePhone(str(form, 'phone'));
  if (!phone) back('/members', 'errPhone');
  const [target] = await sql<Player[]>`select * from players where phone = ${phone}`;
  if (!target) back('/members', 'errNoPlayer');
  if (!canResetPin(staff, target)) back('/members', 'errCantReset');
  await sql`update players set pin_hash = null, pin_reset_requested_at = null where id = ${target.id}`;
  await clear(`pin:${target.id}`);
  back('/members', 'pinReset', { name: target.name });
}

/** Ignore a "Forgot PIN" request (e.g. it wasn't really them). Their PIN stays as it is. */
export async function dismissPinRequest(form: FormData) {
  const staff = await requireStaff('pins');
  const [target] = await sql<Player[]>`select * from players where id = ${int(form, 'id')}`;
  if (target && canResetPin(staff, target)) {
    await sql`update players set pin_reset_requested_at = null where id = ${target.id}`;
  }
  back('/members', 'pinRequestDismissed');
}

/**
 * Admin switches a player off: they're signed out everywhere and can't sign in. Their votes for sessions that
 * haven't started are withdrawn (giving back any plan session already taken) and open plan requests are closed.
 * Their plan itself is kept, so reactivating puts them back where they were.
 */
export async function deactivatePlayer(form: FormData) {
  const admin = await requireStaff('staff');
  const id = int(form, 'id');
  const name = await sql.begin(async (tx) => {
    const [p] = await tx<Player[]>`
      update players set deactivated_at = now(), pin_reset_requested_at = null
      where id = ${id} and id <> ${admin.id} and role = 'player' and deactivated_at is null returning *`;
    if (!p) return null;
    const upcoming = await tx<{ id: number }[]>`
      select b.id from bookings b join sessions s on s.id = b.session_id
      where b.player_id = ${id} and b.status in ('booked', 'confirmed') and s.starts_at > now() and not s.cancelled`;
    await refundBookings(tx, upcoming.map((b) => b.id), admin.id);
    await tx`
      update bookings set status = 'withdrawn', confirmed_at = null, checked_by = ${admin.id}, updated_at = now()
      where id = any(${upcoming.map((b) => b.id)}::int[])`;
    await tx`
      update membership_requests set status = 'rejected', handled_by = ${admin.id}, handled_at = now()
      where player_id = ${id} and status in ('pending', 'quoted')`;
    return p.name;
  });
  back('/admin', name ? 'playerDeactivated' : 'errCantDeactivate', { name: name ?? '' });
}

export async function reactivatePlayer(form: FormData) {
  await requireStaff('staff');
  const [p] = await sql<Player[]>`
    update players set deactivated_at = null where id = ${int(form, 'id')} and deactivated_at is not null returning *`;
  back('/admin', 'playerReactivated', { name: p?.name ?? '' });
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
