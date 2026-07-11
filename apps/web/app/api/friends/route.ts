import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function me() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** List friendships (accepted + pending, both directions). */
export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.friend.findMany({
    where: { OR: [{ userId: user.id }, { friendId: user.id }] },
  });
  const otherIds = [...new Set(rows.map((r) => (r.userId === user.id ? r.friendId : r.userId)))];
  // never expose email — usernames only
  const users = await prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u]));

  const map = new Map<string, { id: string; name: string; status: string; incoming: boolean }>();
  for (const r of rows) {
    const otherId = r.userId === user.id ? r.friendId : r.userId;
    const u = byId.get(otherId);
    if (!u) continue;
    const accepted = r.status === 'accepted';
    if (map.get(otherId)?.status === 'accepted') continue;
    map.set(otherId, {
      id: otherId,
      name: u.name,
      status: accepted ? 'accepted' : 'pending',
      incoming: !accepted && r.userId === otherId,
    });
  }
  return NextResponse.json({ me: { id: user.id, name: user.name }, friends: [...map.values()] });
}

/** Send a friend request by username (auto-accepts if they already requested you). */
export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const username = (body.username ?? '').trim();
  if (!username) return NextResponse.json({ error: 'Username required' }, { status: 400 });

  const target = await prisma.user.findFirst({ where: { name: { equals: username, mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!target) return NextResponse.json({ error: 'No survivor with that callsign' }, { status: 404 });
  if (target.id === user.id) return NextResponse.json({ error: 'That is you' }, { status: 400 });

  const incoming = await prisma.friend.findUnique({
    where: { userId_friendId: { userId: target.id, friendId: user.id } },
  });
  if (incoming) {
    await prisma.friend.update({
      where: { userId_friendId: { userId: target.id, friendId: user.id } },
      data: { status: 'accepted' },
    });
    await prisma.friend.upsert({
      where: { userId_friendId: { userId: user.id, friendId: target.id } },
      create: { userId: user.id, friendId: target.id, status: 'accepted' },
      update: { status: 'accepted' },
    });
    return NextResponse.json({ ok: true, status: 'accepted', name: target.name });
  }
  await prisma.friend.upsert({
    where: { userId_friendId: { userId: user.id, friendId: target.id } },
    create: { userId: user.id, friendId: target.id, status: 'pending' },
    update: {},
  });
  return NextResponse.json({ ok: true, status: 'pending', name: target.name });
}

/** Accept an incoming request: { id: <userId> } */
export async function PUT(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const other = (body.id ?? '').trim();
  if (!other) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const res = await prisma.friend.updateMany({
    where: { userId: other, friendId: user.id, status: 'pending' },
    data: { status: 'accepted' },
  });
  if (res.count === 0) return NextResponse.json({ error: 'No pending request from them' }, { status: 404 });
  await prisma.friend.upsert({
    where: { userId_friendId: { userId: user.id, friendId: other } },
    create: { userId: user.id, friendId: other, status: 'accepted' },
    update: { status: 'accepted' },
  });
  return NextResponse.json({ ok: true });
}
