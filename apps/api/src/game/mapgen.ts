import {
  AUTHORED_MAP_MAX_SIZE,
  AUTHORED_MAP_MIN_SIZE,
  AuthoredMap,
  COPPER_CHANCE,
  EnemyKind,
  IRON_CHANCE,
  MAP_H,
  MAP_W,
  PoiSnap,
  TILE,
  Tile,
  TraderTier,
  decodeAuthoredElevations,
  decodeAuthoredTiles,
  decodeTerrainRuns,
} from '@holdout/shared';

export type ChestTier = 'normal' | 'military' | 'rare';

export interface GeneratedMap {
  seed: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  elevations: Uint8Array;
  terrainKinds: Record<string, string>;
  resourceKinds: Record<string, string>;
  blockKinds: Record<string, string>;
  blockRotations: Record<string, number>;
  chestSpots: { x: number; y: number; tier: ChestTier; lootTable?: string }[]; // pixel centers
  lootSpots: { x: number; y: number }[];
  spawns: { x: number; y: number }[];
  pois: PoiSnap[];
  traders: { x: number; y: number; tier?: TraderTier }[];
  extracts: { x: number; y: number }[];
  enemySpawns: { x: number; y: number; kind: EnemyKind; respawnMs?: number }[];
}

export const TERRAIN_ID_BY_TILE: Record<number, string> = {
  [Tile.Grass]: 'grass', [Tile.Water]: 'water', [Tile.Tree]: 'tree', [Tile.Floor]: 'floor',
  [Tile.Wall]: 'wall', [Tile.Road]: 'road', [Tile.Sand]: 'sand', [Tile.Rock]: 'rock',
  [Tile.Asphalt]: 'asphalt', [Tile.Bed]: 'bed', [Tile.DoorMat]: 'doormat',
  [Tile.CopperOre]: 'copper_ore', [Tile.IronOre]: 'iron_ore', [Tile.Cliff]: 'cliff',
};

export function terrainKindsFromTiles(tiles: ArrayLike<number>): Record<string, string> {
  const terrain: Record<string, string> = {};
  for (let index = 0; index < tiles.length; index++) terrain[String(index)] = TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
  return terrain;
}

