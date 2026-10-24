import { redirect } from 'next/navigation';
import { sql, type Session, type Tx } from './db';
import type { Key } from './i18n';

// Helpers for server actions. Kept out of 'use server' files so they aren't exposed as actions.

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
export const int = (f: FormData, k: string) => Math.trunc(Number(f.get(k)) || 0);
/** First and last name from a form; null if either is missing. */
export function personName(f: FormData) {
  const first = str(f, 'firstName').slice(0, 40);
  const last = str(f, 'lastName').slice(0, 40);
  return first && last ? { first, last } : null;
}
/** Lower-cased email, or null if it doesn't look like one. */
export function email(f: FormData) {
  const e = str(f, 'email').toLowerCase().slice(0, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
/** Only allow redirecting back to our own pages. */
export const safePath = (p: string) => (p.startsWith('/') && !p.startsWith('//') ? p : '/');

/** Redirect with a translated message: the page renders `t(key, vars)`. */
export function back(path: string, key: Key, vars?: Record<string, string | number>): never {
  const u = new URL(safePath(path), 'http://x');
  u.searchParams.set('msg', key);
  if (vars) u.searchParams.set('mv', JSON.stringify(vars));
  redirect(u.pathname + u.search);
}

/** Runs `fn` in a transaction holding the session row lock, so capacity checks can't race. */
export async function withLockedSession<T>(sessionId: number, fn: (tx: Tx, s: Session) => Promise<T>) {
  return sql.begin(async (tx) => {
    const [session] = await tx<Session[]>`select * from sessions where id = ${sessionId} for update`;
    if (!session) throw new Error('Session not found');
    return fn(tx, session);
  }) as Promise<T>;
}
