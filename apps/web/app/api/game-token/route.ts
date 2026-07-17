import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const GUEST_COOKIE = 'holdout_guest';
const GUEST_COOKIE_SECONDS = 6 * 60 * 60;

function signGuestId(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`holdout-guest:${id}`).digest('base64url');
}

function guestIdFromCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const expected = signGuestId(id, secret);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? id : null;
}

/** Exchange a Better Auth session, or a signed temporary guest identity, for a short-lived game JWT. */
export async function POST(request: Request) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const requested = await request.json().catch(() => ({})) as { serverUrl?: unknown; guest?: unknown };
  const serverUrl = typeof requested.serverUrl === 'string'
    ? requested.serverUrl.trim().replace(/\/$/, '').slice(0, 500)
    : '';
  if (serverUrl && !/^https?:\/\//i.test(serverUrl)) {
    return NextResponse.json({ error: 'Invalid game server' }, { status: 400 });
  }

  if (requested.guest === true) {
    const cookieStore = await cookies();
    const id = guestIdFromCookie(cookieStore.get(GUEST_COOKIE)?.value, secret) ?? randomUUID();
    const username = `Guest-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    const token = jwt.sign(
      { sub: `guest:${id}`, username, guest: true, serverUrl: serverUrl || undefined },
      secret,
      { expiresIn: '10m' },
    );
    const response = NextResponse.json({ token, guest: true, username });
    response.cookies.set(GUEST_COOKIE, `${id}.${signGuestId(id, secret)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GUEST_COOKIE_SECONDS,
    });
    return response;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: { bannedUntil: true, banReason: true },
  });
  if (access?.bannedUntil && access.bannedUntil.getTime() > Date.now()) {
    const reason = access.banReason ? ` Reason: ${access.banReason}` : '';
    return NextResponse.json(
      { error: `This survivor is suspended until ${access.bannedUntil.toISOString()}.${reason}` },
      { status: 403 },
    );
  }

  // This is an early, friendly rejection only; socket admission remains the
  // authoritative check. Unknown custom SERVER_STATE_KEY values intentionally
  // fall through so self-hosted servers are not rejected by the web tier.
  const lease = await prisma.playerWorldLease.findUnique({ where: { userId: session.user.id } });
  if (lease && lease.expiresAt.getTime() > Date.now() && serverUrl) {
    const servers = await prisma.gameServer.findMany({
      where: { active: true },
      select: { id: true, name: true, region: true, url: true },
    });
    const normalized = (value: string) => value.trim().replace(/\/$/, '').toLowerCase();
    const selected = servers.find((server) => normalized(server.url) === normalized(serverUrl));
    const leased = servers.find((server) => {
      const key = normalized(lease.serverKey).replace(/:staging$/, '');
      return key === normalized(server.url) || key === normalized(`${server.name}:${server.region}`);
    });
    if (selected && leased && selected.id !== leased.id) {
      return NextResponse.json(
        { error: `Your survivor is still active on ${leased.name}. Disconnect there or wait up to 45 seconds.` },
        { status: 409 },
      );
    }
  }
  const token = jwt.sign(
    { sub: session.user.id, username: session.user.name || session.user.email.split('@')[0], serverUrl: serverUrl || undefined },
    secret,
    { expiresIn: '10m' },
  );
  return NextResponse.json({ token });
}