export function resourceKindsFromTiles(tiles: ArrayLike<number>): Record<string, string> {
  const resources: Record<string, string> = {};
  for (let index = 0; index < tiles.length; index++) {
    const id = tiles[index] === Tile.Tree ? 'tree'
      : tiles[index] === Tile.Rock || tiles[index] === Tile.CopperOre || tiles[index] === Tile.IronOre ? 'rock'
        : '';
    if (id) resources[String(index)] = id;
  }
  return resources;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOWN_NAMES = ['Milton', 'Ashford', 'Grayson', 'Duskvale', 'Emberton'];

const px = (t: number) => t * TILE + TILE / 2;

export function generateMap(seed = (Math.random() * 2 ** 31) | 0): GeneratedMap {
  const rnd = mulberry32(seed);
  const W = MAP_W;
  const H = MAP_H;
  const t = new Uint8Array(W * H).fill(Tile.Grass);
  const elevations = new Uint8Array(W * H);
  const idx = (x: number, y: number) => y * W + x;
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const chestSpots: GeneratedMap['chestSpots'] = [];
  const enemySpawns: GeneratedMap['enemySpawns'] = [];
  const pois: PoiSnap[] = [];
  const traders: GeneratedMap['traders'] = [];
  const buildingRects: { x: number; y: number; w: number; h: number }[] = [];

  // lakes + shore
  for (let l = 0, lakes = ri(2, 3); l < lakes; l++) {
    const cx = ri(12, W - 13);
    const cy = ri(12, H - 13);
    for (let b = 0, blobs = ri(3, 6); b < blobs; b++) {
      const bx = cx + ri(-4, 4);
      const by = cy + ri(-4, 4);
      const r = ri(2, 5);
      for (let y = by - r; y <= by + r; y++)
        for (let x = bx - r; x <= bx + r; x++)
          if (inB(x, y) && (x - bx) ** 2 + (y - by) ** 2 <= r * r) t[idx(x, y)] = Tile.Water;
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (t[idx(x, y)] !== Tile.Grass) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inB(x + dx, y + dy) && t[idx(x + dx, y + dy)] === Tile.Water) { near = true; break; }
      if (near) t[idx(x, y)] = Tile.Sand;
    }

  const areaClear = (bx: number, by: number, w: number, h: number, margin = 2) => {
    for (let y = by - margin; y < by + h + margin; y++)
      for (let x = bx - margin; x < bx + w + margin; x++) {
        if (!inB(x, y)) return false;
        const v = t[idx(x, y)];
        if (v !== Tile.Grass && v !== Tile.Road && v !== Tile.Sand) return false;
      }
    return true;
  };

  const stampBuilding = (bx: number, by: number, w: number, h: number, doorWidth: number, tier: ChestTier, chests: number) => {
    const interior: { x: number; y: number }[] = [];
    for (let y = by; y < by + h; y++)
      for (let x = bx; x < bx + w; x++) {
        const edge = x === bx || y === by || x === bx + w - 1 || y === by + h - 1;
        t[idx(x, y)] = edge ? Tile.Wall : Tile.Floor;
        if (!edge) interior.push({ x, y });
      }
    for (let d = 0, doors = ri(1, 2); d < doors; d++) {
      const side = ri(0, 3);
      const along = side < 2 ? ri(1, w - 1 - doorWidth) : ri(1, h - 1 - doorWidth);
      for (let k = 0; k < doorWidth; k++) {
        if (side === 0) t[idx(bx + along + k, by)] = Tile.Floor;
        else if (side === 1) t[idx(bx + along + k, by + h - 1)] = Tile.Floor;
        else if (side === 2) t[idx(bx, by + along + k)] = Tile.Floor;
        else t[idx(bx + w - 1, by + along + k)] = Tile.Floor;
      }
    }
    for (let c = 0; c < chests && interior.length > 0; c++) {
      const i = ri(0, interior.length - 1);
      const cell = interior.splice(i, 1)[0];
      chestSpots.push({ x: px(cell.x), y: px(cell.y), tier });
    }
    buildingRects.push({ x: bx, y: by, w, h });
  };

  // ── TRADER OUTPOST (safe zone) near the map center
  const oX = ri(42, 52);
  const oY = ri(42, 52);
  {
    // walled compound with two gates
    const w = 12, h = 10;
    for (let y = oY; y < oY + h; y++)
      for (let x = oX; x < oX + w; x++) {
        const edge = x === oX || y === oY || x === oX + w - 1 || y === oY + h - 1;
        t[idx(x, y)] = edge ? Tile.Wall : Tile.Road;
      }
    // gates south + east
    t[idx(oX + 5, oY + h - 1)] = Tile.Road;
    t[idx(oX + 6, oY + h - 1)] = Tile.Road;
    t[idx(oX + w - 1, oY + 4)] = Tile.Road;
    t[idx(oX + w - 1, oY + 5)] = Tile.Road;
    // trader hut
    for (let y = oY + 2; y < oY + 5; y++)
      for (let x = oX + 2; x < oX + 6; x++) t[idx(x, y)] = Tile.Floor;
    // door mats mark the hideout entrance corner
    t[idx(oX + 9, oY + 2)] = Tile.DoorMat;
    traders.push({ x: px(oX + 3), y: px(oY + 3) });
    buildingRects.push({ x: oX, y: oY, w, h });
    pois.push({ name: 'Waypoint Outpost', kind: 'outpost', x: px(oX + 6), y: px(oY + 5), r: 9 * TILE, safe: true });
  }

  // ── TOWN
  const townCx = ri(20, 34);
  const townCy = ri(20, H - 21);
  {
    for (let x = townCx - 14; x <= townCx + 14; x++)
      for (let w = 0; w < 2; w++)
        if (inB(x, townCy + w) && t[idx(x, townCy + w)] !== Tile.Water) t[idx(x, townCy + w)] = Tile.Road;
    for (let y = townCy - 14; y <= townCy + 14; y++)
      for (let w = 0; w < 2; w++)
        if (inB(townCx + w, y) && t[idx(townCx + w, y)] !== Tile.Water) t[idx(townCx + w, y)] = Tile.Road;

    for (let attempt = 0, placed = 0; attempt < 300 && placed < 7; attempt++) {
      const w = ri(6, 10);
      const h = ri(5, 8);
      const bx = townCx + ri(-14, 14 - w);
      const by = townCy + ri(-14, 14 - h);
      if (!inB(bx - 2, by - 2) || !inB(bx + w + 2, by + h + 2)) continue;
      if (!areaClear(bx, by, w, h, 1)) continue;
      stampBuilding(bx, by, w, h, 1, rnd() < 0.2 ? 'military' : 'normal', ri(1, 2));
      placed++;
    }
    pois.push({ name: TOWN_NAMES[ri(0, TOWN_NAMES.length - 1)], kind: 'town', x: px(townCx), y: px(townCy), r: 15 * TILE });
    for (let i = 0; i < 8; i++)
      enemySpawns.push({ x: px(townCx + ri(-12, 12)), y: px(townCy + ri(-12, 12)), kind: 'zombie' });
  }

  // ── AIRPORT
  const airX = ri(62, 72);
  const airY = ri(16, H - 36);
  {
    for (let x = airX - 4; x < airX + 26; x++)
      for (let y = airY + 14; y < airY + 18; y++)
        if (inB(x, y)) t[idx(x, y)] = Tile.Asphalt;
    for (let y = airY + 8; y < airY + 14; y++)
      for (let x = airX + 4; x < airX + 7; x++)
        if (inB(x, y)) t[idx(x, y)] = Tile.Asphalt;

    for (const hg of [
      { bx: airX, by: airY, w: 12, h: 8 },
      { bx: airX + 14, by: airY, w: 12, h: 8 },
    ]) {
      for (let y = hg.by - 1; y < hg.by + hg.h + 1; y++)
        for (let x = hg.bx - 1; x < hg.bx + hg.w + 1; x++)
          if (inB(x, y) && (t[idx(x, y)] === Tile.Water || t[idx(x, y)] === Tile.Sand)) t[idx(x, y)] = Tile.Grass;
      stampBuilding(hg.bx, hg.by, hg.w, hg.h, 3, 'military', ri(2, 3));
    }
    for (let i = 0; i < 3; i++)
      chestSpots.push({ x: px(airX + ri(0, 20)), y: px(airY + ri(15, 16)), tier: 'military' });

    // the airport is the high-loot zone: rare chests, harder enemies, black-market dealer
    pois.push({ name: 'Redfield Airport', kind: 'airport', x: px(airX + 11), y: px(airY + 9), r: 17 * TILE, hot: true });
    for (let i = 0; i < 6; i++)
      enemySpawns.push({ x: px(airX + ri(-2, 24)), y: px(airY + ri(-2, 20)), kind: 'military' });
    traders.push({ x: px(airX + 8), y: px(airY + 15), tier: 2 }); // trades in the open — risky business
  }

  // road: town → outpost → airport
  const carveRoad = (x1: number, y1: number, x2: number, y2: number) => {
    let cx = x1;
    while (cx !== x2) {
      cx += Math.sign(x2 - cx);
      for (let w = 0; w < 2; w++)
        if (inB(cx, y1 + w) && (t[idx(cx, y1 + w)] === Tile.Grass || t[idx(cx, y1 + w)] === Tile.Sand)) t[idx(cx, y1 + w)] = Tile.Road;
    }
    let cy = y1;
    while (cy !== y2) {
      cy += Math.sign(y2 - cy);
      for (let w = 0; w < 2; w++)
        if (inB(x2 + w, cy) && (t[idx(x2 + w, cy)] === Tile.Grass || t[idx(x2 + w, cy)] === Tile.Sand)) t[idx(x2 + w, cy)] = Tile.Road;
    }
  };
  carveRoad(townCx, townCy, oX + 5, oY + 10);
  carveRoad(oX + 12, oY + 5, airX + 11, airY + 16);

  // scattered farms
  for (let attempt = 0, placed = 0; attempt < 200 && placed < 5; attempt++) {
    const w = ri(7, 11);
    const h = ri(6, 9);
    const bx = ri(4, W - w - 4);
    const by = ri(4, H - h - 4);
    if (!areaClear(bx, by, w, h)) continue;
    stampBuilding(bx, by, w, h, 1, rnd() < 0.1 ? 'military' : 'normal', ri(1, 2));
    placed++;
  }

  const nearBuilding = (x: number, y: number, pad: number) =>
    buildingRects.some((b) => x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad);

  // rock clusters — a rock has a rare chance to spawn ore-veined instead
  for (let c = 0; c < 9; c++) {
    for (let tries = 0; tries < 60; tries++) {
      const cx = ri(4, W - 5);
      const cy = ri(4, H - 5);
      if (t[idx(cx, cy)] !== Tile.Grass || nearBuilding(cx, cy, 2)) continue;
      for (let i = 0, n = ri(3, 6); i < n; i++) {
        const x = cx + ri(-2, 2);
        const y = cy + ri(-2, 2);
        if (inB(x, y) && t[idx(x, y)] === Tile.Grass && !nearBuilding(x, y, 1)) {
          const roll = rnd();
          t[idx(x, y)] = roll < IRON_CHANCE ? Tile.IronOre : roll < IRON_CHANCE + COPPER_CHANCE ? Tile.CopperOre : Tile.Rock;
        }
      }
      break;
    }
  }

  // outdoor chests
  for (let c = 0; c < 8; c++) {
    for (let tries = 0; tries < 50; tries++) {
      const x = ri(3, W - 4);
      const y = ri(3, H - 4);
      if (t[idx(x, y)] === Tile.Grass && !nearBuilding(x, y, 1)) {
        chestSpots.push({ x: px(x), y: px(y), tier: 'normal' });
        break;
      }
    }
  }

  // trees
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const border = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
      if (t[idx(x, y)] !== Tile.Grass) continue;
      if (border) { t[idx(x, y)] = Tile.Tree; continue; }
      if (!nearBuilding(x, y, 2) && rnd() < 0.05) t[idx(x, y)] = Tile.Tree;
    }

  // wild zombies
  for (let i = 0; i < 5; i++) {
    for (let tries = 0; tries < 60; tries++) {
      const x = ri(6, W - 7);
      const y = ri(6, H - 7);
      const far = pois.every((p) => Math.hypot(px(x) - p.x, px(y) - p.y) > p.r + 8 * TILE);
      if (t[idx(x, y)] === Tile.Grass && far && !nearBuilding(x, y, 2)) {
        enemySpawns.push({ x: px(x), y: px(y), kind: 'zombie' });
        break;
      }
    }
  }

  // Wildlife keeps travel lanes alive: small game flees, territorial animals
  // punish careless routing, and apex bears make deep forest valuable/risky.
  const wildlife: { kind: EnemyKind; count: number; poiPad: number }[] = [
    { kind: 'deer', count: 8, poiPad: 4 },
    { kind: 'rabbit', count: 10, poiPad: 3 },
    { kind: 'boar', count: 5, poiPad: 5 },
    { kind: 'wolf', count: 4, poiPad: 10 },
    { kind: 'fox', count: 6, poiPad: 5 },
    { kind: 'bear', count: 2, poiPad: 14 },
    { kind: 'moose', count: 3, poiPad: 9 },
    { kind: 'raccoon', count: 7, poiPad: 4 },
    { kind: 'cougar', count: 2, poiPad: 14 },
  ];
  for (const w of wildlife) {
    for (let i = 0; i < w.count; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const x = ri(6, W - 7);
        const y = ri(6, H - 7);
        const far = pois.every((p) => Math.hypot(px(x) - p.x, px(y) - p.y) > p.r + w.poiPad * TILE);
        if (t[idx(x, y)] === Tile.Grass && far && !nearBuilding(x, y, 2)) {
          enemySpawns.push({ x: px(x), y: px(y), kind: w.kind });
          break;
        }
      }
    }
  }

  // ground loot spots
  const lootSpots: { x: number; y: number }[] = [];
  for (let c = 0; c < 70; c++) {
    for (let tries = 0; tries < 50; tries++) {
      const x = ri(3, W - 4);
      const y = ri(3, H - 4);
      const v = t[idx(x, y)];
      if (v === Tile.Grass || v === Tile.Road || v === Tile.Floor || v === Tile.Sand || v === Tile.Asphalt) {
        lootSpots.push({ x: px(x) + (rnd() - 0.5) * 10, y: px(y) + (rnd() - 0.5) * 10 });
        break;
      }
    }
  }

  // player spawns
  const spawns: { x: number; y: number }[] = [];
  for (let tries = 0; tries < 3000 && spawns.length < 30; tries++) {
    const x = ri(4, W - 5);
    const y = ri(4, H - 5);
    if (t[idx(x, y)] !== Tile.Grass || nearBuilding(x, y, 4)) continue;
    const safe = enemySpawns.every((e) => Math.hypot(px(x) - e.x, px(y) - e.y) > 12 * TILE);
    if (safe) spawns.push({ x: px(x), y: px(y) });
  }
  if (spawns.length === 0) spawns.push({ x: px(W >> 1), y: px(H >> 1) });

  // extraction beacons — one per map quadrant edge, away from POIs
  const extracts = placeExtracts(t, W, H, pois);

  // Broad elevation fields make the procedural wilderness three-dimensional.
  // Most rings rise one level at a time; occasional mesas have a steep face.
  for (let hill = 0; hill < 7; hill++) {
    let cx = ri(12, W - 13); let cy = ri(12, H - 13);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (pois.every((poi) => Math.hypot(px(cx) - poi.x, px(cy) - poi.y) > poi.r + 12 * TILE)) break;
      cx = ri(12, W - 13); cy = ri(12, H - 13);
    }
    const radius = ri(8, 15);
    const mesa = hill % 3 === 0;
    for (let y = Math.max(1, cy - radius); y <= Math.min(H - 2, cy + radius); y++) for (let x = Math.max(1, cx - radius); x <= Math.min(W - 2, cx + radius); x++) {
      if (t[idx(x, y)] === Tile.Water) continue;
      const distance = Math.hypot((x - cx) * (0.82 + rnd() * .04), y - cy) / radius;
      const level = mesa ? distance < .34 ? 3 : distance < .78 ? 1 : 0 : distance < .3 ? 3 : distance < .58 ? 2 : distance < .88 ? 1 : 0;
      elevations[idx(x, y)] = Math.max(elevations[idx(x, y)], level);
    }
  }
  for (const point of [...spawns, ...extracts]) {
    const cx = Math.floor(point.x / TILE); const cy = Math.floor(point.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inB(cx + dx, cy + dy)) elevations[idx(cx + dx, cy + dy)] = 0;
  }

  return { seed, w: W, h: H, tiles: t, elevations, terrainKinds: terrainKindsFromTiles(t), resourceKinds: resourceKindsFromTiles(t), blockKinds: {}, blockRotations: {}, chestSpots, lootSpots, spawns, pois, traders, extracts, enemySpawns };
}

