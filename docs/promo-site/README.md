# RDx website

The public site for the RDx badminton community: what RDx is, session times, announcements (news, tournaments, videos, photos), the team's contact numbers and how to join.

Built phone first. The page, top to bottom:

1. **Hero**: the RDx wordmark on a court (drawn upright on phones). One shuttle flies across when the page opens.
1. **About RDx**: the member count, the venue, a court map per batch with that batch's courts lit up, and a short "how a session goes" chain.
2. **Coming up**: upcoming tournaments with date bubbles (only when there are some).
3. **Announcements**, with filters.
4. **Four shots you'll play**: swipeable cards, each a tiny looping rally (clear, smash, drop, net shot). They only animate while on screen.
5. **A slot, start to finish**: a chain whose line fills as you scroll.
6. **Who pays what**: a decision flowchart that opens up step by step.
7. **Your way onto the court**: the joining steps placed on a court, with a shuttle that follows the path as you scroll and lights up each step.
8. **Team** with WhatsApp and call buttons. On phones, a WhatsApp/Call bar slides up from the bottom once the hero is gone.

All animation is SVG and CSS transforms, and it all stops when the phone's "reduce motion" setting is on.

Tested at 320, 360, 390 and 430 px wide, in phone landscape (667×375, 844×390), and on a tablet and a laptop. Every size has no sideways scrolling, tap targets of at least 44 px and text of at least 0.8rem. Scrolling stays at 60 fps with the CPU slowed 4×.

Plain HTML, CSS and JavaScript with no build step, plus two small API routes for posting. It is deployed together with the booking app, on the same website.

```
public/site/*.html    the pages (index, about, play, membership, news, join)
assets/js/config.js   team names and numbers, session times, app link, venue: edit here
assets/js/site.js     renders the page and the announcements feed
assets/css/           styles (same colours as the booking app)
(in the app) lib/site/posts.js, sign.js   list / publish / delete posts; one-time upload signature
(in the app) app/ui/PostsAdmin.tsx         the posting form, inside the /admin page
```

## Changing the text, numbers or times

Open `assets/js/config.js`:

- `TEAM`: names, roles and phone numbers (10 digits). The first person is shown as the community head.
- `COMMUNITY`: the member count ("300+") and how many courts the venue has.
- `SESSIONS`: batch names, times and the court numbers each batch plays on.
- `SITE.appUrl`: the booking app's link once it's online. While it's empty, the "Open the app" button stays hidden.
- `SITE.venue` / `SITE.mapUrl`: where you play (a Google Maps link works). Hidden while empty.

The other wording is in `index.html`. Push to GitHub and Vercel publishes the change in about a minute.

## How announcements work

An admin signs in to the app as usual, opens **`https://<your-site>/admin`**, scrolls to **Announcements** and fills in:

- **Type:** Announcement, Tournament, Video or Photos. These match the filter buttons on the site.
- **Title** and optional details.
- For a tournament: **date, start time, venue and a registration link**. Upcoming tournaments also show in the "Coming up" strip at the top of the site, with a date bubble.
- **Photos and videos** from the phone or computer. Each file shows an upload bar. They go straight from the browser to Cloudinary, so large videos never pass through Vercel.
- **A YouTube link**, for long videos.
- **Pin to the top:** a pinned post is shown first, large.

Posts appear on the site within a minute. The admin page also lists every post, with **Delete** (tap twice), which removes the post and the files uploaded for it.

Under the hood, each post is a small JSON file in Cloudinary, so there's no database to run. The site's visitors load photos and videos from Cloudinary's CDN with automatic format and quality (`f_auto,q_auto`), and videos only load when someone presses play. YouTube videos show a thumbnail until tapped.

## Put it online (Vercel)

The promo pages and the booking app are **one Vercel project**, so there's nothing separate to deploy. Pushing to `main` publishes both.

1. **Cloudinary** (free): sign up at https://cloudinary.com. On the dashboard, go to **Settings → API Keys** and note the **Cloud name**, **API key** and **API secret**.
2. In the Vercel project, under **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `CLOUDINARY_CLOUD_NAME` | from step 1 |
   | `CLOUDINARY_API_KEY` | from step 1 |
   | `CLOUDINARY_API_SECRET` | from step 1 |

3. Redeploy. If you had a separate promo project on Vercel, you can delete it, and point its domain at this project.

Visitors without a sign-in see the promo at `/`; signed-in players go straight to the app. The promo pages are static files, so they use no server time, and the app's pages never load promo scripts.

**Why Vercel rather than S3?** S3 can only serve files. It can't run the two small functions that keep the Cloudinary secret safe and check admin sign-in. It also needs CloudFront added for HTTPS on your own domain. Vercel's free plan does all of that, with a global CDN. The heavy files (videos and photos) live in Cloudinary either way, so hosting costs stay at zero.

## Try it on your computer

```bash
npm run local             # the whole site: http://localhost:3000, and the posting form in /admin
```

To test posting, add the four Cloudinary /  values (see `env.example` in this folder) to `.env.local`. Without them the site works and the announcements list shows its empty state.

## Free places to keep photos and videos

Free-tier limits change, so check each provider's pricing page before relying on these numbers.

| Option | Free allowance (approx.) | Good for | Notes |
|---|---|---|---|
| **Cloudinary** (used now) | 25 credits a month (1 credit ≈ 1 GB stored *or* 1 GB delivered); photos up to 10 MB, videos up to 100 MB | Photos and short clips | Resizes and compresses automatically for phones. Easiest to start with. |
| **YouTube** (supported now) | Unlimited | Match videos, long highlights | Free streaming in every quality. Paste the link in the admin page. Use *Unlisted* if you don't want it in YouTube search. |
| **Cloudflare R2** | 10 GB stored a month, **no fee for downloads** | Lots of files, later on | No automatic resizing or video streaming; files are served as uploaded. Moving to it means changing `api/` and the upload code. |
| **Backblaze B2** | 10 GB stored | Cheap archive and backups | Free downloads when served through Cloudflare. |
| **ImageKit** | about 20 GB delivered a month | Similar to Cloudinary | Image and video optimization included. |
| **Supabase Storage** | 1 GB | Small sites | Comes with a database if you ever need one. |

**Suggestion:** keep Cloudinary for photos and short clips, put anything long on YouTube, and watch Cloudinary's usage page. Moving to R2 makes sense if photos alone start passing the free credits, because R2 charges nothing for people viewing them.

## Security notes

- The Cloudinary secret only exists on the server, as a Vercel environment variable.
- Posting requires an admin signed in with their PIN (core members can't post). Requests from other websites are refused.
- Posts can only show media from your own Cloudinary account or YouTube.
- All text is shown as plain text, so a post can't inject code into the page.
- To stop someone posting, change their role (Admin page → Staff). There's no shared password to rotate.
