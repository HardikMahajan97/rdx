import { NextResponse, type NextRequest } from 'next/server';
import { makeStaffToken, readStaffToken, STAFF_COOKIE, staffCookieOptions } from './lib/staff-token';

// One website: the promo pages (static files in public/site) and the booking app share this domain.
// The sign-in cookie is readable here, so `/` can pick the right one before anything renders.

/** Public promo pages, served from public/site (static, no server work). */
const PROMO: Record<string, string> = {
  '/about': '/site/about.html',
  '/play': '/site/play.html',
  '/membership': '/site/membership.html',
  '/news': '/site/news.html',
  '/join': '/site/join.html',
};

/** A "Join / Log in" button sends people to `/?app=1`; this cookie keeps them in the app for a while after (the ?msg notices drop the query). */
const APP_COOKIE = 'rdx-app';
const APP_COOKIE_SECONDS = 30 * 60;

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const jar = request.cookies;
  let response = NextResponse.next();

  if (pathname === '/site-admin') {
    // The announcements tool now lives on the main admin page.
    return NextResponse.redirect(new URL('/admin', request.url));
  }
  if (PROMO[pathname]) {
    response = NextResponse.rewrite(new URL(PROMO[pathname], request.url));
  } else if (pathname === '/' && searchParams.has('home')) {
    // The app's "Home" button: show the promo even to someone who is signed in.
    response = NextResponse.rewrite(new URL('/site/index.html', request.url));
    response.cookies.delete(APP_COOKIE);
  } else if (pathname === '/') {
    const wantsApp = searchParams.has('app') || searchParams.has('msg');
    // Anyone with a sign-in (or a sign-in in progress) goes to the app. Everyone else sees the promo home.
    const inApp = wantsApp || jar.has('pid') || jar.has('claim') || jar.has(APP_COOKIE);
    if (!inApp) response = NextResponse.rewrite(new URL('/site/index.html', request.url));
    else if (searchParams.has('app')) {
      response.cookies.set(APP_COOKIE, '1', { maxAge: APP_COOKIE_SECONDS, path: '/', sameSite: 'lax', secure: request.nextUrl.protocol === 'https:' });
    }
  }

  // Slides the staff idle timeout forward on every page view, so the PIN is only asked again after inactivity.
  const token = readStaffToken(jar.get(STAFF_COOKIE)?.value);
  if (token) response.cookies.set(STAFF_COOKIE, makeStaffToken(token.id, token.pinVersion), staffCookieOptions);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|site/).*)'],
};
