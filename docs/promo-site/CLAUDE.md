# CLAUDE.md: RDx promo website (public/site)

The public promo website for the RDx badminton community. It is **part of the booking app's single deployment** (it used to be a second Vercel project). Pages are static files in `public/site/` (no build step, ESLint and `tsc` skip them), served on the same domain through rewrites in `proxy.ts`. The announcements API is `lib/site/*.js` behind `app/api/posts` and `app/api/sign`. It shares no database with the app. Read `README.md` here for the admin guide. Paths below like `assets/...` mean `public/site/assets/...`, referenced as `/site/assets/...`.

## Intent

- Show what RDx is, its batches and courts, announcements (news, tournaments, videos, photos), and **how to join**, with the team's contact numbers.
- **Phone first.** The owner asked for it to be "highly mobile responsive" and tested as a phone user, not a laptop user. Every change must be checked at 320, 360, 390 and 430 px wide, in phone landscape (667×375, 844×390), and on a tablet and a laptop:
  - no sideways scrolling;
  - tap targets of at least 44 px;
  - no text under 0.8rem;
  - no JavaScript errors.
- **Processes are explained with simple chains of steps, not paragraphs in boxes or technical flowcharts.** The owner was explicit about this.
- Light, badminton-themed animation: SVG and CSS transforms only, run only while on screen, and switched off completely for "reduce motion". Scrolling must stay at 60 fps with the CPU slowed 4×.
- Will be deployed on Vercel (chosen over S3: S3 can't run the functions or provide HTTPS on a custom domain without CloudFront).

## Facts (only use what the owner gave; ask before adding claims)

All of these live in `assets/js/config.js`:

- Name **RD’x**: R and D uppercase, an apostrophe, then x lowercase; the apostrophe and x are red. Always written with the apostrophe in visible text.
- **300+ members**.
- Venue: **Aliens Badminton Academy**. `mapUrl` is empty until the owner gives a Google Maps link.
- **Batches:**
  - Morning: courts **1 and 2**.
  - Evening: courts **4, 5 and 6**. (The owner corrected these; they were the other way round before.)
  - The academy has 6 courts.
  - The 7–8 AM / 7–8 PM times came from the booking app's default batches, not from the owner. Confirm them if asked.
- **Team, with phone numbers kept directly in the code, as the owner asked:**
  - Rahul Dhekane (**RDx**), Community head: 8898117019
  - Sadanand Wagh, Core member: 8793103747
  - Pranit Devre, Core member: 9766990861
  - Jaideep Bisen, Core member: 9325735543
- `SITE.appUrl` is the booking app link, https://rdxbaddy.vercel.app/.
- **Don't invent details.** Copy that said "beginners, regulars and tournament players", "run by volunteers" and "doubles" was removed because the owner never said it.

## Pages (multi-page, no build step; shared header/footer are repeated in each HTML file)

- `/` Home: hero (wordmark on a court, one rally), session times, "Coming up", links to the other pages, join band.
- `/about`: members, venue, court map per batch, "How a session goes", the team (`#team`, call and WhatsApp).
- `/play`: the four shots, and "A slot, start to finish" (chain).
- `/membership`: fixed and wallet plans, and "Who pays what" as a plain four-step chain (vote, are you a member?, not a member?, bringing friends?). The owner found the decision flowchart too technical; keep the wording in everyday terms.
- `/news`: "Coming up" and announcements (filters, photo viewer).
- `/join` (nav label "Register"): the four-step court guide, with Register / I have an account buttons.
- Icons come from `assets/img/sprite.svg` (`<use href="/assets/img/sprite.svg#i-shuttle">`). The shuttle artwork lives there now.
- Header: logo, page links (a second swipeable row on phones; `aria-current="page"` is set in each file) and a Join button. The footer repeats the page links.
- **Every Join / Register / Log in button goes to the booking app** (`SITE.appUrl` = `/?app=1`, marked `data-app`). WhatsApp is no longer the join route; the team's numbers stay on `/about`.
- **One site, decided on the server.** `proxy.ts` shows the promo home at `/` unless the visitor has a `pid` (signed in) or `claim` cookie, or a short-lived `rdx-app` cookie (set by `/?app=1`, 30 min), or `?app` / `?msg` is in the URL. Join / Register / Log in buttons (`data-app`, `SITE.appUrl`) go to `/?app=1`, the app's sign-in screen. Signed-in players never see the promo at `/`.
- There is **one admin page, `/admin`** (the app's). Announcements are managed in its "Announcements" section (`app/ui/PostsAdmin.tsx`, English-only labels). `/site-admin` just redirects there. `/robots.txt` allows only `/` and the promo pages.
- Header: logo, then **Log in** and **Join** at the very top (both go to the app). The phone dock at the bottom has only "Join RDx", hidden while an element marked `data-hide-dock` (hero, footer, the page's own join buttons) is on screen.
- Scroll-driven animations were removed. The chain and the court guide now play once, by themselves, the first time they are seen (`playOnce`); the court map opens the first time it is seen. "Reduce motion" shows the finished state.

## Design decisions

- **Same palette as the booking app:** near-black (`#050506`, `#0c0c0e`, `#16161a`), beige text `#efe6d2`, red `#e5484d` / `#a61f28`. Blue, yellow and green glass only on dates, chips, the decision diamond and WhatsApp.
- **Fonts:** Anek Devanagari (wide display face, `font-stretch` up to 125%) and Mukta. Body text is 17 px.
- **The shuttle is a Yonex Mavis 350, as the owner asked** (the `#i-shuttle` symbol in `assets/img/sprite.svg`, plus `assets/img/favicon.svg`):
  - a bright lemon-yellow nylon skirt with a see-through diamond mesh in the top half and a ribbed lower skirt;
  - a very slim green speed band;
  - a white cork.
  - The owner said the first yellow "looked off", so it was made brighter. Keep it bright, and keep it a small accent against the red and beige.
  - The mesh is generated from the skirt's taper. If you redraw it, re-render at 240, 52, 34 and 22 px and check how it reads.
  - Regenerate `assets/img/apple-touch-icon.png` (180 px) whenever the favicon changes.
- **Motion rules:** one rally on the hero, rallies on the shot cards, the scroll-filled chain, and the court guide. No generic fade-ins on every section.

## How announcements are stored (no database)

- **Nothing is kept in a database or in memory.** Posts and media live in the owner's **Cloudinary** account:
  - each post is a raw JSON file tagged `rdx-post` (`rdx/posts/<id>.json`);
  - photos and videos are in `rdx/media` (tagged `rdx-media`).
- `api/posts.js`:
  - `GET` is public and cached at the edge for 60 s; `?fresh=` skips the cache.
  - `POST` and `DELETE` require the admin password. Deleting a post also removes its media.
  - Up to 200 posts are listed.
- `api/sign.js` returns a one-time Cloudinary signature, so the browser uploads straight to Cloudinary. Vercel's ~4.5 MB request limit makes this necessary. Free-plan limits: photos 10 MB, videos 100 MB; longer videos go on YouTube.
- `api/_lib.js` makes the Cloudinary REST calls without an SDK (SHA-1 signatures, Basic auth for the Admin API). It also validates posts:
  - media must come from our own `res.cloudinary.com/<cloud>/` or YouTube;
  - all text is plain text (rendered with `textContent`, never `innerHTML`).
- **Admin:** the app's `/admin` page. `POST`/`DELETE` on `/api/posts` and `/api/sign` need an admin signed in with their PIN (checked on the server in `isAdmin`, which also rejects requests from other websites). There is no separate posting password any more.
- **Required Vercel variables:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Redeploy after changing them.
- **Storage plan discussed:** Cloudinary now (free tier), YouTube for long videos, possibly **Cloudflare R2** later (free downloads, but no automatic resizing; it would mean rewriting `api/` and the upload code in `admin.js`). Other free options discussed: Backblaze B2, ImageKit, Supabase Storage.

## Local preview and testing

- Run the whole site with `npm run dev` (Next, port 3000). Cloudinary keys go in `.env.local` (see `docs/promo-site/env.example`).
- Without Cloudinary keys, the announcements list shows its empty state.
- Earlier testing used a stand-in for Cloudinary (posts in memory) that pointed media at Cloudinary's public `demo` account. It lived only in the session scratchpad and isn't part of the project.
- **Testing checklist after any UI change:**
  1. headless Chrome with mobile emulation and touch, at the sizes above;
  2. screenshots taken while scrolling (hero, shots, chains, guide, team, dock);
  3. a "reduce motion" run;
  4. a scroll-smoothness run with the CPU slowed 4×.
- Leftover headless Chrome processes can hang later runs. Kill them with `pkill -f remote-debugging-port=9333`.

## Open items

- Set `SITE.mapUrl` once the owner gives a Maps link.
- Cloudinary keys still need to be added in Vercel before posting works.
- `assets/img/og.png` (the image shown when the link is shared) was rendered with a fallback font. Re-render it if the wordmark should match exactly.
