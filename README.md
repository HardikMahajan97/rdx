# Badminton Community – slot booking

One pinned link in the WhatsApp group replaces the daily poll. The site is available in English, मराठी and हिंदी, and each person's choice is saved with their account.

## Who does what

| Role | How they get it | Sign-in | Can |
|---|---|---|---|
| Floater | Self sign-up: phone + name | Remembered on the device | Book "Just me" or "Me + friends" and pay the daily fee at court. Sees counts only. |
| Member | Applies in the app; core/admin activates the plan after collecting payment offline | Same as floater | Is IN by default on plan days and taps "Can't make it" if not coming. Sees who's coming. |
| Core member | Admin enters their phone number | Phone + own 4-digit PIN | Roster (tick arrivals, collect dues, ±court), approve and edit memberships |
| Admin (RDX) | Admin enters their phone number (first one comes from `.env`) | Phone + own 4-digit PIN | Everything above, plus staff management, batch settings and cancelling sessions |

Staff set their PIN the first time they sign in. The app locks again after 20 minutes idle or when the browser closes. Wrong PINs are limited to 5 tries per account and 30 per IP every 15 minutes. PINs are stored as salted scrypt hashes.

## What each person sees

- **Admin / core (dashboard):** live tiles (coming, requests, active members, plans running low, money to collect), then one panel per batch with:
  - a court board showing who is on which court
  - who's coming and who isn't
  - an attendance chart of recent sessions (showed up vs no-show)

  Staff never see a booking form. The dashboard refreshes every 30 s.
- **Roster (core):** tiles, a tap-to-tick list with in-place updates, the court board, ±court, and Share on WhatsApp.
- **Member:** plan tiles (sessions left, used, days, valid till) and their batch's court board with names. They're in by default, so there's no voting, just "Can't make it".
- **Floater:** both batches with an anonymous court board (filled seats, no names), "Just me / Me + friends" with a counter, and a live total.

Desktop uses the full width (side-by-side panels); phones get a single column.

## Plans

- A plan is a batch, its days (all / weekdays / weekends / custom), a number of sessions, a start date and an optional expiry date. Quick options: 15, 22, or "Whole month", which counts the matching days.
- A session is used only when a core member ticks the player present. Unticking gives it back. A no-show doesn't use a session.
- If a member plays outside their plan (e.g. a weekday member on Saturday, or the other batch), they book like a floater. The roster shows "not covered today" with the daily fee, and the visit is recorded as "paid daily".
- Friends always pay the daily fee.

## Run locally

```bash
cp .env.example .env.local   # set SESSION_SECRET, ADMIN_PHONE, CORE_PHONE
createdb badminton
npm install
npm run db:setup             # tables, Morning (2 courts) + Evening (3 courts), first admin + core
npm run dev
```

## Deploy (free tier)

Vercel for the app plus Neon or Supabase for Postgres. Set the env vars in Vercel and run `npm run db:setup` once against the production `DATABASE_URL`. Vercel serves HTTPS only, and the app sends HSTS, so traffic is always encrypted.
