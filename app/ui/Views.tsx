import { sql, type Batch, type Booking, type Lang, type Membership, type Player, type Session } from '@/lib/db';
import { batchName, daysLabel, type T } from '@/lib/i18n';
import { covers, planLeft } from '@/lib/members';
import { attendanceHistory, snapshot, type Snapshot } from '@/lib/snapshot';
import { timing } from '@/lib/sessions';
import { fmtDate, fmtTime, istDate, dayOfWeek } from '@/lib/time';
import { book, withdraw } from '../actions';
import { AttendanceChart } from './AttendanceChart';
import { BookForm } from './BookForm';
import { AutoRefresh, Submit } from './Client';
import { CourtBoard, type BoardPerson } from './CourtBoard';
import { initials, Tile } from './Shared';

type Upcoming = { batch: Batch; session: Session }[];

/** Compute the next N session dates for a membership. */
function upcomingPlanDates(m: Membership, batch: Batch, limit = 6): string[] {
  const dates: string[] = [];
  const today = istDate();
  for (let offset = 0; dates.length < limit && offset < 90; offset++) {
    const date = istDate(offset);
    if (date < m.starts_on) continue;
    if (m.ends_on && date > m.ends_on) continue;
    if (!m.days.includes(dayOfWeek(date))) continue;
    dates.push(date);
  }
  return dates;
}

const dayLabel = (t: T, lang: Lang, date: string) =>
  date === istDate() ? t('today') : date === istDate(1) ? t('tomorrow') : fmtDate(date, lang);

function SessionHead({ t, lang, batch, session }: { t: T; lang: Lang; batch: Batch; session: Session }) {
  const { start, end, phase } = timing(session, batch);
  return (
    <div className="panel-head">
      <h2>{batchName(t, batch)} · {dayLabel(t, lang, session.date)}</h2>
      <span className="row">
        <span className="muted">{fmtTime(start, lang)} – {fmtTime(end, lang)}</span>
        {phase === 'live' && <span className="pill ok">● {t('live')}</span>}
        {phase === 'cancelled' && <span className="pill bad">{t('cancelled')}</span>}
      </span>
    </div>
  );
}

const boardLabels = (t: T) => ({
  court: t('court'), member: t('legendMember'), floater: t('legendFloater'), friend: t('legendFriend'),
  open: t('openSpot'), extra: t('overCap'),
});

const boardPeople = (snap: Snapshot, meId?: number): BoardPerson[] =>
  snap.active.map((r) => ({
    name: r.name, kind: r.covered ? 'member' : 'floater', guests: r.guests, here: r.status === 'present', me: r.player_id === meId,
  }));

