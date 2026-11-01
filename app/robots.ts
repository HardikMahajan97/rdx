import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

// Search engines and AI assistants may read the public pages (promo, policies, Register, llms.txt) and nothing
// else: the app's pages hold player names and money. AI crawlers are named so it's clear they are welcome on the
// public pages; they get the same rules as everyone.
const allow = [
  '/$', '/about', '/play', '/membership', '/news', '/join', '/register',
  '/terms', '/refund-policy', '/privacy', '/contact', '/llms.txt', '/site/assets/', '/_next/static/',
];
const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot',
  'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Meta-ExternalAgent', 'Amazonbot', 'CCBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow, disallow: '/' },
      { userAgent: AI_BOTS, allow, disallow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
