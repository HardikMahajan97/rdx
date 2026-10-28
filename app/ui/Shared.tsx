import type { Batch, Lang, Player, Session } from '@/lib/db';
import { can } from '@/lib/auth';
import { batchName, isKey, langName, type T } from '@/lib/i18n';
import { timing } from '@/lib/sessions';
import { dateParts, fmtDate, fmtTime, istDate } from '@/lib/time';
import { lock, setLang } from '../actions';
import { Toast } from './Client';

const LANGS: Lang[] = ['en', 'mr', 'hi'];

export function LangSwitch({ lang, path }: { lang: Lang; path: string }) {
  return (
    <div className="langs">
      {LANGS.map((l) => (
        <form key={l} action={setLang}>
          <input type="hidden" name="lang" value={l} />
          <input type="hidden" name="path" value={path} />
          <button className={`btn-sm ${l === lang ? 'on' : 'btn-ghost'}`} aria-pressed={l === lang}>{langName(l)}</button>
        </form>
      ))}
    </div>
  );
}

/** Message passed back by an action as ?msg=<key>&mv=<json vars>. Only known keys render. */
export function Msg({ t, msg, mv }: { t: T; msg?: string; mv?: string }) {
  if (!msg || !isKey(msg)) return null;
  let vars: Record<string, string | number> = {};
  try { vars = mv ? JSON.parse(mv) : {}; } catch {}
  if (typeof vars.role === 'string' && isKey(`role_${vars.role}`)) vars.role = t(`role_${vars.role}` as 'role_core');
  return <Toast key={msg + (mv ?? '')}>{t(msg, vars)}</Toast>;
}

