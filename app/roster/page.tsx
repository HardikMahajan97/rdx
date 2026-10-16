import { Suspense } from 'react';
import { headers } from 'next/headers';
import { sql, type Session } from '@/lib/db';
import { can, requireStaff } from '@/lib/auth';
import { batchName, translator } from '@/lib/i18n';
import { planLeft } from '@/lib/members';
import { snapshot } from '@/lib/snapshot';
import { getBatch, getSession, timing, upcomingSessions } from '@/lib/sessions';
import { fmtDate, fmtTime, istDate } from '@/lib/time';
import { cancelSession, changeCourts, togglePaid } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { CourtBoard } from '../ui/CourtBoard';
import { initials, Msg, Skeleton, SlotHead, Tile, Toolbar } from '../ui/Shared';
import type { BookingStatus } from '@/lib/db';

const statusTone: Record<BookingStatus, string> = { booked: '', confirmed: 'ok', present: 'blue', no_show: 'bad', withdrawn: '' };

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
  const { start, lockAt, closeAt, phase } = timing(session, batch);
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
    t('shareText', { batch: batchName(t, batch), day, time: fmtTime(start), booked: snap.booked, cap: snap.capacity }) +
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
      <div className="tabs sub-tabs">
        {upcoming.map((u) => (
          <a key={u.batch.id} href={`/roster?b=${u.batch.id}`} className={u.session.id === session.id ? 'on' : ''}>
            {batchName(t, u.batch)} · {fmtTime(u.session.starts_at)}
          </a>
        ))}
      </div>

      <section className="card panel">
        <SlotHead t={t} lang={me.lang} batch={batch} session={session}>
          {phase === 'over' && <span className="pill">{t('finished')}</span>}
        </SlotHead>
      </section>

      <div className="tiles">
        <Tile label={t('tileComing')} value={snap.booked} of={snap.capacity} tone={left < 0 ? 'warn' : 'blue'}
          sub={left < 0 ? t('overCapacity', { n: -left }) : t('spotsLeft', { n: left })} />
        <Tile label={t('tileConfirmed')} value={snap.confirmed} of={snap.booked} tone="ok" />
        <Tile label={t('tileHere')} value={snap.here} of={snap.booked} />
        <Tile label={t('tileMembers')} value={snap.members} sub={`${snap.floaters} ${t('tileFloaters').toLowerCase()}${snap.friends ? ` · +${snap.friends} ${t('tileFriends').toLowerCase()}` : ''}`} />
        <Tile label={t('tileCollect')} value={`₹${snap.toCollect}`} tone={snap.toCollect ? 'warn' : undefined}
          sub={snap.toRefund ? t('toRefund', { amount: snap.toRefund }) : undefined} />
        <Tile label={t('tileCollected')} value={`₹${snap.collected}`} tone="ok" />
      </div>

      <div className="side">
        <section className="card">
          <h2>{t('players')}</h2>
          <p className="muted">{t('rosterHint', { lock: fmtTime(lockAt), time: fmtTime(closeAt) })}</p>
          {snap.rows.length === 0 && <p className="muted">{t('noBookings')}</p>}
          <ul className="list roster">
            {snap.rows.map((r) => (
              <li key={r.id} className={r.status === 'withdrawn' ? 'withdrawn' : ''}>
                <div className="spread" style={{ flexWrap: 'nowrap' }}>
                  <span className="person">
                    <span className={`av ${r.covered ? 'member' : 'floater'}`}>{initials(r.name)}</span>
                    <span className="pname">{r.name}{r.guests > 0 && <span className="muted"> +{r.guests}</span>}</span>
                  </span>
                  {r.due > 0 && (
                    <form action={togglePaid}>
                      {hidden(r.id)}
                      {r.status === 'withdrawn'
                        ? <Submit className="btn-sm btn-danger">{t('refund', { amount: r.due })}</Submit>
                        : <Submit className={`btn-sm ${r.paid ? 'btn-ok' : 'btn-warn'}`}>{r.paid ? t('paid') : t('collect', { amount: r.due })}</Submit>}
                    </form>
                  )}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className={`pill ${statusTone[r.status]}`}>{t(`st_${r.status}`)}</span>
                  {r.covered
                    ? <span className="pill blue">{r.plan?.kind === 'wallet' ? t('walletPill', { left: r.plan ? planLeft(r.plan) : 0 }) : t('planCovered', { left: r.plan ? planLeft(r.plan) : 0 })}</span>
                    : r.isMember ? <span className="pill warn">{t('planNotCovering')}</span>
                    : <span className="pill">{t('floater')}</span>}
                  {r.no_shows > 0 && <span className="pill bad">{t('pastNoShows', { n: r.no_shows })}</span>}
                  <a className="muted" href={`tel:${r.phone}`}>{r.phone}</a>
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
          {can(me.role, 'cancel') && (phase === 'open' || phase === 'locked' || phase === 'live') && (
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
