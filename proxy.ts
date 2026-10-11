import { NextResponse, type NextRequest } from 'next/server';
import { makeStaffToken, readStaffToken, STAFF_COOKIE, staffCookieOptions } from './lib/staff-token';

/** Slides the staff idle timeout forward on every page view, so the PIN is only asked again after inactivity. */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const token = readStaffToken(request.cookies.get(STAFF_COOKIE)?.value);
  if (token) response.cookies.set(STAFF_COOKIE, makeStaffToken(token.id, token.pinVersion), staffCookieOptions);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
