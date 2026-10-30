import { Suspense } from 'react';
import { sql, type Player, type PlanKind } from '@/lib/db';
import { canResetPin, requireStaff } from '@/lib/auth';
import { batchName, translator } from '@/lib/i18n';
import { ALL_DAYS } from '@/lib/members';
import { getBatches } from '@/lib/sessions';
import { fmtDate, istDate } from '@/lib/time';
import { approveSignup, dismissPinRequest, quoteRequest, rejectRequest, rejectSignup, resetPin } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { PlanForm } from '../ui/PlanForm';
import { dayNames, planLabels } from '../ui/plan-labels';
import { initials, Msg, Skeleton, Tile, Toolbar } from '../ui/Shared';

// Everything that waits for core/admin, in one place: new sign-ups, "Forgot PIN" requests and plan requests.
// The staff nav shows the same total as a badge.

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };
type PlanRequest = {
  id: number; player_id: number; batch_id: string | null; plan: PlanKind; note: string | null; name: string; phone: string;
  status: 'pending' | 'quoted'; sessions_requested: number | null; amount_rupees: number | null; has_wallet: boolean;
};

const REQUEST_DAYS: Record<PlanKind, number[]> = {
  month: ALL_DAYS, weekdays: [1, 2, 3, 4, 5], weekends: [0, 6], wallet: ALL_DAYS,
};

export default function Requests(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={3} blocks={2} />}>
      <RequestsContent {...props} />
    </Suspense>
  );
}

