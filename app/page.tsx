import { Suspense } from 'react';
import { sql, type Membership } from '@/lib/db';
import { getLang, isStaff, viewer } from '@/lib/auth';
import { batchName, translator } from '@/lib/i18n';
import { planLive } from '@/lib/members';
import { upcomingSessions } from '@/lib/sessions';
import { applyMembership, enterPin, join, leave, setPin } from './actions';
import { Submit } from './ui/Client';
import { Msg, Skeleton, Toolbar } from './ui/Shared';
import { FloaterSessions, MemberHome, StaffDashboard } from './ui/Views';

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };

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
        <h1>{t('welcome')}</h1>
        <p className="muted">{t('welcomeHint')}</p>
        <form action={join} className="card stack">
          <label>
            {t('phone')}
            <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98xxxxxxxx" required />
          </label>
          <label>
            {t('name')} <span>{t('nameHint')}</span>
            <input name="name" autoComplete="name" maxLength={60} />
          </label>
          <Submit className="btn-big">{t('continue')}</Submit>
        </form>
      </div>
    );
  }

  if (gate) {
    return (
      <div style={narrow}>
        {top}
        <h1>{gate === 'set' ? t('pinSetTitle') : t('pinEnterTitle')}</h1>
        <p className="muted">{gate === 'set' ? t('pinSetHint', { role: t(`role_${me.role}`) }) : t('pinEnterHint')}</p>
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
          <Submit className="btn-big">{gate === 'set' ? t('pinSave') : t('unlock')}</Submit>
        </form>
        <form action={leave}><button className="btn-ghost btn-sm">{t('switchUser', { name: me.name.split(' ')[0] })}</button></form>
      </div>
    );
  }

  const upcoming = await upcomingSessions();

  // Admin and core members run the sessions; they get the dashboard, not booking.
  if (isStaff(me.role)) {
    return <>{top}<StaffDashboard me={me} t={t} lang={lang} upcoming={upcoming} /></>;
  }

  const [plan] = await sql<Membership[]>`select * from memberships where player_id = ${me.id} and status = 'active'`;
  const switchUser = (
    <form action={leave} style={{ marginTop: 24 }}>
      <button className="btn-ghost btn-sm">{t('switchUser', { name: me.name.split(' ')[0] })}</button>
    </form>
  );

  if (plan && planLive(plan)) {
    return <>{top}<MemberHome me={me} t={t} lang={lang} plan={plan} upcoming={upcoming} />{switchUser}</>;
  }

  const [pending] = await sql<{ id: number }[]>`
    select id from membership_requests where player_id = ${me.id} and status = 'pending'`;
  return (
    <>
      {top}
      <div className="toolbar">
        <h1>{t('hi', { name: me.name.split(' ')[0] })}</h1>
        <span className="pill">{t('floater')}</span>
      </div>
      <FloaterSessions me={me} t={t} lang={lang} upcoming={upcoming} />
      {pending ? <div className="status warn">{t('applyPending')}</div> : (
        <details className="card" style={{ maxWidth: 640 }}>
          <summary>{t('applyTitle')}</summary>
          <p className="muted">{t('applyHint')}</p>
          <form action={applyMembership} className="stack">
            <label>
              {t('batch')}
              <select name="batchId">
                {upcoming.map(({ batch }) => <option key={batch.id} value={batch.id}>{batchName(t, batch)}</option>)}
              </select>
            </label>
            <label>
              {t('plan')}
              <select name="plan">
                {(['month', 'weekdays', 'weekends', 'other'] as const).map((p) => <option key={p} value={p}>{t(`plan_${p}`)}</option>)}
              </select>
            </label>
            <label>{t('note')}<input name="note" maxLength={200} /></label>
            <Submit className="btn-primary">{t('applySubmit')}</Submit>
          </form>
        </details>
      )}
      {switchUser}
    </>
  );
}
