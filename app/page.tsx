import { Suspense } from 'react';
import { GENDERS, SKILL_LEVELS, sql, type Membership, type PlanKind } from '@/lib/db';
import { getLang, isStaff, viewer } from '@/lib/auth';
import { batchName, translator } from '@/lib/i18n';
import { planLive } from '@/lib/members';
import { upcomingSessions } from '@/lib/sessions';
import { cancelRequest, enterPin, forgotPin, join, leave, register, setPin, updateName } from './actions';
import { ApplyForm } from './ui/ApplyForm';
import { Submit } from './ui/Client';
import { Loader, Msg, Rally, Skeleton, Toolbar } from './ui/Shared';
import { AttendancePrompts, PlanCard, PlayerSessions, StaffDashboard } from './ui/Views';

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };

/** Messages that belong to the registration form, so it opens to show them. */
const REGISTER_MSGS = ['needName', 'errName', 'errRegPhone', 'errEmail', 'errSkill', 'errGender'];

export default function Home(props: Props) {
  return (
    <Suspense fallback={<Skeleton />}>
      <HomeContent {...props} />
    </Suspense>
  );
}

async function HomeContent({ searchParams }: Props) {
  const { msg, mv } = await searchParams;
  const { player: me, gate } = await viewer();
  const lang = await getLang(me);
  const t = translator(lang);
  const top = (
    <>
      <Toolbar me={gate ? null : me} t={t} here="/" lang={lang} />
      <Msg t={t} msg={msg} mv={mv} />
    </>
  );
  const narrow = { maxWidth: 520, margin: '0 auto' };

  if (!me) {
    return (
      <div style={narrow}>
        {top}
        <div className="welcome">
          <Loader />
          <h1>{t('welcome')}</h1>
          <p className="muted">{t('welcomeHint')}</p>
        </div>
        <form action={join} className="card stack">
          <h2>{t('signInTitle')}</h2>
          <label>
            {t('phone')}
            <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98xxxxxxxx" required />
          </label>
          <Submit className="btn-big">{t('continue')}</Submit>
        </form>

        {/* New players: a request that the RDx admin / core team approve. */}
        <details className="card register" open={REGISTER_MSGS.includes(msg ?? '')}>
          <summary><span>{t('registerTitle')}</span><span className="muted">{t('registerSub')}</span></summary>
          <form action={register} className="stack">
            <div className="notice" role="note">
              <b>{t('registerNoticeTitle')}</b>
              <span>{t('registerNotice')}</span>
            </div>
            <div className="grid2">
              <label>{t('firstName')}<input name="firstName" autoComplete="given-name" maxLength={40} required /></label>
              <label>{t('lastName')}<input name="lastName" autoComplete="family-name" maxLength={40} required /></label>
            </div>
            <label>
              {t('phone')}
              <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98xxxxxxxx" required />
            </label>
            <label>{t('email')}<input name="email" type="email" inputMode="email" autoComplete="email" maxLength={120} placeholder="name@example.com" required /></label>
            <div className="grid2">
              <label>{t('skillLevel')}
                <select name="skill" defaultValue="" required>
                  <option value="" disabled>{t('choose')}</option>
                  {SKILL_LEVELS.map((s) => <option key={s} value={s}>{t(`skill_${s}`)}</option>)}
                </select>
              </label>
              <label>{t('gender')}
                <select name="gender" defaultValue="" required>
                  <option value="" disabled>{t('choose')}</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{t(`gender_${g}`)}</option>)}
                </select>
              </label>
            </div>
            <Submit className="btn-big">{t('register')}</Submit>
          </form>
        </details>
      </div>
    );
  }

  if (gate) {
    const staff = isStaff(me.role);
    const hint = gate === 'set'
      ? staff ? t('pinSetHint', { role: t(`role_${me.role}`) }) : t('pinSetHintPlayer')
      : staff ? t('pinEnterHint') : t('pinEnterHintPlayer', { name: me.first_name });
    return (
      <div style={narrow}>
        {top}
        <h1>{gate === 'set' ? t('pinSetTitle') : t('pinEnterTitle')}</h1>
        <p className="muted">{hint}</p>
        <form action={gate === 'set' ? setPin : enterPin} className="card stack">
          <label>
            {t('pin')}
            <input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" autoFocus required className="pin" />
          </label>
          {gate === 'set' && (
            <label>
              {t('pinConfirm')}
              <input name="pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} autoComplete="off" required className="pin" />
            </label>
          )}
          <Submit className="btn-big">{gate === 'set' ? t('pinSave') : staff ? t('unlock') : t('continue')}</Submit>
        </form>
        {gate === 'enter' && (me.pin_reset_requested_at
          ? <div className="status warn">{t('pinRequestPending')}</div>
          : <form action={forgotPin}><Submit className="btn-ghost btn-sm">{t('forgotPin')}</Submit></form>)}
        <form action={leave}><button className="btn-ghost btn-sm">{t('switchUser', { name: me.first_name })}</button></form>
      </div>
    );
  }

  const upcoming = await upcomingSessions();

  // Admin and core members run the sessions; they get the dashboard, not booking.
  if (isStaff(me.role)) {
    return <>{top}<StaffDashboard me={me} t={t} lang={lang} upcoming={upcoming} /></>;
  }

  const [active] = await sql<Membership[]>`select * from memberships where player_id = ${me.id} and status = 'active'`;
  const plan = active && planLive(active) ? active : null;
  const [request] = await sql<{ plan: PlanKind; status: 'pending' | 'quoted'; amount_rupees: number | null; sessions_requested: number | null }[]>`
    select plan, status, amount_rupees, sessions_requested from membership_requests
    where player_id = ${me.id} and status in ('pending', 'quoted')`;
  const first = me.first_name;
  // Fixed plans have to run out before a new one; wallets can be topped up any time.
  const canApply = !plan || plan.kind === 'wallet';
  const membership = request ? (
    <section className="card request-card">
      <div className="eyebrow">{t(`plan_${request.plan}`)}{request.sessions_requested ? ` · ${t('nSessions', { n: request.sessions_requested })}` : ''}</div>
      {request.status === 'quoted'
        ? <div className="status info">{t('quotedPay', { amount: request.amount_rupees ?? 0 })}</div>
        : <div className="status warn">{t('applyPending')}</div>}
      <form action={cancelRequest}><Submit className="btn-ghost btn-sm">{t('cancelRequest')}</Submit></form>
    </section>
  ) : canApply ? (
    <details className={`card apply-card${plan ? '' : ' promo'}`}>
      <summary>
        {plan ? t('topUpTitle') : (
          <span className="promo-head">
            <Rally />
            <span className="promo-title">{t('applyTitle')}</span>
            <span className="promo-sub">{t('promoHint')}</span>
          </span>
        )}
      </summary>
      <p className="muted">{plan ? t('topUpHint') : t('applyHint')}</p>
      <ApplyForm walletOnly={!!plan} batches={upcoming.map(({ batch }) => ({ id: batch.id, name: batchName(t, batch) }))}
        labels={{
          batch: t('batch'), plan: t('plan'), month: t('plan_month'), weekdays: t('plan_weekdays'), weekends: t('plan_weekends'),
          wallet: t('plan_wallet'), walletHint: t('walletHint'), sessions: t('sessionsWanted'), note: t('note'),
          submit: plan ? t('topUpSubmit') : t('applySubmit'),
        }} />
    </details>
  ) : null;

  return (
    <>
      {top}
      <div className="hero">
        <div>
          <div className="eyebrow">{plan ? (plan.kind === 'wallet' ? t('walletTitle') : t('member')) : t('floater')}</div>
          <h1>{t('hi', { name: first })}</h1>
        </div>
      </div>
      {/* Floaters see the membership offer first; members find top-ups below their sessions. */}
      {!plan && membership}
      {plan && <PlanCard t={t} lang={lang} plan={plan} batches={upcoming.map((u) => u.batch)} />}
      <AttendancePrompts me={me} t={t} lang={lang} />
      <PlayerSessions me={me} t={t} lang={lang} plan={plan} upcoming={upcoming} />
      {plan && membership}

      <details className="card name-card">
        <summary>{t('yourName')}{me.last_name === 'x' && <span className="pill warn">{t('addLastName')}</span>}</summary>
        <form action={updateName} className="stack">
          <div className="grid2">
            <label>{t('firstName')}<input name="firstName" defaultValue={me.first_name} autoComplete="given-name" maxLength={40} required /></label>
            <label>{t('lastName')}<input name="lastName" defaultValue={me.last_name === 'x' ? '' : me.last_name} autoComplete="family-name" maxLength={40} required /></label>
          </div>
          <Submit className="btn-primary">{t('saveName')}</Submit>
        </form>
      </details>
      <form action={leave} className="switch-user">
        <button className="btn-ghost btn-sm">{t('switchUser', { name: first })}</button>
      </form>
    </>
  );
}
