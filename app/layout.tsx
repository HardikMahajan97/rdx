import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Hind, Teko } from 'next/font/google';
import './globals.css';

// Both families cover Latin and Devanagari, so Marathi and Hindi render in the same style.
const display = Teko({ subsets: ['latin', 'devanagari'], weight: ['500', '600'], variable: '--font-display' });
const body = Hind({ subsets: ['latin', 'devanagari'], weight: ['400', '600', '700'], variable: '--font-body' });

const name = process.env.COMMUNITY_NAME || 'Badminton Community';

export const metadata: Metadata = {
  title: name,
  description: `Book your ${name} slot`,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0a0b' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <header className="top">
          <Link href="/"><span className="dot" aria-hidden />{name}</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
