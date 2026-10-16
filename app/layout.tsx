import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Anek_Devanagari, Mukta } from 'next/font/google';
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
            <svg className="logo" viewBox="0 0 24 24" aria-hidden>
              <path d="M8.5 13.5 4 4.5h8l-1 9" fill="rgba(239,230,210,.95)" />
              <path d="M10.5 13.5 13 4.5h7l-5.5 9" fill="rgba(239,230,210,.7)" />
              <circle cx="11.6" cy="17" r="4" fill="#0f0f11" stroke="rgba(239,230,210,.95)" strokeWidth="1.4" />
            </svg>
            {name}
          </Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
