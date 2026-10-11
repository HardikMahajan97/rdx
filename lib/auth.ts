import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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

export type Permission = 'roster' | 'members' | 'staff' | 'batches' | 'cancel';

const PERMISSIONS: Record<Role, Permission[]> = {
  player: [],
  core: ['roster', 'members'],
  admin: ['roster', 'members', 'staff', 'batches', 'cancel'],
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

export async function currentPlayer(): Promise<Player | null> {
  const value = (await cookies()).get(PLAYER_COOKIE)?.value;
  const [id, sig] = value?.split('.') ?? [];
  if (!id || sig !== hmac(`pid:${id}`)) return null;
  const [player] = await sql<Player[]>`select * from players where id = ${Number(id)}`;
  return player ?? null;
}

/** Staff must have entered their PIN recently in this browser session. */
export async function staffUnlocked(player: Player): Promise<boolean> {
  if (!isStaff(player.role) || !player.pin_hash) return false;
  const token = readStaffToken((await cookies()).get(STAFF_COOKIE)?.value);
  return token?.id === player.id && token.pinVersion === pinVersion(player.pin_hash);
}

/** Who is looking at the page, and whether a staff member still has to set or enter a PIN. */
export async function viewer() {
  const player = await currentPlayer();
  if (!player) return { player: null, gate: null } as const;
  if (!isStaff(player.role)) return { player, gate: null } as const;
  if (!player.pin_hash) return { player, gate: 'set' } as const;
  return { player, gate: (await staffUnlocked(player)) ? null : 'enter' } as const;
}

export async function signIn(playerId: number) {
  (await cookies()).set(PLAYER_COOKIE, `${playerId}.${hmac(`pid:${playerId}`)}`, playerCookieOptions);
}

export async function unlockStaff(player: Player & { pin_hash: string }) {
  (await cookies()).set(STAFF_COOKIE, makeStaffToken(player.id, pinVersion(player.pin_hash)), staffCookieOptions);
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(PLAYER_COOKIE);
  jar.delete(STAFF_COOKIE);
}

export async function lockStaff() {
  (await cookies()).delete(STAFF_COOKIE);
}

/** For player actions: signed in, and staff accounts must be unlocked too. */
export async function requirePlayer(): Promise<Player> {
  const { player, gate } = await viewer();
  if (!player || gate) redirect('/');
  return player;
}

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
