// The site's public address, for canonical links, the sitemap, robots.txt and llms.txt.
// Set SITE_URL on Vercel if the site moves to its own domain (and update the same address in public/site/*.html).
export const SITE_URL = (process.env.SITE_URL || 'https://rdxbaddy.vercel.app').replace(/\/$/, '');
