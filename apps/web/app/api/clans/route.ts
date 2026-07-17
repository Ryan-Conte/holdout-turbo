import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const MAX_MEMBERS = 40;
const ranks = new Set(['owner', 'officer', 'member']);

async function me() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

function clanName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return /^[A-Za-z0-9][A-Za-z0-9 '\-]{2,30}[A-Za-z0-9]$/.test(name) ? name : null;
}

function clanTag(value: unknown): string | null {
  const tag = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{2,6}$/.test(tag) ? tag : null;
}

async function membership(userId: string) {
  return prisma.clanMember.findUnique({
    where: { userId },
    include: {
      clan: {
        include: {
          members: { include: { user: { select: { id: true, name: true } } }, orderBy: [{ rank: 'asc' }, { joinedAt: 'asc' }] },
          invites: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
          ledger: { orderBy: { createdAt: 'desc' }, take: 12 },
        },
      },
    },
  });
}

function membershipJson(row: Awaited<ReturnType<typeof membership>>) {
  if (!row) return null;
  return {
    id: row.clan.id,
    name: row.clan.name,
    tag: row.clan.tag,
    rank: row.rank,
    treasury: row.clan.treasury,
    ledger: row.clan.ledger.map((entry) => ({
      id: entry.id,
      actor: entry.actorName,
      kind: entry.kind,
      amount: entry.amount,
      balance: entry.balance,
      createdAt: entry.createdAt,
    })),
    members: row.clan.members.map((member) => ({ id: member.user.id, name: member.user.name, rank: member.rank, joinedAt: member.joinedAt })),
    outgoingInvites: row.rank === 'owner'
      ? row.clan.invites.map((invite) => ({ id: invite.user.id, name: invite.user.name, createdAt: invite.createdAt }))
      : [],
  };
}

