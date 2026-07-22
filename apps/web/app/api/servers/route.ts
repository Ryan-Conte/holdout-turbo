import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function isDevelopmentRelay(server: { name: string; region: string; url: string }) {
  if (server.region.toLowerCase() === 'dev' || server.name.toLowerCase() === 'local') return true;
  try {
    const hostname = new URL(server.url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/** Public server browser list. Local relays are development-only. */
export async function GET() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  let servers = await prisma.gameServer.findMany({
    where: { active: true },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, region: true, url: true },
  });
  if (!isDevelopment) {
    servers = servers.filter((server) => !isDevelopmentRelay(server));
  }
  if (isDevelopment && servers.length === 0) {
    const local = await prisma.gameServer.create({
      data: { name: 'Local', region: 'dev', url: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001', sort: 0 },
    });
    servers = [{ id: local.id, name: local.name, region: local.region, url: local.url }];
  }
  return NextResponse.json({ servers });
}
