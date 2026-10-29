import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { sql, type Lang, type Player, type Role } from './db';
import { hmac, makeStaffToken, pinVersion, readStaffToken, STAFF_COOKIE, staffCookieOptions } from './staff-token';

const PLAYER_COOKIE = 'pid';
const LANG_COOKIE = 'lang';
// Browsers cap cookie lifetime at 400 days; signing in again rolls it over.
const YEAR = 60 * 60 * 24 * 400;
const playerCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: YEAR,
  path: '/',
};

// ---------- Roles ----------

export type Permission = 'roster' | 'members' | 'pins' | 'staff' | 'batches' | 'cancel';

const PERMISSIONS: Record<Role, Permission[]> = {
  player: [],
  core: ['roster', 'members', 'pins'],
  admin: ['roster', 'members', 'pins', 'staff', 'batches', 'cancel'],
};

export const can = (role: Role, perm: Permission) => PERMISSIONS[role].includes(perm);
export const isStaff = (role: Role) => role !== 'player';

// ---------- Phone & PIN ----------

/** Accepts '+91 98xxx', '098xxx' etc; returns the 10-digit number or null. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Returns an i18n error key, or null if the PIN is acceptable. */
export function pinProblem(pin: string): 'errPinFormat' | 'errPinWeak' | null {
  if (!/^\d{4}$/.test(pin)) return 'errPinFormat';
  const d = [...pin].map(Number);
  const allSame = d.every((x) => x === d[0]);
  const ascending = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const descending = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  const repeatedPair = pin.slice(0, 2) === pin.slice(2);
  return allSame || ascending || descending || repeatedPair ? 'errPinWeak' : null;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ---------- Sessions ----------
// Everyone signs in with phone + PIN. Players then stay signed in on that phone (400-day cookie);
// core/admin also need a short-lived staff unlock, so they enter the PIN every time they come back.
// Both cookies carry a fingerprint of the PIN hash: resetting a PIN signs that person out everywhere.

const CLAIM_COOKIE = 'claim';
/** Between "entered phone" and "entered PIN". */
const CLAIM_MS = 15 * 60_000;
const claimCookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: CLAIM_MS / 1000 };

const pidValue = (id: number, pinHash: string) => {
  const pv = pinVersion(pinHash);
  return `${id}.${pv}.${hmac(`pid:${id}:${pv}`)}`;
};

/** Deactivated or deleted accounts don't count as signed in anywhere, so switching one off signs them out at once. */
async function playerById(id: number) {
  const [player] = await sql<Player[]>`select * from players where id = ${id} and deactivated_at is null and deleted_at is null`;
  return player ?? null;
}

/** Signed in on this device (has entered their PIN here at least once since it was last reset). */
export async function currentPlayer(): Promise<Player | null> {
  const [id, pv, sig] = (await cookies()).get(PLAYER_COOKIE)?.value.split('.') ?? [];
  if (!id || !pv || sig !== hmac(`pid:${id}:${pv}`)) return null;
  const player = await playerById(Number(id));
  return player?.pin_hash && pinVersion(player.pin_hash) === pv ? player : null;
}

/** Typed a phone number but hasn't entered (or set) the PIN yet. */
export async function claimedPlayer(): Promise<Player | null> {
  const [id, at, sig] = (await cookies()).get(CLAIM_COOKIE)?.value.split('.') ?? [];
  await connection(); // the expiry check reads the clock, so this is per-request
  if (!id || !at || sig !== hmac(`claim:${id}:${at}`) || Date.now() - Number(at) > CLAIM_MS) return null;
  return playerById(Number(id));
}

/** Staff must have entered their PIN recently in this browser session. */
export async function staffUnlocked(player: Player): Promise<boolean> {
  if (!isStaff(player.role) || !player.pin_hash) return false;
  const token = readStaffToken((await cookies()).get(STAFF_COOKIE)?.value);
  return token?.id === player.id && token.pinVersion === pinVersion(player.pin_hash);
}

/**
 * Who is looking at the page, and what PIN step they still have:
 * 'set' (new account or PIN was reset), 'enter' (signing in, or staff coming back), or null.
 */
export async function viewer() {
  const player = await currentPlayer();
  if (player) {
    if (isStaff(player.role) && !(await staffUnlocked(player))) return { player, gate: 'enter' } as const;
    return { player, gate: null } as const;
  }
  const claimed = await claimedPlayer();
  if (claimed) return { player: claimed, gate: claimed.pin_hash ? 'enter' : 'set' } as const;
  return { player: null, gate: null } as const;
}

/** Step 1: phone number entered. The PIN screen comes next. */
export async function claim(playerId: number) {
  const at = Date.now();
  (await cookies()).set(CLAIM_COOKIE, `${playerId}.${at}.${hmac(`claim:${playerId}:${at}`)}`, claimCookieOptions);
}

/** Step 2: PIN set or entered. Players stay signed in; staff are also unlocked for this visit. */
export async function signIn(player: Player & { pin_hash: string }) {
  const jar = await cookies();
  jar.set(PLAYER_COOKIE, pidValue(player.id, player.pin_hash), playerCookieOptions);
  jar.delete(CLAIM_COOKIE);
  if (isStaff(player.role)) jar.set(STAFF_COOKIE, makeStaffToken(player.id, pinVersion(player.pin_hash)), staffCookieOptions);
}

/** For player actions: signed in, and staff accounts must be unlocked too. */
export async function requirePlayer(): Promise<Player> {
  const { player, gate } = await viewer();
  if (!player || gate) redirect('/');
  return player;
}

/** Core can reset players' PINs; admins can also reset core and other admins. Nobody resets their own. */
export const canResetPin = (by: Player, target: Pick<Player, 'id' | 'role'>) =>
  by.id !== target.id && can(by.role, 'pins') && (target.role === 'player' || by.role === 'admin');

/** For staff pages and actions. */
export async function requireStaff(perm: Permission): Promise<Player> {
  const { player, gate } = await viewer();
  if (!player || gate || !can(player.role, perm)) redirect('/');
  return player;
}

// ---------- Language ----------

export const LANGS: Lang[] = ['en', 'mr', 'hi'];

export async function getLang(player?: Player | null): Promise<Lang> {
  if (player) return player.lang;
  const c = (await cookies()).get(LANG_COOKIE)?.value as Lang | undefined;
  return c && LANGS.includes(c) ? c : 'en';
}

export async function setLangCookie(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang, { ...playerCookieOptions, httpOnly: false });
}
