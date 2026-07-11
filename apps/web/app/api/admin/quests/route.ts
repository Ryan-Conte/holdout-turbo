import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { ENEMY_DEFS, ITEMS } from '@holdout/shared';
import { auth, isAdminEmail } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function admin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !isAdminEmail(session.user.email)) return null;
  return session.user;
}

export async function GET() {
  const user = await admin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const quests = await prisma.quest.findMany({ orderBy: { id: 'asc' } });
  return NextResponse.json({ quests });
}

interface QuestBody {
  id?: number;
  name?: string;
  desc?: string;
  kind?: string;
  target?: string;
  count?: number;
  rewardMoney?: number;
  rewardItem?: string | null;
  rewardQty?: number;
  active?: boolean;
}

function validate(body: QuestBody) {
  const kind = body.kind === 'fetch' ? 'fetch' : 'kill';
  const target = String(body.target ?? '');
  if (kind === 'kill' && !(target in ENEMY_DEFS)) return 'Kill target must be: zombie or military';
  if (kind === 'fetch' && !(target in ITEMS)) return 'Fetch target must be a valid item id';
  if (body.rewardItem && !(body.rewardItem in ITEMS)) return 'Reward item must be a valid item id';
  if (!body.name?.trim()) return 'Name required';
  return null;
}

function toData(body: QuestBody) {
  return {
    name: String(body.name).slice(0, 60),
    desc: String(body.desc ?? '').slice(0, 200),
    kind: body.kind === 'fetch' ? 'fetch' : 'kill',
    target: String(body.target),
    count: Math.max(1, Math.min(999, Number(body.count) | 0 || 1)),
    rewardMoney: Math.max(0, Math.min(100000, Number(body.rewardMoney) | 0)),
    rewardItem: body.rewardItem || null,
    rewardQty: Math.max(1, Math.min(99, Number(body.rewardQty) | 0 || 1)),
    active: body.active !== false,
  };
}

/** Create (no id) or update (with id). Quests hot-reload into the game server within a minute. */
export async function POST(req: Request) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: QuestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const data = toData(body);
  const quest = body.id
    ? await prisma.quest.update({ where: { id: body.id | 0 }, data: { ...data, updatedAt: new Date() } })
    : await prisma.quest.create({ data });
  return NextResponse.json({ ok: true, quest });
}

export async function DELETE(req: Request) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.quest.delete({ where: { id: body.id | 0 } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
