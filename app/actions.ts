'use server';

import { redirect } from 'next/navigation';
import { sql, type Booking, type Lang, type Membership, type Player } from '@/lib/db';
import { back, int, personName, safePath, str, withLockedSession } from '@/lib/action-utils';
import {
  claim, currentPlayer, hashPin, LANGS, lockStaff, normalizePhone, pinProblem,
  requirePlayer, setLangCookie, signIn, signOut, verifyPin, viewer, isStaff,
} from '@/lib/auth';
import { clear, clientIp, hit } from '@/lib/ratelimit';
import { activePlan, bookable, chargeBookings, covers, planBlocks, planLive, reservedSessions } from '@/lib/members';
import { bookedSeats, getBatch, timing } from '@/lib/sessions';
import type { Key } from '@/lib/i18n';

// ---------- Language ----------

export async function setLang(form: FormData) {
  const lang = str(form, 'lang') as Lang;
  if (LANGS.includes(lang)) {
    await setLangCookie(lang);
    const me = await currentPlayer();
    if (me) await sql`update players set lang = ${lang} where id = ${me.id}`;
  }
  redirect(safePath(str(form, 'path')));
}

// ---------- Sign in ----------
// phone (added by core/admin) → PIN (set it the first time or after a reset, enter it otherwise) → signed in.

export async function join(form: FormData) {
  const limit = await hit(`join:${await clientIp()}`, 20, 600);
  if (!limit.ok) return back('/', 'tooMany', { min: limit.retryMin });

  const phone = normalizePhone(str(form, 'phone'));
  if (!phone) return back('/', 'errPhone');
  // No self sign-up: core/admin add people first (Members → Add a player).
  const [player] = await sql<Player[]>`select * from players where phone = ${phone}`;
  if (!player) return back('/', 'notRegistered');
  if (player.deactivated_at) return back('/', 'accountDeactivated');
  await claim(player.id);
  redirect('/'); // the PIN screen
}

/** Players fix their own first and last name. */
export async function updateName(form: FormData) {
  const me = await requirePlayer();
  const name = personName(form);
  if (!name) return back('/', 'errName');
  await sql`update players set first_name = ${name.first}, last_name = ${name.last} where id = ${me.id}`;
  return back('/', 'nameSaved');
}

export async function leave() {
  await signOut();
  redirect('/');
}

export async function lock() {
  await lockStaff();
  redirect('/');
}

/** First sign-in, or the PIN was reset by core/admin: choose a new PIN. */
export async function setPin(form: FormData) {
  const { player: me, gate } = await viewer();
  if (!me || gate !== 'set') redirect('/');
  const limit = await hit(`pinset:${await clientIp()}`, 10, 900);
  if (!limit.ok) return back('/', 'tooMany', { min: limit.retryMin });

  const pin = str(form, 'pin');
  const problem = pinProblem(pin);
  if (problem) return back('/', problem);
  if (pin !== str(form, 'pin2')) return back('/', 'errPinMismatch');

  const [updated] = await sql<Player[]>`
    update players set pin_hash = ${hashPin(pin)}, pin_reset_requested_at = null
    where id = ${me.id} and pin_hash is null returning *`;
  if (updated?.pin_hash) await signIn({ ...updated, pin_hash: updated.pin_hash });
  redirect('/');
}

/** Sign in (everyone) or unlock (staff). Limited per account (5 wrong tries / 15 min) and per IP (30 / 15 min). */
export async function enterPin(form: FormData) {
  const { player: me, gate } = await viewer();
  if (!me?.pin_hash || gate !== 'enter') redirect('/');

  const ipLimit = await hit(`pinip:${await clientIp()}`, 30, 900);
  const accLimit = await hit(`pin:${me.id}`, 5, 900);
  if (!ipLimit.ok || !accLimit.ok) {
    return back('/', 'tooMany', { min: Math.max(ipLimit.ok ? 0 : ipLimit.retryMin, accLimit.ok ? 0 : accLimit.retryMin) });
  }
  if (!verifyPin(str(form, 'pin'), me.pin_hash)) {
    return back('/', 'errPinWrong', { left: accLimit.remaining });
  }
  await clear(`pin:${me.id}`);
  await sql`update players set pin_reset_requested_at = null where id = ${me.id}`; // remembered it after all
  await signIn({ ...me, pin_hash: me.pin_hash });
  redirect('/');
}

/** "Forgot PIN": asks core/admin to clear it. Once they do, the player sets a new one on this screen. */
export async function forgotPin() {
  const { player: me, gate } = await viewer();
  if (!me?.pin_hash || gate !== 'enter') redirect('/');
  const limit = await hit(`pinforgot:${await clientIp()}`, 5, 3600);
  if (!limit.ok) return back('/', 'tooMany', { min: limit.retryMin });
  await sql`update players set pin_reset_requested_at = now() where id = ${me.id} and pin_reset_requested_at is null`;
  return back('/', 'pinResetRequested');
}

// ---------- Booking ----------

type Msg = [Key, Record<string, number | string>?];

