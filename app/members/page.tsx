import { Suspense } from 'react';
import { sql, type Membership, type PlanKind } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, daysLabel, translator, type Key, type T } from '@/lib/i18n';
import { ALL_DAYS, planLeft, planLive } from '@/lib/members';
import { getBatches } from '@/lib/sessions';
import { fmtDate, istDate } from '@/lib/time';
import { addPlayer, endPlan, resetPinByPhone } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { PlanForm, type PlanDefaults } from '../ui/PlanForm';
import { dayNames, planLabels } from '../ui/plan-labels';
import { initials, Msg, Skeleton, Tile, Toolbar } from '../ui/Shared';

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };
type Visit = { date: string; batch_id: string; plan: boolean; status: 'present' | 'no_show' };
type Entry = { delta: number; reason: 'activate' | 'topup' | 'use' | 'refund' | 'adjust'; at: string; amount: number | null; date: string | null };
type MemberRow = Membership & { name: string; phone: string; visits: Visit[] | null; entries: Entry[] | null };

const REQUEST_DAYS: Record<PlanKind, number[]> = {
  month: ALL_DAYS, weekdays: [1, 2, 3, 4, 5], weekends: [0, 6], wallet: ALL_DAYS,
};

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
  const batchOpts = batches.map((b) => ({ id: b.id, name: batchName(t, b) }));
  const nameOf = (id: string | null) => (id ? batchOpts.find((b) => b.id === id)?.name ?? id : t('wallet'));

  const [req] = await sql<{ pending: number; quoted: number }[]>`
    select count(*) filter (where r.status = 'pending')::int as pending, count(*) filter (where r.status = 'quoted')::int as quoted
    from membership_requests r join players p on p.id = r.player_id
    where r.status in ('pending', 'quoted') and p.deleted_at is null`;
  const members = await sql<MemberRow[]>`
    select m.*, p.name, p.phone, v.visits, l.entries
    from memberships m join players p on p.id = m.player_id
    left join lateral (
      select json_agg(json_build_object('date', s.date, 'batch_id', s.batch_id, 'plan', b.charged, 'status', b.status)
                      order by s.date desc) as visits
      from (select * from bookings where player_id = m.player_id and status in ('present', 'no_show')
            order by created_at desc limit 10) b
      join sessions s on s.id = b.session_id
    ) v on true
    left join lateral (
      select json_agg(json_build_object('delta', x.delta, 'reason', x.reason, 'at', x.created_at, 'amount', x.amount_rupees, 'date', s.date)
                      order by x.created_at desc) as entries
      from (select * from plan_ledger where membership_id = m.id order by created_at desc limit 12) x
      left join bookings b on b.id = x.booking_id left join sessions s on s.id = b.session_id
    ) l on true
    where m.status = 'active' and p.deleted_at is null
    order by p.name`;

  const form = (defaults: PlanDefaults, submit: Key, opts: { withPhone?: boolean; topUp?: boolean } = {}) => (
    <PlanForm batches={batchOpts} defaults={defaults} withPhone={opts.withPhone} topUp={opts.topUp} labels={planLabels(t, submit)} dayNames={dayNames(t)} />
  );
  const live = members.filter((m) => planLive(m));

  return (
    <>
      <Toolbar me={me} t={t} here="/members" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />
      <AutoRefresh seconds={15} />

      <div className="tiles">
        <Tile label={t('tilePending')} value={req.pending} tone={req.pending + req.quoted ? 'warn' : undefined} href="/requests#plans"
          sub={t('awaitingPayment', { n: req.quoted })} />
        <Tile label={t('tileActive')} value={live.length} tone="blue" />
        <Tile label={t('walletsTile')} value={live.filter((m) => m.kind === 'wallet').length}
          sub={t('sessionsInWallets', { n: live.filter((m) => m.kind === 'wallet').reduce((n, m) => n + planLeft(m), 0) })} />
        <Tile label={t('lowPlans')} value={live.filter((m) => planLeft(m) <= 3).length} />
      </div>
      <div className="cols">
        <div>
          <details className="card">
            <summary>+ {t('addPlayer')}</summary>
            <p className="muted">{t('addPlayerHint')}</p>
            <form action={addPlayer} className="stack">
              <label>{t('phone')}<input name="phone" type="tel" inputMode="numeric" placeholder="98xxxxxxxx" required /></label>
              <div className="grid2">
                <label>{t('firstName')}<input name="firstName" autoComplete="off" maxLength={40} required /></label>
                <label>{t('lastName')}<input name="lastName" autoComplete="off" maxLength={40} required /></label>
              </div>
              <Submit className="btn-primary">{t('addPlayer')}</Submit>
            </form>
          </details>
          <details className="card">
            <summary>+ {t('addMember')}</summary>
            {form({ kind: 'fixed', batchId: batches[0]?.id ?? '', days: REQUEST_DAYS.month, startsOn: istDate() }, 'activate', { withPhone: true })}
          </details>
          <details className="card">
            <summary>{t('resetByPhone')}</summary>
            <p className="muted">{t('pinRequestsHint')}</p>
            <form action={resetPinByPhone} className="row">
              <input name="phone" type="tel" inputMode="numeric" placeholder="98xxxxxxxx" required style={{ flex: 1, minWidth: 0 }} />
              <Submit className="btn-sm btn-warn">{t('resetPin')}</Submit>
            </form>
          </details>
        </div>
        <div>
          <h3>{t('activeMembers')}</h3>
          {members.length === 0 && <p className="muted">{t('noMembers')}</p>}
          {members.map((m) => (
            <MemberCard key={m.id} t={t} m={m} lang={me.lang} nameOf={nameOf}
              topUpForm={m.kind === 'wallet' && planLive(m)
                ? form({ phone: m.phone, kind: 'wallet', batchId: null, days: ALL_DAYS, startsOn: istDate() }, 'topUpBtn', { topUp: true })
                : null}
              editForm={form({
                planId: m.id, kind: m.kind, batchId: m.batch_id, days: m.days, sessionsTotal: m.sessions_total,
                startsOn: m.starts_on, endsOn: m.ends_on, note: m.note, amount: m.amount_rupees,
              }, 'savePlan')} />
          ))}
        </div>
      </div>
    </>
  );
}

