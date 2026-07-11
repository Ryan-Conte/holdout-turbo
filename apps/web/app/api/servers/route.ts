import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Public server browser list. Auto-seeds a Local entry so dev always works. */
export async function GET() {
  let servers = await prisma.gameServer.findMany({
    where: { active: true },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, region: true, url: true },
  });
  if (servers.length === 0) {
    const local = await prisma.gameServer.create({
      data: { name: 'Local', region: 'dev', url: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001', sort: 0 },
    });
    servers = [{ id: local.id, name: local.name, region: local.region, url: local.url }];
  }
  return NextResponse.json({ servers });
}
