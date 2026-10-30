import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { GENDERS, SKILL_LEVELS } from '@/lib/db';
import { getLang, viewer } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { register } from '../actions';
import { Submit } from '../ui/Client';
import { Msg, Skeleton, Toolbar } from '../ui/Shared';

// Registration has its own page, apart from Log in (the owner asked for them to be separate):
// the promo site's Register buttons come here, and nothing on this page offers signing in.

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };

/** After these the request is with the team, so the form is replaced by the message. */
const DONE = ['signupSent', 'signupPending'];

export default function Register(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={0} blocks={1} />}>
      <RegisterContent {...props} />
    </Suspense>
  );
}

async function RegisterContent({ searchParams }: Props) {
  const { msg, mv } = await searchParams;
  const { player } = await viewer();
  if (player) redirect('/'); // signed in, or half-way through signing in
  const lang = await getLang();
  const t = translator(lang);
  let vars: Record<string, string | number> = {};
  try { vars = mv ? JSON.parse(mv) : {}; } catch {}

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <Toolbar me={null} t={t} here="/register" lang={lang} />
      {!DONE.includes(msg ?? '') && <Msg t={t} msg={msg} mv={mv} />}
      <div className="welcome">
        <h1>{t('registerTitle')}</h1>
        <p className="muted">{t('registerSub')}</p>
      </div>

      {DONE.includes(msg ?? '') ? (
        <section className="card stack">
          <p className="status ok" role="status">{t(msg === 'signupSent' ? 'signupSent' : 'signupPending', vars)}</p>
          {/* Plain link on purpose: `/?home` is answered by the proxy with the promo pages, not by the app router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-ghost" href="/?home">{t('backHome')}</a>
        </section>
      ) : (
        <form action={register} className="card stack">
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
          <p className="muted consent">
            {t('registerConsent')} <a href="/terms">{t('termsLink')}</a> · <a href="/privacy">{t('privacyLink')}</a>
          </p>
          <Submit className="btn-big">{t('register')}</Submit>
        </form>
      )}
    </div>
  );
}