function MemberCard({ t, m, lang, nameOf, editForm, topUpForm }: {
  t: T; m: MemberRow; lang: 'en' | 'mr' | 'hi'; nameOf: (id: string | null) => string; editForm: React.ReactNode; topUpForm: React.ReactNode;
}) {
  const live = planLive(m);
  const left = planLeft(m);
  const pct = Math.max(0, Math.min(100, (left / m.sessions_total) * 100));

  return (
    <details className="card member-card">
      <summary className="member-summary">
        <div className="spread" style={{ flexWrap: 'nowrap' }}>
          <span className="person">
            <span className={`av ${m.kind === 'wallet' ? 'wallet' : 'member'}`}>{initials(m.name)}</span>
            <span className="pname">{m.name}<small><a href={`tel:${m.phone}`}>{m.phone}</a></small></span>
          </span>
          <span className={`big-left ${live ? '' : 'bad'}`}><b>{left}</b><small>/ {m.sessions_total}</small></span>
        </div>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="member-meta">
          {m.kind === 'wallet'
            ? <span className="pill blue">👛 {t('walletAnyDay')}</span>
            : <><span className="pill">{nameOf(m.batch_id)}</span><span className="pill">{daysLabel(t, m.days)}</span></>}
          <span className="pill">{m.ends_on ? t('planUntil', { date: fmtDate(m.ends_on, lang) }) : t('noExpiry')}</span>
          {m.amount_rupees ? <span className="pill ok">₹{m.amount_rupees}</span> : null}
        </div>
      </summary>
      {m.note && <p className="note">{m.note}</p>}
      {topUpForm && (
        <details className="card-nested">
          <summary>＋ {t('topUpBtn')}</summary>
          <div>{topUpForm}</div>
        </details>
      )}
      <details className="card-nested">
        <summary>{t('history')}</summary>
        <div>
          {!m.entries?.length ? <p className="muted">{t('noVisits')}</p> : (
            <ul className="ledger">
              {m.entries.map((e, i) => (
                <li key={i}>
                  <span className={`delta ${e.delta > 0 ? 'plus' : 'minus'}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
                  <span>{t(`lg_${e.reason}`)}{e.date && ` · ${fmtDate(e.date, lang)}`}{e.amount ? ` · ${e.amount < 0 ? '−' : ''}₹${Math.abs(e.amount)}` : ''}</span>
                  <span className="faint">{fmtDate(String(e.at).slice(0, 10), lang)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3>{t('visits')}</h3>
          {!m.visits?.length ? <p className="muted">{t('noVisits')}</p> : (
            <ul className="names">
              {m.visits.map((v, i) => (
                <li key={i}>
                  {fmtDate(v.date, lang)} · {nameOf(v.batch_id)} · <span className={`pill ${v.status === 'present' ? 'ok' : 'bad'}`}>{t(`st_${v.status}`)}</span>{' '}
                  <span className={`pill ${v.plan ? 'blue' : 'warn'}`}>{v.plan ? t('planVisit') : t('extraVisit')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <details className="card-nested">
        <summary>{t('editPlan')}</summary>
        <div>
          {editForm}
          <form action={endPlan} style={{ marginTop: 10 }}>
            <input type="hidden" name="planId" value={m.id} />
            <Submit className="btn-danger btn-sm">{t('endPlan')}</Submit>
          </form>
        </div>
      </details>
    </details>
  );
}
