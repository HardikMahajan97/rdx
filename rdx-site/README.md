# RDx website

The public site for the RDx badminton community: what RDx is, session times, announcements (news, tournaments, videos, photos), the team's contact numbers and how to join.

Plain HTML, CSS and JavaScript with no build step, plus two small Vercel functions for posting. It's separate from the booking app in the parent folder and deployed on its own.

```
index.html            the site
admin.html            where RDx posts announcements (/admin, not linked from the site)
assets/js/config.js   team names and numbers, session times, app link, venue: edit here
assets/js/site.js     renders the page and the announcements feed
assets/js/admin.js    the posting page
assets/css/           styles (same colours as the booking app)
api/posts.js          list / publish / delete posts
api/sign.js           password check + one-time upload signature
dev.mjs               local preview server
```

## Changing the text, numbers or times

Open `assets/js/config.js`:

- `TEAM`: names, roles and phone numbers (10 digits). The first person is shown as the community head.
- `SESSIONS`: batch names and times.
- `SITE.appUrl`: the booking app's link once it's online. While it's empty, the "Open the app" button stays hidden.
- `SITE.venue` / `SITE.mapUrl`: where you play (a Google Maps link works). Hidden while empty.

The other wording is in `index.html`. Push to GitHub and Vercel publishes the change in about a minute.

## How announcements work

RDx opens **`https://<your-site>/admin`**, enters the posting password and fills in:

- **Type:** Announcement, Tournament, Video or Photos. These match the filter buttons on the site.
- **Title** and optional details.
- For a tournament: **date, start time, venue and a registration link**. Upcoming tournaments also show in the "Coming up" strip at the top of the site, with a date bubble.
- **Photos and videos** from the phone or computer. Each file shows an upload bar. They go straight from the browser to Cloudinary, so large videos never pass through Vercel.
- **A YouTube link**, for long videos.
- **Pin to the top:** a pinned post is shown first, large.

Posts appear on the site within a minute. The admin page also lists every post, with **Delete** (tap twice), which removes the post and the files uploaded for it.

Under the hood, each post is a small JSON file in Cloudinary, so there's no database to run. The site's visitors load photos and videos from Cloudinary's CDN with automatic format and quality (`f_auto,q_auto`), and videos only load when someone presses play. YouTube videos show a thumbnail until tapped.

## Put it online (Vercel)

1. **Cloudinary** (free): sign up at https://cloudinary.com. On the dashboard, go to **Settings → API Keys** and note the **Cloud name**, **API key** and **API secret**.
2. **Vercel:** at https://vercel.com, click **Add New → Project** and import this GitHub repository.
   - Set **Root Directory** to `rdx-site`.
   - Set **Framework Preset** to **Other**. There's no build command.
3. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `CLOUDINARY_CLOUD_NAME` | from step 1 |
   | `CLOUDINARY_API_KEY` | from step 1 |
   | `CLOUDINARY_API_SECRET` | from step 1 |
   | `ADMIN_PASSWORD` | a password of 10+ characters for posting; share it only with whoever posts |

4. Click **Deploy**. Optionally connect your own domain under **Settings → Domains**. Vercel adds HTTPS for free.

The site and the booking app are two Vercel projects from the same repository: this one with root `rdx-site`, the app with the repository root.

**Why Vercel rather than S3?** S3 can only serve files. It can't run the two small functions that keep the Cloudinary secret safe and check the posting password. It also needs CloudFront added for HTTPS on your own domain. Vercel's free plan does all of that, with a global CDN. The heavy files (videos and photos) live in Cloudinary either way, so hosting costs stay at zero.

## Try it on your computer

You need Node.js 20 or newer. The setup script in the parent folder installs it.

```bash
cd rdx-site
cp .env.example .env      # optional: add Cloudinary keys + ADMIN_PASSWORD to test posting
npm run dev               # http://localhost:5173 and http://localhost:5173/admin
```

Without Cloudinary keys, the site works and the announcements list shows its empty state.

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

- The Cloudinary secret and posting password only exist on the server, as Vercel environment variables.
- Posting requires the password. Wrong guesses are slowed down and limited.
- Posts can only show media from your own Cloudinary account or YouTube.
- All text is shown as plain text, so a post can't inject code into the page.
- `/admin` is hidden from search engines.
- Change `ADMIN_PASSWORD` in Vercel whenever someone who knew it shouldn't post any more, then redeploy.
