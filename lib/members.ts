import { sql, type Membership, type Session, type Tx } from './db';
import { dayOfWeek, istDate } from './time';

export const planLeft = (m: Membership) => m.sessions_total - m.sessions_used;

/** Plan still usable on `date`: active, sessions left, not expired. */
export const planLive = (m: Membership, date = istDate()) =>
  m.status === 'active' && planLeft(m) > 0 && (!m.ends_on || m.ends_on >= date);

/** Does this plan pay for the player's own seat in this session? */
export const covers = (m: Membership | null | undefined, s: Pick<Session, 'batch_id' | 'date'>) =>
  !!m && planLive(m, s.date) && m.batch_id === s.batch_id && m.starts_on <= s.date && m.days.includes(dayOfWeek(s.date));

export async function activePlan(playerId: number) {
  const [m] = await sql<Membership[]>`select * from memberships where player_id = ${playerId} and status = 'active'`;
  return m ?? null;
}

export async function activePlans(playerIds: number[]) {
  if (playerIds.length === 0) return new Map<number, Membership>();
  const rows = await sql<Membership[]>`
    select * from memberships where status = 'active' and player_id = any(${playerIds}::int[])`;
  return new Map(rows.map((m) => [m.player_id, m]));
}

/**
 * Drops a player's untouched future auto-bookings. Call after their plan changes;
 * the next page load re-creates whichever ones the plan still covers.
 */
export async function resetAutoBookings(tx: Tx, playerId: number) {
  await tx`
    delete from bookings b using sessions s
    where s.id = b.session_id and b.player_id = ${playerId}
      and b.source = 'auto' and b.status = 'booked' and s.starts_at > now()`;
}
