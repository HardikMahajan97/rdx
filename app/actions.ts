'use server';

import { redirect } from 'next/navigation';
import { sql, type Booking, type Lang, type Player } from '@/lib/db';
import { back, int, safePath, str, withLockedSession } from '@/lib/action-utils';
import {
  currentPlayer, getLang, hashPin, isStaff, LANGS, lockStaff, normalizePhone, pinProblem,
  requirePlayer, setLangCookie, signIn, signOut, unlockStaff, verifyPin,
} from '@/lib/auth';
import { clear, clientIp, hit } from '@/lib/ratelimit';
import { activePlan, planLive } from '@/lib/members';
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

export async function join(form: FormData) {
  const limit = await hit(`join:${await clientIp()}`, 20, 600);
  if (!limit.ok) return back('/', 'tooMany', { min: limit.retryMin });

  const phone = normalizePhone(str(form, 'phone'));
  if (!phone) return back('/', 'errPhone');
  const name = str(form, 'name').slice(0, 60);

  let [player] = await sql<Player[]>`select * from players where phone = ${phone}`;
  if (!player) {
    if (!name) return back('/', 'errName');
    [player] = await sql<Player[]>`
      insert into players (name, phone, lang) values (${name}, ${phone}, ${await getLang()}) returning *`;
  }
  await signIn(player.id);
  redirect('/'); // staff land on the PIN screen
}

export async function leave() {
  await signOut();
  redirect('/');
}

export async function lock() {
  await lockStaff();
  redirect('/');
}

/** First sign-in of a core member / admin: choose a PIN. */
export async function setPin(form: FormData) {
  const me = await currentPlayer();
  if (!me || !isStaff(me.role) || me.pin_hash) redirect('/');
  const limit = await hit(`pinset:${await clientIp()}`, 10, 900);
  if (!limit.ok) return back('/', 'tooMany', { min: limit.retryMin });

  const pin = str(form, 'pin');
  const problem = pinProblem(pin);
  if (problem) return back('/', problem);
  if (pin !== str(form, 'pin2')) return back('/', 'errPinMismatch');

  const [updated] = await sql<Player[]>`
    update players set pin_hash = ${hashPin(pin)} where id = ${me.id} and pin_hash is null returning *`;
  if (updated?.pin_hash) await unlockStaff({ ...updated, pin_hash: updated.pin_hash });
  redirect('/');
}

/** Staff unlock. Limited per account (5 wrong tries / 15 min) and per IP (30 / 15 min). */
export async function enterPin(form: FormData) {
  const me = await currentPlayer();
  if (!me || !isStaff(me.role) || !me.pin_hash) redirect('/');

  const ipLimit = await hit(`pinip:${await clientIp()}`, 30, 900);
  const accLimit = await hit(`pin:${me.id}`, 5, 900);
  if (!ipLimit.ok || !accLimit.ok) {
    return back('/', 'tooMany', { min: Math.max(ipLimit.ok ? 0 : ipLimit.retryMin, accLimit.ok ? 0 : accLimit.retryMin) });
  }
  if (!verifyPin(str(form, 'pin'), me.pin_hash)) {
    return back('/', 'errPinWrong', { left: accLimit.remaining });
  }
  await clear(`pin:${me.id}`);
  await unlockStaff({ ...me, pin_hash: me.pin_hash });
  redirect('/');
}

// ---------- Booking ----------

export async function book(form: FormData) {
  const me = await requirePlayer();
  if (isStaff(me.role)) return back('/', 'bookingClosed'); // staff run sessions, they don't book
  const guests = str(form, 'mode') === 'friends' ? Math.min(10, Math.max(1, int(form, 'guests'))) : 0;

  type Msg = [Key, Record<string, number>?];
  const result = await withLockedSession(int(form, 'sessionId'), async (tx, session): Promise<Msg> => {
    const batch = (await getBatch(session.batch_id))!;
    if (timing(session, batch).phase !== 'open') return ['bookingClosed'];

    const [existing] = await tx<Booking[]>`
      select * from bookings where session_id = ${session.id} and player_id = ${me.id} for update`;
    if (existing && existing.status !== 'withdrawn') return ['alreadyBooked'];

    const need = 1 + guests;
    if ((await bookedSeats(tx, session.id)) + need > session.capacity) {
      return need > 1 ? ['notEnough', { n: need }] : ['sessionFull'];
    }
    if (existing) {
      await tx`
        update bookings set status = 'booked', guests = ${guests}, source = 'self', paid = false, updated_at = now()
        where id = ${existing.id}`;
    } else {
      await tx`insert into bookings (session_id, player_id, guests) values (${session.id}, ${me.id}, ${guests})`;
    }
    return ['booked'];
  });
  return back('/', ...result);
}

export async function withdraw(form: FormData) {
  const me = await requirePlayer();
  const key = await withLockedSession(int(form, 'sessionId'), async (tx, session) => {
    const batch = (await getBatch(session.batch_id))!;
    if (timing(session, batch).phase !== 'open') return 'started';
    const [row] = await tx`
      update bookings set status = 'withdrawn', updated_at = now()
      where session_id = ${session.id} and player_id = ${me.id} and status = 'booked'
      returning id`;
    return row ? 'withdrawn' : 'noBooking';
  });
  return back('/', key);
}

// ---------- Membership request ----------

export async function applyMembership(form: FormData) {
  const me = await requirePlayer();
  const plan = await activePlan(me.id);
  if (plan && planLive(plan)) return back('/', 'alreadyMember');

  const batch = await getBatch(str(form, 'batchId'));
  const kind = ['month', 'weekdays', 'weekends', 'other'].includes(str(form, 'plan')) ? str(form, 'plan') : 'month';
  if (!batch) return back('/', 'errDays');
  const [row] = await sql`
    insert into membership_requests (player_id, batch_id, plan, note)
    values (${me.id}, ${batch.id}, ${kind}, ${str(form, 'note').slice(0, 200) || null})
    on conflict (player_id) where status = 'pending' do nothing
    returning id`;
  return back('/', row ? 'applyPending' : 'requestExists');
}
