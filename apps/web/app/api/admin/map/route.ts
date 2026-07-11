import { NextResponse } from 'next/server';
import { AuthoredMap, Tile } from '@holdout/shared';
import { requireAdmin as admin } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await admin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const row = await prisma.gameMap.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } });
  return NextResponse.json({ map: row ? { id: row.id, name: row.name, data: row.data } : null });
}

const VALID_OBJECTS = new Set([
  'chest', 'chest_military', 'loot', 'zombie', 'military',
  'deer', 'rabbit', 'boar', 'wolf',
  'spawn', 'trader', 'trader_black', 'extract',
  'poi_town', 'poi_airport', 'poi_outpost', 'poi_hotzone',
]);

export async function POST(req: Request) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { name?: string; data?: AuthoredMap };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const data = body.data;
  const name = (body.name ?? 'Custom Map').slice(0, 60);
  if (!data || !Array.isArray(data.tiles) || !Array.isArray(data.objects))
    return NextResponse.json({ error: 'Invalid map data' }, { status: 400 });
  const w = data.w | 0;
  const h = data.h | 0;
  if (w < 20 || h < 20 || w > 200 || h > 200 || data.tiles.length !== w * h)
    return NextResponse.json({ error: 'Map must be 20-200 tiles per side' }, { status: 400 });
  if (data.objects.length > 2000)
    return NextResponse.json({ error: 'Too many objects' }, { status: 400 });

  // validate against the allowed palette — editor output is untrusted input
  const AUTHORABLE = new Set<number>([
    Tile.Grass, Tile.Water, Tile.Tree, Tile.Floor, Tile.Wall, Tile.Road,
    Tile.Sand, Tile.Rock, Tile.Asphalt, Tile.Bed, Tile.DoorMat,
    Tile.CopperOre, Tile.IronOre,
  ]);
  const tiles = data.tiles.map((t) => {
    const v = t | 0;
    return AUTHORABLE.has(v) ? v : Tile.Grass;
  });
  const objects = data.objects
    .filter((o) => o && VALID_OBJECTS.has(o.type) && Number.isFinite(o.x) && Number.isFinite(o.y))
    .map((o) => ({
      type: o.type,
      x: Math.max(0, Math.min(w - 1, o.x | 0)),
      y: Math.max(0, Math.min(h - 1, o.y | 0)),
      ...(o.name ? { name: String(o.name).slice(0, 40) } : {}),
      ...(o.r ? { r: Math.max(2, Math.min(40, o.r | 0)) } : {}),
    }));

  await prisma.gameMap.updateMany({ where: { active: true }, data: { active: false } });
  const row = await prisma.gameMap.create({
    data: { name, data: { w, h, tiles, objects }, active: true },
  });
  return NextResponse.json({ ok: true, id: row.id, note: 'Restart the game API to load the new map' });
}
