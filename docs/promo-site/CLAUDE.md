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

- Name **RDx**: R and D uppercase, x lowercase in red. **No apostrophe** (the owner tried "RD'x", then asked for it to be removed everywhere). The group is always written **RDx BADDY GROUP** on one line (never wrapped), capitals except the x; the header and footer wordmark, the app's top bar and the install name all use it.
- **300+ members**.
- Venue: **Aliens Badminton Academy**, shown once, as a line with a pin and a Google Maps link (`SITE.mapUrl`, https://maps.app.goo.gl/nebRK6iLGiv4KU559) just above "Timings and courts" on Home and About. The owner first had it removed everywhere, then asked for it back in that one place only; don't add it to the footer or descriptions.
- **Halls, batches, times and courts now come from the database** (`/api/venues`, edited on the app's Admin → Halls and batches). The values below and in `config.js` are only a fallback for when the API can't be reached.
- **Batches:**
  - Morning: courts **1 and 2** (`SESSIONS` in `config.js`; keep it in step with Admin → Batches → Court numbers).
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

- `/` Home: no big wordmark any more. It opens straight with the headline and Join button, then who we are (300+ members), timings and courts, "Coming up", links to the other pages and the join band.
- **First-visit intro video:** `public/site/assets/video/intro.mp4` (+ `intro-poster.jpg`), the 5-second RDx BADDY GROUP logo sting (shuttle hits the logo, explosion, logo re-forms; has sound). It plays once over the home page for a first-time visitor: an inline script in `index.html` marks `html.intro` when `localStorage.rdx-intro` is unset, the browser can store data, motion isn't reduced and the URL has no `?home`; `intro()` in `site.js` then creates the video (the file is requested only then). There are no buttons (the owner asked for no "Tap to play" or "Skip"): it just plays. Browsers often block sound before any tap, so then it plays silently and the sound comes on if the visitor taps the screen. It sets `rdx-intro` and never plays again on that phone. The original is `source-assets/intro-original.mp4` (committed, never served). `bash scripts/make-intro-assets.sh [original.mp4]` rebuilds the served video, the poster and every logo image from it. The served copy is cropped (white frame removed) and re-encoded from the original at 768 px with a light sharpen (~1.2 MB; the source itself is only 576 px). While the explosion plays (1.2 s to 3.8 s) the edges are faded to black with an ffmpeg `blend` mask, because the smoke otherwise fills the square and shows as a visible box on the black screen; the logo frames at the start and end are not touched. If you swap in a new original, redo that fade.
- `/about`: members, timings and courts as plain text (hours and courts both underlined, no boxes or highlight), "How a session goes", the team (`#team`, call and WhatsApp).
- `/play`: the four shots, and "A slot, start to finish" (chain).
- `/membership`: fixed and wallet plans, and "Who pays what" as a plain four-step chain (vote, are you a member?, not a member?, bringing friends?). The owner found the decision flowchart too technical; keep the wording in everyday terms.
- `/news`: "Coming up" and announcements (filters, photo viewer).
- `/join` (nav label "How to join"): the four-step court guide, with Register now (→ `/register`) / I have an account (→ Log in) buttons.
- **Policy pages for PhonePe** (needed before PhonePe enables payments): `/terms`, `/refund-policy`, `/privacy`, `/contact` (`terms.html` etc., plain static text, no sign-in). Every page's footer has a second row of links to all four (`.legal-links`); keep it on any new page. The owner's answers (29 Oct 2026):
  - Refunds match the app: cancel until 30 min before the start, so a plan session goes back or a paid fee is refunded in 5–7 business days; after that, final; activated plans are not refundable; failed payments are returned by the bank in 3–5 working days.
  - Court rules: arrive on time, non-marking shoes, bring your own racket, respect the rotation.
  - Contact: Rahul's number first, then the core team's. Support hours: every day, 7 AM to 9 PM.
  - **Email and full address are not on the Contact page yet.** The owner had the placeholders removed (29 Oct 2026); it shows the venue name with the Maps link instead. PhonePe's checklist asks for a support email and an operating address that match what Rahul enters on PhonePe, so add both (and the "email" mention back to the other three pages' contact line) once the owner gives them.
  - The safety clause (play at your own risk; RDx isn't liable for injury or lost belongings) and "governed by the laws of India" are standard wording, not facts from the owner.
- Icons come from `assets/img/sprite.svg` (`<use href="/assets/img/sprite.svg#i-shuttle">`). The shuttle artwork lives there now.
- Header: logo, page links (a second swipeable row on phones; `aria-current="page"` is set in each file) and a Join button. The footer has the page links, then the copyright line at the very end: "Copyright © 2027 RDx BADDY GROUP" (fixed text, owner's wording). Above it, a credit line: "Hardik Mahajan · Developer & Technical Team".
- **Logo:** the RDx BADDY GRP logo (a frame of the intro video, on black) is now the header logo (`logo.png`), favicon, home-screen icons (`icon-192/512.png`, `apple-touch-icon.png`), sharing image (`og.png`) and the app's top-bar logo and tab icon. All are made by `scripts/make-intro-assets.sh` from frame 0 of the original, cropped 32 px in. The logo has a solid black background, so it is shown as a rounded square, not cut out.
- **Buttons say "Register" (red) and "Log in" (ghost); the owner replaced "Join" / "Join RDx" with "Register".** Register buttons go to the app's own registration page (`SITE.registerUrl` = `/register`, marked `data-app="register"`); Log in buttons go to the app's Log in screen (`SITE.appUrl` = `/?app=1`, marked `data-app`). The two are separate pages on purpose. `/join` is the how-to guide, labelled **"How to join"** in the nav and footer so it isn't confused with the Register button. WhatsApp is no longer the join route; the team's numbers stay on `/about`.
- **One site, decided on the server.** `proxy.ts` shows the promo home at `/` unless the visitor has a `pid` (signed in) or `claim` cookie, or a short-lived `rdx-app` cookie (set by `/?app=1`, 30 min), or `?app` / `?msg` is in the URL. Join / Register / Log in buttons (`data-app`, `SITE.appUrl`) go to `/?app=1`, the app's sign-in screen. Signed-in players never see the promo at `/`.
- There is **one admin page, `/admin`** (the app's). Announcements are managed in its "Announcements" section (`app/ui/PostsAdmin.tsx`, English-only labels). `/site-admin` just redirects there. `/robots.txt` allows only `/` and the promo pages.
- **Signed in on this browser:** `proxy.ts` keeps a readable `rdx-in=1` cookie in step with the sign-in cookie. `signedInView()` in `site.js` then removes the header's Log in / Register, adds **Log out** (a form posting to `/logout`), turns the page's Register buttons into "Open the app" (→ `/`), and removes the phone Register bar and the footer's app links.
- **Footer is centred** on every screen size.
- Header: logo, then **Log in** and **Register** at the very top (both go to the app). On phones, the logo, name and both buttons must share the first row and the page links the second (the header is 107 px tall). This was measured to fit from 320 px up: up to 430 px the logo is 32 px and the buttons 0.92rem; under 360 px the logo image is hidden so the name stays on one line. From 720 to 959 px everything is on one row with tighter links. Re-measure if a label gets longer. The phone dock at the bottom has only "Join RDx", hidden while an element marked `data-hide-dock` (hero, footer, the page's own join buttons) is on screen.
- Scroll-driven animations were removed. The chain and the court guide now play once, by themselves, the first time they are seen (`playOnce`); the court map opens the first time it is seen. "Reduce motion" shows the finished state.

## Design decisions

- **Same palette as the booking app:** near-black (`#050506`, `#0c0c0e`, `#16161a`), beige text `#efe6d2`, red `#e5484d` / `#a61f28`. Blue, yellow and green glass only on dates, chips, the decision diamond and WhatsApp.
- **Fonts:** Anek Devanagari (wide display face, `font-stretch` up to 125%) and Mukta. Body text is 17 px.
- **The shuttle is a Yonex Mavis 350, as the owner asked** (the `#i-shuttle` symbol in `assets/img/sprite.svg`, and the shuttle still used in the court guide and shot animations):
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