export function StaffNav({ me, t, here }: { me: Player; t: T; here: string }) {
  const links = [
    { href: '/', label: t('navDashboard'), show: true },
    { href: '/roster', label: t('navRoster'), show: can(me.role, 'roster') },
    { href: '/members', label: t('navMembers'), show: can(me.role, 'members') },
    { href: '/players', label: t('navPlayers'), show: can(me.role, 'members') },
    { href: '/admin', label: t('navAdmin'), show: can(me.role, 'staff') },
  ].filter((l) => l.show);
  return (
    <nav className="tabs">
      {links.map((l) => <a key={l.href} href={l.href} className={here === l.href ? 'on' : ''}>{l.label}</a>)}
      <form action={lock}><button className="btn-ghost lock-btn" aria-label={t('lock')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>{t('lock')}</span>
      </button></form>
    </nav>
  );
}

/** Top bar for every signed-in page: nav (staff), language. */
export function Toolbar({ me, t, here, lang }: { me: Player | null; t: T; here: string; lang: Lang }) {
  return (
    <>
      {me && me.role !== 'player' && <StaffNav me={me} t={t} here={here} />}
      <LangSwitch lang={lang} path={here} />
    </>
  );
}

export function Tile({ label, value, of, sub, tone, href }: {
  label: string; value: React.ReactNode; of?: React.ReactNode; sub?: React.ReactNode;
  tone?: 'red' | 'ok' | 'warn' | 'blue'; href?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value">{value}{of !== undefined && <small> / {of}</small>}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
  return href ? <a href={href} className={`tile ${tone ?? ''}`}>{body}</a> : <div className={`tile ${tone ?? ''}`}>{body}</div>;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();

/** Big glass date badge + time slot: what every session card leads with. */
export function SlotHead({ t, lang, batch, session, children }: {
  t: T; lang: Lang; batch: Batch; session: Session; children?: React.ReactNode;
}) {
  const { start, end, phase } = timing(session, batch);
  const { weekday, day, month } = dateParts(session.date, lang);
  const rel = session.date === istDate() ? t('today') : session.date === istDate(1) ? t('tomorrow') : null;
  return (
    <div className="slot-head">
      <div className="date-bubble" aria-label={fmtDate(session.date, lang)}>
        <span className="wd">{weekday}</span>
        <span className="dd">{day}</span>
        <span className="mm">{month}</span>
      </div>
      <div className="slot-info">
        <div className="slot-tags">
          {rel && <span className="chip-rel">{rel}</span>}
          <span className="batch-name">{batchName(t, batch)}</span>
          {phase === 'live' && <span className="pill ok live-dot">{t('live')}</span>}
          {phase === 'locked' && <span className="pill warn">🔒 {t('lockedShort')}</span>}
          {phase === 'cancelled' && <span className="pill bad">{t('cancelled')}</span>}
        </div>
        <div className="slot-time">{fmtTime(start)} <span className="dash">–</span> {fmtTime(end)}</div>
        {session.court_numbers.length > 0 && (
          <div className="slot-courts">{t(session.court_numbers.length === 1 ? 'court' : 'courtsLabel')} {session.court_numbers.join(', ')}</div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A racquet smashing a shuttle, with a bar swinging under it. Pure CSS/SVG, no JS. */
export function Loader({ label }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-label={label ?? 'Loading'}>
      <svg viewBox="0 0 130 92" className="smash" aria-hidden>
        <defs>
          <clipPath id="ld-head"><ellipse cx="45" cy="26" rx="10.5" ry="14.5" /></clipPath>
          <linearGradient id="ld-frame" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6e3" /><stop offset="1" stopColor="#a9a08e" />
          </linearGradient>
        </defs>
        <path className="whoosh" d="M12 50 Q 30 6 74 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <g className="racquet">
          <g clipPath="url(#ld-head)" stroke="rgba(239,230,210,.45)" strokeWidth=".7">
            {[36, 39.5, 43, 46.5, 50, 53.5].map((x) => <line key={x} x1={x} y1="8" x2={x} y2="44" />)}
            {[14, 18, 22, 26, 30, 34, 38].map((y) => <line key={y} x1="30" y1={y} x2="60" y2={y} />)}
          </g>
          <ellipse cx="45" cy="26" rx="12" ry="16" fill="none" stroke="url(#ld-frame)" strokeWidth="3.2" />
          <path d="M39.5 40.5 L45 48 L50.5 40.5" fill="none" stroke="url(#ld-frame)" strokeWidth="2.2" strokeLinejoin="round" />
          <line x1="45" y1="47" x2="45" y2="66" stroke="#d8cfbb" strokeWidth="2.4" strokeLinecap="round" />
          <rect x="41.3" y="65" width="7.4" height="20" rx="3.2" fill="var(--red)" />
          <path d="M41.5 70 l7 -2.4 M41.5 75 l7 -2.4 M41.5 80 l7 -2.4" stroke="rgba(0,0,0,.35)" strokeWidth="1.1" />
        </g>
        <g className="shuttle">
          <path d="M-2.6 -1.5 L-6.5 -15 L6.5 -15 L2.6 -1.5 Z" fill="rgba(239,230,210,.95)" />
          <path d="M-6.5 -15 L6.5 -15 M-4.6 -8.5 L4.6 -8.5 M0 -1.5 L0 -15 M-2.2 -1.5 L-3.6 -15 M2.2 -1.5 L3.6 -15"
            stroke="rgba(15,15,17,.35)" strokeWidth=".7" fill="none" />
          <circle r="3.3" cy="0.4" fill="var(--red)" />
        </g>
        <circle className="burst" cx="52" cy="22" r="9" fill="none" stroke="var(--red)" strokeWidth="2" />
      </svg>
      <div className="loader-track"><span /></div>
      {label && <div className="loader-label">{label}</div>}
    </div>
  );
}

/** A short rally: the shuttle arcs over the net and each racquet swings as it arrives. Decorative. */
export function Rally() {
  const racquet = (
    <svg viewBox="0 0 20 40" aria-hidden>
      <ellipse cx="10" cy="10" rx="7" ry="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5 10h10M10 2v16M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth=".6" opacity=".55" />
      <path d="M10 19v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="8" y="29" width="4" height="10" rx="2" fill="var(--red)" />
    </svg>
  );
  return (
    <span className="rally" aria-hidden>
      <span className="rq left">{racquet}</span>
      <span className="net" />
      <span className="rx"><span className="ry"><span className="rr">
        <svg viewBox="0 0 24 14">
          <path d="M5 2 L21 0.5 L21 13.5 L5 12 Z" fill="var(--text)" opacity=".92" />
          <path d="M9 2.3v9.4M13 1.9v10.2M17 1.4v11.2" stroke="var(--ink)" strokeWidth=".6" opacity=".35" />
          <circle cx="4.5" cy="7" r="4" fill="var(--yellow)" />
        </svg>
      </span></span></span>
      <span className="rq right">{racquet}</span>
    </span>
  );
}

export function Skeleton({ tiles = 4, blocks = 2 }: { tiles?: number; blocks?: number }) {
  return (
    <div aria-busy="true">
      <Loader />
      <div className="tiles">{Array.from({ length: tiles }, (_, i) => <div key={i} className="skel" style={{ height: 92 }} />)}</div>
      <div className="cols">{Array.from({ length: blocks }, (_, i) => <div key={i} className="skel" style={{ height: 260 }} />)}</div>
    </div>
  );
}
