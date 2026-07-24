import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const {
  DEFAULT_TERRAIN_ID_BY_TILE,
  Tile,
  decodeAuthoredElevations,
  decodeAuthoredTiles,
  decodeTerrainRuns,
  encodeByteRuns,
  encodeTerrainRuns,
} = require('../../packages/shared/dist/index.js');

export const SHOWCASE_MAP_NAME = 'Ashfall Basin - Showcase Base';
export const SHOWCASE_MAP_SEED = 0x484f4c44;

const W = 2000;
const H = 2000;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function numericColor(hex, fallback = '#557c43') {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? '') ?? /^#([0-9a-f]{6})$/i.exec(fallback);
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

export function generateShowcaseMap({ terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs, seed = SHOWCASE_MAP_SEED }) {
  const random = mulberry32(seed);
  const tiles = new Uint8Array(W * H).fill(Tile.Grass);
  const elevations = new Uint8Array(W * H);
  const terrain = {};
  const resources = {};
  const blocks = {};
  const blockRotations = {};
  const objects = [];
  const reserved = new Set();

  const indexOf = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const terrainDef = (id) => terrainDefs[id] ?? terrainDefs.grass;
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));

  const setTerrain = (x, y, id, reserve = false) => {
    if (!inBounds(x, y)) return;
    const definition = terrainDef(id);
    if (!definition) throw new Error(`Missing terrain definition: ${id}`);
    const index = indexOf(x, y);
    const tile = Number(definition.simulationTile) | 0;
    tiles[index] = tile;
    if (id === (DEFAULT_TERRAIN_ID_BY_TILE[tile] ?? 'grass')) delete terrain[String(index)];
    else terrain[String(index)] = id;
    if (reserve) reserved.add(index);
  };

  const setElevation = (x, y, level) => {
    if (inBounds(x, y)) elevations[indexOf(x, y)] = Math.max(0, Math.min(3, level | 0));
  };

  const paintCircle = (cx, cy, radius, id, reserve = false) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setTerrain(x, y, id, reserve);
      }
    }
  };

  const paintRect = (x, y, width, height, id, reserve = false) => {
    for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) setTerrain(tx, ty, id, reserve);
  };

  const flattenRect = (x, y, width, height) => {
    for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) setElevation(tx, ty, 0);
  };

  const drawLine = (x1, y1, x2, y2, width, id, reserve = true) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(x1 + (x2 - x1) * step / steps);
      const y = Math.round(y1 + (y2 - y1) * step / steps);
      paintCircle(x, y, width / 2, id, reserve);
      for (let dy = -Math.ceil(width / 2); dy <= Math.ceil(width / 2); dy++) {
        for (let dx = -Math.ceil(width / 2); dx <= Math.ceil(width / 2); dx++) setElevation(x + dx, y + dy, 0);
      }
    }
  };

  const drawPath = (points, width = 2, id = 'road') => {
    for (let point = 1; point < points.length; point++) {
      drawLine(points[point - 1][0], points[point - 1][1], points[point][0], points[point][1], width, id);
    }
  };

  const placeBlock = (x, y, id, rotation = 0) => {
    if (!blockDefs[id]) throw new Error(`Missing block definition: ${id}`);
    const index = indexOf(x, y);
    blocks[String(index)] = id;
    if (rotation) blockRotations[String(index)] = ((rotation % 4) + 4) % 4;
    reserved.add(index);
  };

  const removePlacement = (x, y) => {
    if (!inBounds(x, y)) return;
    const key = String(indexOf(x, y));
    delete blocks[key];
    delete blockRotations[key];
    delete resources[key];
  };

  const clearArea = (cx, cy, radius, id = 'grass') => {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      removePlacement(x, y);
      setTerrain(x, y, id, true);
      setElevation(x, y, 0);
    }
  };

  const placeResource = (x, y, id) => {
    const definition = resourceDefs[id];
    if (!definition) throw new Error(`Missing resource definition: ${id}`);
    const terrainId = definition.tile === Tile.Tree ? 'tree'
      : definition.tile === Tile.Rock ? 'rock'
        : definition.tile === Tile.CopperOre ? 'copper_ore'
          : definition.tile === Tile.IronOre ? 'iron_ore'
            : 'grass';
    setTerrain(x, y, terrainId);
    resources[String(indexOf(x, y))] = id;
  };

  const addObject = (type, x, y, extra = {}) => objects.push({ type, x, y, ...extra });

  const stampBuilding = (x, y, width, height, { doorSide = 'south', doorOffset, floorBlock = 'wood_floor' } = {}) => {
    if (width > 14 || height > 10) throw new Error(`Building footprint ${width}x${height} exceeds the compact 14x10 limit`);
    paintRect(x, y, width, height, 'floor', true);
    const offset = doorOffset ?? Math.floor((doorSide === 'north' || doorSide === 'south' ? width : height) / 2);
    const door = doorSide === 'north' ? [x + offset, y]
      : doorSide === 'south' ? [x + offset, y + height - 1]
        : doorSide === 'west' ? [x, y + offset]
          : [x + width - 1, y + offset];
    for (let ty = y; ty < y + height; ty++) for (let tx = x; tx < x + width; tx++) {
      const edge = tx === x || ty === y || tx === x + width - 1 || ty === y + height - 1;
      if (edge) {
        if (tx === door[0] && ty === door[1]) {
          setTerrain(tx, ty, 'doormat', true);
          placeBlock(tx, ty, 'door', doorSide === 'east' || doorSide === 'west' ? 1 : 0);
        } else placeBlock(tx, ty, 'wall');
      } else if ((tx + ty) % 3 !== 0 && blockDefs[floorBlock]) placeBlock(tx, ty, floorBlock);
    }
    const outside = doorSide === 'north' ? [door[0], door[1] - 1]
      : doorSide === 'south' ? [door[0], door[1] + 1]
        : doorSide === 'west' ? [door[0] - 1, door[1]]
          : [door[0] + 1, door[1]];
    if (inBounds(outside[0], outside[1])) setTerrain(outside[0], outside[1], 'doormat', true);
    return { door, outside };
  };

  const fenceRect = (x, y, width, height, gates = []) => {
    const gateSet = new Set(gates.map(([gx, gy]) => `${gx}:${gy}`));
    for (let tx = x; tx < x + width; tx++) for (const ty of [y, y + height - 1]) {
      if (!gateSet.has(`${tx}:${ty}`)) placeBlock(tx, ty, 'fence', 0);
    }
    for (let ty = y + 1; ty < y + height - 1; ty++) for (const tx of [x, x + width - 1]) {
      if (!gateSet.has(`${tx}:${ty}`)) placeBlock(tx, ty, 'fence', 1);
    }
  };

  // Macro terrain spans the full 2000x2000 region.
  for (const [cx, cy, radius] of [[180, 180, 170], [430, 1550, 280], [1780, 1690, 250], [1640, 930, 210], [690, 1070, 190], [260, 1080, 180], [1450, 690, 170]]) {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const distance = Math.hypot(x - cx, y - cy) / radius;
      const level = distance < .25 ? 3 : distance < .5 ? 2 : distance < .8 ? 1 : 0;
      elevations[indexOf(x, y)] = Math.max(elevations[indexOf(x, y)], level);
    }
  }

  const riverCenter = (y) => 1000 + Math.round(Math.sin(y * .0075) * 62 + Math.sin(y * .0021) * 38);
  for (let y = 2; y < H - 2; y++) {
    const center = riverCenter(y);
    for (let x = center - 34; x <= center + 34; x++) setTerrain(x, y, 'sand');
    for (let x = center - 21; x <= center + 21; x++) setTerrain(x, y, 'water');
  }
  paintCircle(1160, 270, 185, 'mud');
  paintCircle(1190, 250, 92, 'water');
  paintCircle(1080, 350, 48, 'water');
  paintCircle(1310, 340, 38, 'water');
  paintCircle(1110, 1790, 160, 'mud');
  paintCircle(1140, 1810, 82, 'water');

  // Copperhead Quarry is a major southwest landmark with traversable concentric grades.
  paintCircle(390, 1560, 225, 'rock');
  paintCircle(390, 1560, 165, 'grass');
  paintCircle(390, 1560, 95, 'mud');
  for (let y = 1340; y <= 1780; y++) for (let x = 170; x <= 610; x++) {
    const distance = Math.hypot(x - 390, y - 1560);
    if (distance > 220) continue;
    const level = distance < 75 ? 3 : distance < 135 ? 2 : distance < 195 ? 1 : 0;
    if (Math.abs(Math.atan2(y - 1560, x - 390)) > .42) setElevation(x, y, level);
  }

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) setTerrain(x, y, 'cliff', true);
  }

  // Cross-region routes and local spurs provide several raid paths through each district.
  drawPath([[5, 300], [380, 500], [720, 510], [960, 430], [1040, 430], [1360, 350], [1680, 310], [1994, 280]], 7);
  drawPath([[5, 950], [280, 950], [650, 970], [955, 950], [1045, 950], [1290, 980], [1650, 930], [1994, 940]], 7);
  drawPath([[5, 1510], [390, 1560], [720, 1450], [955, 1450], [1045, 1450], [1320, 1320], [1650, 1540], [1994, 1600]], 7);
  drawPath([[5, 1850], [500, 1850], [955, 1820], [1045, 1820], [1500, 1840], [1994, 1850]], 6);
  drawPath([[380, 500], [280, 950], [390, 1560], [500, 1994]], 7);
  drawPath([[1680, 310], [1650, 930], [1650, 1540], [1500, 1994]], 7);
  drawPath([[720, 510], [700, 250], [720, 5]], 6);
  drawPath([[1290, 980], [1260, 1260], [1320, 1320]], 6);
  drawPath([[380, 500], [400, 540], [220, 730], [280, 950]], 4);
  drawPath([[650, 970], [650, 850], [700, 700]], 4);
  drawPath([[960, 430], [900, 430]], 4);
  drawPath([[1360, 350], [1280, 520], [1250, 650], [1290, 980]], 4);
  drawPath([[1680, 310], [1510, 690], [1650, 930]], 4);
  drawPath([[280, 950], [300, 1180], [390, 1560]], 4);
  drawPath([[720, 1450], [820, 1650], [955, 1820]], 4);
  drawPath([[1650, 930], [1780, 1160], [1650, 1540]], 4);
  drawPath([[1320, 1320], [1080, 1450], [1110, 1790], [1360, 1840]], 4);
  drawPath([[1500, 1840], [1840, 1840]], 4);
  for (const y of [430, 950, 1450, 1820]) paintRect(riverCenter(y) - 58, y - 6, 116, 13, 'asphalt', true);

  const stampSettlement = (cx, cy, columns, rows, stoneBias = .35) => {
    const lotW = 20; const lotH = 17;
    const startX = Math.round(cx - columns * lotW / 2);
    const startY = Math.round(cy - rows * lotH / 2);
    const buildings = [];
    paintRect(startX - 5, startY - 5, columns * lotW + 10, rows * lotH + 10, 'grass');
    flattenRect(startX - 5, startY - 5, columns * lotW + 10, rows * lotH + 10);
    for (let column = 0; column <= columns; column++) drawLine(startX + column * lotW, startY - 4, startX + column * lotW, startY + rows * lotH + 4, 3, 'road');
    for (let row = 0; row <= rows; row++) drawLine(startX - 4, startY + row * lotH, startX + columns * lotW + 4, startY + row * lotH, 3, 'road');
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const width = randomInt(8, 13); const height = randomInt(7, 10);
      const x = startX + column * lotW + randomInt(3, Math.max(3, lotW - width - 2));
      const y = startY + row * lotH + randomInt(3, Math.max(3, lotH - height - 2));
      const doorSide = row % 2 ? 'north' : 'south';
      stampBuilding(x, y, width, height, { doorSide, floorBlock: random() < stoneBias ? 'stone_floor' : 'wood_floor' });
      buildings.push({ x, y, width, height, cx: x + Math.floor(width / 2), cy: y + Math.floor(height / 2) });
    }
    return buildings;
  };

  const settlementSpecs = [
    { name: 'Harrowfield', cx: 400, cy: 540, columns: 8, rows: 6, stoneBias: .35, r: 95, zombies: 34 },
    { name: 'Northport', cx: 700, cy: 250, columns: 6, rows: 4, stoneBias: .25, r: 75, zombies: 20 },
    { name: 'Westmere', cx: 220, cy: 730, columns: 5, rows: 4, stoneBias: .2, r: 65, zombies: 16 },
    { name: 'Millhaven', cx: 650, cy: 850, columns: 6, rows: 4, stoneBias: .3, r: 75, zombies: 22 },
    { name: 'Redwater', cx: 1250, cy: 650, columns: 5, rows: 4, stoneBias: .45, r: 65, zombies: 20 },
    { name: 'Bracken', cx: 300, cy: 1180, columns: 5, rows: 4, stoneBias: .25, r: 65, zombies: 18 },
    { name: 'Southridge', cx: 700, cy: 1370, columns: 7, rows: 5, stoneBias: .45, r: 85, zombies: 28 },
    { name: 'Cinder Port', cx: 1280, cy: 1230, columns: 6, rows: 4, stoneBias: .65, r: 75, zombies: 24, hot: true },
    { name: 'Eastwatch', cx: 1660, cy: 930, columns: 6, rows: 4, stoneBias: .75, r: 75, zombies: 24 },
    { name: 'Farpoint', cx: 1780, cy: 1160, columns: 5, rows: 4, stoneBias: .55, r: 65, zombies: 18 },
    { name: 'Duston', cx: 820, cy: 1650, columns: 6, rows: 4, stoneBias: .5, r: 75, zombies: 22 },
    { name: 'Shoreline', cx: 1360, cy: 1840, columns: 5, rows: 3, stoneBias: .4, r: 60, zombies: 16 },
  ];
  const settlements = settlementSpecs.map((spec) => ({
    ...spec,
    buildings: stampSettlement(spec.cx, spec.cy, spec.columns, spec.rows, spec.stoneBias),
  }));
  const settlementBuildings = settlements.flatMap((settlement) => settlement.buildings);
  setTerrain(settlements[0].buildings[1].cx, settlements[0].buildings[1].cy, 'bed', true);
  for (const [x, y] of [[1540, 1030], [1560, 1040], [1580, 1040], [1600, 1050], [1620, 1050], [1640, 1060]]) setTerrain(x, y, 'wall', true);

  const stampFarm = (cx, cy) => {
    const x = cx - 36; const y = cy - 27; const width = 72; const height = 54;
    paintRect(x, y, width, height, 'grass'); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1], [x + width - 1, cy]]);
    const buildings = [
      { x: x + 7, y: y + 7, width: 11, height: 8 },
      { x: x + 28, y: y + 7, width: 14, height: 9 },
      { x: x + 52, y: y + 10, width: 9, height: 7 },
    ];
    for (const building of buildings) stampBuilding(building.x, building.y, building.width, building.height, { doorSide: 'south', floorBlock: 'wood_floor' });
    placeBlock(x + 12, y + 38, 'firepit'); placeBlock(x + 30, y + 39, 'chest'); placeBlock(x + 50, y + 38, 'workbench');
    return buildings.map((building) => ({ ...building, cx: building.x + Math.floor(building.width / 2), cy: building.y + Math.floor(building.height / 2) }));
  };

  const farmSpecs = [
    { name: 'Ash Creek Farm', cx: 285, cy: 950, r: 48 },
    { name: 'Greenbank Farm', cx: 1280, cy: 520, r: 48 },
    { name: 'Sunken Fields', cx: 1110, cy: 1790, r: 48 },
  ];
  const farms = farmSpecs.map((spec) => ({ ...spec, buildings: stampFarm(spec.cx, spec.cy) }));

  const stampOutpost = (cx, cy) => {
    const x = cx - 29; const y = cy - 23; const width = 58; const height = 46;
    paintRect(x, y, width, height, 'road', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1], [x, cy]]);
    const buildings = [
      { x: x + 7, y: y + 7, width: 13, height: 9 },
      { x: x + 37, y: y + 7, width: 11, height: 8 },
    ];
    for (const building of buildings) stampBuilding(building.x, building.y, building.width, building.height, { doorSide: 'south', floorBlock: 'stone_floor' });
    for (const [px, py, id] of [
      [x + 8, y + 33, 'workbench'], [x + 18, y + 33, 'furnace'], [x + 28, y + 33, 'anvil'],
      [x + 40, y + 33, 'chest'], [x + 50, y + 33, 'firepit'], [x + 42, y + 10, 'bed'],
      [x + 3, y + 3, 'torch'], [x + 54, y + 3, 'torch'],
    ]) placeBlock(px, py, id);
    return buildings.map((building) => ({ ...building, cx: building.x + Math.floor(building.width / 2), cy: building.y + Math.floor(building.height / 2) }));
  };

  const outpostSpecs = [
    { name: 'Northgate Market', cx: 900, cy: 430, r: 38 },
    { name: 'Crossroads Workshop', cx: 1110, cy: 990, r: 42 },
    { name: 'Southwatch Rest', cx: 1080, cy: 1450, r: 38 },
    { name: 'Eastline Depot', cx: 1840, cy: 1840, r: 38 },
  ];
  const outposts = outpostSpecs.map((spec) => ({ ...spec, buildings: stampOutpost(spec.cx, spec.cy) }));

  const stampAirfield = (cx, cy, width) => {
    const height = 88; const x = cx - Math.floor(width / 2); const y = cy - Math.floor(height / 2);
    paintRect(x, y, width, height, 'asphalt', true); flattenRect(x, y, width, height);
    paintRect(x + 12, y + 16, width - 24, 11, 'asphalt', true);
    fenceRect(x, y, width, height, [
      [x, cy - 1], [x, cy], [x + width - 1, cy - 1], [x + width - 1, cy],
      [cx - 1, y], [cx, y], [cx - 1, y + height - 1], [cx, y + height - 1],
    ]);
    const offsets = [18, 48, width - 61, width - 31];
    const buildings = offsets.map((offset, index) => ({ x: x + offset, y: y + 55 + index % 2, width: 13, height: 9 }));
    for (const building of buildings) stampBuilding(building.x, building.y, building.width, building.height, { doorSide: 'north', floorBlock: 'stone_floor' });
    for (let offset = 24, crate = 0; offset < width - 20; offset += 25, crate++) placeBlock(x + offset, y + 40 + crate % 2, 'steel_crate', crate % 2);
    for (const [px, py] of [[x + 4, y + 4], [x + width - 5, y + 4], [x + 4, y + height - 5], [x + width - 5, y + height - 5]]) placeBlock(px, py, 'torch');
    return buildings.map((building) => ({ ...building, cx: building.x + Math.floor(building.width / 2), cy: building.y + Math.floor(building.height / 2) }));
  };

  const airfields = [
    { name: 'Greywing Airfield', cx: 1680, cy: 300, r: 105, buildings: stampAirfield(1680, 300, 190) },
    { name: 'Rook Airstrip', cx: 1510, cy: 690, r: 88, buildings: stampAirfield(1510, 690, 154) },
  ];

  const stampMilitaryBase = (cx, cy) => {
    const x = cx - 72; const y = cy - 52; const width = 144; const height = 104;
    paintRect(x, y, width, height, 'asphalt', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1], [x + width - 1, cy - 1], [x + width - 1, cy]]);
    const buildings = [
      { x: x + 10, y: y + 9, width: 12, height: 8 }, { x: x + 31, y: y + 9, width: 11, height: 8 },
      { x: x + 102, y: y + 9, width: 14, height: 9 }, { x: x + 11, y: y + 38, width: 10, height: 8 },
      { x: x + 108, y: y + 40, width: 12, height: 9 }, { x: x + 40, y: y + 78, width: 14, height: 9 },
      { x: x + 86, y: y + 77, width: 13, height: 9 },
    ];
    for (const building of buildings) stampBuilding(building.x, building.y, building.width, building.height, { doorSide: 'south', floorBlock: 'stone_floor' });
    paintCircle(cx, cy, 12, 'floor', true);
    for (const [px, py] of [[x + 4, y + 4], [x + width - 5, y + 4], [x + 4, y + height - 5], [x + width - 5, y + height - 5]]) placeBlock(px, py, 'torch');
    return buildings.map((building) => ({ ...building, cx: building.x + Math.floor(building.width / 2), cy: building.y + Math.floor(building.height / 2) }));
  };

  const militaryBases = [
    { name: 'Fort Meridian', cx: 360, cy: 300, r: 82, buildings: stampMilitaryBase(360, 300) },
    { name: 'Bastion Redoubt', cx: 1650, cy: 1550, r: 86, buildings: stampMilitaryBase(1650, 1550) },
  ];
  const allBuildings = [
    ...settlementBuildings,
    ...farms.flatMap((farm) => farm.buildings),
    ...outposts.flatMap((outpost) => outpost.buildings),
    ...airfields.flatMap((airfield) => airfield.buildings),
    ...militaryBases.flatMap((base) => base.buildings),
  ];

  for (const [x, y, id, rotation] of [
    [1640, 300, 'road_barrier', 1], [1720, 300, 'road_barrier', 1],
    [1660, 325, 'wrecked_car', 0], [1530, 715, 'wrecked_car', 1],
    [340, 300, 'sandbag_wall', 0], [380, 300, 'sandbag_wall', 0],
    [1630, 1550, 'sandbag_wall', 0], [1670, 1550, 'sandbag_wall', 0],
    [330, 318, 'stone_wall', 0], [390, 318, 'stone_wall', 0],
    [720, 320, 'dead_tree', 0], [1180, 1710, 'dead_tree', 1],
  ]) if (blockDefs[id]) placeBlock(x, y, id, rotation);

  const scatterFloraBlock = (id, count, bounds, allowedTerrain = new Set(['grass', 'mud'])) => {
    if (!blockDefs[id]) throw new Error(`Missing flora block definition: ${id}`);
    let placed = 0;
    for (let attempt = 0; attempt < count * 120 && placed < count; attempt++) {
      const x = randomInt(bounds[0], bounds[2]); const y = randomInt(bounds[1], bounds[3]);
      const index = indexOf(x, y);
      const terrainId = terrain[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
      if (x < 5 || y < 5 || x >= W - 5 || y >= H - 5) continue;
      if (reserved.has(index) || blocks[String(index)] || resources[String(index)] || elevations[index] > 1) continue;
      if (!allowedTerrain.has(terrainId)) continue;
      placeBlock(x, y, id, randomInt(0, 3));
      placed++;
    }
    if (placed < count) throw new Error(`Could only place ${placed}/${count} ${id} flora blocks`);
  };
  scatterFloraBlock('young_pine', 700, [10, 10, 1989, 1989]);
  scatterFloraBlock('dense_shrub', 900, [10, 10, 1989, 1989]);
  scatterFloraBlock('berry_bush', 420, [20, 20, 1980, 1980]);
  scatterFloraBlock('fern_patch', 850, [20, 20, 1980, 1980]);
  scatterFloraBlock('reeds', 500, [900, 40, 1320, 1910], new Set(['grass', 'mud', 'sand']));
  scatterFloraBlock('wildflowers', 700, [10, 10, 1989, 1989], new Set(['grass']));
  scatterFloraBlock('tall_grass', 1_000, [10, 10, 1989, 1989], new Set(['grass', 'mud']));
  scatterFloraBlock('fallen_log', 300, [20, 20, 1980, 1980]);
  scatterFloraBlock('mossy_stump', 300, [20, 20, 1980, 1980]);
  scatterFloraBlock('bramble', 500, [20, 20, 1980, 1980]);
  scatterFloraBlock('mushrooms', 450, [20, 20, 1980, 1980]);

  const scatterResource = (id, count, bounds) => {
    const allowedTerrain = resourceDefs[id]?.tile === Tile.Tree
      ? new Set(['grass', 'mud'])
      : new Set(['grass', 'mud', 'rock']);
    let placed = 0;
    for (let attempt = 0; attempt < count * 100 && placed < count; attempt++) {
      const x = randomInt(bounds[0], bounds[2]); const y = randomInt(bounds[1], bounds[3]);
      const index = indexOf(x, y);
      const terrainId = terrain[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
      if (reserved.has(index) || blocks[String(index)] || resources[String(index)] || !allowedTerrain.has(terrainId)) continue;
      if (x < 5 || y < 5 || x >= W - 5 || y >= H - 5) continue;
      placeResource(x, y, id); placed++;
    }
    if (placed < count) throw new Error(`Could only place ${placed}/${count} ${id} resources`);
  };
  scatterResource('tree', 15_000, [6, 6, 1993, 1993]);
  scatterResource('pine_tree', 7_000, [20, 20, 1980, 1980]);
  scatterResource('birch_tree', 3_000, [20, 20, 1980, 1980]);
  scatterResource('ironwood', 1_500, [420, 40, 900, 620]);
  scatterResource('rock', 4_500, [40, 1200, 820, 1950]);
  scatterResource('copper_vein', 900, [175, 1340, 610, 1780]);
  scatterResource('iron_vein', 800, [190, 1340, 650, 1810]);

  const spawnPoints = [];
  for (let x = 90; x <= 1910; x += 230) { spawnPoints.push([x, 70], [x, 1930]); }
  for (let y = 260; y <= 1740; y += 245) { spawnPoints.push([70, y], [1930, y]); }
  spawnPoints.push(
    [110, 600], [500, 730], [830, 700], [1120, 760], [1370, 570], [1830, 600],
    [160, 1080], [500, 1080], [850, 1110], [1150, 1100], [1460, 1020], [1880, 1050],
    [150, 1400], [560, 1250], [900, 1350], [1180, 1580], [1420, 1710], [1850, 1400],
  );
  const extracts = [[5, 300], [5, 950], [5, 1510], [720, 5], [1500, 5], [1994, 280], [1994, 940], [1994, 1600], [500, 1994], [1000, 1994], [1500, 1994], [1994, 1850]];
  for (const [x, y] of [...spawnPoints, ...extracts]) clearArea(x, y, 7);
  for (const [x, y] of spawnPoints) addObject('spawn', x, y);
  for (const [x, y] of extracts) addObject('extract', x, y);

  for (const settlement of settlements) {
    addObject(settlement.hot ? 'poi_zone' : 'poi_town', settlement.cx, settlement.cy, {
      name: settlement.name,
      r: settlement.r,
      ...(settlement.hot ? { zoneKind: 'town', safe: false, hot: true } : {}),
    });
  }
  for (const farm of farms) addObject('poi_zone', farm.cx, farm.cy, { name: farm.name, r: farm.r, zoneKind: 'farmland', safe: false, hot: false });
  for (const outpost of outposts) addObject('trader', outpost.cx, outpost.cy, { name: outpost.name, r: outpost.r });
  for (const airfield of airfields) addObject('poi_airport', airfield.cx, airfield.cy, { name: airfield.name, r: airfield.r });
  for (const base of militaryBases) addObject('poi_hotzone', base.cx, base.cy, { name: base.name, r: base.r });
  for (const region of [
    { name: 'Copperhead Quarry', x: 390, y: 1560, r: 190, zoneKind: 'quarry', hot: false },
    { name: 'Ironwood Reserve', x: 680, y: 320, r: 175, zoneKind: 'forest', hot: false },
    { name: 'Drowned Fen', x: 1160, y: 270, r: 175, zoneKind: 'marsh', hot: false },
    { name: 'Red Hills', x: 180, y: 180, r: 145, zoneKind: 'highlands', hot: false },
    { name: 'Wolfpine Forest', x: 1460, y: 930, r: 120, zoneKind: 'forest', hot: false },
    { name: 'Blackwater Marsh', x: 1170, y: 1710, r: 110, zoneKind: 'marsh', hot: true },
    { name: 'Old Rail Yard', x: 1540, y: 1130, r: 85, zoneKind: 'industrial', hot: true },
  ]) addObject('poi_zone', region.x, region.y, { name: region.name, r: region.r, zoneKind: region.zoneKind, safe: false, hot: region.hot });
  addObject('trader_black', 1510, 675);
  addObject('trader_black', 1700, 1570);

  for (let index = 0; index < settlementBuildings.length; index += 3) {
    const building = settlementBuildings[index];
    addObject('chest', building.cx, building.cy);
  }
  for (const farm of farms) for (const building of farm.buildings) addObject('chest', building.cx, building.cy);
  for (const airfield of airfields) for (const building of airfield.buildings) addObject('chest_military', building.cx, building.cy);
  for (const base of militaryBases) for (const building of base.buildings) addObject('chest_military', building.cx, building.cy);

  const occupiedGameplay = new Set(objects.filter((object) => !object.type.startsWith('poi_')).map((object) => `${object.x},${object.y}`));
  const protectedSpawnPoints = [...spawnPoints, ...extracts];
  const scatterObjects = (type, count, bounds, extra = {}) => {
    const isMob = type === 'mob' || Object.hasOwn(mobDefs, type);
    let placed = 0;
    for (let attempt = 0; attempt < count * 160 && placed < count; attempt++) {
      const x = randomInt(bounds[0], bounds[2]); const y = randomInt(bounds[1], bounds[3]);
      const index = indexOf(x, y); const position = `${x},${y}`;
      const terrainId = terrain[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
      const terrainDefinition = terrainDefs[terrainId]; const blockDefinition = blockDefs[blocks[String(index)]];
      if (occupiedGameplay.has(position) || resources[String(index)] || elevations[index] > 1) continue;
      if (terrainDefinition?.collision?.move || blockDefinition?.collision?.move) continue;
      if (isMob && (
        terrainDefinition?.collision?.enemy
        || blockDefinition?.collision?.enemy
        || outposts.some((outpost) => Math.hypot(x - outpost.cx, y - outpost.cy) < outpost.r + 12)
        || protectedSpawnPoints.some(([px, py]) => Math.hypot(x - px, y - py) < 18)
      )) continue;
      addObject(type, x, y, extra); occupiedGameplay.add(position); placed++;
    }
    if (placed < count) throw new Error(`Could only place ${placed}/${count} ${type} objects`);
  };

  const lootIds = Object.keys(lootDefs);
  lootIds.forEach((lootTable, index) => {
    const settlement = settlements[index % settlements.length];
    scatterObjects('chest_custom', 1, [settlement.cx - settlement.r, settlement.cy - settlement.r, settlement.cx + settlement.r, settlement.cy + settlement.r], { lootTable });
  });
  for (const settlement of settlements) {
    scatterObjects('loot', Math.max(8, Math.floor(settlement.buildings.length / 2)), [settlement.cx - settlement.r, settlement.cy - settlement.r, settlement.cx + settlement.r, settlement.cy + settlement.r]);
    scatterObjects('zombie', settlement.zombies, [settlement.cx - settlement.r, settlement.cy - settlement.r, settlement.cx + settlement.r, settlement.cy + settlement.r]);
  }
  for (const farm of farms) {
    scatterObjects('loot', 12, [farm.cx - farm.r, farm.cy - farm.r, farm.cx + farm.r, farm.cy + farm.r]);
    scatterObjects('zombie', 12, [farm.cx - farm.r, farm.cy - farm.r, farm.cx + farm.r, farm.cy + farm.r]);
  }
  for (const airfield of airfields) {
    scatterObjects('loot', 24, [airfield.cx - airfield.r, airfield.cy - airfield.r, airfield.cx + airfield.r, airfield.cy + airfield.r]);
    scatterObjects('military', airfield.name === 'Greywing Airfield' ? 42 : 30, [airfield.cx - airfield.r, airfield.cy - airfield.r, airfield.cx + airfield.r, airfield.cy + airfield.r]);
  }
  for (const base of militaryBases) {
    scatterObjects('loot', 26, [base.cx - base.r, base.cy - base.r, base.cx + base.r, base.cy + base.r]);
    addObject('mob', base.cx, base.cy, { contentId: 'brute', respawnMs: 300_000 });
    occupiedGameplay.add(`${base.cx},${base.cy}`);
    scatterObjects('military', base.name === 'Bastion Redoubt' ? 48 : 34, [base.cx - base.r, base.cy - base.r, base.cx + base.r, base.cy + base.r]);
  }
  scatterObjects('military', 18, [1460, 1070, 1620, 1190]);
  scatterObjects('deer', 30, [350, 30, 940, 750]);
  scatterObjects('deer', 15, [1050, 1500, 1450, 1940]);
  scatterObjects('rabbit', 45, [40, 340, 960, 1240]);
  scatterObjects('boar', 35, [120, 1260, 820, 1900]);
  scatterObjects('wolf', 45, [1120, 500, 1940, 1360]);
  scatterObjects('wolf', 20, [80, 80, 520, 450]);
  scatterObjects('fox', 30, [300, 80, 980, 760]);
  scatterObjects('bear', 12, [80, 80, 540, 470]);
  scatterObjects('moose', 18, [380, 60, 980, 700]);
  scatterObjects('raccoon', 35, [850, 120, 1320, 760]);
  scatterObjects('cougar', 12, [1250, 540, 1900, 1280]);

  const coveredMobs = new Set(objects.flatMap((object) => object.type === 'mob' ? [object.contentId] : Object.hasOwn(mobDefs, object.type) ? [object.type] : []));
  for (const id of Object.keys(mobDefs)) if (!coveredMobs.has(id)) scatterObjects('mob', 1, [1350, 1100, 1450, 1200], { contentId: id, respawnMs: 120_000 });

  for (const object of objects) {
    if (object.type.startsWith('poi_')) continue;
    const index = indexOf(object.x, object.y);
    if (!resources[String(index)]) continue;
    delete resources[String(index)]; setTerrain(object.x, object.y, 'grass', true);
  }

  const workingMap = { w: W, h: H, tiles, elevations, terrain, resources, blocks, blockRotations, objects };
  const report = validateShowcaseMap(workingMap, { terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs });
  report.buildings = allBuildings.length;
  report.largestBuilding = `${Math.max(...allBuildings.map((building) => building.width))}x${Math.max(...allBuildings.map((building) => building.height))}`;
  const map = {
    w: W,
    h: H,
    tileRuns: encodeByteRuns(tiles),
    elevationRuns: encodeByteRuns(elevations),
    terrainRuns: encodeTerrainRuns(terrain),
    resources,
    blocks,
    blockRotations,
    objects,
  };
  return { map, report };
}

export function validateShowcaseMap(map, { terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs }) {
  const errors = [];
  const tiles = map.tiles instanceof Uint8Array ? map.tiles : decodeAuthoredTiles(map);
  const elevations = map.elevations instanceof Uint8Array ? map.elevations : decodeAuthoredElevations(map);
  const terrainOverrides = { ...decodeTerrainRuns(map.terrainRuns, map.w * map.h), ...(map.terrain ?? {}) };
  if (tiles.length !== map.w * map.h) errors.push('Tile count does not match dimensions');
  if (elevations.length !== map.w * map.h) errors.push('Elevation count does not match dimensions');

  const usedTerrain = new Set(Object.values(terrainOverrides));
  for (const tile of new Set(tiles)) usedTerrain.add(DEFAULT_TERRAIN_ID_BY_TILE[tile] ?? 'grass');
  const usedBlocks = new Set(Object.values(map.blocks));
  const usedResources = new Set(Object.values(map.resources));
  const usedMobs = new Set(map.objects.flatMap((object) => object.type === 'mob' ? [object.contentId] : Object.hasOwn(mobDefs, object.type) ? [object.type] : []));
  const usedLoot = new Set(map.objects.filter((object) => object.type === 'chest_custom').map((object) => object.lootTable));

  for (const id of usedTerrain) if (!terrainDefs[id]) errors.push(`Unknown terrain: ${id}`);
  for (const id of usedBlocks) if (!blockDefs[id]) errors.push(`Unknown block: ${id}`);
  for (const id of usedResources) if (!resourceDefs[id]) errors.push(`Unknown resource: ${id}`);
  for (const id of usedMobs) if (!mobDefs[id]) errors.push(`Unknown mob: ${id}`);
  for (const id of usedLoot) if (!lootDefs[id]) errors.push(`Unknown loot table: ${id}`);
  for (const id of Object.keys(blockDefs)) if (!usedBlocks.has(id)) errors.push(`Published block is not demonstrated: ${id}`);
  for (const id of Object.keys(resourceDefs)) if (!usedResources.has(id)) errors.push(`Published resource is not demonstrated: ${id}`);
  for (const id of Object.keys(mobDefs)) if (!usedMobs.has(id)) errors.push(`Published mob is not demonstrated: ${id}`);

  const terrainIdAt = (index) => terrainOverrides[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
  const passable = (index) => {
    const terrain = terrainDefs[terrainIdAt(index)];
    const block = blockDefs[map.blocks[String(index)]];
    return !terrain?.collision?.move && !block?.collision?.move;
  };
  const spawns = map.objects.filter((object) => object.type === 'spawn');
  const critical = map.objects.filter((object) => ['spawn', 'extract', 'trader', 'trader_black'].includes(object.type));
  const gameplayObjects = map.objects.filter((object) => !object.type.startsWith('poi_'));
  const regions = map.objects.filter((object) => object.type.startsWith('poi_'));
  const traders = map.objects.filter((object) => object.type === 'trader');
  const enemies = map.objects.filter((object) => object.type === 'mob' || Object.hasOwn(mobDefs, object.type));
  const enemyCounts = enemies.reduce((counts, object) => {
    const id = object.type === 'mob' ? object.contentId : object.type;
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  const containers = map.objects.filter((object) => ['chest', 'chest_military', 'chest_custom'].includes(object.type));
  const hotRegions = regions.filter((object) => object.type === 'poi_airport' || object.type === 'poi_hotzone' || object.hot);
  if (spawns.length < 8) errors.push('Map needs at least eight spawn points');
  if (map.objects.filter((object) => object.type === 'extract').length < 4) errors.push('Map needs four extraction points');
  if (regions.length + traders.length < 30) errors.push('Map needs at least 30 named gameplay regions');
  if (map.objects.filter((object) => object.type === 'poi_town').length < 10) errors.push('Map needs at least ten towns');
  if (map.objects.filter((object) => object.type === 'poi_airport').length < 2) errors.push('Map needs at least two airfields');
  if (traders.length < 4) errors.push('Map needs at least four safe trading outposts');
  if (hotRegions.length < 6) errors.push('Map needs at least six high-loot regions');
  if (enemies.length < 600) errors.push('Map needs at least 600 regional mob spawns');
  if ((enemyCounts.zombie ?? 0) < 250) errors.push('Map needs at least 250 infected spawns');
  if ((enemyCounts.military ?? 0) < 150) errors.push('Map needs at least 150 military spawns');
  if (containers.length < 130) errors.push('Map needs at least 130 loot containers');

  for (const trader of traders) {
    const unsafeEnemy = enemies.find((enemy) => Math.hypot(enemy.x - trader.x, enemy.y - trader.y) < (trader.r ?? 8) + 10);
    if (unsafeEnemy) errors.push(`${trader.name ?? 'Trader'} safe zone contains ${unsafeEnemy.type} at ${unsafeEnemy.x},${unsafeEnemy.y}`);
  }
  for (const spawn of spawns) {
    const nearbyEnemy = enemies.find((enemy) => Math.hypot(enemy.x - spawn.x, enemy.y - spawn.y) < 16);
    if (nearbyEnemy) errors.push(`Spawn at ${spawn.x},${spawn.y} is camped by ${nearbyEnemy.type}`);
  }

  const start = spawns[0] ? spawns[0].y * map.w + spawns[0].x : -1;
  const visited = new Uint8Array(map.w * map.h);
  const queue = new Int32Array(map.w * map.h);
  let queueLength = 0;
  if (start >= 0 && passable(start)) { visited[start] = 1; queue[queueLength++] = start; }
  for (let cursor = 0; cursor < queueLength; cursor++) {
    const index = queue[cursor];
    const x = index % map.w;
    const y = Math.floor(index / map.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const next = ny * map.w + nx;
      if (visited[next] || !passable(next) || Math.abs(elevations[next] - elevations[index]) > 1) continue;
      visited[next] = 1;
      queue[queueLength++] = next;
    }
  }
  for (const object of critical) {
    if (!visited[object.y * map.w + object.x]) errors.push(`${object.type} at ${object.x},${object.y} is unreachable`);
  }
  const occupied = new Set();
  for (const object of gameplayObjects) {
    const index = object.y * map.w + object.x;
    const position = `${object.x},${object.y}`;
    const mobId = object.type === 'mob' ? object.contentId : Object.hasOwn(mobDefs, object.type) ? object.type : null;
    const terrainDefinition = terrainDefs[terrainIdAt(index)];
    const blockDefinition = blockDefs[map.blocks[String(index)]];
    if (object.x < 0 || object.y < 0 || object.x >= map.w || object.y >= map.h) errors.push(`${object.type} at ${position} is out of bounds`);
    if (!passable(index)) errors.push(`${object.type} at ${position} is embedded in collision`);
    if (mobId && (terrainDefinition?.collision?.enemy || blockDefinition?.collision?.enemy)) errors.push(`${object.type} at ${position} blocks enemy navigation`);
    if (!visited[index]) errors.push(`${object.type} at ${position} is unreachable`);
    if (occupied.has(position)) errors.push(`Multiple gameplay objects overlap at ${position}`);
    occupied.add(position);
  }
  let walkable = 0;
  let reachableWalkable = 0;
  for (let index = 0; index < tiles.length; index++) {
    if (passable(index)) walkable++;
    if (visited[index]) reachableWalkable++;
  }
  const connectivity = walkable ? reachableWalkable / walkable : 0;
  if (connectivity < .9) errors.push(`Only ${(connectivity * 100).toFixed(1)}% of walkable cells are connected`);

  if (errors.length) throw new Error(`Showcase map validation failed:\n- ${errors.join('\n- ')}`);
  return {
    size: `${map.w}x${map.h}`,
    objects: map.objects.length,
    regions: regions.length + traders.length,
    towns: map.objects.filter((object) => object.type === 'poi_town').length,
    airfields: map.objects.filter((object) => object.type === 'poi_airport').length,
    safeOutposts: traders.length,
    hotRegions: hotRegions.length,
    spawns: spawns.length,
    extracts: map.objects.filter((object) => object.type === 'extract').length,
    containers: containers.length,
    enemies: enemies.length,
    enemyCounts,
    blocks: Object.keys(map.blocks).length,
    blockKinds: usedBlocks.size,
    resources: Object.keys(map.resources).length,
    resourceKinds: usedResources.size,
    mobKinds: usedMobs.size,
    lootTables: usedLoot.size,
    terrainKinds: usedTerrain.size,
    connectedWalkablePercent: Number((connectivity * 100).toFixed(1)),
  };
}

export function renderShowcasePreview(map, terrainDefs, requestedScale) {
  const tiles = map.tiles instanceof Uint8Array ? map.tiles : decodeAuthoredTiles(map);
  const elevations = map.elevations instanceof Uint8Array ? map.elevations : decodeAuthoredElevations(map);
  const terrainOverrides = { ...decodeTerrainRuns(map.terrainRuns, map.w * map.h), ...(map.terrain ?? {}) };
  const scale = requestedScale ?? (Math.max(map.w, map.h) > 500 ? 1 : 4);
  const png = new PNG({ width: map.w * scale, height: map.h * scale });
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const index = y * map.w + x;
    const terrainId = terrainOverrides[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
    const definition = terrainDefs[terrainId];
    let [red, green, blue] = numericColor(definition?.minimapColor);
    const level = elevations[index] ?? 0;
    red = Math.min(255, red + level * 13);
    green = Math.min(255, green + level * 13);
    blue = Math.min(255, blue + level * 10);
    if (map.blocks[String(index)]) [red, green, blue] = [196, 156, 76];
    if (map.resources[String(index)]) [red, green, blue] = [62, 91, 52];
    for (let py = 0; py < scale; py++) for (let px = 0; px < scale; px++) {
      const offset = ((y * scale + py) * png.width + x * scale + px) * 4;
      png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
    }
  }
  const objectColors = { spawn: [110, 220, 145], extract: [245, 225, 91], trader: [82, 210, 140], trader_black: [200, 92, 80], poi_hotzone: [230, 75, 58], mob: [235, 82, 65] };
  for (const object of map.objects) {
    const color = objectColors[object.type];
    if (!color) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = object.x * scale + Math.floor(scale / 2) + dx;
      const y = object.y * scale + Math.floor(scale / 2) + dy;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const offset = (y * png.width + x) * 4;
      png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