export async function GET() {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [row, invitations] = await Promise.all([
    membership(user.id),
    prisma.clanInvite.findMany({
      where: { userId: user.id },
      include: { clan: { select: { id: true, name: true, tag: true, _count: { select: { members: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return NextResponse.json({
    clan: membershipJson(row),
    invitations: row ? [] : invitations.map((invite) => ({
      clanId: invite.clan.id,
      name: invite.clan.name,
      tag: invite.clan.tag,
      members: invite.clan._count.members,
      createdAt: invite.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; name?: string; tag?: string; username?: string; clanId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  if (body.action === 'create') {
    const name = clanName(body.name);
    const tag = clanTag(body.tag);
    if (!name) return NextResponse.json({ error: 'Clan name must be 4-32 letters, numbers, spaces, apostrophes or hyphens' }, { status: 400 });
    if (!tag) return NextResponse.json({ error: 'Tag must be 2-6 letters or numbers' }, { status: 400 });
    if (await prisma.clanMember.findUnique({ where: { userId: user.id } })) return NextResponse.json({ error: 'Leave your current clan first' }, { status: 409 });
    const duplicate = await prisma.clan.findFirst({ where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { tag: { equals: tag, mode: 'insensitive' } }] }, select: { id: true } });
    if (duplicate) return NextResponse.json({ error: 'That clan name or tag is already claimed' }, { status: 409 });
    try {
      const clan = await prisma.$transaction(async (tx) => {
        const created = await tx.clan.create({ data: { name, tag } });
        await tx.clanMember.create({ data: { clanId: created.id, userId: user.id, rank: 'owner' } });
        await tx.clanInvite.deleteMany({ where: { userId: user.id } });
        return created;
      });
      return NextResponse.json({ ok: true, clanId: clan.id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That clan name or tag is already claimed' }, { status: 409 });
      throw error;
    }
  }

  if (body.action === 'invite') {
    const own = await membership(user.id);
    if (!own || own.rank !== 'owner') return NextResponse.json({ error: 'Only the clan owner can invite survivors' }, { status: 403 });
    if (own.clan.members.length >= MAX_MEMBERS) return NextResponse.json({ error: `Clan is full (${MAX_MEMBERS} members)` }, { status: 409 });
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const target = username ? await prisma.user.findFirst({ where: { name: { equals: username, mode: 'insensitive' } }, select: { id: true, name: true } }) : null;
    if (!target) return NextResponse.json({ error: 'No survivor with that callsign' }, { status: 404 });
    if (target.id === user.id) return NextResponse.json({ error: 'You already own this clan' }, { status: 400 });
    if (await prisma.clanMember.findUnique({ where: { userId: target.id } })) return NextResponse.json({ error: `${target.name} is already in a clan` }, { status: 409 });
    await prisma.clanInvite.upsert({
      where: { clanId_userId: { clanId: own.clanId, userId: target.id } },
      create: { clanId: own.clanId, userId: target.id, invitedBy: user.id },
      update: { invitedBy: user.id, createdAt: new Date() },
    });
    return NextResponse.json({ ok: true, name: target.name });
  }

  if (body.action === 'accept') {
    const clanId = typeof body.clanId === 'string' ? body.clanId : '';
    try {
      await prisma.$transaction(async (tx) => {
        if (await tx.clanMember.findUnique({ where: { userId: user.id } })) throw new Error('already-member');
        const invite = await tx.clanInvite.findUnique({ where: { clanId_userId: { clanId, userId: user.id } } });
        if (!invite) throw new Error('no-invite');
        const count = await tx.clanMember.count({ where: { clanId } });
        if (count >= MAX_MEMBERS) throw new Error('full');
        await tx.clanMember.create({ data: { clanId, userId: user.id, rank: 'member' } });
        await tx.clanInvite.deleteMany({ where: { userId: user.id } });
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'already-member') return NextResponse.json({ error: 'You are already in a clan' }, { status: 409 });
      if (message === 'no-invite') return NextResponse.json({ error: 'Invitation no longer exists' }, { status: 404 });
      if (message === 'full') return NextResponse.json({ error: 'That clan is full' }, { status: 409 });
      throw error;
    }
  }
  return NextResponse.json({ error: 'Unknown clan action' }, { status: 400 });
}

export async function PUT(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; memberId?: string; rank?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const own = await membership(user.id);
  if (!own || own.rank !== 'owner') return NextResponse.json({ error: 'Only the clan owner can manage ranks' }, { status: 403 });
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  if (!memberId || memberId === user.id) return NextResponse.json({ error: 'Choose another clan member' }, { status: 400 });
  const target = own.clan.members.find((member) => member.userId === memberId);
  if (!target) return NextResponse.json({ error: 'Clan member not found' }, { status: 404 });
  if (body.action === 'rank') {
    if (!ranks.has(body.rank ?? '') || body.rank === 'owner') return NextResponse.json({ error: 'Rank must be officer or member' }, { status: 400 });
    await prisma.clanMember.update({ where: { userId: memberId }, data: { rank: body.rank } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'transfer') {
    await prisma.$transaction([
      prisma.clanMember.update({ where: { userId: user.id }, data: { rank: 'officer' } }),
      prisma.clanMember.update({ where: { userId: memberId }, data: { rank: 'owner' } }),
    ]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown clan action' }, { status: 400 });
}

export async function DELETE(req: Request) {
  const user = await me();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { action?: string; memberId?: string; clanId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  if (body.action === 'decline') {
    const clanId = typeof body.clanId === 'string' ? body.clanId : '';
    await prisma.clanInvite.deleteMany({ where: { clanId, userId: user.id } });
    return NextResponse.json({ ok: true });
  }
  const own = await membership(user.id);
  if (!own) return NextResponse.json({ error: 'You are not in a clan' }, { status: 404 });
  if (body.action === 'leave') {
    if (own.rank === 'owner') return NextResponse.json({ error: 'Transfer ownership or disband the clan first' }, { status: 409 });
    await prisma.clanMember.delete({ where: { userId: user.id } });
    return NextResponse.json({ ok: true });
  }
  if (own.rank !== 'owner') return NextResponse.json({ error: 'Only the clan owner can do that' }, { status: 403 });
  if (body.action === 'remove') {
    const memberId = typeof body.memberId === 'string' ? body.memberId : '';
    if (!memberId || memberId === user.id) return NextResponse.json({ error: 'Choose another clan member' }, { status: 400 });
    const result = await prisma.clanMember.deleteMany({ where: { clanId: own.clanId, userId: memberId, rank: { not: 'owner' } } });
    if (!result.count) return NextResponse.json({ error: 'Clan member not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'cancel_invite') {
    const memberId = typeof body.memberId === 'string' ? body.memberId : '';
    await prisma.clanInvite.deleteMany({ where: { clanId: own.clanId, userId: memberId } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'disband') {
    await prisma.clan.delete({ where: { id: own.clanId } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown clan action' }, { status: 400 });
}
