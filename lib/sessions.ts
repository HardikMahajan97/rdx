import { sql, type Batch, type BookingStatus, type Session, type Tx } from './db';
import { chargeBookings } from './members';
import { istDate, istInstant } from './time';

/**
 * open:    voting open, can still back out
 * locked:  from 30 min before start: can still join, can't back out, plan sessions are charged
 * live:    playing now
 * over:    finished; players confirm they came until the session closes
 */
export type Phase = 'open' | 'locked' | 'live' | 'over' | 'cancelled';

/** Backing out closes this long before the start. */
export const LOCK_MIN = 30;
/** "I'm coming" confirmation opens this long before the start. */
export const CONFIRM_FROM_H = 12;
/** After the session ends, players have this long to confirm they came. */
export const ATTEND_GRACE_H = 12;

export async function getBatches() {
  return sql<Batch[]>`select * from batches order by start_time`;
}

export async function getBatch(id: string) {
  const [batch] = await sql<Batch[]>`select * from batches where id = ${id}`;
  return batch ?? null;
}

export async function getSession(id: number) {
  const [session] = await sql<Session[]>`select * from sessions where id = ${id}`;
  return session ?? null;
}

export function timing(session: Session, batch: Batch, now = Date.now()) {
  const start = session.starts_at;
  const end = new Date(start.getTime() + batch.duration_min * 60_000);
  const lockAt = new Date(start.getTime() - LOCK_MIN * 60_000);
  const confirmFrom = new Date(start.getTime() - CONFIRM_FROM_H * 3_600_000);
  const closeAt = new Date(end.getTime() + ATTEND_GRACE_H * 3_600_000);
  const phase: Phase = session.cancelled ? 'cancelled'
    : now < lockAt.getTime() ? 'open'
    : now < start.getTime() ? 'locked'
    : now < end.getTime() ? 'live'
    : 'over';
  return {
    start, end, lockAt, confirmFrom, closeAt, phase,
    /** Can join (vote) now. */
    canBook: phase === 'open' || phase === 'locked',
    /** Can back out now. */
    canWithdraw: phase === 'open',
    /** Can say "I'm coming" now. */
    canConfirm: (phase === 'open' || phase === 'locked') && now >= confirmFrom.getTime(),
    /** Can say "I played" now. */
    canAttend: (phase === 'live' || phase === 'over') && !session.closed && now < closeAt.getTime(),
  };
}

/** Statuses staff may set on a booking: before the start it's about coming, after it about having played. */
export function staffStatuses(phase: Phase): BookingStatus[] {
  if (phase === 'open' || phase === 'locked') return ['booked', 'confirmed', 'withdrawn'];
  if (phase === 'live' || phase === 'over') return ['present', 'no_show', 'withdrawn'];
  return [];
}

/** The batch's next session that hasn't ended yet (today's or tomorrow's), created on first use. */
async function upcomingSession(batch: Batch): Promise<Session> {
  for (const offset of [0, 1]) {
    const date = istDate(offset);
    const startsAt = istInstant(date, batch.start_time);
    if (startsAt.getTime() + batch.duration_min * 60_000 <= Date.now()) continue;
    const [session] = await sql<Session[]>`
      insert into sessions (batch_id, date, starts_at, capacity, court_numbers)
      values (${batch.id}, ${date}, ${startsAt}, ${(batch.court_numbers.length || batch.courts) * batch.players_per_court}, ${batch.court_numbers})
      on conflict (batch_id, date) do update set batch_id = excluded.batch_id
      returning *`;
    return session;
  }
  throw new Error('unreachable: tomorrow always starts in the future');
}

/**
 * 30 min before start the slot is final: plan sessions are taken off the balance.
 * The `not locked` update makes this run once per session even with concurrent requests.
 */
async function lockDueSessions() {
  await sql.begin(async (tx) => {
    const locked = await tx<{ id: number }[]>`
      update sessions set locked = true
      where not locked and not cancelled and starts_at <= now() + make_interval(mins => ${LOCK_MIN})
      returning id`;
    if (locked.length === 0) return;
    const due = await tx<{ id: number }[]>`
      select id from bookings
      where session_id = any(${locked.map((s) => s.id)}::int[]) and membership_id is not null
        and not charged and status in ('booked', 'confirmed')`;
    await chargeBookings(tx, due.map((b) => b.id));
  });
}

/** Attendance window over: anyone who didn't confirm they came becomes a no-show (the slot stays charged). */
async function closeFinishedSessions() {
  await sql`
    with done as (
      update sessions s set closed = true
      from batches b
      where s.batch_id = b.id and not s.closed
        and s.starts_at + make_interval(mins => b.duration_min) + make_interval(hours => ${ATTEND_GRACE_H}) <= now()
      returning s.id
    )
    update bookings set status = 'no_show', updated_at = now()
    where status in ('booked', 'confirmed') and session_id in (select id from done)`;
}

/** Keeps session state current. Cheap enough to run per request. */
export async function sweep() {
  await lockDueSessions();
  await closeFinishedSessions();
}

/** Upcoming session for every batch. */
export async function upcomingSessions() {
  await sweep();
  const batches = await getBatches();
  const list = await Promise.all(batches.map(async (batch) => ({ batch, session: await upcomingSession(batch) })));
  return list.sort((a, b) => a.session.starts_at.getTime() - b.session.starts_at.getTime());
}

/** Sessions that have started, where this player still has to confirm they came. */
export async function awaitingAttendance(playerId: number) {
  return sql<(Session & { guests: number; batch: Batch })[]>`
    select s.*, b.guests, to_jsonb(bt) as batch
    from bookings b join sessions s on s.id = b.session_id join batches bt on bt.id = s.batch_id
    where b.player_id = ${playerId} and b.status in ('booked', 'confirmed')
      and not s.closed and not s.cancelled and s.starts_at <= now()
    order by s.starts_at`;
}

export const seats = (b: { guests: number }) => 1 + b.guests;
/** Batches are priced per hour; one seat for one session costs this. */
export const seatFee = (b: Pick<Batch, 'price_rupees' | 'duration_min'>) => Math.round((b.price_rupees * b.duration_min) / 60);
export const ACTIVE = ['booked', 'confirmed', 'present'] as const;
export const isActive = (b: { status: string }) => (ACTIVE as readonly string[]).includes(b.status);

export async function bookedSeats(tx: Tx | typeof sql, sessionId: number) {
  const [row] = await tx<{ n: number }[]>`
    select coalesce(sum(1 + guests), 0)::int as n from bookings
    where session_id = ${sessionId} and status in ('booked', 'confirmed', 'present')`;
  return row.n;
}
