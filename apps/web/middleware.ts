import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/editor') return NextResponse.redirect(new URL('/admin/map', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/editor'] };
