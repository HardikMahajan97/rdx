# Badminton Community – slot booking

One pinned link in the WhatsApp group replaces the daily poll. Players vote for the morning or evening slot, members use their plan sessions, and core members see who's coming and who still has to pay. The site works in English, मराठी and हिंदी.

**Contents**

1. [Run it on your computer](#run-it-on-your-computer) (step by step, no coding needed)
2. [Copy the live data to your computer](#copy-the-live-data-to-your-computer)
3. [Set up the online database (Neon)](#set-up-the-online-database-neon)
4. [Put the site online (Vercel)](#put-the-site-online-vercel)
5. [Commands](#commands)
6. [Troubleshooting](#troubleshooting)
7. [How the app works](#how-the-app-works)

---

## Run it on your computer

This takes about 10 minutes the first time, mostly waiting for downloads. A setup script installs everything the app needs.

### 1. What you need

- A **Mac**, a **Linux** computer (Ubuntu or Debian), or **Windows 10/11** (through WSL, see below).
- An internet connection and about 2 GB of free space.
- Access to the code on GitHub. If the repository is private, ask the owner to add your GitHub account to it.

### 2. Open a terminal

The terminal is the window where you type the commands below. Copy each command, paste it, and press **Enter**.

- **Mac:** press `⌘ Cmd` + `Space`, type **Terminal**, press Enter.
- **Ubuntu:** press `Ctrl` + `Alt` + `T`.
- **Windows:** the app runs inside WSL, a small Linux that Windows can run.
  1. Click Start, type **PowerShell**, right-click it and choose **Run as administrator**.
  2. Run `wsl --install`, wait for it to finish, then restart the computer.
  3. Open **Ubuntu** from the Start menu. The first time, it asks you to choose a username and password; remember the password, the setup asks for it.
  4. Use this Ubuntu window for every command below.

### 3. Download the code

Check that `git` is installed:

```bash
git --version
```

- On a Mac, if a window offers to install the "command line developer tools", click **Install**, wait, then run the command again.
- On Ubuntu/WSL, if it says `command not found`, run `sudo apt update && sudo apt install -y git`.

Then download the project and go into its folder:

```bash
git clone https://github.com/HardikMahajan97/rdx.git badminton-community
cd badminton-community
```

If the repository is private, GitHub asks you to sign in. It wants a **personal access token**, not your password. The easiest way is the GitHub app for the terminal: install it (`brew install gh` on a Mac, `sudo apt install -y gh` on Ubuntu), run `gh auth login`, follow the prompts, then run the `git clone` command again.

### 4. Run the setup script

```bash
bash scripts/setup-local.sh
```

It checks each item and only installs what is missing:

| Step | What happens |
|---|---|
| Node.js | The engine that runs the app. Installed with Homebrew (Mac) or the official Node.js package (Ubuntu). |
| PostgreSQL | The database. Installed and started in the background. |
| `.env.local` | Your private settings file, created from `.env.example` with a fresh random secret. You're asked for the **admin's phone number and name**. |
| Database | Creates the `badminton` database. |
| Packages | Downloads the app's code libraries (`npm install`). |
| Tables | Creates the tables, the Morning (7 AM, 2 courts) and Evening (7 PM, 3 courts) batches, and the admin and core accounts. |

Along the way it may ask for your **computer password** (to install software), or, on a Mac without Homebrew, ask to install Homebrew first. Answer `y` and press Enter. When you type a password, nothing appears on screen; that's normal.

At the end it asks **"Start the app now?"**. Press Enter.

You can run the script again at any time. It skips everything that's already done, so it's also the fix for most problems.

### 5. Open the app and sign in

1. Open **http://localhost:3000** in your browser.
2. Enter the admin phone number you gave the setup script.
3. Choose a 4-digit PIN. Admins enter it each time they open the app.
4. To add players, go to **Members → Add a player**: phone number and name. They then sign in with that number and choose their own PIN.

To test as a player on the same computer, use a private/incognito window: each window can be signed in as a different person.

### Every day after that

```bash
cd badminton-community
npm run local
```

This starts the database if needed, then the app. Open http://localhost:3000. Keep the terminal window open while you use the app; press `Ctrl` + `C` in it to stop.

### Getting the latest code

```bash
cd badminton-community
git pull
bash scripts/setup-local.sh
```

The setup script installs any new packages and upgrades the database tables to match the new code. Your data is kept.

---

## Copy the live data to your computer

To test with the real players and plans, copy the online (Neon) database into your local one:

```bash
npm run db:pull
```

- It **only reads** from Neon; the live site isn't touched.
- It shows how many players, plans and bookings each side has and asks before replacing your local data.
- Your local data is backed up first to `backups/local-<date>.sql`, and the Neon copy is saved as `backups/neon-<date>.sql`. If loading fails, your old local data is put back automatically.
- It needs the Neon connection string. It's taken from `DATABASE_URL` in `.env.production`, or `NEON_DATABASE_URL` if set; otherwise the script asks you to paste it.
- If your PostgreSQL tools are older than Neon's, it offers to install the newer ones. Your local database keeps running as it is.

After the copy, everyone's PIN works locally too. Sign in again, since local and live sign-ins are separate.

The `backups/` folder holds real phone numbers. It is never committed to git; delete old files there when you don't need them.

---

## Set up the online database (Neon)

Neon hosts the database for the live site. The free plan is enough.

1. Sign up at **https://neon.tech** and create a project. Pick the region **Asia Pacific (Singapore)**, closest to India.
2. On the project dashboard click **Connect**. Turn on **Connection pooling** and copy the connection string. It looks like:
   `postgresql://neondb_owner:…@ep-something-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. In the project folder, create a file named `.env.production` (copy `.env.example` and edit it):

   ```bash
   DATABASE_URL=<the Neon connection string>
   # A different long random string from the local one. Make one with:
   #   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   SESSION_SECRET=<random string>
   COMMUNITY_NAME=Badminton Community
   ADMIN_PHONE=<real admin number>
   ADMIN_NAME=<admin name>
   CORE_PHONE=<core member number, or leave empty>
   CORE_NAME=<core member name>
   ```

4. Create the tables on Neon, then check them:

   ```bash
   npm run db:setup:prod
   npm run db:check:prod
   ```

   `db:check:prod` only reads. It should end with **✓ Ready**. Run `db:setup:prod` again after pulling code that changes the database; it only adds what is missing and never deletes data.

Keep `.env.production` private. It holds the database password, and git ignores it.

---

## Put the site online (Vercel)

1. Sign in at **https://vercel.com** with GitHub and click **Add New → Project**. Pick this repository.
2. Under **Environment Variables**, add each line from `.env.production` (`DATABASE_URL`, `SESSION_SECRET`, `COMMUNITY_NAME`, `ADMIN_PHONE`, `ADMIN_NAME`, `CORE_PHONE`, `CORE_NAME`).
3. Click **Deploy**. Vercel gives you a link like `https://your-project.vercel.app`. Pin it in the WhatsApp group.

Every push to the `main` branch on GitHub updates the live site automatically. When a change touches the database, run `npm run db:setup:prod` once from your computer. Vercel serves HTTPS only and the app sends HSTS, so traffic is always encrypted.

---

## Commands

| Command | What it does |
|---|---|
| `bash scripts/setup-local.sh` | First-time setup, or repair/upgrade an existing one. Safe to rerun. |
| `npm run local` | Start the database (if needed) and the app on http://localhost:3000. |
| `npm run db:pull` | Copy the live Neon data into your local database (backs up local first). |
| `npm run db:setup` / `db:check` | Create or upgrade / check the **local** database tables. |
| `npm run db:setup:prod` / `db:check:prod` | The same for **Neon** (uses `.env.production`). |
| `npm run dev` | Start only the app (the database must already be running). |
| `npm run typecheck` / `npm run lint` | Code checks for developers. |

For developers who prefer doing it by hand: `cp .env.example .env.local`, set a random `SESSION_SECRET` and the phone numbers, `createdb badminton`, `npm install`, `npm run db:setup`, `npm run dev`. The schema is in `db/schema.sql`; it is idempotent and upgrades older databases in place.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: npm` or `node` right after setup | Close the terminal, open a new one, `cd badminton-community`, and run the command again. |
| "This number is not registered yet" when signing in | Only added people can sign in. An admin or core member adds them under **Members → Add a player**. For the first admin, check `ADMIN_PHONE` in `.env.local`, then rerun `bash scripts/setup-local.sh`. |
| Forgot a PIN | Tap **Forgot PIN?** on the PIN screen; another admin or core member resets it under **Members**. If the only admin forgot theirs locally: `psql "$(grep ^DATABASE_URL .env.local \| cut -d= -f2-)" -c "update players set pin_hash = null where phone = '<number>'"`, then sign in and choose a new PIN. |
| "Port 3000 is in use" | The app is already running in another terminal window. Use that one, or stop it with `Ctrl` + `C` first. |
| "PostgreSQL did not start" / "Can't connect" | Run `bash scripts/setup-local.sh` again; it starts the database and can repair the login. On Windows, open the Ubuntu window first (WSL stops PostgreSQL when it shuts down). |
| `column "…" does not exist` on a page | The code is newer than your tables. Run `npm run db:setup` (local) or `npm run db:setup:prod` (Neon). |
| `db:pull` says pg_dump is too old | Answer `y` to install the newer tools, or on a Mac run `brew install postgresql@18`. |
| `.env.local points at Neon` | The local scripts refuse to touch the live database. Put the local line first in `.env.local` and comment the Neon one out with `#`. |
| Everyone got signed out | `SESSION_SECRET` changed. That's expected after changing it; everyone signs in again with their PIN. |

---

## How the app works

### Who does what

| Role | How they get it | Sign-in | Can |
|---|---|---|---|
| Floater | Core/admin add their number + name (Members → Add a player) | Phone + own 4-digit PIN, once per device | Votes for any slot ("Just me" / "Me + friends") and pays the per-session fee. Sees counts only. |
| Member | Applies in the app; core/admin quotes the amount, collects it offline and activates the plan | Same as floater | Votes like everyone else, using plan sessions. Sees who's coming. |
| Core member | Admin enters their phone number | Phone + own 4-digit PIN | Roster (dues, refunds, ±court, share), quote and activate plans, wallet top-ups |
| Admin (RDX) | Admin enters their phone number (first one comes from `.env`) | Phone + own 4-digit PIN | Everything above, plus staff management, batch settings and cancelling sessions |

Everyone sets a PIN the first time they sign in. Players and members then stay signed in on that phone; core and admin enter their PIN again after 20 minutes idle or when the browser closes. Forgot your PIN? Tap "Forgot PIN" on the PIN screen: core members (for players) or admins (for anyone) clear it on the Members page, which signs that person out everywhere, and they set a new one at next sign-in. Admins see **inactive users** on the Admin page: people who were added but haven't set a PIN yet (never signed in, or their PIN was reset) and players an admin deactivated. Deactivating a player signs them out at once, blocks sign-in, withdraws their votes for sessions that haven't started (giving back any plan session already taken) and closes open plan requests; their plan is kept, and **Reactivate** lets them sign in again with the same PIN. Wrong PINs are limited to 5 tries per account and 30 per IP every 15 minutes. PINs are stored as salted scrypt hashes.

### A slot, start to finish

Everyone votes, members included. Nobody is in by default.

1. **Vote:** any time before the start, if there's room.
2. **Confirm "I'm coming":** opens 12 hours before the start.
3. **Back out:** allowed until 30 minutes before the start. The button reads "I'm a member but I can't come", "I've paid but I can't come" or "Can't make it". After that the slot is final: plan sessions are charged and fees are owed. Joining in the last 30 minutes is final straight away.
4. **"I came & played":** the player confirms this themselves, from the start until 12 hours after the end. Anyone who doesn't becomes a no-show (the slot stays charged).

Players mark their own attendance. On the roster staff see each player's status (voted / confirmed / played / no-show / withdrew) and can correct it: voted, confirmed or withdrew before the start; played, no-show or withdrew after it. Marking someone withdrew gives back a used plan session (and shows a refund if they paid); bringing them back re-checks their plan. Staff also collect fees and refund people who paid and then backed out in time.

### Plans

- **Fixed plan:** one batch and its days (all / weekdays / weekends / custom), a number of sessions, a start date and an optional expiry date. The member can only vote for their own batch on their own days.
- **Wallet:** a balance of sessions for any batch on any day. The player asks for N sessions; staff quote the amount, collect it and activate (or top up an existing wallet).
- A request goes **pending → quoted** (the player sees "pay ₹X") **→ activated**.
- One plan session is taken 30 minutes before the start, for each slot the member voted for and didn't back out of. Cancelling a session gives the sessions back.
- Every balance change (activate, top-up, use, refund, staff edit) is written to `plan_ledger`, which is shown per member as the balance history.
- Friends always pay the fee. Batches are priced per hour (admin → batches); a seat costs that × the session length.

### Code layout

| Path | What's there |
|---|---|
| `app/page.tsx` | Sign-in, PIN screens, the player home and the staff dashboard |
| `app/roster`, `app/members`, `app/admin` | Staff pages |
| `app/actions.ts`, `app/staff-actions.ts` | Everything a button does (server actions) |
| `lib/` | Sign-in and PINs (`auth.ts`), slot timing (`sessions.ts`), plans (`members.ts`), translations (`i18n.ts`) |
| `db/schema.sql` | Database tables; safe to rerun |
| `scripts/` | Setup, database checks and the Neon → local copy |
| `rdx-site/` | The public RDx promo website (separate Vercel project; see `rdx-site/README.md`) |
