'use server';

import { refresh } from 'next/cache';
import { sql, type Tx, type Booking, type BookingStatus, type Membership, type Player, type PlanType } from '@/lib/db';
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

/**
 * Fee collected, or (for someone who backed out after paying) refunded. The form says which state it wants
 * (`paid` = 1 or 0), so a double tap or two staff pressing the same button end in the same place instead of undoing each other.
 */
export async function togglePaid(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  const paid = int(form, 'paid') === 1;
  // The amount is fixed now (seat unless the plan covers it, plus friends, at this batch's price), so revenue
  // stays right if the price changes later. Refunding (paid → no) clears it.
  await sql`
    update bookings b set paid = ${paid}, updated_at = now(),
      paid_rupees = case when ${paid} then ((b.membership_id is null)::int + b.guests) * round(bt.price_rupees * bt.duration_min / 60.0) end
    from sessions s join batches bt on bt.id = s.batch_id
    where b.id = ${int(form, 'bookingId')} and b.session_id = ${sid} and s.id = b.session_id`;
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

/** A court number from the form: 1 to 99, or null. */
const courtNo = (f: FormData) => {
  const n = int(f, 'court');
  return n >= 1 && n <= 99 ? n : null;
};

/** Adds a court (by its exact number) to one session: players see it, and its seats open up. Adding it twice does nothing. */
export async function addCourt(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  const n = courtNo(form);
  if (!n) back(`/roster?sid=${sid}`, 'errCourt');
  const done = await sql`
    update sessions s set capacity = s.capacity + b.players_per_court,
      court_numbers = (select array_agg(x order by x) from unnest(array_append(s.court_numbers, ${n}::int)) x)
    from batches b
    where s.id = ${sid} and b.id = s.batch_id and not s.cancelled and not s.closed and not (${n}::int = any(s.court_numbers))
    returning s.id`;
  back(`/roster?sid=${sid}`, done.length ? 'courtAdded' : 'courtExists', { n });
}

/** Takes one court (by number) out of a session. Taking it out twice does nothing. */
export async function removeCourt(form: FormData) {
  await requireStaff('roster');
  const sid = int(form, 'sessionId');
  const n = courtNo(form);
  if (!n) back(`/roster?sid=${sid}`, 'errCourt');
  await sql`
    update sessions s set capacity = greatest(0, s.capacity - b.players_per_court), court_numbers = array_remove(s.court_numbers, ${n}::int)
    from batches b
    where s.id = ${sid} and b.id = s.batch_id and not s.cancelled and not s.closed and ${n}::int = any(s.court_numbers)`;
  back(`/roster?sid=${sid}`, 'courtRemoved', { n });
}

export async function cancelSession(form: FormData) {
  const staff = await requireStaff('cancel');
  const sid = int(form, 'sessionId');
  if (str(form, 'confirm') !== 'CANCEL') back(`/roster?sid=${sid}`, 'cancelConfirm');
  await withLockedSession(sid, async (tx, session) => {
    if (session.cancelled) return;
    await cancelSessions(tx, [sid], staff.id);
  });
  back(`/roster?sid=${sid}`, 'cancelDone');
}

/**
 * Cancels sessions: plan sessions already charged go back, everyone's vote is withdrawn (a paid floater then
 * shows as a refund), and the sessions are closed.
 */
async function cancelSessions(tx: Tx, ids: number[], by: number) {
  if (ids.length === 0) return;
  const charged = await tx<{ id: number }[]>`select id from bookings where session_id = any(${ids}::int[]) and charged`;
  await refundBookings(tx, charged.map((b) => b.id), by);
  await tx`update bookings set status = 'withdrawn', membership_id = null, updated_at = now() where session_id = any(${ids}::int[])`;
  await tx`update sessions set cancelled = true, locked = true, closed = true where id = any(${ids}::int[])`;
}

// ---------- Players ----------

/** Core/admin register a floater directly (already approved). They sign in with this number and set their own PIN. */
export async function addPlayer(form: FormData) {
  const staff = await requireStaff('members');
  const phone = normalizePhone(str(form, 'phone'));
  const name = personName(form);
  if (!phone) back('/members', 'errPhone');
  if (!name) back('/members', 'errName');
  const [added] = await sql<Player[]>`
    insert into players (first_name, last_name, phone, approved_at, approved_by)
    values (${name.first}, ${name.last}, ${phone}, now(), ${staff.id})
    on conflict (phone) do nothing returning *`;
  if (!added) {
    const [p] = await sql<Player[]>`select * from players where phone = ${phone}`;
    if (p?.deleted_at) back('/members', 'errPlayerDeleted', { name: p.name });
    // Someone already asked to join with this number: adding them is the same as approving.
    if (p && !p.approved_at) {
      await sql`update players set approved_at = now(), approved_by = ${staff.id} where id = ${p.id}`;
      back('/members', 'playerApproved', { name: p.name });
    }
    back('/members', 'errPlayerExists', { name: p?.name ?? phone });
  }
  back('/members', 'playerAdded', { name: added.name });
}

/** Approve a self sign-up. They can now sign in with their number and set a PIN. */
export async function approveSignup(form: FormData) {
  const staff = await requireStaff('members');
  const [p] = await sql<Player[]>`
    update players set approved_at = now(), approved_by = ${staff.id}
    where id = ${int(form, 'id')} and approved_at is null and deactivated_at is null returning *`;
  // Lost the race: another staff member approved or rejected this person first.
  if (!p) back('/requests', 'alreadyHandled');
  back('/requests', 'playerApproved', { name: p.name });
}

/** Turn a sign-up down. The request is removed; the number can ask again later. */
export async function rejectSignup(form: FormData) {
  await requireStaff('members');
  const [p] = await sql<Player[]>`
    delete from players p where p.id = ${int(form, 'id')} and p.approved_at is null and p.pin_hash is null
      and not exists (select 1 from bookings b where b.player_id = p.id)
      and not exists (select 1 from memberships m where m.player_id = p.id)
      and not exists (select 1 from membership_requests r where r.player_id = p.id)
    returning *`;
  if (!p) back('/requests', 'alreadyHandled');
  back('/requests', 'signupRejected', { name: p.name });
}

// ---------- Memberships ----------

/** Step 1 of a request: tell the player what to pay. They see the amount on their home screen. */
export async function quoteRequest(form: FormData) {
  const staff = await requireStaff('members');
  const amount = Math.max(0, int(form, 'amount'));
  if (amount < 1) back('/requests', 'errAmount');
  const sessions = Math.min(400, Math.max(0, int(form, 'sessions'))) || null;
  const [r] = await sql<{ name: string }[]>`
    update membership_requests r set status = 'quoted', amount_rupees = ${amount},
      sessions_requested = coalesce(${sessions}, r.sessions_requested), handled_by = ${staff.id}, handled_at = now()
    from players p where r.id = ${int(form, 'requestId')} and p.id = r.player_id and r.status in ('pending', 'quoted')
    returning p.name`;
  back('/requests', r ? 'quoteSent' : 'alreadyHandled', { name: r?.name ?? '', amount });
}

/**
 * Step 2: payment received → activate. Also creates a plan for any phone number, edits a plan,
 * or (wallet + live wallet) tops the existing balance up.
 */
export async function savePlan(form: FormData) {
  const staff = await requireStaff('members');
  const to = safePath(str(form, 'back') || '/members'); // Members, Requests or Players
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
  if (batchId !== null && !(await getBatch(batchId))) back(to, 'errSessions');
  if (days.length === 0) back(to, 'errDays');
  if (total < 1) back(to, 'errSessions');
  if (endsOn && startsOn > endsOn) back(to, 'errDateRange');

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
      // Sessions added or taken off, and/or the amount paid corrected: one history line, so the balance and the
      // money can both be explained later. Extra sessions with no money are free sessions given by staff.
      const moneyChange = amount !== null && amount !== old.amount_rupees ? amount - (old.amount_rupees ?? 0) : null;
      if (newTotal !== old.sessions_total || moneyChange !== null) {
        await ledger(tx, { membershipId: m.id, delta: newTotal - old.sessions_total, reason: 'adjust', amount: moneyChange, note, by: staff.id });
      }
      await recheckBookings(tx, m.player_id);
      return ['planSaved', { name: m.name }];
    }

    // New: from a request, or by phone number
    let player: Player | undefined;
    if (requestId) {
      [player] = await tx<Player[]>`
        select p.* from membership_requests r join players p on p.id = r.player_id
        where r.id = ${requestId} and r.status in ('pending', 'quoted')
        for update of r`; // a second staff member activating the same request waits here, then finds it handled
      if (!player) return ['alreadyHandled'];
    } else {
      const phone = normalizePhone(str(form, 'phone'));
      if (!phone) return ['errPhone'];
      const [gone] = await tx<Player[]>`select * from players where phone = ${phone} and deleted_at is not null`;
      if (gone) return ['errPlayerDeleted', { name: gone.name }];
      // Giving someone a plan also approves them if they were still waiting.
      [player] = await tx<Player[]>`
        update players set approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, ${staff.id})
        where phone = ${phone} returning *`;
      if (!player) {
        const name = personName(form);
        if (!name) return ['errName'];
        [player] = await tx<Player[]>`
          insert into players (first_name, last_name, phone, approved_at, approved_by)
          values (${name.first}, ${name.last}, ${phone}, now(), ${staff.id}) returning *`;
      }
    }
    if (!player) return ['noRequests'];

    const [old] = await tx<Membership[]>`
      select * from memberships where player_id = ${player.id} and status = 'active' for update`;
    let result: [Key, Record<string, string | number>];
    if (old && planLive(old) && old.kind === 'wallet' && kind === 'wallet') {
      if (!(await firstUse(tx, form))) return ['alreadyHandled'];
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
      if (!(await firstUse(tx, form))) return ['alreadyHandled'];
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
  back(to, key, vars);
}

/**
 * One-time form token (made when the form opens). A resubmitted form, such as a retry after a bad connection,
 * can't credit the same top-up or create the same plan twice. Lives in the transaction, so it only counts if the write does.
 */
async function firstUse(tx: Tx, form: FormData) {
  const token = str(form, 'token').slice(0, 64);
  if (!token) return true;
  const rows = await tx`
    insert into rate_limits (key, count, window_start) values (${`form:${token}`}, 1, now())
    on conflict (key) do nothing returning key`;
  return rows.length > 0;
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
  const done = await sql`
    update membership_requests set status = 'rejected', handled_by = ${staff.id}, handled_at = now()
    where id = ${int(form, 'requestId')} and status in ('pending', 'quoted') returning id`;
  back('/requests', done.length ? 'requestRejected' : 'alreadyHandled');
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
  if (p?.deleted_at) back('/admin', 'errPlayerDeleted', { name: p.name });
  if (!p && !name) back('/admin', 'errName');
  const [saved] = p
    ? await sql<Player[]>`
        update players set role = ${role}, approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, ${admin.id})
        where id = ${p.id} returning *`
    : await sql<Player[]>`
        insert into players (first_name, last_name, phone, role, approved_at, approved_by)
        values (${name!.first}, ${name!.last}, ${phone!}, ${role}, now(), ${admin.id}) returning *`;
  back('/admin', 'staffSaved', { name: saved.name, role });
}

/** Clear someone's PIN (they forgot it). They're signed out everywhere and set a new one at next sign-in. */
export async function resetPin(form: FormData) {
  const staff = await requireStaff('pins');
  const path = safePath(str(form, 'back') || '/members');
  const [target] = await sql<Player[]>`select * from players where id = ${int(form, 'id')} and deleted_at is null`;
  if (!target || !canResetPin(staff, target)) back(path, 'errCantReset');
  // From the "Forgot PIN" list: only if the request is still open. If another staff member already reset it and the
  // player has chosen a new PIN, a second reset would wipe that new PIN.
  const [done] = await sql`
    update players set pin_hash = null, pin_reset_requested_at = null
    where id = ${target.id} and (${str(form, 'requested') !== '1'} or pin_reset_requested_at is not null) returning id`;
  if (!done) back(path, 'alreadyHandled');
  await clear(`pin:${target.id}`);
  back(path, 'pinReset', { name: target.name });
}

/** Same, but found by phone number, for someone who calls instead of tapping "Forgot PIN". */
export async function resetPinByPhone(form: FormData) {
  const staff = await requireStaff('pins');
  const phone = normalizePhone(str(form, 'phone'));
  if (!phone) back('/members', 'errPhone');
  const [target] = await sql<Player[]>`select * from players where phone = ${phone} and deleted_at is null`;
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
  back('/requests', 'pinRequestDismissed');
}

/**
 * Signs a player out of everything that's still ahead: votes for sessions that haven't started are withdrawn
 * (giving back any plan session already taken) and open plan requests are closed. The plan itself is kept.
 */
async function switchOff(tx: Tx, id: number, by: number) {
  const upcoming = await tx<{ id: number }[]>`
    select b.id from bookings b join sessions s on s.id = b.session_id
    where b.player_id = ${id} and b.status in ('booked', 'confirmed') and s.starts_at > now() and not s.cancelled`;
  await refundBookings(tx, upcoming.map((b) => b.id), by);
  await tx`
    update bookings set status = 'withdrawn', confirmed_at = null, checked_by = ${by}, updated_at = now()
    where id = any(${upcoming.map((b) => b.id)}::int[])`;
  await tx`
    update membership_requests set status = 'rejected', handled_by = ${by}, handled_at = now()
    where player_id = ${id} and status in ('pending', 'quoted')`;
}

/** Where to go after an action on the Players page: back to the same filters and page. */
const playersBack = (form: FormData) => safePath(str(form, 'back') || '/players');

/**
 * Admin switches a player off: they're signed out everywhere and can't sign in (see switchOff).
 * Reactivating puts them back where they were.
 */
export async function deactivatePlayer(form: FormData) {
  const admin = await requireStaff('staff');
  const id = int(form, 'id');
  const name = await sql.begin(async (tx) => {
    const [p] = await tx<Player[]>`
      update players set deactivated_at = now(), pin_reset_requested_at = null
      where id = ${id} and id <> ${admin.id} and role = 'player' and deactivated_at is null and deleted_at is null returning *`;
    if (!p) return null;
    await switchOff(tx, id, admin.id);
    return p.name;
  });
  back(playersBack(form), name ? 'playerDeactivated' : 'errCantDeactivate', { name: name ?? '' });
}

export async function reactivatePlayer(form: FormData) {
  await requireStaff('staff');
  const [p] = await sql<Player[]>`
    update players set deactivated_at = null
    where id = ${int(form, 'id')} and deactivated_at is not null and deleted_at is null returning *`;
  back(playersBack(form), 'playerReactivated', { name: p?.name ?? '' });
}

/**
 * Soft delete (admin only, players only): the account is deactivated as well, and disappears from every list
 * and count. Their history (past sessions, payments, plan ledger) is kept, and the number can't be reused
 * until an admin restores them from Players → Deleted.
 */
export async function deletePlayer(form: FormData) {
  const admin = await requireStaff('staff');
  const id = int(form, 'id');
  const name = await sql.begin(async (tx) => {
    const [p] = await tx<Player[]>`
      update players set deleted_at = now(), deleted_by = ${admin.id},
        deactivated_at = coalesce(deactivated_at, now()), pin_reset_requested_at = null
      where id = ${id} and id <> ${admin.id} and role = 'player' and deleted_at is null returning *`;
    if (!p) return null;
    await switchOff(tx, id, admin.id);
    return p.name;
  });
  back(playersBack(form), name ? 'playerDeleted' : 'errCantDelete', { name: name ?? '' });
}

/** Brings a deleted player back into the lists. They stay deactivated until an admin reactivates them. */
export async function restorePlayer(form: FormData) {
  await requireStaff('staff');
  const [p] = await sql<Player[]>`
    update players set deleted_at = null, deleted_by = null
    where id = ${int(form, 'id')} and deleted_at is not null returning *`;
  back(playersBack(form), p ? 'playerRestored' : 'alreadyHandled', { name: p?.name ?? '' });
}

export async function removeStaff(form: FormData) {
  const admin = await requireStaff('staff');
  const id = int(form, 'id');
  if (id === admin.id) back('/admin', 'errSelf');
  const [p] = await sql<Player[]>`
    update players set role = 'player', pin_hash = null where id = ${id} returning *`;
  back('/admin', 'staffRemoved', { name: p?.name ?? '' });
}

// ---------- Halls and batches (admin, no code needed) ----------

const HALLS = '/admin#halls';
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Add a hall, or edit one. Switching a hall off switches its batches off too (their upcoming sessions are cancelled). */
export async function saveVenue(form: FormData) {
  const admin = await requireStaff('batches');
  const id = int(form, 'id');
  const name = str(form, 'name').slice(0, 80);
  if (!name) back(HALLS, 'errHallName');
  const address = str(form, 'address').slice(0, 200) || null;
  const map = str(form, 'mapUrl');
  const mapUrl = /^https:\/\/\S+$/.test(map) ? map.slice(0, 300) : null;
  const courts = clamp(int(form, 'courts'), 1, 99);
  if (!id) {
    await sql`insert into venues (name, address, map_url, courts) values (${name}, ${address}, ${mapUrl}, ${courts})`;
    back(HALLS, 'hallSaved', { name });
  }
  const active = str(form, 'active') === '1';
  // Courts can't shrink below the numbers its batches play on.
  const [used] = await sql<{ n: number | null }[]>`
    select max(c)::int as n from batches b, unnest(b.court_numbers) c where b.venue_id = ${id} and b.active`;
  if (active && used?.n && courts < used.n) back(HALLS, 'errHallCourts', { n: used.n });
  await sql.begin(async (tx) => {
    await tx`update venues set name = ${name}, address = ${address}, map_url = ${mapUrl}, courts = ${courts}, active = ${active} where id = ${id}`;
    if (!active) {
      const off = await tx<{ id: string }[]>`update batches set active = false where venue_id = ${id} and active returning id`;
      await cancelUpcoming(tx, off.map((b) => b.id), admin.id);
    }
  });
  back(HALLS, 'hallSaved', { name });
}

/** Sessions of these batches that haven't started yet (and aren't locked in), cancelled. */
async function cancelUpcoming(tx: Tx, batchIds: string[], by: number, onlyDays?: number[]) {
  if (batchIds.length === 0) return;
  const rows = await tx<{ id: number }[]>`
    select id from sessions
    where batch_id = any(${batchIds}::text[]) and not cancelled and not locked and starts_at > now()
      ${onlyDays ? sql`and not (extract(dow from date)::int = any(${onlyDays}::int[]))` : sql``}
    for update`;
  await cancelSessions(tx, rows.map((r) => r.id), by);
}

/**
 * Add a batch, or edit one: name, hall, start time, length, the days it runs, its courts, players per court and
 * the fee per hour. Sessions that haven't started pick up the changes. Switching a batch off, or taking a day
 * away, cancels its upcoming sessions on those days.
 */
export async function saveBatch(form: FormData) {
  const admin = await requireStaff('batches');
  const id = str(form, 'id');
  const label = str(form, 'label').slice(0, 40);
  if (!label) back(HALLS, 'errBatchName');
  const [venue] = await sql<{ id: number; courts: number }[]>`select id, courts from venues where id = ${int(form, 'venueId')}`;
  if (!venue) back(HALLS, 'errHallName');
  const start = str(form, 'startTime');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) back(HALLS, 'errTime');
  const duration = clamp(int(form, 'duration') || 60, 15, 300);
  const days = [...new Set(form.getAll('days').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (days.length === 0) back(HALLS, 'errDays');
  // "1, 2" or "4 5 6": the exact courts this batch plays on, all inside the hall.
  const numbers = [...new Set(str(form, 'courtNumbers').split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 99))].sort((x, y) => x - y);
  if (numbers.length === 0) back(HALLS, 'errCourts');
  if (numbers.some((n) => n > venue.courts)) back(HALLS, 'errCourtRange', { n: venue.courts });
  const perCourt = clamp(int(form, 'playersPerCourt') || 4, 1, 12);
  const price = Math.max(0, int(form, 'price'));

  if (!id) {
    // A readable id from the name, made unique: "Saturday morning" → "saturday-morning-x7k2".
    const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'batch';
    const newId = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    await sql`
      insert into batches (id, label, start_time, duration_min, courts, court_numbers, players_per_court, price_rupees, venue_id, days)
      values (${newId}, ${label}, ${start}, ${duration}, ${numbers.length}, ${numbers}, ${perCourt}, ${price}, ${venue.id}, ${days})`;
    back(HALLS, 'batchAdded', { name: label });
  }

  const active = str(form, 'active') === '1';
  await sql.begin(async (tx) => {
    await tx`
      update batches set label = ${label}, venue_id = ${venue.id}, start_time = ${start}, duration_min = ${duration}, days = ${days},
        courts = ${numbers.length}, court_numbers = ${numbers}, players_per_court = ${perCourt}, price_rupees = ${price},
        active = ${active} and (select active from venues where id = ${venue.id})
      where id = ${id}`;
    if (!active) await cancelUpcoming(tx, [id], admin.id);
    else await cancelUpcoming(tx, [id], admin.id, days); // days taken away
    // Sessions that haven't started (and aren't locked in) pick up the new courts and time.
    await tx`
      update sessions set capacity = ${numbers.length * perCourt}, court_numbers = ${numbers},
        starts_at = case when locked then starts_at else (date + ${start}::time) at time zone 'Asia/Kolkata' end
      where batch_id = ${id} and starts_at > now() and not cancelled`;
  });
  back(HALLS, 'batchSaved');
}
