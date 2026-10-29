import { sql, type Batch, type Booking, type Lang, type Membership, type Player, type Session } from '@/lib/db';
import { batchName, daysLabel, type T } from '@/lib/i18n';
import { bookable, covers, planBlocks, planLeft, reservedSessions } from '@/lib/members';
import { attendanceHistory, snapshot, type Snapshot, type SnapshotRow } from '@/lib/snapshot';
import { courtStats, headCounts, lowPlans, openRequests, revenue } from '@/lib/stats';
import { awaitingAttendance, getBatches, seatFee, timing } from '@/lib/sessions';
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
// Overall numbers only. Each session's own counts (coming, confirmed, fees) live on its card on the Roster:
// two different sessions are never added together here.

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const monthName = (ym: string, lang: Lang) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { timeZone: 'UTC', month: 'short', year: 'numeric' });

export async function StaffDashboard({ me, t, lang }: { me: Player; t: T; lang: Lang }) {
  const [heads, req, money, court, low, batches] = await Promise.all([
    headCounts(), openRequests(me), revenue(), courtStats(), lowPlans(), getBatches(),
  ]);
  const nameOf = (id: string | null) => {
    const b = batches.find((x) => x.id === id);
    return b ? batchName(t, b) : t('wallet');
  };
  const histories = await Promise.all(batches.map((b) => attendanceHistory(b.id)));
  const maxMonth = Math.max(1, ...money.last6.map((m) => m.total));

  return (
    <>
      <AutoRefresh seconds={60} />
      <div className="hero">
        <div>
          <div className="eyebrow">{t('navDashboard')}</div>
          <h1>{t('hi', { name: me.first_name })}</h1>
        </div>
        <a className="btn btn-ghost btn-sm" href="/roster">{t('todaySessions')} →</a>
      </div>

      <div className="tiles dash-tiles">
        <Tile label={t('tilePlayers')} value={heads.players} href="/players"
          sub={heads.new_month ? t('newThisMonth', { n: heads.new_month }) : undefined} />
        <Tile label={t('navRequests')} value={req.total} tone={req.total ? 'warn' : undefined} href="/requests"
          sub={req.total ? [req.signups && t('nSignups', { n: req.signups }), req.plans + req.quoted && t('nPlanRequests', { n: req.plans + req.quoted }), req.pins && t('nPinResets', { n: req.pins })].filter(Boolean).join(' · ') : t('nothingWaiting')} />
        <Tile label={t('tileActive')} value={heads.members} tone="blue" href="/players?plan=member" sub={t('walletsCount', { n: heads.wallets })} />
        <Tile label={t('lowPlans')} value={heads.low} tone={heads.low ? 'warn' : undefined} href="/players?plan=low" />
        <Tile label={t('tileCore')} value={heads.core} href="/players?role=staff" sub={t('nAdmins', { n: heads.admins })} />
        <Tile label={t('revenueMonth')} value={rupees(money.month.total)} tone="ok" sub={t('revenueYearSub', { amount: rupees(money.year.total) })} />
      </div>

      <div className="cols">
        <section className="card">
          <h2>{t('moneyTitle')}</h2>
          <div className="money-grid">
            {([['revenueMonth', money.month], ['revenueYear', money.year], ['revenueAll', money.all]] as const).map(([k, m]) => (
              <div key={k}>
                <span className="label">{t(k)}</span>
                <b>{rupees(m.total)}</b>
                <small>{t('plansAndFees', { plans: rupees(m.plans), fees: rupees(m.fees) })}</small>
              </div>
            ))}
          </div>
          <h3>{t('byMonth')}</h3>
          <ul className="month-list">
            {money.last6.map((m) => (
              <li key={m.ym}>
                <span>{monthName(m.ym, lang)}</span>
                <span className="month-bar" aria-hidden><i style={{ width: `${(m.total / maxMonth) * 100}%` }} /></span>
                <b>{rupees(m.total)}</b>
              </li>
            ))}
          </ul>
          <div className="member-meta" style={{ marginTop: 12 }}>
            <span className={`pill ${money.toCollect ? 'warn' : ''}`}>{t('feesToCollect', { amount: rupees(money.toCollect) })}</span>
            {money.toRefund > 0 && <span className="pill bad">{t('toRefund', { amount: rupees(money.toRefund) })}</span>}
            <span className="pill">{t('freeSessionsMonth', { n: money.freeSessions })}</span>
          </div>
          <p className="hint">{t('moneyHint')}</p>
        </section>

        <section className="card">
          <h2>{t('courtTitle')}</h2>
          <p className="muted">{t('courtHint')}</p>
          {batches.map((b, i) => {
            const c = court.find((x) => x.batch_id === b.id);
            const played = (c?.members ?? 0) + (c?.floaters ?? 0);
            return (
              <div key={b.id} className="batch-stats">
                <div className="spread"><b>{batchName(t, b)}</b><span className="muted">{t('nSessionsHeld', { n: c?.sessions ?? 0 })}</span></div>
                <div className="mini-tiles">
                  <div><b>{c?.sessions ? Math.round((c.seats / c.sessions) * 10) / 10 : 0}</b><span>{t('avgPlayers')}</span></div>
                  <div><b>{c?.members ?? 0}</b><span>{t('tileMembers')}</span></div>
                  <div><b>{c?.floaters ?? 0}</b><span>{t('tileFloaters')}</span></div>
                  <div><b>{played + (c?.no_shows ?? 0) ? Math.round(((c?.no_shows ?? 0) / (played + c!.no_shows)) * 100) : 0}%</b><span>{t('noShowRate')}</span></div>
                  <div><b>{c?.cancelled ?? 0}</b><span>{t('cancelled')}</span></div>
                </div>
                <details className="card-nested">
                  <summary>{t('attendance')}</summary>
                  <AttendanceChart id={b.id} data={histories[i]} lang={lang}
                    labels={{ showed: t('showed'), missed: t('missed'), table: t('tableView'), date: t('date'), empty: t('noHistory') }} />
                </details>
              </div>
            );
          })}
        </section>

        <section className="card">
          <h2>{t('lowPlans')}</h2>
          {low.length === 0 ? <p className="muted">{t('noLowPlans')}</p> : (
            <div className="people">
              {low.map((l) => (
                <div key={l.id} className="person">
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
