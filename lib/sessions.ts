import { sql, type Batch, type Session, type Tx } from './db';
import { dayOfWeek, istDate, istInstant } from './time';

export type Phase = 'open' | 'live' | 'over' | 'cancelled';

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

/** open: bookable until start · live: playing now · over: finished */
export function timing(session: Session, batch: Batch) {
  const start = session.starts_at;
  const end = new Date(start.getTime() + batch.duration_min * 60_000);
  const now = Date.now();
  const phase: Phase = session.cancelled ? 'cancelled'
    : now < start.getTime() ? 'open'
    : now < end.getTime() ? 'live'
    : 'over';
  return { start, end, phase };
}

/** The batch's next session that hasn't ended yet (today's or tomorrow's), created on first use. */
async function upcomingSession(batch: Batch): Promise<Session> {
  for (const offset of [0, 1]) {
    const date = istDate(offset);
    const startsAt = istInstant(date, batch.start_time);
    if (startsAt.getTime() + batch.duration_min * 60_000 <= Date.now()) continue;
    const [session] = await sql<Session[]>`
      insert into sessions (batch_id, date, starts_at, capacity)
      values (${batch.id}, ${date}, ${startsAt}, ${batch.courts * batch.players_per_court})
      on conflict (batch_id, date) do update set batch_id = excluded.batch_id
      returning *`;
    return session;
  }
  throw new Error('unreachable: tomorrow always starts in the future');
}

/** Members are IN by default on their plan days. Players who withdrew keep their 'withdrawn' row, so they aren't re-added. */
async function autoBookMembers(session: Session) {
  if (session.cancelled || Date.now() >= session.starts_at.getTime()) return;
  await sql`
    insert into bookings (session_id, player_id, source)
    select ${session.id}, m.player_id, 'auto' from memberships m
    where m.status = 'active' and m.batch_id = ${session.batch_id}
      and m.sessions_used < m.sessions_total
      and m.starts_on <= ${session.date} and (m.ends_on is null or m.ends_on >= ${session.date})
      and ${dayOfWeek(session.date)} = any(m.days)
    on conflict (session_id, player_id) do nothing`;
}

/** Sessions that have ended: anyone still 'booked' (not ticked present) becomes a no-show. */
async function closeFinishedSessions() {
  await sql`
    with done as (
      update sessions s set closed = true
      from batches b
      where s.batch_id = b.id and not s.closed
        and s.starts_at + make_interval(mins => b.duration_min) <= now()
      returning s.id
    )
    update bookings set status = 'no_show', updated_at = now()
    where status = 'booked' and session_id in (select id from done)`;
}

/** Upcoming session for every batch, with member auto-bookings applied. Cheap enough to run per request. */
export async function upcomingSessions() {
  await closeFinishedSessions();
  const batches = await getBatches();
  return Promise.all(
    batches.map(async (batch) => {
      const session = await upcomingSession(batch);
      await autoBookMembers(session);
      return { batch, session };
    }),
  );
}

export const seats = (b: { guests: number }) => 1 + b.guests;
export const isActive = (b: { status: string }) => b.status === 'booked' || b.status === 'present';

export async function bookedSeats(tx: Tx | typeof sql, sessionId: number) {
  const [row] = await tx<{ n: number }[]>`
    select coalesce(sum(1 + guests), 0)::int as n from bookings
    where session_id = ${sessionId} and status in ('booked', 'present')`;
  return row.n;
}