/** Find grass tiles near the four map edges for extraction beacons. */
function placeExtracts(t: Uint8Array, W: number, H: number, pois: PoiSnap[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const anchors = [
    { x: W >> 1, y: 5 }, // north
    { x: W - 6, y: H >> 1 }, // east
    { x: W >> 1, y: H - 6 }, // south
    { x: 5, y: H >> 1 }, // west
  ];
  for (const a of anchors) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const x = a.x + dx;
        const y = a.y + dy;
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue;
        if (t[y * W + x] !== Tile.Grass) continue;
        if (pois.some((p) => Math.hypot(px(x) - p.x, px(y) - p.y) < p.r + 4 * TILE)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x: px(x), y: px(y) }; }
      }
    if (best) out.push(best);
  }
  return out;
}

/** Convert an editor-authored map into the runtime structure (validating tiles). */
export function fromAuthored(map: AuthoredMap): GeneratedMap {
  const W = Math.max(AUTHORED_MAP_MIN_SIZE, Math.min(AUTHORED_MAP_MAX_SIZE, map.w | 0));
  const H = Math.max(AUTHORED_MAP_MIN_SIZE, Math.min(AUTHORED_MAP_MAX_SIZE, map.h | 0));
  const tiles = new Uint8Array(W * H).fill(Tile.Grass);
  const authoredTiles = decodeAuthoredTiles({ ...map, w: W, h: H });
  const elevations = decodeAuthoredElevations({ ...map, w: W, h: H });
  // editor may paint terrain + resource nodes; structures/stations stay player-built
  const AUTHORABLE = new Set<number>([
    Tile.Grass, Tile.Water, Tile.Tree, Tile.Floor, Tile.Wall, Tile.Road,
    Tile.Sand, Tile.Rock, Tile.Asphalt, Tile.Bed, Tile.DoorMat,
    Tile.CopperOre, Tile.IronOre, Tile.Cliff,
  ]);
  for (let i = 0; i < W * H; i++) {
    const v = authoredTiles[i] | 0;
    tiles[i] = AUTHORABLE.has(v) ? v : Tile.Grass;
  }

  const out: GeneratedMap = {
    seed: 0,
    w: W,
    h: H,
    tiles,
    elevations,
    terrainKinds: {},
    resourceKinds: {},
    blockKinds: {},
    blockRotations: {},
    chestSpots: [],
    lootSpots: [],
    spawns: [],
    pois: [],
    traders: [],
    extracts: [],
    enemySpawns: [],
  };

  const authoredTerrain = { ...decodeTerrainRuns(map.terrainRuns, W * H), ...(map.terrain ?? {}) };
  if (Object.keys(authoredTerrain).length) {
    for (const [rawIndex, terrainId] of Object.entries(authoredTerrain)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= W * H || typeof terrainId !== 'string' || !terrainId) continue;
      out.terrainKinds[String(index)] = terrainId.slice(0, 50);
    }
  }
  if (map.resources && typeof map.resources === 'object') {
    for (const [rawIndex, resourceId] of Object.entries(map.resources)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= W * H || typeof resourceId !== 'string' || !resourceId) continue;
      if (![Tile.Tree, Tile.Rock, Tile.CopperOre, Tile.IronOre].includes(tiles[index])) continue;
      out.resourceKinds[String(index)] = resourceId.slice(0, 50);
    }
  }
  // Legacy authored maps inferred resources from their tile layer. Once a map
  // has explicit resource IDs, that catalog is authoritative and broad terrain
  // regions must not silently become thousands of extra harvest nodes.
  if (Object.keys(out.resourceKinds).length === 0) {
    out.resourceKinds = resourceKindsFromTiles(tiles);
  }
  if (map.blocks && typeof map.blocks === 'object') {
    for (const [rawIndex, blockId] of Object.entries(map.blocks)) {
      const index = Number(rawIndex) | 0;
      if (index < 0 || index >= W * H || typeof blockId !== 'string' || !blockId) continue;
      out.blockKinds[String(index)] = blockId.slice(0, 50);
      const rotation = Number(map.blockRotations?.[String(index)]) | 0;
      if (rotation) out.blockRotations[String(index)] = ((rotation % 4) + 4) % 4;
    }
  }

  for (const o of Array.isArray(map.objects) ? map.objects : []) {
    const x = Math.max(0, Math.min(W - 1, o.x | 0));
    const y = Math.max(0, Math.min(H - 1, o.y | 0));
    const cx = px(x);
    const cy = px(y);
    switch (o.type) {
      case 'chest': out.chestSpots.push({ x: cx, y: cy, tier: 'normal' }); break;
      case 'chest_military': out.chestSpots.push({ x: cx, y: cy, tier: 'military' }); break;
      case 'chest_custom': out.chestSpots.push({ x: cx, y: cy, tier: 'normal', lootTable: o.lootTable || 'chest' }); break;
      case 'loot': out.lootSpots.push({ x: cx, y: cy }); break;
      case 'zombie': out.enemySpawns.push({ x: cx, y: cy, kind: 'zombie' }); break;
      case 'military': out.enemySpawns.push({ x: cx, y: cy, kind: 'military' }); break;
      case 'deer': out.enemySpawns.push({ x: cx, y: cy, kind: 'deer' }); break;
      case 'rabbit': out.enemySpawns.push({ x: cx, y: cy, kind: 'rabbit' }); break;
      case 'boar': out.enemySpawns.push({ x: cx, y: cy, kind: 'boar' }); break;
      case 'wolf': out.enemySpawns.push({ x: cx, y: cy, kind: 'wolf' }); break;
      case 'fox': out.enemySpawns.push({ x: cx, y: cy, kind: 'fox' }); break;
      case 'bear': out.enemySpawns.push({ x: cx, y: cy, kind: 'bear' }); break;
      case 'moose': out.enemySpawns.push({ x: cx, y: cy, kind: 'moose' }); break;
      case 'raccoon': out.enemySpawns.push({ x: cx, y: cy, kind: 'raccoon' }); break;
      case 'cougar': out.enemySpawns.push({ x: cx, y: cy, kind: 'cougar' }); break;
      case 'mob': out.enemySpawns.push({ x: cx, y: cy, kind: o.contentId || 'zombie', respawnMs: o.respawnMs }); break;
      case 'spawn': out.spawns.push({ x: cx, y: cy }); break;
      case 'extract': out.extracts.push({ x: cx, y: cy }); break;
      case 'trader':
        out.traders.push({ x: cx, y: cy, tier: 1 });
        out.pois.push({ name: o.name || 'Outpost', kind: 'outpost', x: cx, y: cy, r: (o.r ?? 8) * TILE, safe: true });
        break;
      case 'trader_black': out.traders.push({ x: cx, y: cy, tier: 2 }); break; // no safe zone — deal at your own risk
      case 'poi_town': out.pois.push({ name: o.name || 'Town', kind: 'town', x: cx, y: cy, r: (o.r ?? 14) * TILE }); break;
      case 'poi_airport': out.pois.push({ name: o.name || 'Airport', kind: 'airport', x: cx, y: cy, r: (o.r ?? 16) * TILE, hot: true }); break;
      case 'poi_outpost': out.pois.push({ name: o.name || 'Outpost', kind: 'outpost', x: cx, y: cy, r: (o.r ?? 8) * TILE, safe: true }); break;
      case 'poi_hotzone': out.pois.push({ name: o.name || 'Hot Zone', kind: 'hotzone', x: cx, y: cy, r: (o.r ?? 12) * TILE, hot: true }); break;
      case 'poi_zone': out.pois.push({ name: o.name || 'Zone', kind: o.zoneKind ?? 'wilds', x: cx, y: cy, r: (o.r ?? 10) * TILE, safe: Boolean(o.safe), hot: Boolean(o.hot) }); break;
    }
  }
  if (out.spawns.length === 0) out.spawns.push({ x: px(W >> 1), y: px(H >> 1) });
  // maps authored before extraction existed still get edge beacons
  if (out.extracts.length === 0) out.extracts = placeExtracts(tiles, W, H, out.pois);
  return out;
}
