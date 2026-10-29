import { NextResponse, type NextRequest } from 'next/server';

// Log out, the same for everyone (players, core, admin): every RDx cookie is deleted and the browser is asked to
// clear this site's stored data too, so the next visit starts fresh. The visitor lands on the home page, where
// they can log in or register again.
// A POST from our own pages only (forms), so another site can't log people out with a link.

const COOKIES = ['pid', 'staff', 'claim', 'rdx-app', 'rdx-in', 'lang'];

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  for (const name of COOKIES) response.cookies.delete(name);
  response.headers.set('Clear-Site-Data', '"cookies", "storage"');
  return response;
}
