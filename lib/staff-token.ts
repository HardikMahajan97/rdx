import crypto from 'node:crypto';

// Pure helpers shared by lib/auth.ts and proxy.ts (no DB, no next/headers).

export const STAFF_COOKIE = 'staff';
/** Staff are asked for their PIN again after this much inactivity. */
export const STAFF_IDLE_MS = 20 * 60_000;

export function hmac(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * `id.issuedAt.pinVersion.sig`. pinVersion is a fingerprint of the stored PIN hash,
 * so resetting or changing a PIN invalidates every open staff session.
 */
export function makeStaffToken(id: number, pinVersion: string, at = Date.now()): string {
  return `${id}.${at}.${pinVersion}.${hmac(`staff:${id}:${at}:${pinVersion}`)}`;
}

export function readStaffToken(token: string | undefined) {
  const [id, at, pv, sig] = token?.split('.') ?? [];
  if (!id || !at || !pv || !sig) return null;
  const expected = hmac(`staff:${id}:${at}:${pv}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() - Number(at) > STAFF_IDLE_MS) return null;
  return { id: Number(id), pinVersion: pv };
}

export const pinVersion = (pinHash: string) => hmac(`pv:${pinHash}`).slice(0, 12);

export const staffCookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  // No maxAge: a session cookie, and the server also enforces STAFF_IDLE_MS.
};
