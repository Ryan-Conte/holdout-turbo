import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { sanitizeCharacterAppearance } from '@holdout/shared';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.profile.findUnique({ where: { userId: user.id }, select: { data: true } });
  const data = (profile?.data ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    appearance: sanitizeCharacterAppearance(data.appearance, typeof data.look === 'number' ? data.look : 0),
    configured: Boolean(data.appearance),
  });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { appearance?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const appearance = sanitizeCharacterAppearance(body.appearance);
  const profile = await prisma.profile.findUnique({ where: { userId: user.id }, select: { data: true } });
  const existing = (profile?.data ?? {}) as Record<string, unknown>;
  const data = JSON.parse(JSON.stringify({ ...existing, appearance, look: appearance.outfit }));
  await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, data },
    update: { data, updatedAt: new Date() },
  });
  return NextResponse.json({ ok: true, appearance, configured: true });
}
