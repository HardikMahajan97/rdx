import type { Lang, Player } from '@/lib/db';
import { can } from '@/lib/auth';
import { isKey, langName, type T } from '@/lib/i18n';
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
    { href: '/admin', label: t('navAdmin'), show: can(me.role, 'staff') },
  ].filter((l) => l.show);
  return (
    <nav className="tabs">
      {links.map((l) => <a key={l.href} href={l.href} className={here === l.href ? 'on' : ''}>{l.label}</a>)}
      <form action={lock}><button className="btn-ghost">🔒 {t('lock')}</button></form>
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
  label: string; value: React.ReactNode; of?: React.ReactNode; sub?: React.ReactNode; tone?: 'red' | 'ok' | 'warn'; href?: string;
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

export function Skeleton({ tiles = 4, blocks = 2 }: { tiles?: number; blocks?: number }) {
  return (
    <div aria-busy="true">
      <div className="tiles">{Array.from({ length: tiles }, (_, i) => <div key={i} className="skel" style={{ height: 92 }} />)}</div>
      <div className="cols">{Array.from({ length: blocks }, (_, i) => <div key={i} className="skel" style={{ height: 260 }} />)}</div>
    </div>
  );
}
