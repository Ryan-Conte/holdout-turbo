import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import jwt from 'jsonwebtoken';
import { auth } from '@/lib/auth';

/** Exchange a Better Auth session for a short-lived JWT the game server accepts. */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const secret = process.env.JWT_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const token = jwt.sign(
    { sub: session.user.id, username: session.user.name || session.user.email.split('@')[0] },
    secret,
    { expiresIn: '10m' },
  );
  return NextResponse.json({ token });
}