/** Vote for a slot. Members' own seat goes on their plan; fixed plans only vote for their batch and days. */
export async function book(form: FormData) {
  const me = await requirePlayer();
  if (isStaff(me.role)) return back('/', 'bookingClosed'); // staff run sessions, they don't book
  const guests = str(form, 'mode') === 'friends' ? Math.min(10, Math.max(1, int(form, 'guests'))) : 0;

  const result = await withLockedSession(int(form, 'sessionId'), async (tx, session): Promise<Msg> => {
    const batch = (await getBatch(session.batch_id))!;
    if (!timing(session, batch).canBook) return ['bookingClosed'];

    const [existing] = await tx<Booking[]>`
      select * from bookings where session_id = ${session.id} and player_id = ${me.id} for update`;
    if (existing && existing.status !== 'withdrawn') return ['alreadyBooked'];

    const [plan] = await tx<Membership[]>`
      select * from memberships where player_id = ${me.id} and status = 'active' for update`;
    if (planBlocks(plan, session)) return ['planOnly'];
    let membershipId: number | null = null;
    if (covers(plan, session)) {
      if (bookable(plan, await reservedSessions(tx, plan.id, existing?.id)) < 1) {
        return [plan.kind === 'wallet' ? 'walletEmpty' : 'planAllBooked'];
      }
      membershipId = plan.id;
    }

    const need = 1 + guests;
    if ((await bookedSeats(tx, session.id)) + need > session.capacity) {
      return need > 1 ? ['notEnough', { n: need }] : ['sessionFull'];
    }
    const [row] = existing
      ? await tx<{ id: number }[]>`
          update bookings set status = 'booked', guests = ${guests}, source = 'self', paid = false,
            membership_id = ${membershipId}, charged = false, confirmed_at = null, attended_at = null, updated_at = now()
          where id = ${existing.id} returning id`
      : await tx<{ id: number }[]>`
          insert into bookings (session_id, player_id, guests, membership_id)
          values (${session.id}, ${me.id}, ${guests}, ${membershipId}) returning id`;
    // Joined after the lock: the slot is final straight away.
    if (session.locked) await chargeBookings(tx, [row.id]);
    return ['booked'];
  });
  return back('/', ...result);
}

/** Back out. Only until 30 min before the start; after that the slot is paid for. */
export async function withdraw(form: FormData) {
  const me = await requirePlayer();
  const key = await withLockedSession(int(form, 'sessionId'), async (tx, session): Promise<Key> => {
    const batch = (await getBatch(session.batch_id))!;
    if (!timing(session, batch).canWithdraw) return 'tooLateToWithdraw';
    const [row] = await tx`
      update bookings set status = 'withdrawn', confirmed_at = null, updated_at = now()
      where session_id = ${session.id} and player_id = ${me.id} and status in ('booked', 'confirmed') and not charged
      returning id`;
    return row ? 'withdrawn' : 'noBooking';
  });
  return back('/', key);
}

/** "I'm coming": opens 12 h before the start. */
export async function confirmSlot(form: FormData) {
  const me = await requirePlayer();
  const key = await withLockedSession(int(form, 'sessionId'), async (tx, session): Promise<Key> => {
    const batch = (await getBatch(session.batch_id))!;
    const tm = timing(session, batch);
    if (!tm.canConfirm) return tm.phase === 'open' ? 'confirmNotYet' : 'bookingClosed';
    const [row] = await tx`
      update bookings set status = 'confirmed', confirmed_at = now(), updated_at = now()
      where session_id = ${session.id} and player_id = ${me.id} and status = 'booked'
      returning id`;
    return row ? 'slotConfirmed' : 'noBooking';
  });
  return back('/', key);
}

/** "I played": the player's own attendance, from the start until the session closes. */
export async function markAttended(form: FormData) {
  const me = await requirePlayer();
  const key = await withLockedSession(int(form, 'sessionId'), async (tx, session): Promise<Key> => {
    const batch = (await getBatch(session.batch_id))!;
    if (!timing(session, batch).canAttend) return 'attendClosed';
    const [row] = await tx<{ id: number }[]>`
      update bookings set status = 'present', attended_at = now(), updated_at = now()
      where session_id = ${session.id} and player_id = ${me.id} and status in ('booked', 'confirmed')
      returning id`;
    if (row) await chargeBookings(tx, [row.id]); // normally already charged at the lock
    return row ? 'attended' : 'noBooking';
  });
  return back('/', key);
}

// ---------- Membership request ----------

/** Ask for a plan, or (wallet members) a top-up. Staff quote the amount, collect it and activate. */
export async function applyMembership(form: FormData) {
  const me = await requirePlayer();
  const plan = await activePlan(me.id);
  const kind = (['month', 'weekdays', 'weekends', 'wallet'] as const).find((k) => k === str(form, 'plan')) ?? 'month';
  const live = plan && planLive(plan);
  // A live wallet can be topped up; any other live plan has to run out first.
  if (live && !(plan.kind === 'wallet' && kind === 'wallet')) return back('/', 'alreadyMember');

  const sessions = Math.min(400, Math.max(0, int(form, 'sessions'))) || null;
  if (kind === 'wallet' && !sessions) return back('/', 'errSessions');
  const batch = kind === 'wallet' ? null : await getBatch(str(form, 'batchId'));
  if (kind !== 'wallet' && !batch) return back('/', 'errDays');
  const [row] = await sql`
    insert into membership_requests (player_id, batch_id, plan, sessions_requested, note)
    values (${me.id}, ${batch?.id ?? null}, ${kind}, ${sessions}, ${str(form, 'note').slice(0, 200) || null})
    on conflict (player_id) where status in ('pending', 'quoted') do nothing
    returning id`;
  return back('/', row ? 'applyPending' : 'requestExists');
}

/** Withdraw your own open request. */
export async function cancelRequest() {
  const me = await requirePlayer();
  await sql`
    update membership_requests set status = 'rejected', handled_at = now()
    where player_id = ${me.id} and status in ('pending', 'quoted')`;
  return back('/', 'requestCancelled');
}
