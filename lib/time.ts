import type { Lang } from './db';

const TZ = 'Asia/Kolkata';
const LOCALE: Record<Lang, string> = { en: 'en-IN', mr: 'mr-IN-u-nu-latn', hi: 'hi-IN-u-nu-latn' };

/** IST calendar date as YYYY-MM-DD, `offsetDays` from today. IST has no DST. */
export function istDate(offsetDays = 0, from = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(from + offsetDays * 86_400_000));
}

/** Instant of an IST wall-clock time ('HH:MM[:SS]') on an IST date. */
export function istInstant(date: string, time: string): Date {
  return new Date(`${date}T${time.slice(0, 5)}:00+05:30`);
}

/** Day of week (0 = Sun) of a YYYY-MM-DD calendar date. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** '7:00 AM' in every language, so AM/PM is never ambiguous. */
export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
}

/** 'Mon 13 Oct' style label for a YYYY-MM-DD date. */
export function fmtDate(date: string, lang: Lang = 'en'): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  });
}

/** Pieces for the big date badge: localized weekday and month, numeric day. */
export function dateParts(date: string, lang: Lang = 'en') {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(LOCALE[lang], { timeZone: 'UTC', ...o });
  return { weekday: f({ weekday: 'short' }), day: d.getUTCDate(), month: f({ month: 'short' }) };
}
