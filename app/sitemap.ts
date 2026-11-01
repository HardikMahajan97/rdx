import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

// Every public page. The app's pages are left out on purpose (see robots.ts).
const PAGES: [path: string, priority: number, changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'][] = [
  ['/', 1, 'weekly'],
  ['/about', 0.9, 'monthly'],
  ['/join', 0.9, 'monthly'],
  ['/register', 0.9, 'yearly'],
  ['/membership', 0.8, 'monthly'],
  ['/play', 0.7, 'monthly'],
  ['/news', 0.8, 'daily'],
  ['/contact', 0.6, 'yearly'],
  ['/terms', 0.3, 'yearly'],
  ['/refund-policy', 0.3, 'yearly'],
  ['/privacy', 0.3, 'yearly'],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([path, priority, changeFrequency]) => ({ url: `${SITE_URL}${path}`, priority, changeFrequency }));
}
