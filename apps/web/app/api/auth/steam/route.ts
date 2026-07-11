import { NextResponse } from 'next/server';

// Steam sign-in, step 1: bounce the browser to Steam's OpenID 2.0 endpoint.
// Steam redirects back to /api/auth/steam/callback with signed params.
export function GET(req: Request) {
  const origin = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/api/auth/steam/callback`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return NextResponse.redirect(`https://steamcommunity.com/openid/login?${params}`);
}
