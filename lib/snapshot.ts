import { sql, type Batch, type Booking, type Membership, type Session } from './db';
import { activePlans, planLive } from './members';
import { isActive, seatFee, seats } from './sessions';

export type SnapshotRow = Booking & {
  name: string;
  phone: string;
  no_shows: number;
  plan: Membership | undefined;
  /** Player's own seat is paid by their plan. */
  covered: boolean;
  isMember: boolean;
  due: number;
};

/** Everything a dashboard, roster or member view needs about one session. */
export async function snapshot(session: Session, batch: Batch) {
  const rows = await sql<(Booking & { name: string; phone: string; no_shows: number })[]>`
    select b.*, p.name, p.phone,
      (select count(*) from bookings x where x.player_id = p.id and x.status = 'no_show')::int as no_shows
    from bookings b join players p on p.id = b.player_id
    where b.session_id = ${session.id}
    order by b.status = 'withdrawn', b.status <> 'present', b.status <> 'confirmed', b.created_at`;
  const plans = await activePlans(rows.map((r) => r.player_id));
  const view: SnapshotRow[] = rows.map((r) => {
    const plan = plans.get(r.player_id);
    const covered = r.membership_id !== null;
    const fee = ((covered ? 0 : 1) + r.guests) * seatFee(batch);
    // Withdrawn players who had already paid are owed their money back.
    const due = isActive(r) || (r.status === 'withdrawn' && r.paid) ? fee : 0;
    return { ...r, plan, covered, isMember: !!plan && planLive(plan, session.date), due };
  });

  const active = view.filter(isActive);
  const sum = (list: SnapshotRow[], f: (r: SnapshotRow) => number) => list.reduce((n, r) => n + f(r), 0);
  return {
    rows: view,
    active,
    withdrawn: view.filter((r) => r.status === 'withdrawn'),
    booked: sum(active, seats),
    here: sum(active.filter((r) => r.status === 'present'), seats),
    confirmed: sum(active.filter((r) => r.status === 'confirmed' || r.status === 'present'), seats),
    members: active.filter((r) => r.covered).length,
    floaters: active.filter((r) => !r.covered).length,
    friends: sum(active, (r) => r.guests),
    toCollect: sum(active.filter((r) => !r.paid), (r) => r.due),
    collected: sum(active.filter((r) => r.paid), (r) => r.due),
    toRefund: sum(view.filter((r) => r.status === 'withdrawn' && r.paid), (r) => r.due),
    capacity: session.capacity,
  };
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Seats (player + friends) that showed up vs didn't, for the last finished sessions of a batch. */
export async function attendanceHistory(batchId: string, limit = 12) {
  const rows = await sql<{ date: string; showed: number; missed: number }[]>`
    select s.date,
      coalesce(sum(1 + b.guests) filter (where b.status = 'present'), 0)::int as showed,
      coalesce(sum(1 + b.guests) filter (where b.status = 'no_show'), 0)::int as missed
    from sessions s left join bookings b on b.session_id = s.id
    where s.batch_id = ${batchId} and s.closed and not s.cancelled
    group by s.id order by s.date desc limit ${limit}`;
  return rows.reverse();
}
