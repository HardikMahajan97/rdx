import { NextResponse } from 'next/server';
import { getBatches, getVenues } from '@/lib/sessions';
import { fmtTime, istDate, istInstant } from '@/lib/time';

// Public: the halls and their batches (times, courts, days) for the promo site, which is static and can't read the
// database itself. Admins change halls and batches on the Admin page; the promo site picks it up within a minute.

const hhmm = (t: string, plusMin = 0) => fmtTime(new Date(istInstant(istDate(), t).getTime() + plusMin * 60_000));

export async function GET() {
  const [venues, batches] = await Promise.all([getVenues(), getBatches()]);
  const body = venues.map((v) => ({
    name: v.name,
    address: v.address,
    mapUrl: v.map_url,
    courts: v.courts,
    batches: batches.filter((b) => b.venue_id === v.id).map((b) => ({
      name: b.label,
      start: hhmm(b.start_time),
      end: hhmm(b.start_time, b.duration_min),
      courts: b.court_numbers,
      days: b.days,
    })),
  })).filter((v) => v.batches.length > 0);
  return NextResponse.json({ venues: body }, {
    headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600' },
  });
}