function People({ t, snap }: { t: T; snap: Snapshot }) {
  return (
    <div className="split" style={{ marginTop: 14 }}>
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>{t('comingList')} · {snap.active.length}</div>
        {snap.active.length === 0 ? <p className="faint">{t('nobodyYet')}</p> : (
          <div className="stack" style={{ gap: 6 }}>
            {snap.active.map((r) => (
              <div key={r.id} className="person">
                <span className={`av ${r.covered ? 'member' : 'floater'}`}>{initials(r.name)}</span>
                <span>{r.name}{r.guests > 0 && <span className="muted"> +{r.guests}</span>}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>{t('notComingList')} · {snap.withdrawn.length}</div>
        <div className="stack" style={{ gap: 6 }}>
          {snap.withdrawn.map((r) => (
            <div key={r.id} className="person withdrawn">
              <span className="av out">{initials(r.name)}</span><span>{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Staff dashboard ----------

export async function StaffDashboard({ t, lang, upcoming }: { me: Player; t: T; lang: Lang; upcoming: Upcoming }) {
  const panels = await Promise.all(upcoming.map(async ({ batch, session }) => ({
    batch, session, snap: await snapshot(session, batch), history: await attendanceHistory(batch.id),
  })));
  const [counts] = await sql<{ pending: number; active: number; low: number }[]>`
    select
      (select count(*) from membership_requests where status = 'pending')::int as pending,
      (select count(*) from memberships where status = 'active' and sessions_used < sessions_total
         and (ends_on is null or ends_on >= ${istDate()}))::int as active,
      (select count(*) from memberships where status = 'active' and sessions_total - sessions_used between 1 and 3)::int as low`;
  const low = await sql<{ name: string; remaining: number; batch_id: string; ends_on: string | null }[]>`
    select p.name, m.sessions_total - m.sessions_used as remaining, m.batch_id, m.ends_on
    from memberships m join players p on p.id = m.player_id
    where m.status = 'active' and m.sessions_total - m.sessions_used between 1 and 3
    order by remaining, p.name limit 12`;
  const coming = panels.reduce((n, p) => n + p.snap.booked, 0);
  const capacity = panels.reduce((n, p) => n + p.snap.capacity, 0);
  const toCollect = panels.reduce((n, p) => n + p.snap.toCollect, 0);
  const nameOf = (id: string) => batchName(t, upcoming.find((u) => u.batch.id === id)?.batch ?? { id, label: id });

  return (
    <>
      <AutoRefresh />
      <div className="toolbar"><h1>{t('navDashboard')}</h1><span className="muted">● {t('liveNote')}</span></div>
      <div className="tiles">
        <Tile label={t('tileComing')} value={coming} of={capacity} tone="red" />
        <Tile label={t('tilePending')} value={counts.pending} tone={counts.pending ? 'warn' : undefined} href="/members" />
        <Tile label={t('tileActive')} value={counts.active} href="/members" />
        <Tile label={t('lowPlans')} value={counts.low} tone={counts.low ? 'warn' : undefined} />
        <Tile label={t('tileCollect')} value={`₹${toCollect}`} tone={toCollect ? 'warn' : 'ok'} />
      </div>

      <div className="cols">
        {panels.map(({ batch, session, snap, history }) => (
          <section key={session.id} className="card">
            <SessionHead t={t} lang={lang} batch={batch} session={session} />
            <div className="tiles">
              <Tile label={t('tileComing')} value={snap.booked} of={snap.capacity} tone="red" />
              <Tile label={t('tileMembers')} value={snap.members} />
              <Tile label={t('tileFloaters')} value={snap.floaters} sub={snap.friends ? `+${snap.friends} ${t('tileFriends').toLowerCase()}` : undefined} />
              <Tile label={t('tileNotComing')} value={snap.withdrawn.length} />
              <Tile label={t('tileSpots')} value={Math.max(0, snap.capacity - snap.booked)}
                tone={snap.booked > snap.capacity ? 'warn' : 'ok'}
                sub={snap.booked > snap.capacity ? t('overCapacity', { n: snap.booked - snap.capacity }) : undefined} />
            </div>
            <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} people={boardPeople(snap)} showNames labels={boardLabels(t)} />
            <People t={t} snap={snap} />
            <h3>{t('attendance')}</h3>
            <AttendanceChart id={batch.id} data={history} lang={lang}
              labels={{ showed: t('showed'), missed: t('missed'), table: t('tableView'), date: t('date'), empty: t('noHistory') }} />
            <a className="btn btn-ghost full" style={{ marginTop: 12 }} href={`/roster?sid=${session.id}`}>{t('navRoster')} →</a>
          </section>
        ))}
      </div>

      <section className="card">
        <h2>{t('lowPlans')}</h2>
        {low.length === 0 ? <p className="muted">{t('noLowPlans')}</p> : (
          <div className="people">
            {low.map((l, i) => (
              <div key={i} className="person">
                <span className="av member">{initials(l.name)}</span>
                <span>{l.name} <span className="muted">· {nameOf(l.batch_id)} · {t('left', { n: l.remaining })}</span></span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ---------- Paid member ----------

export async function MemberHome({ me, t, lang, plan, upcoming }: { me: Player; t: T; lang: Lang; plan: Membership; upcoming: Upcoming }) {
  const mine = upcoming.find((u) => u.batch.id === plan.batch_id);
  const left = planLeft(plan);
  const nextDates = mine ? upcomingPlanDates(plan, mine.batch, 6) : [];
  return (
    <>
      <AutoRefresh seconds={45} />
      <h1>{t('hi', { name: me.name.split(' ')[0] })}</h1>
      <div className="tiles">
        <Tile label={t('sessionsLeft')} value={left} of={plan.sessions_total} tone="red"
          sub={<span className="bar" style={{ display: 'block' }}><span style={{ width: `${(left / plan.sessions_total) * 100}%` }} /></span>} />
        <Tile label={t('sessionsUsed')} value={plan.sessions_used} />
        <Tile label={t('days')} value={<span style={{ fontSize: '1.5rem' }}>{daysLabel(t, plan.days)}</span>}
          sub={mine && batchName(t, mine.batch)} />
        <Tile label={t('validTill')} value={<span style={{ fontSize: '1.5rem' }}>{plan.ends_on ? fmtDate(plan.ends_on, lang) : t('noExpiry')}</span>}
          sub={plan.starts_on > istDate() ? t('planStarts', { date: fmtDate(plan.starts_on, lang) }) : undefined} />
      </div>
      {nextDates.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{t('upcomingSessions')}</h2>
          <div className="dates-grid">
            {nextDates.map((d, i) => (
              <span key={i} className="pill date">{fmtDate(d, lang)}</span>
            ))}
          </div>
        </section>
      )}
      {mine && <MemberSession me={me} t={t} lang={lang} plan={plan} batch={mine.batch} session={mine.session} />}
    </>
  );
}

async function MemberSession({ me, t, lang, plan, batch, session }: {
  me: Player; t: T; lang: Lang; plan: Membership; batch: Batch; session: Session;
}) {
  const snap = await snapshot(session, batch);
  const [mine] = await sql<Booking[]>`select * from bookings where session_id = ${session.id} and player_id = ${me.id}`;
  const { phase } = timing(session, batch);
  const covered = covers(plan, session);
  const active = mine && (mine.status === 'booked' || mine.status === 'present');
  const due = active ? ((covered ? 0 : 1) + mine.guests) * batch.price_rupees : 0;
  const open = phase === 'open';

  return (
    <div className="side flip">
      <section className="card">
        {phase === 'cancelled' ? <div className="status bad">{t('sessionCancelled')}</div>
          : active ? (
            <>
              <div className="status ok">{covered ? t('memberIn') : t('youAreBooked')}</div>
              {due > 0 && <div className="status warn">{t('payAtCourt', { amount: due })}</div>}
              {mine.status === 'booked' && open && (
                <form action={withdraw}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Submit className="btn-ghost full">{t('cantMakeIt')}</Submit>
                  <p className="muted">{t('withdrawHint')}</p>
                </form>
              )}
            </>
          ) : !open ? <div className="status warn">{t('bookingClosed')}</div>
          : (
            <>
              <p className={covered ? 'status warn' : 'muted'}>{covered ? t('memberOut') : t('noPlanToday')}</p>
              {snap.booked < snap.capacity && (
                <form action={book}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <input type="hidden" name="mode" value="me" />
                  <Submit className={covered ? 'btn-big' : 'btn-ghost full'}>
                    {covered ? t('comingAfterAll') : t('comingAnyway', { amount: batch.price_rupees })}
                  </Submit>
                </form>
              )}
            </>
          )}
      </section>
      <section className="card">
        <SessionHead t={t} lang={lang} batch={batch} session={session} />
        <div className="spread" style={{ marginBottom: 10 }}>
          <span><span className="count">{snap.booked}</span> <span className="muted">/ {snap.capacity} {t('coming')}</span></span>
          <span className="muted">{snap.capacity > snap.booked ? t('spotsLeft', { n: snap.capacity - snap.booked }) : t('full')}</span>
        </div>
        <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} people={boardPeople(snap, me.id)} showNames labels={boardLabels(t)} />
        <People t={t} snap={snap} />
      </section>
    </div>
  );
}

// ---------- Floater ----------

export async function FloaterSessions({ me, t, lang, upcoming }: { me: Player; t: T; lang: Lang; upcoming: Upcoming }) {
  const cards = await Promise.all(upcoming.map(async ({ batch, session }) => {
    const [mine] = await sql<Booking[]>`select * from bookings where session_id = ${session.id} and player_id = ${me.id}`;
    return { batch, session, snap: await snapshot(session, batch), mine: mine ?? null };
  }));
  return (
    <div className="cols">
      <AutoRefresh seconds={45} />
      {cards.map(({ batch, session, snap, mine }) => {
        const { phase } = timing(session, batch);
        const active = mine && (mine.status === 'booked' || mine.status === 'present');
        const left = Math.max(0, snap.capacity - snap.booked);
        return (
          <section key={session.id} className="card">
            <SessionHead t={t} lang={lang} batch={batch} session={session} />
            <div className="spread" style={{ marginBottom: 10 }}>
              <span><span className="count">{snap.booked}</span> <span className="muted">/ {snap.capacity} {t('coming')}</span></span>
              <span className="muted">{left > 0 ? t('spotsLeft', { n: left }) : t('full')}</span>
            </div>
            {/* Floaters see how full the courts are, not who is on them. */}
            <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} people={boardPeople(snap)} showNames={false} labels={boardLabels(t)} />
            <div style={{ marginTop: 14 }}>
              {phase === 'cancelled' ? <div className="status bad">{t('sessionCancelled')}</div>
                : active ? (
                  <>
                    <div className="status ok">{t('youAreBooked')}{mine.guests > 0 && ` ${t('plusFriends', { n: mine.guests })}`}</div>
                    <div className="status warn">{t('payAtCourt', { amount: (1 + mine.guests) * batch.price_rupees })}</div>
                    {mine.status === 'booked' && phase === 'open' && (
                      <form action={withdraw}>
                        <input type="hidden" name="sessionId" value={session.id} />
                        <Submit className="btn-ghost full">{t('cantMakeIt')}</Submit>
                        <p className="muted">{t('withdrawHint')}</p>
                      </form>
                    )}
                  </>
                ) : phase !== 'open' ? <div className="status warn">{t('bookingClosed')}</div>
                : left === 0 ? <div className="status bad">{t('sessionFull')}</div>
                : (
                  <>
                    {mine?.status === 'withdrawn' && <p className="muted">{t('notComingMarked')}</p>}
                    <BookForm sessionId={session.id} price={batch.price_rupees} selfCovered={false} maxFriends={Math.min(10, left - 1)}
                      labels={{ justMe: t('justMe'), meAndFriends: t('meAndFriends'), friends: t('friends'), you: t('you'), total: t('total'), covered: t('covered'), bookSlot: t('bookSlot') }} />
                  </>
                )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
