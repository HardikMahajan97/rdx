import { sql, type Batch, type Booking, type Lang, type Membership, type Player, type Session } from '@/lib/db';
import { batchName, daysLabel, type T } from '@/lib/i18n';
import { bookable, covers, planBlocks, planLeft, reservedSessions } from '@/lib/members';
import { attendanceHistory, snapshot, type Snapshot, type SnapshotRow } from '@/lib/snapshot';
import { awaitingAttendance, seatFee, timing } from '@/lib/sessions';
import { dayOfWeek, fmtDate, fmtTime, istDate } from '@/lib/time';
import { confirmSlot, markAttended, withdraw } from '../actions';

import { AttendanceChart } from './AttendanceChart';
import { BookForm } from './BookForm';
import { AutoRefresh, Submit } from './Client';
import { CourtBoard, type BoardPerson } from './CourtBoard';
import { initials, SlotHead, Tile } from './Shared';

type Upcoming = { batch: Batch; session: Session }[];

/** Next N dates a fixed plan covers. */
function upcomingPlanDates(m: Membership, limit = 6): string[] {
  const dates: string[] = [];
  for (let offset = 0; dates.length < limit && offset < 90; offset++) {
    const date = istDate(offset);
    if (date < m.starts_on) continue;
    if (m.ends_on && date > m.ends_on) break;
    if (!m.days.includes(dayOfWeek(date))) continue;
    dates.push(date);
  }
  return dates;
}

const boardLabels = (t: T) => ({
  court: t('court'), member: t('legendMember'), floater: t('legendFloater'), friend: t('legendFriend'),
  open: t('openSpot'), extra: t('overCap'),
});

const boardPeople = (snap: Snapshot, meId?: number): BoardPerson[] =>
  snap.active.map((r) => ({
    name: r.name, kind: r.covered ? 'member' : 'floater', guests: r.guests,
    here: r.status === 'present', me: r.player_id === meId,
  }));

const statusIcon = (r: SnapshotRow) => (r.status === 'present' ? '🏸' : r.status === 'confirmed' ? '✓' : '');

function Fill({ t, snap }: { t: T; snap: Snapshot }) {
  const cap = Math.max(1, snap.capacity);
  const left = snap.capacity - snap.booked;
  return (
    <div className="fill">
      <div className="spread">
        <span className="fill-count"><b>{snap.booked}</b><small>/ {snap.capacity} {t('coming')}</small></span>
        <span className={`pill ${left > 0 ? 'ok' : left < 0 ? 'bad' : 'warn'}`}>
          {left > 0 ? t('spotsLeft', { n: left }) : left < 0 ? t('overCapacity', { n: -left }) : t('full')}
        </span>
      </div>
      <div className="meter" aria-hidden>
        <span className="m-booked" style={{ width: `${Math.min(100, (snap.booked / cap) * 100)}%` }} />
        <span className="m-confirmed" style={{ width: `${Math.min(100, (snap.confirmed / cap) * 100)}%` }} />
      </div>
      <div className="fill-legend">
        <span><i className="m-confirmed" />{t('confirmedCount', { n: snap.confirmed })}</span>
        <span><i className="m-booked" />{t('votedCount', { n: snap.booked - snap.confirmed })}</span>
      </div>
    </div>
  );
}

