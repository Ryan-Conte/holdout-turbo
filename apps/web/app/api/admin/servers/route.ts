import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

/** Admin server-browser management: register game servers with regions. */
export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const servers = await prisma.gameServer.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
  return NextResponse.json({ servers });
}

interface ServerBody { id?: number; name?: string; region?: string; url?: string; active?: boolean; sort?: number }

export async function POST(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: ServerBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim().slice(0, 40);
  const region = String(body.region ?? 'local').trim().slice(0, 20);
  const url = String(body.url ?? '').trim().slice(0, 200);
  if (!body.id && (!name || !/^https?:\/\//.test(url))) {
    return NextResponse.json({ error: 'Name and a valid http(s) socket URL are required' }, { status: 400 });
  }
  const data = {
    ...(name ? { name } : {}),
    ...(region ? { region } : {}),
    ...(url ? { url } : {}),
    ...(body.active !== undefined ? { active: !!body.active } : {}),
    ...(body.sort !== undefined ? { sort: Number(body.sort) | 0 } : {}),
  };
  const server = body.id
    ? await prisma.gameServer.update({ where: { id: body.id | 0 }, data: { ...data, updatedAt: new Date() } })
    : await prisma.gameServer.create({ data: { name, region, url } });
  return NextResponse.json({ ok: true, server });
}

export async function DELETE(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.gameServer.delete({ where: { id: body.id | 0 } }).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