async function RequestsContent({ searchParams }: Props) {
  const me = await requireStaff('members');
  const t = translator(me.lang);
  const { msg, mv } = await searchParams;
  const allBatches = await getBatches({ all: true });
  const label = (b: (typeof allBatches)[number]) => (b.multi_venue ? `${batchName(t, b)} · ${b.venue_name}` : batchName(t, b));
  const batchOpts = allBatches.filter((b) => b.active).map((b) => ({ id: b.id, name: label(b) }));
  const nameOf = (id: string | null) => {
    const b = allBatches.find((x) => x.id === id);
    return id ? (b ? label(b) : id) : t('wallet');
  };

  const signups = await sql<Pick<Player, 'id' | 'name' | 'phone' | 'created_at' | 'email' | 'skill_level' | 'gender'>[]>`
    select id, name, phone, created_at, email, skill_level, gender from players
    where approved_at is null and deactivated_at is null and deleted_at is null order by created_at`;
  const pinRequests = (await sql<Pick<Player, 'id' | 'name' | 'phone' | 'role'>[]>`
    select id, name, phone, role from players
    where pin_reset_requested_at is not null and pin_hash is not null and deactivated_at is null and deleted_at is null
    order by pin_reset_requested_at`)
    .filter((p) => canResetPin(me, p));
  const plans = await sql<PlanRequest[]>`
    select r.*, p.name, p.phone,
      exists (select 1 from memberships m where m.player_id = r.player_id and m.status = 'active' and m.kind = 'wallet'
              and m.sessions_used < m.sessions_total) as has_wallet
    from membership_requests r join players p on p.id = r.player_id
    where r.status in ('pending', 'quoted') and p.deleted_at is null order by r.status = 'quoted', r.created_at`;
  const total = signups.length + pinRequests.length + plans.length;

  return (
    <>
      <Toolbar me={me} t={t} here="/requests" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />
      <AutoRefresh seconds={20} />

      <div className="hero">
        <div>
          <div className="eyebrow">{t('navRequests')}</div>
          <h1>{total ? t('nWaiting', { n: total }) : t('nothingWaiting')}</h1>
        </div>
      </div>
      <div className="tiles">
        <Tile label={t('signups')} value={signups.length} tone={signups.length ? 'warn' : undefined} href="#signups" />
        <Tile label={t('planRequests')} value={plans.length} tone={plans.length ? 'warn' : undefined} href="#plans"
          sub={t('awaitingPayment', { n: plans.filter((r) => r.status === 'quoted').length })} />
        <Tile label={t('pinRequests')} value={pinRequests.length} tone={pinRequests.length ? 'warn' : undefined} href="#pins" />
      </div>

      <div className="cols">
        <div>
          <section className="card signups" id="signups">
            <h2>{t('signups')} {signups.length > 0 && <span className="pill warn">{signups.length}</span>}</h2>
            <p className="muted">{t('signupsHint')}</p>
            {signups.length === 0 && <p className="faint">{t('noneWaiting')}</p>}
            <ul className="list">
              {signups.map((p) => (
                <li key={p.id}>
                  <div className="spread" style={{ flexWrap: 'nowrap' }}>
                    <span className="person">
                      <span className="av floater">{initials(p.name)}</span>
                      <span className="pname">{p.name}<small><a href={`tel:${p.phone}`}>{p.phone}</a> · {fmtDate(istDate(0, p.created_at.getTime()), me.lang)}</small></span>
                    </span>
                    <form action={approveSignup}>
                      <input type="hidden" name="id" value={p.id} />
                      <Submit className="btn-sm btn-ok">{t('approve')}</Submit>
                    </form>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    {p.skill_level && <span className="pill blue">{t(`skill_${p.skill_level}`)}</span>}
                    {p.gender && <span className="pill">{t(`gender_${p.gender}`)}</span>}
                    {p.email && <a className="muted" href={`mailto:${p.email}`}>{p.email}</a>}
                  </div>
                  <details className="status-edit">
                    <summary>{t('reject')}</summary>
                    <form action={rejectSignup}>
                      <input type="hidden" name="id" value={p.id} />
                      <Submit className="btn-sm btn-danger">{t('rejectSignupConfirm', { name: p.name })}</Submit>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" id="pins">
            <h2>{t('pinRequests')} {pinRequests.length > 0 && <span className="pill warn">{pinRequests.length}</span>}</h2>
            <p className="muted">{t('pinRequestsHint')}</p>
            {pinRequests.length === 0 && <p className="faint">{t('noneWaiting')}</p>}
            <ul className="list">
              {pinRequests.map((p) => (
                <li key={p.id} className="spread">
                  <span className="person">
                    <span className="av floater">{initials(p.name)}</span>
                    <span className="pname">{p.name}<small><a href={`tel:${p.phone}`}>{p.phone}</a>{p.role !== 'player' && ` · ${t(`role_${p.role}`)}`}</small></span>
                  </span>
                  <span className="row">
                    <form action={resetPin}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="requested" value="1" />
                      <input type="hidden" name="back" value="/requests" />
                      <Submit className="btn-sm btn-warn">{t('resetPin')}</Submit>
                    </form>
                    <form action={dismissPinRequest}>
                      <input type="hidden" name="id" value={p.id} />
                      <Submit className="btn-sm btn-ghost">{t('dismiss')}</Submit>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div id="plans">
          <h3>{t('planRequests')}</h3>
          {plans.length === 0 && <p className="muted">{t('noRequests')}</p>}
          {plans.map((r) => {
            const topUp = r.plan === 'wallet' && r.has_wallet;
            return (
              <details key={r.id} className="card">
                <summary className="req-summary">
                  <span className="person">
                    <span className="av member">{initials(r.name)}</span>
                    <span className="pname">{r.name}</span>
                  </span>
                  <span className="row">
                    <span className="pill">{topUp ? t('topUpReq') : t(`plan_${r.plan}`)}</span>
                    {r.batch_id && <span className="pill">{nameOf(r.batch_id)}</span>}
                    {r.sessions_requested && <span className="pill blue">{t('nSessions', { n: r.sessions_requested })}</span>}
                    <span className={`pill ${r.status === 'quoted' ? 'blue' : 'warn'}`}>
                      {r.status === 'quoted' ? t('quotedPill', { amount: r.amount_rupees ?? 0 }) : t('reqPending')}
                    </span>
                  </span>
                </summary>
                <p className="muted"><a href={`tel:${r.phone}`}>{r.phone}</a>{r.note && ` · “${r.note}”`}</p>

                <div className="step-box">
                  <div className="eyebrow">① {t('stepQuote')}</div>
                  <form action={quoteRequest} className="row">
                    <input type="hidden" name="requestId" value={r.id} />
                    {r.sessions_requested && <input type="hidden" name="sessions" value={r.sessions_requested} />}
                    <input name="amount" type="number" min="1" inputMode="numeric" placeholder="₹" defaultValue={r.amount_rupees ?? ''} required style={{ flex: 1, minWidth: 0 }} />
                    <Submit className="btn-sm">{r.status === 'quoted' ? t('updateQuote') : t('sendQuote')}</Submit>
                  </form>
                </div>
                <div className="step-box">
                  <div className="eyebrow">② {t('stepActivate')}</div>
                  <PlanForm batches={batchOpts} back="/requests" topUp={topUp} labels={planLabels(t, topUp ? 'topUpBtn' : 'activate')} dayNames={dayNames(t)}
                    defaults={{
                      requestId: r.id, kind: r.plan === 'wallet' ? 'wallet' : 'fixed', batchId: r.batch_id, days: REQUEST_DAYS[r.plan],
                      startsOn: istDate(), sessionsTotal: r.sessions_requested ?? undefined, amount: r.amount_rupees,
                    }} />
                </div>
                <form action={rejectRequest} style={{ marginTop: 10 }}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <Submit className="btn-ghost btn-sm">{t('reject')}</Submit>
                </form>
              </details>
            );
          })}
        </div>
      </div>
    </>
  );
}
