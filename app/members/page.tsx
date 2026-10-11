import { Suspense } from 'react';
import { sql, type Membership, type PlanKind } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, daysLabel, translator, type Key, type T } from '@/lib/i18n';
import { planLeft, planLive } from '@/lib/members';
import { getBatches } from '@/lib/sessions';
import { fmtDate, istDate, dayOfWeek } from '@/lib/time';
import { endPlan, rejectRequest } from '../staff-actions';
import { PlanForm, type PlanDefaults } from '../ui/PlanForm';
import { Msg, Skeleton, Tile, Toolbar } from '../ui/Shared';

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };
type Request = { id: number; player_id: number; batch_id: string; plan: PlanKind; note: string | null; name: string; phone: string; created_at: Date };
type Visit = { date: string; batch_id: string; plan: boolean };
type MemberRow = Membership & { name: string; phone: string; visits: Visit[] | null };

const REQUEST_DAYS: Record<PlanKind, number[]> = {
  month: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6], other: [1, 2, 3, 4, 5],
};

/** Compute the next N session dates for a membership (for member glance view). */
function upcomingPlanDates(m: Membership, batch: { start_time: string }, limit = 5): string[] {
  const dates: string[] = [];
  const today = istDate();
  for (let offset = 0; dates.length < limit && offset < 60; offset++) {
    const date = istDate(offset);
    if (date < m.starts_on) continue;
    if (m.ends_on && date > m.ends_on) continue;
    if (!m.days.includes(dayOfWeek(date))) continue;
    dates.push(date);
  }
  return dates;
}

export default function Members(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={0} blocks={3} />}>
      <MembersContent {...props} />
    </Suspense>
  );
}

async function MembersContent({ searchParams }: Props) {
  const me = await requireStaff('members');
  const t = translator(me.lang);
  const { msg, mv } = await searchParams;
  const batches = await getBatches();
  const batchOpts = batches.map((b) => ({ id: b.id, name: batchName(t, b), start_time: b.start_time }));
  const nameOf = (id: string) => batchOpts.find((b) => b.id === id)?.name ?? id;
  const batchOf = (id: string) => batchOpts.find((b) => b.id === id);

  const requests = await sql<Request[]>`
    select r.*, p.name, p.phone from membership_requests r join players p on p.id = r.player_id
    where r.status = 'pending' order by r.created_at`;
  const members = await sql<MemberRow[]>`
    select m.*, p.name, p.phone, v.visits
    from memberships m join players p on p.id = m.player_id
    left join lateral (
      select json_agg(json_build_object('date', s.date, 'batch_id', s.batch_id, 'plan', b.membership_id is not null)
                      order by s.date desc) as visits
      from (select * from bookings where player_id = m.player_id and status = 'present'
            order by created_at desc limit 10) b
      join sessions s on s.id = b.session_id
    ) v on true
    where m.status = 'active'
    order by p.name`;

  const labels = (submit: Key) => ({
    phone: t('phone'), name: t('name'), batch: t('batch'), days: t('days'), all: t('days_all'),
    weekdays: t('days_weekdays'), weekends: t('days_weekends'), other: t('other'), otherHint: t('otherHint'),
    sessions: t('sessions'), wholeMonth: t('wholeMonth'),
    startsOn: t('startsOn'), endsOn: t('endsOn'), note: t('paymentNote'), submit: t(submit),
  });
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`d${d}` as Key));
  const form = (defaults: PlanDefaults, submit: Key, withPhone = false) => (
    <PlanForm batches={batchOpts.map(b => ({ id: b.id, name: b.name }))} defaults={defaults} withPhone={withPhone} labels={labels(submit)} dayNames={dayNames} />
  );

  return (
    <>
      <Toolbar me={me} t={t} here="/members" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />

      <div className="tiles">
        <Tile label={t('tilePending')} value={requests.length} tone={requests.length ? 'warn' : undefined} />
        <Tile label={t('tileActive')} value={members.filter((m) => planLive(m)).length} tone="red" />
        <Tile label={t('lowPlans')} value={members.filter((m) => planLive(m) && planLeft(m) <= 3).length} />
      </div>
      <div className="cols">
      <div>
      <h3>{t('requests')}</h3>
      {requests.length === 0 && <p className="muted">{t('noRequests')}</p>}
      {requests.map((r) => (
        <details key={r.id} className="card">
          <summary>
            {r.name} <span className="muted">· {t('requested', { plan: t(`plan_${r.plan}`), batch: nameOf(r.batch_id) })}</span>
          </summary>
          <p className="muted"><a href={`tel:${r.phone}`}>{r.phone}</a>{r.note && ` · “${r.note}”`}</p>
          {form({ requestId: r.id, batchId: r.batch_id, days: REQUEST_DAYS[r.plan], startsOn: istDate() }, 'activate')}
          <form action={rejectRequest} style={{ marginTop: 10 }}>
            <input type="hidden" name="requestId" value={r.id} />
            <button className="btn-ghost btn-sm">{t('reject')}</button>
          </form>
        </details>
      ))}

      <details className="card">
        <summary>+ {t('addMember')}</summary>
        {form({ batchId: batches[0]?.id ?? '', days: REQUEST_DAYS.month, startsOn: istDate() }, 'activate', true)}
      </details>

      </div>
      <div>
      <h3>{t('activeMembers')}</h3>
      {members.length === 0 && <p className="muted">{t('noMembers')}</p>}
      {members.map((m) => {
        const batch = batchOf(m.batch_id);
        const nextDates = batch ? upcomingPlanDates(m, batch, 5) : [];
        return <MemberCard key={m.id} t={t} m={m} lang={me.lang} batchLabel={nameOf(m.batch_id)} batchStart={batch?.start_time} nextDates={nextDates} nameOf={nameOf}
          editForm={form({ planId: m.id, batchId: m.batch_id, days: m.days, sessionsTotal: m.sessions_total, startsOn: m.starts_on, endsOn: m.ends_on, note: m.note }, 'savePlan')} />;
      })}
      </div>
      </div>
    </>
  );
}

