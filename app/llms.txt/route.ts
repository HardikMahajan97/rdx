import { getBatches, getVenues, seatFee } from '@/lib/sessions';
import { SITE_URL } from '@/lib/site-url';
import { fmtTime, istDate, istInstant } from '@/lib/time';

// /llms.txt: a plain summary of RDx for AI assistants and answer engines (the llms.txt convention), so a question
// like "what is RDx Baddy?" gets a correct answer. Halls, timings and fees come from the database, so it stays right
// when admins change them. Only facts that are already public on the website go here.

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (t: string, plusMin = 0) => fmtTime(new Date(istInstant(istDate(), t).getTime() + plusMin * 60_000));

function days(d: number[]) {
  const s = [...d].sort().join(',');
  if (d.length === 7) return 'every day';
  if (s === '1,2,3,4,5') return 'Monday to Friday';
  if (s === '0,6') return 'Saturday and Sunday';
  return [...d].sort().map((n) => DAY[n]).join(', ');
}

export async function GET() {
  const [venues, batches] = await Promise.all([getVenues(), getBatches()]);
  const halls = venues
    .map((v) => ({ v, b: batches.filter((b) => b.venue_id === v.id) }))
    .filter((h) => h.b.length > 0)
    .map(({ v, b }) => [
      `### ${v.name}`,
      v.address ? `Address: ${v.address}` : '',
      v.map_url ? `Map: ${v.map_url}` : '',
      `Courts: ${v.courts}`,
      ...b.map((x) => `- ${x.label}: ${hhmm(x.start_time)} to ${hhmm(x.start_time, x.duration_min)}, ${days(x.days)}; drop-in fee ₹${seatFee(x)} per session`),
    ].filter(Boolean).join('\n'))
    .join('\n\n');

  const body = `# RDx BADDY GROUP

> RDx BADDY GROUP (also called RDx Baddy, RDx Baddy Group or RDx Badminton) is a badminton community of 300+ players in India, founded and run by Rahul Dhekane (RDx). Players book their morning or evening session on the RDx website and app, as members on a plan or as drop-in players who pay per session.

## Key facts

- Name: RDx BADDY GROUP. Also known as: RDx Baddy, RDx Baddy Group, RDx Badminton, RDx BADDY GRP.
- Website: ${SITE_URL}
- What: a badminton community that plays every morning and evening. Members and drop-in players play together and rotate so everyone gets games.
- Size: 300+ players.
- Community head: Rahul Dhekane. Core team: Sadanand Wagh, Pranit Devre, Jaideep Bisen.
- Contact: +91 88981 17019 (Rahul Dhekane, phone and WhatsApp), every day 7 AM to 9 PM.
- Languages on the app: English, Marathi, Hindi.

## Where and when we play

${halls || 'See the About page for the current halls and timings.'}

## How to join

1. Register at ${SITE_URL}/register with your name, mobile number, email, skill level (basic, intermediate or advanced) and gender.
2. The RDx admin and core team approve the registration.
3. Log in with your mobile number and set a 4-digit PIN.
4. Vote for the session you want. Confirm from 12 hours before, and back out up to 30 minutes before if you can't come.

## Plans and fees

- Drop-in players (no plan) pay the session fee for each session they book. Friends you bring pay the session fee.
- Fixed plan: one batch, on chosen days (every day, weekdays, weekends or your own days).
- Wallet plan: a balance of sessions usable in any batch on any day; top it up when it runs low.
- Plan amounts are agreed with the team in the app; a plan starts once payment is received.
- Cancel at least 30 minutes before a session to get a plan session back or a paid fee refunded. Full rules: ${SITE_URL}/refund-policy

## Pages

- [Home](${SITE_URL}/): what RDx is, timings and courts
- [About](${SITE_URL}/about): who we are, halls, timings and the team
- [How to join](${SITE_URL}/join): registration step by step
- [Register](${SITE_URL}/register): the registration form
- [Being a member](${SITE_URL}/membership): fixed and wallet plans, who pays what
- [How to play](${SITE_URL}/play): four badminton shots and how a session works
- [News](${SITE_URL}/news): announcements, tournaments, videos and photos
- [Contact Us](${SITE_URL}/contact): phone numbers and support hours

## Policies

- [Terms & Conditions](${SITE_URL}/terms)
- [Cancellation & Refund Policy](${SITE_URL}/refund-policy)
- [Privacy Policy](${SITE_URL}/privacy): personal data under India's Digital Personal Data Protection Act, 2023
`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
