import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Anek_Devanagari, Mukta } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

// Both families cover Latin and Devanagari, so Marathi and Hindi render in the same style.
// Anek: a variable-width face; set wide for dates, times and counts, like court-side signage. Mukta: clean body text.
const display = Anek_Devanagari({ subsets: ['latin', 'devanagari'], axes: ['wdth'], variable: '--font-display', display: 'swap' });
const body = Mukta({ subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });

const name = process.env.COMMUNITY_NAME || 'Badminton Community';

export const metadata: Metadata = {
  title: name,
  description: `Book your ${name} slot`,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050506' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <header className="top">
          <Link href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/site/assets/img/logo.png" width={32} height={32} alt="" />
            <span className="brand-text">RDx BADDY GROUP</span>
          </Link>
          {/* Plain link on purpose: `/?home` is answered by the proxy with the promo pages, not by the app router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="home-link" href="/?home">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            Home
          </a>
        </header>
        <main>{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