function MemberCard({ t, m, lang, batchLabel, batchStart, nextDates, nameOf, editForm }: {
  t: T; m: MemberRow; lang: 'en' | 'mr' | 'hi'; batchLabel: string; batchStart?: string; nextDates: string[]; nameOf: (id: string) => string; editForm: React.ReactNode;
}) {
  const live = planLive(m);
  const left = planLeft(m);
  const batchTime = batchStart ? batchStart.slice(0, 5) : '';
  const daysStr = daysLabel(t, m.days);
  const expiry = m.ends_on ? t('planUntil', { date: fmtDate(m.ends_on, lang) }) : t('noExpiry');

  return (
    <details className="card">
      <summary className="member-summary">
        <div className="member-main">
          <span className="member-name">{m.name}</span>
          <span className="member-phone"><a href={`tel:${m.phone}`}>{m.phone}</a></span>
        </div>
        <div className="member-meta">
          <span className={`pill ${live ? 'ok' : 'bad'}`}>{t('used', { used: m.sessions_used, total: m.sessions_total })}</span>
          <span className="pill info">{t('sessionsLeft', { left, total: m.sessions_total })}</span>
          {batchTime && <span className="pill batch">{batchTime} · {batchLabel}</span>}
          <span className="pill days">{daysStr}</span>
          <span className="pill expiry">{expiry}</span>
        </div>
      </summary>
      {nextDates.length > 0 && (
        <div className="next-dates" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <span className="muted" style={{ marginRight: 8 }}>{t('upcoming')}: </span>
          {nextDates.map((d, i) => (
            <span key={i} className="pill date">{fmtDate(d, lang)}</span>
          ))}
        </div>
      )}
      {m.note && (
        <p className="muted note" style={{ marginTop: 8 }}>{m.note}</p>
      )}
      <details className="card-nested" style={{ marginTop: 12 }}>
        <summary className="muted">{t('visits')} · {t('editPlan')}</summary>
        <div style={{ marginTop: 8 }}>
          <h3>{t('visits')}</h3>
          {!m.visits?.length ? <p className="muted">{t('noVisits')}</p> : (
            <ul className="names">
              {m.visits.map((v, i) => (
                <li key={i}>
                  {fmtDate(v.date, lang)} · {nameOf(v.batch_id)} · <span className={`pill ${v.plan ? 'ok' : 'warn'}`}>{v.plan ? t('planVisit') : t('extraVisit')}</span>
                </li>
              ))}
            </ul>
          )}
          <h3>{t('savePlan')}</h3>
          {editForm}
          <form action={endPlan} style={{ marginTop: 10 }}>
            <input type="hidden" name="planId" value={m.id} />
            <button className="btn-danger btn-sm">{t('endPlan')}</button>
          </form>
        </div>
      </details>
    </details>
  );
}