function People({ t, snap }: { t: T; snap: Snapshot }) {
  return (
    <div className="split people-split">
      <div>
        <div className="eyebrow">{t('comingList')} · {snap.active.length}</div>
        {snap.active.length === 0 ? <p className="faint">{t('nobodyYet')}</p> : (
          <div className="people-list">
            {snap.active.map((r) => (
              <div key={r.id} className={`person ${r.status}`}>
                <span className={`av ${r.covered ? 'member' : 'floater'}`}>{initials(r.name)}</span>
                <span className="pname">{r.name}{r.guests > 0 && <span className="muted"> +{r.guests}</span>}</span>
                {statusIcon(r) && <span className="pstat" title={t(`st_${r.status}`)}>{statusIcon(r)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="eyebrow">{t('notComingList')} · {snap.withdrawn.length}</div>
        <div className="people-list">
          {snap.withdrawn.map((r) => (
            <div key={r.id} className="person withdrawn">
              <span className="av out">{initials(r.name)}</span><span className="pname">{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Staff dashboard ----------

export async function StaffDashboard({ me, t, lang, upcoming }: { me: Player; t: T; lang: Lang; upcoming: Upcoming }) {
  const panels = await Promise.all(upcoming.map(async ({ batch, session }) => ({
    batch, session, snap: await snapshot(session, batch), history: await attendanceHistory(batch.id),
  })));
  const [counts] = await sql<{ pending: number; quoted: number; active: number; low: number; wallets: number; pins: number; signups: number }[]>`
    select
      (select count(*) from players where approved_at is null and deactivated_at is null)::int as signups,
      (select count(*) from players where pin_reset_requested_at is not null and pin_hash is not null
         and id <> ${me.id} and (role = 'player' or ${me.role} = 'admin'))::int as pins,
      (select count(*) from membership_requests where status = 'pending')::int as pending,
      (select count(*) from membership_requests where status = 'quoted')::int as quoted,
      (select count(*) from memberships where status = 'active' and sessions_used < sessions_total
         and (ends_on is null or ends_on >= ${istDate()}))::int as active,
      (select count(*) from memberships where status = 'active' and sessions_total - sessions_used between 1 and 3)::int as low,
      (select count(*) from memberships where status = 'active' and kind = 'wallet' and sessions_used < sessions_total)::int as wallets`;
  const low = await sql<{ name: string; remaining: number; batch_id: string | null; kind: string }[]>`
    select p.name, m.sessions_total - m.sessions_used as remaining, m.batch_id, m.kind
    from memberships m join players p on p.id = m.player_id
    where m.status = 'active' and m.sessions_total - m.sessions_used between 1 and 3
    order by remaining, p.name limit 12`;
  const requests = await sql<{ id: number; name: string; plan: string; status: string; sessions_requested: number | null }[]>`
    select r.id, p.name, r.plan, r.status, r.sessions_requested from membership_requests r join players p on p.id = r.player_id
    where r.status in ('pending', 'quoted') order by r.created_at limit 6`;
  const sum = (f: (s: Snapshot) => number) => panels.reduce((n, p) => n + f(p.snap), 0);
  const nameOf = (id: string | null) => id ? batchName(t, upcoming.find((u) => u.batch.id === id)?.batch ?? { id, label: id }) : t('wallet');

  return (
    <>
      <AutoRefresh />
      <div className="hero">
        <div>
          <div className="eyebrow">{t('navDashboard')}</div>
          <h1>{t('hi', { name: me.first_name })}</h1>
        </div>
        <span className="pill ok live-dot">{t('liveNote')}</span>
      </div>
      <div className="tiles">
        <Tile label={t('tileComing')} value={sum((s) => s.booked)} of={sum((s) => s.capacity)} tone="blue" />
        <Tile label={t('tileConfirmed')} value={sum((s) => s.confirmed)} tone="ok" />
        <Tile label={t('tilePending')} value={counts.pending} tone={counts.pending ? 'warn' : undefined} href="/members"
          sub={counts.quoted ? t('awaitingPayment', { n: counts.quoted }) : undefined} />
        <Tile label={t('tileActive')} value={counts.active} href="/members" sub={t('walletsCount', { n: counts.wallets })} />
        <Tile label={t('lowPlans')} value={counts.low} tone={counts.low ? 'warn' : undefined} />
        <Tile label={t('tileCollect')} value={`₹${sum((s) => s.toCollect)}`} tone={sum((s) => s.toCollect) ? 'warn' : 'ok'}
          sub={sum((s) => s.toRefund) ? t('toRefund', { amount: sum((s) => s.toRefund) }) : undefined} />
      </div>

      <div className="cols">
        {panels.map(({ batch, session, snap, history }) => (
          <section key={session.id} className="card panel">
            <SlotHead t={t} lang={lang} batch={batch} session={session} />
            <Fill t={t} snap={snap} />
            <div className="mini-tiles">
              <div><b>{snap.members}</b><span>{t('tileMembers')}</span></div>
              <div><b>{snap.floaters}</b><span>{t('tileFloaters')}</span></div>
              <div><b>{snap.friends}</b><span>{t('tileFriends')}</span></div>
              <div><b>{snap.withdrawn.length}</b><span>{t('tileNotComing')}</span></div>
              <div><b>₹{snap.toCollect}</b><span>{t('tileCollect')}</span></div>
            </div>
            <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} numbers={session.court_numbers} people={boardPeople(snap)} showNames labels={boardLabels(t)} />
            <People t={t} snap={snap} />
            <details className="card-nested">
              <summary>{t('attendance')}</summary>
              <AttendanceChart id={batch.id} data={history} lang={lang}
                labels={{ showed: t('showed'), missed: t('missed'), table: t('tableView'), date: t('date'), empty: t('noHistory') }} />
            </details>
            <a className="btn btn-ghost full" href={`/roster?sid=${session.id}`}>{t('navRoster')} →</a>
          </section>
        ))}
      </div>

      <div className="cols">
        <section className="card">
          <h2>{t('requests')}</h2>
          {counts.signups > 0 && <a className="status warn" href="/members">{t('signupsCount', { n: counts.signups })} →</a>}
          {counts.pins > 0 && <a className="status warn" href="/members">{t('pinRequestsCount', { n: counts.pins })} →</a>}
          {requests.length === 0 ? <p className="muted">{t('noRequests')}</p> : (
            <ul className="list">
              {requests.map((r) => (
                <li key={r.id} className="spread">
                  <span className="person"><span className="av member">{initials(r.name)}</span>
                    <span className="pname">{r.name} <span className="muted">· {t(`plan_${r.plan}` as 'plan_month')}{r.sessions_requested ? ` · ${r.sessions_requested}` : ''}</span></span>
                  </span>
                  <span className={`pill ${r.status === 'quoted' ? 'blue' : 'warn'}`}>{t(r.status === 'quoted' ? 'reqQuoted' : 'reqPending')}</span>
                </li>
              ))}
            </ul>
          )}
          <a className="btn btn-ghost btn-sm" href="/members">{t('navMembers')} →</a>
        </section>
        <section className="card">
          <h2>{t('lowPlans')}</h2>
          {low.length === 0 ? <p className="muted">{t('noLowPlans')}</p> : (
            <div className="people">
              {low.map((l, i) => (
                <div key={i} className="person">
                  <span className="av member">{initials(l.name)}</span>
                  <span className="pname">{l.name} <span className="muted">· {l.kind === 'wallet' ? t('wallet') : nameOf(l.batch_id)} · {t('left', { n: l.remaining })}</span></span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ---------- Players (floaters and members) ----------

/** The player's plan at a glance. */
export function PlanCard({ t, lang, plan, batches }: { t: T; lang: Lang; plan: Membership; batches: Batch[] }) {
  const left = planLeft(plan);
  const batch = batches.find((b) => b.id === plan.batch_id);
  const nextDates = plan.kind === 'fixed' ? upcomingPlanDates(plan, 6) : [];
  const pct = Math.max(0, Math.min(100, (left / plan.sessions_total) * 100));
  return (
    <section className="card plan-card">
      <div className="plan-ring" style={{ '--p': `${pct}%` } as React.CSSProperties}>
        <div><b>{left}</b><span>{t('sessionsLeft')}</span></div>
      </div>
      <div className="plan-body">
        <div className="eyebrow">{plan.kind === 'wallet' ? t('walletTitle') : t('planTitle')}</div>
        <div className="plan-name">
          {plan.kind === 'wallet' ? t('walletAnyDay') : `${batch ? batchName(t, batch) : ''} · ${daysLabel(t, plan.days)}`}
        </div>
        <div className="plan-meta">
          <span>{t('used', { used: plan.sessions_used, total: plan.sessions_total })}</span>
          <span>{plan.ends_on ? t('planUntil', { date: fmtDate(plan.ends_on, lang) }) : t('noExpiry')}</span>
          {plan.starts_on > istDate() && <span>{t('planStarts', { date: fmtDate(plan.starts_on, lang) })}</span>}
        </div>
        {nextDates.length > 0 && (
          <div className="dates-grid">
            {nextDates.map((d) => <span key={d} className="pill date">{fmtDate(d, lang)}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

/** Sessions that have started where the player still has to tap "I played". */
export async function AttendancePrompts({ me, t, lang }: { me: Player; t: T; lang: Lang }) {
  const due = await awaitingAttendance(me.id);
  if (due.length === 0) return null;
  return (
    <section className="card attend-card">
      <h2>{t('attendTitle')}</h2>
      <p className="muted">{t('attendHint')}</p>
      {due.map((s) => (
        <form key={s.id} action={markAttended} className="attend-row">
          <input type="hidden" name="sessionId" value={s.id} />
          <span><b>{batchName(t, s.batch)}</b> <span className="muted">· {fmtDate(s.date, lang)} · {fmtTime(s.starts_at)}</span></span>
          <Submit className="btn-ok">{t('iPlayed')}</Submit>
        </form>
      ))}
    </section>
  );
}

export async function PlayerSessions({ me, t, lang, plan, upcoming }: {
  me: Player; t: T; lang: Lang; plan: Membership | null; upcoming: Upcoming;
}) {
  const reserved = plan ? await reservedSessions(sql, plan.id) : 0;
  const cards = await Promise.all(upcoming.map(async ({ batch, session }) => {
    const [mine] = await sql<Booking[]>`select * from bookings where session_id = ${session.id} and player_id = ${me.id}`;
    return { batch, session, snap: await snapshot(session, batch), mine: mine ?? null };
  }));
  const isMember = !!plan;
  return (
    <div className="cols">
      <AutoRefresh seconds={45} />
      {cards.map(({ batch, session, snap, mine }) => (
        <section key={session.id} className="card panel">
          <SlotHead t={t} lang={lang} batch={batch} session={session} />
          <Fill t={t} snap={snap} />
          {/* Floaters see how full the courts are, not who is on them. */}
          <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} numbers={session.court_numbers} people={boardPeople(snap, me.id)}
            showNames={isMember} labels={boardLabels(t)} />
          <SlotAction t={t} lang={lang} batch={batch} session={session} snap={snap} mine={mine} plan={plan} reserved={reserved} />
          {isMember && <People t={t} snap={snap} />}
        </section>
      ))}
    </div>
  );
}

function SlotAction({ t, lang, batch, session, snap, mine, plan, reserved }: {
  t: T; lang: Lang; batch: Batch; session: Session; snap: Snapshot; mine: Booking | null; plan: Membership | null; reserved: number;
}) {
  const tm = timing(session, batch);
  const hidden = <input type="hidden" name="sessionId" value={session.id} />;
  const left = Math.max(0, snap.capacity - snap.booked);

  if (tm.phase === 'cancelled') return <div className="status bad">{t('sessionCancelled')}</div>;

  const active = mine && (mine.status === 'booked' || mine.status === 'confirmed' || mine.status === 'present');
  if (active) {
    const covered = mine.membership_id !== null;
    const due = ((covered ? 0 : 1) + mine.guests) * seatFee(batch);
    const withdrawLabel = covered ? t('memberCantCome') : mine.paid ? t('paidCantCome') : t('cantMakeIt');
    return (
      <div className="action">
        <div className="status ok">
          {mine.status === 'present' ? t('youPlayed') : mine.status === 'confirmed' ? t('youConfirmed') : t('youAreBooked')}
          {mine.guests > 0 && ` ${t('plusFriends', { n: mine.guests })}`}
        </div>
        {covered && <div className="status info">{mine.charged ? t('planCharged') : t('fromPlan')}</div>}
        {due > 0 && <div className={`status ${mine.paid ? 'ok' : 'warn'}`}>{mine.paid ? t('feePaid', { amount: due }) : t('payAtCourt', { amount: due })}</div>}

        <ol className="steps">
          <li className="done"><span className="dot">1</span><span>{t('stepVoted')}</span></li>
          <li className={mine.status !== 'booked' ? 'done' : tm.canConfirm ? 'now' : ''}>
            <span className="dot">2</span>
            <span>{t('stepConfirm')}{mine.status === 'booked' && !tm.canConfirm && tm.phase === 'open' &&
              <small>{t('opensAt', { time: fmtTime(tm.confirmFrom), day: fmtDate(istDate(0, tm.confirmFrom.getTime()), lang) })}</small>}</span>
          </li>
          <li className={mine.status === 'present' ? 'done' : tm.canAttend ? 'now' : ''}>
            <span className="dot">3</span>
            <span>{t('stepPlayed')}{mine.status !== 'present' && !tm.canAttend && <small>{t('afterStart', { time: fmtTime(tm.start) })}</small>}</span>
          </li>
        </ol>

        {mine.status === 'booked' && tm.canConfirm && (
          <form action={confirmSlot}>{hidden}<Submit className="btn-big">{t('confirmComing')}</Submit></form>
        )}
        {(mine.status === 'booked' || mine.status === 'confirmed') && tm.canAttend && (
          <form action={markAttended}>{hidden}<Submit className="btn-big btn-ok">{t('iPlayed')}</Submit></form>
        )}
        {(mine.status === 'booked' || mine.status === 'confirmed') && tm.canWithdraw && (
          <form action={withdraw}>
            {hidden}
            <Submit className="btn-ghost full">{withdrawLabel}</Submit>
            <p className="hint">{t('backOutUntil', { time: fmtTime(tm.lockAt) })}</p>
          </form>
        )}
        {(mine.status === 'booked' || mine.status === 'confirmed') && tm.phase === 'locked' && (
          <p className="hint">🔒 {t('lockedHint')}</p>
        )}
      </div>
    );
  }

  if (mine?.status === 'no_show') return <div className="status bad">{t('markedNoShow')}</div>;
  if (!tm.canBook) return <div className="status warn">{t('bookingClosed')}</div>;
  if (planBlocks(plan, session)) {
    return <div className="status info">{t('planOnly')}</div>;
  }
  if (left === 0) return <div className="status bad">{t('sessionFull')}</div>;

  const selfCovered = covers(plan, session);
  if (selfCovered && plan && bookable(plan, reserved) < 1) {
    return <div className="status warn">{plan.kind === 'wallet' ? t('walletEmpty') : t('planAllBooked')}</div>;
  }
  return (
    <div className="action">
      {mine?.status === 'withdrawn' && <p className="muted">{t('notComingMarked')}</p>}
      {tm.phase === 'locked' && <p className="hint">🔒 {t('lateJoinHint')}</p>}
      <BookForm sessionId={session.id} price={seatFee(batch)} selfCovered={selfCovered} maxFriends={Math.min(10, left - 1)}
        labels={{ justMe: t('justMe'), meAndFriends: t('meAndFriends'), friends: t('friends'), you: t('you'), total: t('total'),
          covered: plan?.kind === 'wallet' ? t('fromWallet') : t('covered'), bookSlot: t('bookSlot') }} />
    </div>
  );
}
