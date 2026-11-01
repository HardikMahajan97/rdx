import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Anek_Devanagari, Mukta } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { getLang } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { INTRO_SCRIPT, INTRO_STYLE } from '@/lib/intro-head';
import { SITE_URL } from '@/lib/site-url';
import { LogoutButton } from './ui/Shared';
import './globals.css';

// Both families cover Latin and Devanagari, so Marathi and Hindi render in the same style.
// Anek: a variable-width face; set wide for dates, times and counts, like court-side signage. Mukta: clean body text.
const display = Anek_Devanagari({ subsets: ['latin', 'devanagari'], axes: ['wdth'], variable: '--font-display', display: 'swap' });
const body = Mukta({ subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

// The app's pages (sign-in, bookings, staff pages) stay out of search engines; the promo pages are what gets
// indexed. /register overrides this so people can find it.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'RDx BADDY GROUP', template: '%s | RDx BADDY GROUP' },
  description: 'Book your RDx BADDY GROUP badminton slot.',
  applicationName: 'RDx BADDY GROUP',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050506' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The intro snippet adds a class to <html> before React loads, hence suppressHydrationWarning.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        {/* Intro video on the first page of every new visit, for everyone (signed in or not): lib/intro-head.ts */}
        <style dangerouslySetInnerHTML={{ __html: INTRO_STYLE }} />
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body>
        <header className="top">
          <Link href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/site/assets/img/logo.png" width={32} height={32} alt="" />
            <span className="brand-text">RDx BADDY GROUP</span>
          </Link>
          {/* Plain link on purpose: `/?home` is answered by the proxy with the promo pages, not by the app router. */}
          <span className="top-actions">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="home-link" href="/?home" aria-label="Home">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              <span className="home-text">Home</span>
            </a>
            {/* Signed in (or half-way through signing in): Log out, top right, on every page. */}
            <Suspense fallback={null}><AccountButton /></Suspense>
          </span>
        </header>
        <main>{children}</main>
        <Analytics />
      </body>
    </html>
  );
}

async function AccountButton() {
  const jar = await cookies();
  if (!jar.has('pid') && !jar.has('claim')) return null;
  return <LogoutButton className="top-logout" label={translator(await getLang())('logout')} />;
}
