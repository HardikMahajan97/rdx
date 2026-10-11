import { Suspense } from 'react';
import { headers } from 'next/headers';
import { sql, type Session } from '@/lib/db';
import { can, requireStaff } from '@/lib/auth';
import { batchName, translator } from '@/lib/i18n';
import { planLeft } from '@/lib/members';
import { snapshot } from '@/lib/snapshot';
import { getBatch, getSession, timing, upcomingSessions } from '@/lib/sessions';
import { fmtDate, fmtTime, istDate } from '@/lib/time';
import { cancelSession, changeCourts, togglePaid, togglePresent } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { CourtBoard } from '../ui/CourtBoard';
import { Msg, Skeleton, Tile, Toolbar } from '../ui/Shared';

type Props = { searchParams: Promise<{ sid?: string; b?: string; msg?: string; mv?: string }> };

export default function Roster(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={6} />}>
      <RosterContent {...props} />
    </Suspense>
  );
}

async function RosterContent({ searchParams }: Props) {
  const me = await requireStaff('roster');
  const t = translator(me.lang);
  const { sid, b, msg, mv } = await searchParams;

  const upcoming = await upcomingSessions();
  let session: Session | null = sid ? await getSession(Number(sid)) : null;
  session ??= (upcoming.find((u) => u.batch.id === b) ?? upcoming[0])?.session ?? null;
  if (!session) return <p>—</p>;
  const batch = (await getBatch(session.batch_id))!;
  const { start, end, phase } = timing(session, batch);
  const snap = await snapshot(session, batch);
  const left = snap.capacity - snap.booked;

  const [prev] = await sql<{ id: number }[]>`
    select id from sessions where batch_id = ${batch.id} and starts_at < ${session.starts_at}
    order by starts_at desc limit 1`;
  const isUpcoming = upcoming.some((u) => u.session.id === session.id);

  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const day = session.date === istDate() ? t('today') : session.date === istDate(1) ? t('tomorrow') : fmtDate(session.date, me.lang);
  const shareText =
    t('shareText', { batch: batchName(t, batch), day, time: fmtTime(start, me.lang), booked: snap.booked, cap: snap.capacity }) +
    (left > 0 ? t('shareOpen', { n: left, url: appUrl }) : t('shareFull'));
  const hidden = (bookingId?: number) => (
    <>
      <input type="hidden" name="sessionId" value={session.id} />
      {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
    </>
  );

  return (
    <>
      {isUpcoming && <AutoRefresh seconds={20} />}
      <Toolbar me={me} t={t} here="/roster" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />
      <div className="tabs">
        {upcoming.map((u) => (
          <a key={u.batch.id} href={`/roster?b=${u.batch.id}`} className={u.session.id === session.id ? 'on' : ''}>
            {batchName(t, u.batch)}
          </a>
        ))}
      </div>

      <div className="toolbar">
        <h1>{batchName(t, batch)} · {day} {fmtTime(start, me.lang)}</h1>
        <span className="row">
          {phase === 'cancelled' && <span className="pill bad">{t('cancelled')}</span>}
          {phase === 'over' && <span className="pill">{t('finished')}</span>}
          {phase === 'live' && <span className="pill ok">● {t('live')}</span>}
        </span>
      </div>

      <div className="tiles">
        <Tile label={t('tileComing')} value={snap.booked} of={snap.capacity} tone={left < 0 ? 'warn' : 'red'}
          sub={left < 0 ? t('overCapacity', { n: -left }) : t('spotsLeft', { n: left })} />
        <Tile label={t('tileHere')} value={snap.here} of={snap.booked} tone="ok" />
        <Tile label={t('tileMembers')} value={snap.members} />
        <Tile label={t('tileFloaters')} value={snap.floaters} sub={snap.friends ? `+${snap.friends} ${t('tileFriends').toLowerCase()}` : undefined} />
        <Tile label={t('tileCollect')} value={`₹${snap.toCollect}`} tone={snap.toCollect ? 'warn' : undefined} />
        <Tile label={t('tileCollected')} value={`₹${snap.collected}`} tone="ok" />
      </div>

      <div className="side">
        <section className="card">
          <h2>{t('players')}</h2>
          <p className="muted">{t('rosterHint', { time: fmtTime(end, me.lang) })}</p>
          {snap.rows.length === 0 && <p className="muted">{t('noBookings')}</p>}
          <ul className="list">
            {snap.rows.map((r) => (
              <li key={r.id} className={r.status === 'withdrawn' ? 'withdrawn' : ''}>
                <div className="spread" style={{ flexWrap: 'nowrap' }}>
                  <form action={togglePresent} style={{ flex: 1, minWidth: 0 }}>
                    {hidden(r.id)}
                    <Submit className={`btn-ghost full check ${r.status === 'present' ? 'on' : r.status === 'no_show' ? 'miss' : ''}`}
                      disabled={r.status === 'withdrawn' || phase === 'cancelled'}>
                      <span className="box">{r.status === 'present' ? '✓' : r.status === 'no_show' ? '✕' : ''}</span>
                      <span className="name">{r.name}{r.guests > 0 && ` +${r.guests}`}</span>
                    </Submit>
                  </form>
                  {r.due > 0 && (
                    <form action={togglePaid}>
                      {hidden(r.id)}
                      <Submit className={`btn-sm ${r.paid ? '' : 'btn-danger'}`}>
                        {r.paid ? t('paid') : t('collect', { amount: r.due })}
                      </Submit>
                    </form>
                  )}
                </div>
                <div className="row muted" style={{ marginTop: 6 }}>
                  <span className={`pill ${r.status === 'present' ? 'ok' : r.status === 'no_show' ? 'bad' : ''}`}>{t(`st_${r.status}`)}</span>
                  {r.plan
                    ? <span className={`pill ${r.covered ? 'red' : 'warn'}`}>
                        {r.covered ? t('planCovered', { left: planLeft(r.plan) }) : t('planNotCovering')}
                      </span>
                    : <span className="pill">{t('floater')}</span>}
                  {r.no_shows > 0 && <span className="pill bad">{t('pastNoShows', { n: r.no_shows })}</span>}
                  <a href={`tel:${r.phone}`}>{r.phone}</a>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div>
          <section className="card">
            <CourtBoard capacity={snap.capacity} perCourt={batch.players_per_court} showNames
              people={snap.active.map((r) => ({ name: r.name, kind: r.covered ? 'member' : 'floater', guests: r.guests, here: r.status === 'present' }))}
              labels={{ court: t('court'), member: t('legendMember'), floater: t('legendFloater'), friend: t('legendFriend'), open: t('openSpot'), extra: t('overCap') }} />
            <div className="row" style={{ marginTop: 14 }}>
              <form action={changeCourts}>{hidden()}<input type="hidden" name="delta" value="1" /><Submit className="btn-sm">{t('addCourt')}</Submit></form>
              <form action={changeCourts}>{hidden()}<input type="hidden" name="delta" value="-1" /><Submit className="btn-sm btn-ghost">{t('removeCourt')}</Submit></form>
              <a className="btn btn-sm btn-primary" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}>{t('share')}</a>
            </div>
          </section>
          <div className="row">
            {prev && <a className="btn btn-ghost btn-sm" href={`/roster?sid=${prev.id}`}>{t('prevSession')}</a>}
            {!isUpcoming && <a className="btn btn-ghost btn-sm" href={`/roster?b=${batch.id}`}>{t('nextSession')}</a>}
          </div>
          {can(me.role, 'cancel') && (phase === 'open' || phase === 'live') && (
            <details className="card">
              <summary>{t('cancelTitle')}</summary>
              <form action={cancelSession} className="stack">
                {hidden()}
                <label>{t('cancelConfirm')}<input name="confirm" autoComplete="off" /></label>
                <Submit className="btn-danger">{t('cancelBtn')}</Submit>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
