import { NextResponse } from 'next/server';
import {
  AUTHORED_MAP_MAX_SIZE,
  AUTHORED_MAP_MIN_SIZE,
  AuthoredMap,
  MapObject,
  Tile,
  decodeAuthoredElevations,
  decodeAuthoredTiles,
  decodeTerrainRuns,
  encodeByteRuns,
  encodeTerrainRuns,
  isCompleteByteRuns,
} from '@holdout/shared';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';

const VALID_OBJECTS = new Set([
  'chest', 'chest_military', 'chest_custom', 'loot', 'zombie', 'military', 'mob',
  'deer', 'rabbit', 'boar', 'wolf', 'fox', 'bear', 'spawn', 'trader', 'trader_black',
  'extract', 'poi_town', 'poi_airport', 'poi_outpost', 'poi_hotzone', 'poi_zone',
]);
const ZONE_KINDS = new Set(['town', 'airport', 'outpost', 'wilds', 'hotzone']);

const AUTHORABLE = new Set<number>([
  Tile.Grass, Tile.Water, Tile.Tree, Tile.Floor, Tile.Wall, Tile.Road,
  Tile.Sand, Tile.Rock, Tile.Asphalt, Tile.Bed, Tile.DoorMat,
  Tile.CopperOre, Tile.IronOre, Tile.Cliff,
]);

const TERRAIN_ID_BY_TILE: Record<number, string> = {
  [Tile.Grass]: 'grass', [Tile.Water]: 'water', [Tile.Tree]: 'tree', [Tile.Floor]: 'floor', [Tile.Wall]: 'wall',
  [Tile.Road]: 'road', [Tile.Sand]: 'sand', [Tile.Rock]: 'rock', [Tile.Asphalt]: 'asphalt', [Tile.Bed]: 'bed',
  [Tile.DoorMat]: 'doormat', [Tile.CopperOre]: 'copper_ore', [Tile.IronOre]: 'iron_ore', [Tile.Cliff]: 'cliff',
};

function cleanMap(input: unknown, terrainDocument: unknown): AuthoredMap {
  const data = input as Partial<AuthoredMap> | null;
  if (!data || !Array.isArray(data.objects)) throw new Error('Invalid map data');
  const w = Number(data.w) | 0;
  const h = Number(data.h) | 0;
  const cellCount = w * h;
  const hasTiles = Array.isArray(data.tiles) && data.tiles.length === cellCount;
  if (w < AUTHORED_MAP_MIN_SIZE || h < AUTHORED_MAP_MIN_SIZE || w > AUTHORED_MAP_MAX_SIZE || h > AUTHORED_MAP_MAX_SIZE || (!hasTiles && !isCompleteByteRuns(data.tileRuns, cellCount))) {
    throw new Error(`Map must be ${AUTHORED_MAP_MIN_SIZE}-${AUTHORED_MAP_MAX_SIZE} tiles per side with a complete tile grid`);
  }
  if (data.objects.length > 10_000) throw new Error('Too many objects');
  const tiles = decodeAuthoredTiles(data as AuthoredMap);
  for (let index = 0; index < tiles.length; index++) if (!AUTHORABLE.has(tiles[index])) tiles[index] = Tile.Grass;
  const elevations = (Array.isArray(data.elevations) && data.elevations.length === cellCount) || isCompleteByteRuns(data.elevationRuns, cellCount)
    ? decodeAuthoredElevations(data as AuthoredMap)
    : new Uint8Array(cellCount);
  const objects = data.objects
    .filter((object): object is MapObject => Boolean(object && VALID_OBJECTS.has(object.type) && Number.isFinite(object.x) && Number.isFinite(object.y)))
    .map((object) => ({
      type: object.type,
      x: Math.max(0, Math.min(w - 1, Number(object.x) | 0)),
      y: Math.max(0, Math.min(h - 1, Number(object.y) | 0)),
      ...(object.name ? { name: String(object.name).slice(0, 40) } : {}),
      ...(object.r ? { r: Math.max(2, Math.min(500, Number(object.r) | 0)) } : {}),
      ...(object.contentId ? { contentId: String(object.contentId).replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) } : {}),
      ...(object.lootTable ? { lootTable: String(object.lootTable).replace(/[^a-z0-9_-]/gi, '_').slice(0, 50) } : {}),
      ...(object.respawnMs ? { respawnMs: Math.max(1000, Math.min(86_400_000, Number(object.respawnMs) | 0)) } : {}),
      ...(object.zoneKind && ZONE_KINDS.has(object.zoneKind) ? { zoneKind: object.zoneKind } : {}),
      ...(object.type === 'poi_zone' ? { safe: Boolean(object.safe), hot: Boolean(object.hot) } : {}),
    }));
  const terrainDefs = terrainDocument && typeof terrainDocument === 'object' && !Array.isArray(terrainDocument)
    ? terrainDocument as Record<string, { simulationTile?: number }>
    : {};
  const terrain: Record<string, string> = {};
  const incomingTerrain = {
    ...decodeTerrainRuns(data.terrainRuns, cellCount),
    ...(data.terrain && typeof data.terrain === 'object' ? data.terrain : {}),
  };
  if (Object.keys(incomingTerrain).length) {
    for (const [rawIndex, rawId] of Object.entries(incomingTerrain)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= w * h || typeof rawId !== 'string') continue;
      const id = rawId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      if (!id) continue;
      const definition = terrainDefs[id];
      if (Object.keys(terrainDefs).length && !definition) throw new Error(`Unknown terrain definition: ${id}`);
      if (id !== (TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass')) terrain[String(index)] = id;
      else delete terrain[String(index)];
      if (definition && AUTHORABLE.has(Number(definition.simulationTile) | 0)) tiles[index] = Number(definition.simulationTile) | 0;
    }
  }
  const resources: Record<string, string> = {};
  if (data.resources && typeof data.resources === 'object') {
    for (const [rawIndex, rawId] of Object.entries(data.resources)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= w * h || typeof rawId !== 'string') continue;
      if (![Tile.Tree, Tile.Rock, Tile.CopperOre, Tile.IronOre].includes(tiles[index])) continue;
      const id = rawId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      if (id) resources[String(index)] = id;
    }
  }
  const blocks: Record<string, string> = {};
  const blockRotations: Record<string, number> = {};
  if (data.blocks && typeof data.blocks === 'object') {
    for (const [rawIndex, rawId] of Object.entries(data.blocks)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= w * h || typeof rawId !== 'string') continue;
      const id = rawId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      if (id) {
        blocks[String(index)] = id;
        const rotation = Number(data.blockRotations?.[String(index)]) | 0;
        if (rotation) blockRotations[String(index)] = ((rotation % 4) + 4) % 4;
      }
    }
  }
  return {
    w,
    h,
    tileRuns: encodeByteRuns(tiles),
    elevationRuns: encodeByteRuns(elevations),
    terrainRuns: encodeTerrainRuns(terrain),
    resources,
    blocks,
    blockRotations,
    objects,
  };
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const [draft, published, revisions] = await Promise.all([
    prisma.gameMap.findFirst({
      where: { draft: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, data: true, draft: true },
    }),
    prisma.gameMap.findFirst({
      where: { active: true, draft: false },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, updatedAt: true },
    }),
    prisma.gameMap.findMany({
      where: { draft: false },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, name: true, active: true, updatedAt: true },
    }),
  ]);
  const selected = draft ?? (published
    ? await prisma.gameMap.findUnique({
      where: { id: published.id },
      select: { id: true, name: true, data: true, draft: true },
    })
    : null);
  return NextResponse.json({
    map: selected ? { id: selected.id, name: selected.name, data: selected.data, draft: selected.draft } : null,
    published: published ? { id: published.id, name: published.name, updatedAt: published.updatedAt } : null,
    revisions,
  });
}

