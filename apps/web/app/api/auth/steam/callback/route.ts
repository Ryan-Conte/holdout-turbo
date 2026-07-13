import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Steam sign-in, step 2: verify the OpenID assertion with Steam, then bridge
// the SteamID into a Better Auth account (shadow email + server-secret-derived
// password — never shown to anyone) and set the session cookies.

function steamPassword(steamId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? 'dev-secret';
  return createHmac('sha256', secret).update(`steam:${steamId}`).digest('hex');
}

async function personaName(steamId: string): Promise<string> {
  const key = process.env.STEAM_API_KEY;
  if (key) {
    try {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      const name = data?.response?.players?.[0]?.personaname;
      if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 16);
    } catch { /* fall through to a generated callsign */ }
  }
  return `Survivor${steamId.slice(-5)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.BETTER_AUTH_URL ?? url.origin;
  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/?steam_error=${encodeURIComponent(msg)}`);

  // 1. ask Steam to confirm the signed assertion (mode → check_authentication)
  const verify = new URLSearchParams();
  for (const [k, v] of url.searchParams) verify.set(k, v);
  verify.set('openid.mode', 'check_authentication');
  let valid = false;
  try {
    const res = await fetch('https://steamcommunity.com/openid/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verify.toString(),
      cache: 'no-store',
    });
    valid = (await res.text()).includes('is_valid:true');
  } catch {
    return fail('Could not reach Steam');
  }
  const claimed = url.searchParams.get('openid.claimed_id') ?? '';
  const steamId = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{5,25})$/.exec(claimed)?.[1];
  if (!valid || !steamId) return fail('Steam sign-in could not be verified');

  // 2. bridge into Better Auth: one shadow account per SteamID
  const email = `steam-${steamId}@steam.holdout.local`;
  const password = steamPassword(steamId);
  let headers: Headers;
  try {
    const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    headers = signIn.headers;
  } catch {
    try {
      const name = await personaName(steamId);
      const signUp = await auth.api.signUpEmail({ body: { email, password, name }, returnHeaders: true });
      headers = signUp.headers;
    } catch {
      return fail('Could not create the Steam-linked account');
    }
  }

  // 3. hand the session cookies to the browser and enter the game
  const res = NextResponse.redirect(`${origin}/`);
  for (const cookie of headers.getSetCookie()) res.headers.append('set-cookie', cookie);
  return res;
}
