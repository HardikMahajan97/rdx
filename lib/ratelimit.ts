import { headers } from 'next/headers';
import { sql } from './db';

/**
 * Fixed-window counter in Postgres (works on serverless, no Redis needed).
 * Returns whether this hit is within `max` per `windowSec`, and minutes until the window resets.
 */
export async function hit(key: string, max: number, windowSec: number) {
  const [row] = await sql<{ count: number; left: number }[]>`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count, greatest(0, extract(epoch from window_start + make_interval(secs => ${windowSec}) - now()))::int as left`;
  if (Math.random() < 0.02) await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  return { ok: row.count <= max, remaining: Math.max(0, max - row.count), retryMin: Math.max(1, Math.ceil(row.left / 60)) };
}

export async function clear(key: string) {
  await sql`delete from rate_limits where key = ${key}`;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
}
