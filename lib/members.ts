import { sql, type Membership, type Session, type Tx } from './db';
import { dayOfWeek, istDate } from './time';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const planLeft = (m: Membership) => m.sessions_total - m.sessions_used;

/** Plan still usable on `date`: active, sessions left, not expired. */
export const planLive = (m: Membership, date = istDate()) =>
  m.status === 'active' && planLeft(m) > 0 && (!m.ends_on || m.ends_on >= date);

/** Does this plan pay for the player's own seat in this session? Wallets cover any batch on any day. */
export const covers = (m: Membership | null | undefined, s: Pick<Session, 'batch_id' | 'date'>) =>
  !!m && planLive(m, s.date) && m.starts_on <= s.date &&
  (m.kind === 'wallet' || (m.batch_id === s.batch_id && m.days.includes(dayOfWeek(s.date))));

/**
 * Fixed-plan members can only vote for their own batch on their own days.
 * Before the plan starts, or once it has run out, they book like anyone else.
 */
export const planBlocks = (m: Membership | null | undefined, s: Pick<Session, 'batch_id' | 'date'>) =>
  !!m && m.kind === 'fixed' && planLive(m, s.date) && m.starts_on <= s.date && !covers(m, s);

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

/** Plan sessions promised to upcoming bookings but not charged yet. */
export async function reservedSessions(tx: Tx | typeof sql, membershipId: number, exceptBookingId = 0) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from bookings
    where membership_id = ${membershipId} and not charged and status in ('booked', 'confirmed')
      and id <> ${exceptBookingId}`;
  return row.n;
}

/** Sessions the player can still book against: left minus already reserved. */
export const bookable = (m: Membership, reserved: number) => planLeft(m) - reserved;

type LedgerEntry = {
  membershipId: number; delta: number; reason: 'activate' | 'topup' | 'use' | 'refund' | 'adjust';
  bookingId?: number | null; amount?: number | null; note?: string | null; by?: number | null;
};

export async function ledger(tx: Tx, e: LedgerEntry) {
  await tx`
    insert into plan_ledger (membership_id, delta, reason, booking_id, amount_rupees, note, by_player)
    values (${e.membershipId}, ${e.delta}, ${e.reason}, ${e.bookingId ?? null}, ${e.amount ?? null}, ${e.note ?? null}, ${e.by ?? null})`;
}

/**
 * Takes one plan session for each booking, once. Bookings already charged are skipped,
 * so this is safe to call from both the lock sweep and a late booking.
 */
export async function chargeBookings(tx: Tx, bookingIds: number[]) {
  if (bookingIds.length === 0) return;
  const rows = await tx<{ id: number; membership_id: number }[]>`
    update bookings set charged = true, updated_at = now()
    where id = any(${bookingIds}::int[]) and membership_id is not null and not charged
      and status in ('booked', 'confirmed', 'present')
    returning id, membership_id`;
  for (const r of rows) {
    await tx`update memberships set sessions_used = sessions_used + 1 where id = ${r.membership_id}`;
    await ledger(tx, { membershipId: r.membership_id, delta: -1, reason: 'use', bookingId: r.id });
  }
}

/** Gives charged plan sessions back (session cancelled). */
export async function refundBookings(tx: Tx, bookingIds: number[], by?: number) {
  if (bookingIds.length === 0) return;
  const rows = await tx<{ id: number; membership_id: number }[]>`
    update bookings set charged = false, updated_at = now()
    where id = any(${bookingIds}::int[]) and membership_id is not null and charged
    returning id, membership_id`;
  for (const r of rows) {
    await tx`update memberships set sessions_used = greatest(0, sessions_used - 1) where id = ${r.membership_id}`;
    await ledger(tx, { membershipId: r.membership_id, delta: 1, reason: 'refund', bookingId: r.id, by });
  }
}

/**
 * After a plan changes, re-check its upcoming uncharged bookings: drop the plan from ones it no longer
 * covers (they then pay the daily fee, which staff can see on the roster).
 */
export async function recheckBookings(tx: Tx, playerId: number) {
  const rows = await tx<{ id: number; batch_id: string; date: string; locked: boolean }[]>`
    select b.id, s.batch_id, s.date, s.locked from bookings b join sessions s on s.id = b.session_id
    where b.player_id = ${playerId} and not b.charged and b.status in ('booked', 'confirmed')
      and not s.closed and not s.cancelled
    order by s.starts_at`;
  const [plan] = await tx<Membership[]>`select * from memberships where player_id = ${playerId} and status = 'active'`;
  let avail = plan ? planLeft(plan) : 0;
  const toCharge: number[] = [];
  for (const r of rows) {
    const use = avail > 0 && covers(plan, r);
    if (use) avail--;
    await tx`update bookings set membership_id = ${use ? plan.id : null}, updated_at = now() where id = ${r.id}`;
    if (use && r.locked) toCharge.push(r.id);
  }
  await chargeBookings(tx, toCharge);
}
