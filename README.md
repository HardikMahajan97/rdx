# Badminton Community – slot booking

One pinned link in the WhatsApp group replaces the daily poll. The site is available in English, मराठी and हिंदी, and each person's choice is saved with their account.

## Who does what

| Role | How they get it | Sign-in | Can |
|---|---|---|---|
| Floater | Self sign-up: phone + name | Remembered on the device | Votes for any slot ("Just me" / "Me + friends") and pays the daily fee. Sees counts only. |
| Member | Applies in the app; core/admin quotes the amount, collects it offline and activates the plan | Same as floater | Votes like everyone else, using plan sessions. Sees who's coming. |
| Core member | Admin enters their phone number | Phone + own 4-digit PIN | Roster (dues, refunds, ±court, share), quote and activate plans, wallet top-ups |
| Admin (RDX) | Admin enters their phone number (first one comes from `.env`) | Phone + own 4-digit PIN | Everything above, plus staff management, batch settings and cancelling sessions |

Staff set their PIN the first time they sign in. The app locks again after 20 minutes idle or when the browser closes. Wrong PINs are limited to 5 tries per account and 30 per IP every 15 minutes. PINs are stored as salted scrypt hashes.

## A slot, start to finish

Everyone votes, members included. Nobody is in by default.

1. **Vote:** any time before the start, if there's room.
2. **Confirm "I'm coming":** opens 12 hours before the start.
3. **Back out:** allowed until 30 minutes before the start. The button reads "I'm a member but I can't come", "I've paid but I can't come" or "Can't make it". After that the slot is final: plan sessions are charged and daily fees are owed. Joining in the last 30 minutes is final straight away.
4. **"I came & played":** the player confirms this themselves, from the start until 12 hours after the end. Anyone who doesn't becomes a no-show (the slot stays charged).

Staff no longer tick attendance. On the roster they see each player's status (voted / confirmed / played / no-show / withdrew), collect daily fees, and refund people who paid and then backed out in time.

## Plans

- **Fixed plan:** one batch and its days (all / weekdays / weekends / custom), a number of sessions, a start date and an optional expiry date. The member can only vote for their own batch on their own days.
- **Wallet:** a balance of sessions for any batch on any day. The player asks for N sessions; staff quote the amount, collect it and activate (or top up an existing wallet).
- A request goes **pending → quoted** (the player sees "pay ₹X") **→ activated**.
- One plan session is taken 30 minutes before the start, for each slot the member voted for and didn't back out of. Cancelling a session gives the sessions back.
- Every balance change (activate, top-up, use, refund, staff edit) is written to `plan_ledger`, which is shown per member as the balance history.
- Friends always pay the daily fee.

## Run locally

```bash
cp .env.example .env.local   # set SESSION_SECRET, ADMIN_PHONE, CORE_PHONE
createdb badminton
npm install
npm run db:setup             # tables (also upgrades an older DB in place), Morning (2 courts) + Evening (3 courts), first admin + core
npm run dev
```

## Deploy (free tier)

Vercel for the app plus Neon or Supabase for Postgres. Set the env vars in Vercel and run `npm run db:setup` once against the production `DATABASE_URL`. Vercel serves HTTPS only, and the app sends HSTS, so traffic is always encrypted.
