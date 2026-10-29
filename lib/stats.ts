import { sql, type Player } from './db';
import { istDate } from './time';

// Numbers for the staff dashboard and the Requests badge. Deleted players never count (except their money,
// which was really received).

/** Everything waiting for core/admin: new sign-ups, plan requests (asked or quoted) and "Forgot PIN" requests. */
export async function openRequests(me: Pick<Player, 'id' | 'role'>) {
  const [c] = await sql<{ signups: number; plans: number; quoted: number; pins: number }[]>`
    select
      (select count(*) from players where approved_at is null and deactivated_at is null and deleted_at is null)::int as signups,
      (select count(*) from membership_requests r join players p on p.id = r.player_id
         where r.status = 'pending' and p.deleted_at is null)::int as plans,
      (select count(*) from membership_requests r join players p on p.id = r.player_id
         where r.status = 'quoted' and p.deleted_at is null)::int as quoted,
      -- same rule as canResetPin: core reset players; admins also reset other staff; nobody their own
      (select count(*) from players where pin_reset_requested_at is not null and pin_hash is not null
         and deactivated_at is null and deleted_at is null and id <> ${me.id}
         and (role = 'player' or ${me.role} = 'admin'))::int as pins`;
  return { ...c, total: c.signups + c.plans + c.quoted + c.pins };
}

export type Money = { plans: number; fees: number; total: number };
const zero = (): Money => ({ plans: 0, fees: 0, total: 0 });

/**
 * Money received, by month (IST). What counts:
 *   + a plan's amount paid, in the month it was activated (edits that correct the amount are already in it);
 *   + every wallet top-up's amount;
 *   + every session fee staff marked as collected on the roster, at the amount fixed when they marked it.
 *   − a fee refunded on the roster is no longer marked paid, so it drops out.
 * Sessions given for free (adjustments with no money), plan sessions used or given back, carry no money:
 * the money for a plan is counted once, when it is paid.
 */
export async function revenue(today = istDate()) {
  const rows = await sql<{ ym: string; src: 'plans' | 'fees'; amount: number }[]>`
    with money as (
      select (m.created_at at time zone 'Asia/Kolkata')::date as day, 'plans' as src, m.amount_rupees as amount
        from memberships m where coalesce(m.amount_rupees, 0) <> 0
      union all
      select (l.created_at at time zone 'Asia/Kolkata')::date, 'plans', l.amount_rupees
        from plan_ledger l where l.reason = 'topup' and coalesce(l.amount_rupees, 0) <> 0
      union all
      select s.date, 'fees', b.paid_rupees
        from bookings b join sessions s on s.id = b.session_id where b.paid and coalesce(b.paid_rupees, 0) <> 0
    )
    select to_char(day, 'YYYY-MM') as ym, src, sum(amount)::int as amount from money group by 1, 2`;

  const add = (m: Money, r: (typeof rows)[number]) => { m[r.src] += r.amount; m.total += r.amount; };
  const month = zero(), year = zero(), all = zero();
  const byMonth = new Map<string, Money>();
  for (const r of rows) {
    add(all, r);
    if (r.ym.slice(0, 4) === today.slice(0, 4)) add(year, r);
    if (r.ym === today.slice(0, 7)) add(month, r);
    if (!byMonth.has(r.ym)) byMonth.set(r.ym, zero());
    add(byMonth.get(r.ym)!, r);
  }
  // The last six months, newest first, including empty ones.
  const last6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    return { ym, ...(byMonth.get(ym) ?? zero()) };
  });

  // Not money yet, but useful next to it.
  const [open] = await sql<{ to_collect: number; to_refund: number; free_sessions: number }[]>`
    select
      -- fees owed for sessions that are final (locked), seats not covered by a plan plus friends
      coalesce((select sum(((b.membership_id is null)::int + b.guests) * round(bt.price_rupees * bt.duration_min / 60.0))
        from bookings b join sessions s on s.id = b.session_id join batches bt on bt.id = s.batch_id
        where s.locked and not s.cancelled and not b.paid and b.status in ('booked', 'confirmed', 'present')), 0)::int as to_collect,
      -- paid, then backed out or the session was cancelled
      coalesce((select sum(b.paid_rupees) from bookings b where b.paid and b.status = 'withdrawn'), 0)::int as to_refund,
      -- extra sessions staff added with no money this month
      coalesce((select sum(l.delta) from plan_ledger l where l.reason = 'adjust' and l.delta > 0 and coalesce(l.amount_rupees, 0) = 0
        and to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') = ${today.slice(0, 7)}), 0)::int as free_sessions`;

  return { month, year, all, last6, toCollect: open.to_collect, toRefund: open.to_refund, freeSessions: open.free_sessions };
}

/** Head counts for the dashboard tiles. */
export async function headCounts(today = istDate()) {
  const [c] = await sql<{
    players: number; new_month: number; deactivated: number; members: number; wallets: number; low: number; core: number; admins: number;
  }[]>`
    select
      count(*) filter (where p.role = 'player' and p.approved_at is not null)::int as players,
      count(*) filter (where p.role = 'player' and p.approved_at is not null
        and to_char(p.created_at at time zone 'Asia/Kolkata', 'YYYY-MM') = ${today.slice(0, 7)})::int as new_month,
      count(*) filter (where p.role = 'player' and p.deactivated_at is not null)::int as deactivated,
      count(*) filter (where m.live)::int as members,
      count(*) filter (where m.live and m.kind = 'wallet')::int as wallets,
      count(*) filter (where m.live and m.sessions_total - m.sessions_used <= 3)::int as low,
      count(*) filter (where p.role = 'core')::int as core,
      count(*) filter (where p.role = 'admin')::int as admins
    from players p
    left join lateral (
      select x.kind, x.sessions_total, x.sessions_used,
        (x.sessions_used < x.sessions_total and (x.ends_on is null or x.ends_on >= ${today})) as live
      from memberships x where x.player_id = p.id and x.status = 'active'
    ) m on true
    where p.deleted_at is null`;
  return c;
}

/**
 * Last 30 days on court, one row per batch (batches are never added together: each has its own players and courts).
 * Seats = the player plus their friends.
 */
export async function courtStats(today = istDate()) {
  return sql<{ batch_id: string; sessions: number; seats: number; members: number; floaters: number; no_shows: number; cancelled: number }[]>`
    select s.batch_id,
      count(distinct s.id) filter (where not s.cancelled)::int as sessions,
      coalesce(sum(1 + b.guests) filter (where b.status = 'present' and not s.cancelled), 0)::int as seats,
      count(*) filter (where b.status = 'present' and b.membership_id is not null and not s.cancelled)::int as members,
      count(*) filter (where b.status = 'present' and b.membership_id is null and not s.cancelled)::int as floaters,
      count(*) filter (where b.status = 'no_show' and not s.cancelled)::int as no_shows,
      count(distinct s.id) filter (where s.cancelled)::int as cancelled
    from sessions s left join bookings b on b.session_id = s.id
    where s.closed and s.date > ${today}::date - 30
    group by s.batch_id`;
}

/** Plans with three or fewer sessions left. */
export async function lowPlans() {
  return sql<{ id: number; name: string; remaining: number; batch_id: string | null; kind: string }[]>`
    select p.id, p.name, m.sessions_total - m.sessions_used as remaining, m.batch_id, m.kind
    from memberships m join players p on p.id = m.player_id
    where m.status = 'active' and m.sessions_total - m.sessions_used between 1 and 3 and p.deleted_at is null
    order by remaining, p.name limit 12`;
}