export async function PUT(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { id?: number; name?: string; data?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  let data: AuthoredMap;
  const terrainContent = await prisma.gameContent.findUnique({ where: { kind: 'terrain' } });
  try { data = cleanMap(body.data, terrainContent?.draft); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const name = String(body.name ?? 'Custom Map').trim().slice(0, 60) || 'Custom Map';
  const existing = body.id ? await prisma.gameMap.findFirst({ where: { id: body.id | 0, draft: true }, select: { id: true } }) : null;
  const row = existing
    ? await prisma.gameMap.update({ where: { id: existing.id }, data: { name, data: data as object, updatedAt: new Date() } })
    : await prisma.gameMap.create({ data: { name, data: data as object, active: false, draft: true } });
  return NextResponse.json({ ok: true, id: row.id, updatedAt: row.updatedAt });
}

export async function POST(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { id?: number } = {};
  try { body = await req.json(); } catch { /* omitted body publishes the newest draft */ }
  const draft = body.id
    ? await prisma.gameMap.findFirst({ where: { id: body.id | 0, draft: true } })
    : await prisma.gameMap.findFirst({ where: { draft: true }, orderBy: { updatedAt: 'desc' } });
  if (!draft) return NextResponse.json({ error: 'Save a map draft before publishing' }, { status: 409 });
  let data: AuthoredMap;
  const terrainContent = await prisma.gameContent.findUnique({ where: { kind: 'terrain' } });
  try { data = cleanMap(draft.data, terrainContent?.published); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const row = await prisma.$transaction(async (tx) => {
    await tx.gameMap.updateMany({ where: { active: true }, data: { active: false } });
    return tx.gameMap.create({ data: { name: draft.name, data: data as object, active: true, draft: false } });
  });
  return NextResponse.json({ ok: true, id: row.id, publishedAt: row.updatedAt, note: 'Game servers poll for this revision.' });
}

export async function PATCH(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  let body: { id?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const id = Math.floor(Number(body.id));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Choose a map revision' }, { status: 400 });
  const revision = await prisma.gameMap.findFirst({ where: { id, draft: false } });
  if (!revision) return NextResponse.json({ error: 'Map revision not found' }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.gameMap.updateMany({ where: { active: true }, data: { active: false } });
    await tx.gameMap.update({ where: { id }, data: { active: true, updatedAt: new Date() } });
  });
  return NextResponse.json({ ok: true, id, restoredAt: new Date() });
}
