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

export const FRONTIER_MAP_NAME = 'Greyvale Frontier - 500';
export const FRONTIER_MAP_SEED = 0x47524559;
export const FRONTIER_MAP_SIZE = 500;
const BUILTIN_MOB_TYPES = new Set(['zombie', 'military', 'deer', 'rabbit', 'boar', 'wolf', 'fox', 'bear']);

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

export function generateFrontierMap({ terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs, seed = FRONTIER_MAP_SEED }) {
  const W = FRONTIER_MAP_SIZE;
  const H = FRONTIER_MAP_SIZE;
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
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
  const terrainDef = (id) => terrainDefs[id] ?? terrainDefs.grass;

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

  const drawPath = (points, width = 3, id = 'road') => {
    for (let point = 1; point < points.length; point++) {
      drawLine(points[point - 1][0], points[point - 1][1], points[point][0], points[point][1], width, id);
    }
  };

  const placeBlock = (x, y, id, rotation = 0) => {
    if (!blockDefs[id]) throw new Error(`Missing block definition: ${id}`);
    if (!inBounds(x, y)) return;
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
    if (width > 14 || height > 10) throw new Error(`Building footprint ${width}x${height} exceeds 14x10`);
    paintRect(x, y, width, height, 'floor', true);
    const span = doorSide === 'north' || doorSide === 'south' ? width : height;
    const offset = doorOffset ?? Math.floor(span / 2);
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
      } else if ((tx + ty) % 4 !== 0 && blockDefs[floorBlock]) placeBlock(tx, ty, floorBlock);
    }
    const outside = doorSide === 'north' ? [door[0], door[1] - 1]
      : doorSide === 'south' ? [door[0], door[1] + 1]
        : doorSide === 'west' ? [door[0] - 1, door[1]]
          : [door[0] + 1, door[1]];
    if (inBounds(outside[0], outside[1])) setTerrain(outside[0], outside[1], 'doormat', true);
    return { x, y, width, height, cx: x + Math.floor(width / 2), cy: y + Math.floor(height / 2), door, outside };
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

  // Three graded highland areas give the flat grassland recognizable silhouettes.
  for (const [cx, cy, radius] of [[65, 55, 52], [68, 338, 48], [430, 430, 54]]) {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(x, y)) continue;
      const distance = Math.hypot(x - cx, y - cy) / radius;
      const level = distance < .25 ? 3 : distance < .5 ? 2 : distance < .78 ? 1 : 0;
      elevations[indexOf(x, y)] = Math.max(elevations[indexOf(x, y)], level);
    }
  }

  // The Greywater divides the raid into east/west lanes, with three intentional bridges.
  const riverCenter = (y) => 246 + Math.round(Math.sin(y * .031) * 13 + Math.sin(y * .009) * 8);
  for (let y = 2; y < H - 2; y++) {
    const center = riverCenter(y);
    for (let x = center - 8; x <= center + 8; x++) setTerrain(x, y, 'sand');
    for (let x = center - 5; x <= center + 5; x++) setTerrain(x, y, 'water');
  }
  paintCircle(287, 58, 38, 'sand');
  paintCircle(287, 58, 31, 'water');
  paintCircle(292, 449, 42, 'mud');
  for (const [x, y, radius] of [[281, 445, 13], [307, 458, 10], [298, 426, 8]]) paintCircle(x, y, radius, 'water');

  // Copperhead quarry has a road-cut entrance through a ring of stone.
  paintCircle(68, 338, 46, 'rock');
  paintCircle(68, 338, 35, 'grass');
  paintCircle(68, 338, 18, 'mud');

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) setTerrain(x, y, 'cliff', true);
  }

  // Main roads produce three large loops instead of one mandatory central route.
  drawPath([[4, 105], [82, 98], [210, 108], [270, 108], [390, 92], [495, 95]], 5);
  drawPath([[4, 260], [92, 248], [210, 255], [270, 255], [350, 250], [495, 250]], 5);
  drawPath([[4, 410], [100, 400], [210, 410], [270, 410], [350, 400], [495, 410]], 5);
  drawPath([[105, 4], [82, 98], [88, 245], [68, 338], [100, 400], [105, 495]], 5);
  drawPath([[400, 4], [390, 92], [340, 174], [350, 250], [412, 330], [350, 400], [395, 495]], 5);
  drawPath([[82, 98], [175, 175], [92, 248]], 3);
  drawPath([[92, 248], [175, 320], [68, 338]], 3);
  drawPath([[350, 250], [290, 350], [350, 400]], 3);
  drawPath([[175, 175], [210, 108]], 3);
  drawPath([[290, 350], [270, 410]], 3);
  for (const y of [108, 255, 410]) paintRect(riverCenter(y) - 13, y - 3, 27, 7, 'asphalt', true);

  const stampSettlement = (cx, cy, columns, rows, stoneBias = .3) => {
    const lotW = 16;
    const lotH = 14;
    const startX = Math.round(cx - columns * lotW / 2);
    const startY = Math.round(cy - rows * lotH / 2);
    const buildings = [];
    paintRect(startX - 4, startY - 4, columns * lotW + 8, rows * lotH + 8, 'grass', true);
    flattenRect(startX - 4, startY - 4, columns * lotW + 8, rows * lotH + 8);
    for (let column = 0; column <= columns; column++) drawLine(startX + column * lotW, startY - 3, startX + column * lotW, startY + rows * lotH + 3, 2, 'road');
    for (let row = 0; row <= rows; row++) drawLine(startX - 3, startY + row * lotH, startX + columns * lotW + 3, startY + row * lotH, 2, 'road');
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const width = randomInt(7, 11);
      const height = randomInt(6, 9);
      const x = startX + column * lotW + randomInt(3, Math.max(3, lotW - width - 1));
      const y = startY + row * lotH + randomInt(3, Math.max(3, lotH - height - 1));
      buildings.push(stampBuilding(x, y, width, height, {
        doorSide: row % 2 ? 'north' : 'south',
        floorBlock: random() < stoneBias ? 'stone_floor' : 'wood_floor',
      }));
    }
    return buildings;
  };

  const settlementSpecs = [
    { name: 'Greyhaven', cx: 82, cy: 98, columns: 5, rows: 4, stoneBias: .5, r: 48, zombies: 28 },
    { name: 'Pinecross Village', cx: 92, cy: 248, columns: 3, rows: 3, stoneBias: .2, r: 34, zombies: 15 },
    { name: 'Bellweather Village', cx: 100, cy: 400, columns: 3, rows: 3, stoneBias: .3, r: 34, zombies: 15 },
    { name: 'Eastmere Village', cx: 350, cy: 250, columns: 3, rows: 3, stoneBias: .45, r: 34, zombies: 16 },
    { name: 'Lakeside Village', cx: 350, cy: 400, columns: 3, rows: 3, stoneBias: .35, r: 34, zombies: 15 },
  ];
  const settlements = settlementSpecs.map((spec) => ({ ...spec, buildings: stampSettlement(spec.cx, spec.cy, spec.columns, spec.rows, spec.stoneBias) }));
  const settlementBuildings = settlements.flatMap((settlement) => settlement.buildings);

  const stampFarm = (cx, cy) => {
    const x = cx - 28; const y = cy - 20; const width = 56; const height = 40;
    paintRect(x, y, width, height, 'grass', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1]]);
    const buildings = [
      stampBuilding(x + 6, y + 5, 10, 8, { doorSide: 'south' }),
      stampBuilding(x + 37, y + 6, 11, 8, { doorSide: 'south' }),
      stampBuilding(x + 21, y + 6, 9, 7, { doorSide: 'south' }),
    ];
    for (let row = 0; row < 5; row++) paintRect(x + 7, y + 22 + row * 3, 39, 1, 'mud', true);
    placeBlock(x + 49, y + 29, 'firepit');
    placeBlock(x + 49, y + 22, 'workbench');
    return buildings;
  };

  const farms = [
    { name: 'Ash Creek Farms', cx: 175, cy: 175, r: 31, buildings: stampFarm(175, 175) },
    { name: 'Southbank Farmstead', cx: 290, cy: 350, r: 31, buildings: stampFarm(290, 350) },
  ];

  const stampOutpost = (cx, cy) => {
    const x = cx - 19; const y = cy - 15; const width = 38; const height = 30;
    paintRect(x, y, width, height, 'road', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1], [x + width - 1, cy]]);
    const buildings = [
      stampBuilding(x + 4, y + 4, 10, 7, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 24, y + 4, 9, 7, { doorSide: 'south', floorBlock: 'stone_floor' }),
    ];
    for (const [px, py, id] of [
      [x + 5, y + 21, 'workbench'], [x + 12, y + 21, 'furnace'], [x + 19, y + 21, 'anvil'],
      [x + 27, y + 21, 'chest'], [x + 33, y + 21, 'firepit'], [x + 2, y + 2, 'torch'], [x + 35, y + 2, 'torch'],
    ]) placeBlock(px, py, id);
    return buildings;
  };

  const outposts = [
    { name: 'Bridgewatch Market', cx: 210, cy: 108, r: 22, buildings: stampOutpost(210, 108) },
    { name: 'Central Exchange', cx: 270, cy: 255, r: 22, buildings: stampOutpost(270, 255) },
    { name: 'South Gate Traders', cx: 210, cy: 410, r: 22, buildings: stampOutpost(210, 410) },
  ];

  const stampAirfield = (cx, cy) => {
    const width = 108; const height = 64; const x = cx - width / 2; const y = cy - height / 2;
    paintRect(x, y, width, height, 'asphalt', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[x, cy - 1], [x, cy], [x + width - 1, cy - 1], [x + width - 1, cy]]);
    paintRect(x + 8, y + 12, width - 16, 9, 'asphalt', true);
    drawLine(x + 10, y + 16, x + width - 10, y + 16, 1, 'road', true);
    const buildings = [
      stampBuilding(x + 10, y + 42, 13, 9, { doorSide: 'north', floorBlock: 'stone_floor' }),
      stampBuilding(x + 35, y + 41, 14, 10, { doorSide: 'north', floorBlock: 'stone_floor' }),
      stampBuilding(x + 80, y + 42, 12, 9, { doorSide: 'north', floorBlock: 'stone_floor' }),
    ];
    for (let offset = 18, n = 0; offset < width - 14; offset += 14, n++) placeBlock(x + offset, y + 30 + n % 2, 'steel_crate', n % 2);
    for (const [px, py] of [[x + 3, y + 3], [x + width - 4, y + 3], [x + 3, y + height - 4], [x + width - 4, y + height - 4]]) placeBlock(px, py, 'torch');
    return buildings;
  };

  const airfield = { name: 'Warden Airfield', cx: 390, cy: 92, r: 58, buildings: stampAirfield(390, 92) };

  const stampFort = (cx, cy) => {
    const width = 72; const height = 58; const x = cx - width / 2; const y = cy - height / 2;
    paintRect(x, y, width, height, 'asphalt', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1], [x, cy], [x + width - 1, cy]]);
    const buildings = [
      stampBuilding(x + 7, y + 7, 12, 8, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 50, y + 7, 12, 8, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 28, y + 38, 14, 9, { doorSide: 'north', floorBlock: 'stone_floor' }),
    ];
    for (const [px, py] of [[x + 4, y + 4], [x + width - 5, y + 4], [x + 4, y + height - 5], [x + width - 5, y + height - 5]]) placeBlock(px, py, 'torch');
    for (const [px, py] of [[x + 25, y + 20], [x + 35, y + 20], [x + 45, y + 20], [x + 20, y + 30], [x + 50, y + 30]]) placeBlock(px, py, 'steel_crate');
    return buildings;
  };

  const fort = { name: 'Fort Greywall', cx: 412, cy: 330, r: 43, buildings: stampFort(412, 330) };

  const stampIndustrial = (cx, cy) => {
    const width = 72; const height = 36; const x = cx - width / 2; const y = cy - height / 2;
    paintRect(x, y, width, height, 'asphalt', true); flattenRect(x, y, width, height);
    for (let offset = 7; offset < height - 4; offset += 8) drawLine(x + 3, y + offset, x + width - 4, y + offset, 2, 'road', true);
    const buildings = [
      stampBuilding(x + 5, y + 4, 12, 8, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 53, y + 22, 13, 9, { doorSide: 'north', floorBlock: 'stone_floor' }),
    ];
    for (const [px, py] of [[x + 24, y + 8], [x + 31, y + 8], [x + 39, y + 17], [x + 46, y + 25], [x + 25, y + 27]]) placeBlock(px, py, 'steel_crate');
    return buildings;
  };

  const railYard = { name: 'Old Greyvale Rail Yard', cx: 340, cy: 174, r: 42, buildings: stampIndustrial(340, 174) };

  const stampHospital = (cx, cy) => {
    const width = 50; const height = 40; const x = cx - width / 2; const y = cy - height / 2;
    paintRect(x, y, width, height, 'road', true); flattenRect(x, y, width, height);
    fenceRect(x, y, width, height, [[cx - 1, y + height - 1], [cx, y + height - 1]]);
    const buildings = [
      stampBuilding(x + 5, y + 5, 14, 9, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 29, y + 5, 14, 9, { doorSide: 'south', floorBlock: 'stone_floor' }),
      stampBuilding(x + 18, y + 24, 14, 9, { doorSide: 'north', floorBlock: 'stone_floor' }),
    ];
    placeBlock(x + 3, y + 3, 'torch'); placeBlock(x + width - 4, y + 3, 'torch');
    return buildings;
  };

  const hospital = { name: 'Saint Mercy Hospital', cx: 175, cy: 320, r: 30, buildings: stampHospital(175, 320) };
  const allBuildings = [
    ...settlementBuildings,
    ...farms.flatMap((farm) => farm.buildings),
    ...outposts.flatMap((outpost) => outpost.buildings),
    ...airfield.buildings,
    ...fort.buildings,
    ...railYard.buildings,
    ...hospital.buildings,
  ];

  const spawnPoints = [
    [24, 55], [24, 190], [24, 300], [24, 455], [475, 42], [475, 155], [475, 280], [475, 455],
    [58, 24], [185, 24], [315, 24], [445, 24], [62, 475], [185, 475], [315, 475], [440, 475],
  ];
  const extracts = [[4, 105], [4, 410], [495, 95], [495, 410], [105, 4], [400, 4], [105, 495], [395, 495]];
  for (const [x, y] of [...spawnPoints, ...extracts]) clearArea(x, y, 7);
  for (const [x, y] of spawnPoints) addObject('spawn', x, y);
  for (const [x, y] of extracts) addObject('extract', x, y);

  for (const settlement of settlements) addObject('poi_town', settlement.cx, settlement.cy, { name: settlement.name, r: settlement.r });
  for (const farm of farms) addObject('poi_zone', farm.cx, farm.cy, { name: farm.name, r: farm.r, zoneKind: 'wilds', safe: false, hot: false });
  for (const outpost of outposts) addObject('trader', outpost.cx, outpost.cy, { name: outpost.name, r: outpost.r });
  addObject('poi_airport', airfield.cx, airfield.cy, { name: airfield.name, r: airfield.r });
  addObject('poi_hotzone', fort.cx, fort.cy, { name: fort.name, r: fort.r });
  for (const region of [
    { name: 'Gloamwood Forest', x: 90, y: 195, r: 72, zoneKind: 'wilds', hot: false },
    { name: 'Wolfpine Forest', x: 405, y: 210, r: 62, zoneKind: 'wilds', hot: false },
    { name: 'Copperhead Quarry', x: 68, y: 338, r: 45, zoneKind: 'wilds', hot: false },
    { name: 'Hollow Lake', x: 287, y: 58, r: 40, zoneKind: 'wilds', hot: false },
    { name: 'Drowned Fen', x: 292, y: 449, r: 42, zoneKind: 'hotzone', hot: true },
    { name: railYard.name, x: railYard.cx, y: railYard.cy, r: railYard.r, zoneKind: 'hotzone', hot: true },
    { name: hospital.name, x: hospital.cx, y: hospital.cy, r: hospital.r, zoneKind: 'hotzone', hot: true },
    { name: 'Burnt Orchard', x: 165, y: 445, r: 35, zoneKind: 'wilds', hot: false },
  ]) addObject('poi_zone', region.x, region.y, { name: region.name, r: region.r, zoneKind: region.zoneKind, safe: false, hot: region.hot });
  addObject('trader_black', railYard.cx, railYard.cy);
  addObject('trader_black', 68, 315);

  // Every settlement has searchable interiors, while high-risk sites concentrate military loot.
  for (let index = 0; index < settlementBuildings.length; index += 2) {
    const building = settlementBuildings[index];
    addObject('chest', building.cx, building.cy);
  }
  for (const farm of farms) for (const building of farm.buildings) addObject('chest', building.cx, building.cy);
  for (const building of airfield.buildings) addObject('chest_military', building.cx, building.cy);
  for (const building of fort.buildings) addObject('chest_military', building.cx, building.cy);
  for (const building of railYard.buildings) addObject('chest_custom', building.cx, building.cy, { lootTable: 'rare' });
  for (const building of hospital.buildings) addObject('chest_custom', building.cx, building.cy, { lootTable: 'rare' });

  const protectedSpawnPoints = [...spawnPoints, ...extracts];
  const occupiedGameplay = new Set(objects.filter((object) => !object.type.startsWith('poi_')).map((object) => `${object.x},${object.y}`));
  const terrainIdAt = (index) => terrain[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
  const scatterObjects = (type, count, bounds, extra = {}) => {
    const isMob = type === 'mob' || BUILTIN_MOB_TYPES.has(type) || Object.hasOwn(mobDefs, type);
    let placed = 0;
    for (let attempt = 0; attempt < count * 200 && placed < count; attempt++) {
      const x = randomInt(bounds[0], bounds[2]); const y = randomInt(bounds[1], bounds[3]);
      const index = indexOf(x, y); const position = `${x},${y}`;
      const terrainDefinition = terrainDefs[terrainIdAt(index)];
      const blockDefinition = blockDefs[blocks[String(index)]];
      if (occupiedGameplay.has(position) || elevations[index] > 1) continue;
      if (terrainDefinition?.collision?.move || blockDefinition?.collision?.move) continue;
      if (isMob && (
        terrainDefinition?.collision?.enemy
        || blockDefinition?.collision?.enemy
        || outposts.some((outpost) => Math.hypot(x - outpost.cx, y - outpost.cy) < outpost.r + 11)
        || protectedSpawnPoints.some(([px, py]) => Math.hypot(x - px, y - py) < 17)
      )) continue;
      addObject(type, x, y, extra);
      occupiedGameplay.add(position);
      placed++;
    }
    if (placed < count) throw new Error(`Could only place ${placed}/${count} ${type} objects`);
  };

  for (const settlement of settlements) {
    scatterObjects('loot', settlement.name === 'Greyhaven' ? 14 : 8, [settlement.cx - settlement.r, settlement.cy - settlement.r, settlement.cx + settlement.r, settlement.cy + settlement.r]);
    scatterObjects('zombie', settlement.zombies, [settlement.cx - settlement.r, settlement.cy - settlement.r, settlement.cx + settlement.r, settlement.cy + settlement.r]);
  }
  for (const farm of farms) {
    scatterObjects('loot', 9, [farm.cx - farm.r, farm.cy - farm.r, farm.cx + farm.r, farm.cy + farm.r]);
    scatterObjects('zombie', 8, [farm.cx - farm.r, farm.cy - farm.r, farm.cx + farm.r, farm.cy + farm.r]);
  }
  scatterObjects('loot', 16, [airfield.cx - airfield.r, airfield.cy - airfield.r, airfield.cx + airfield.r, airfield.cy + airfield.r]);
  scatterObjects('chest_custom', 8, [airfield.cx - airfield.r, airfield.cy - airfield.r, airfield.cx + airfield.r, airfield.cy + airfield.r], { lootTable: 'rare' });
  scatterObjects('military', 30, [airfield.cx - airfield.r, airfield.cy - airfield.r, airfield.cx + airfield.r, airfield.cy + airfield.r]);
  scatterObjects('loot', 14, [fort.cx - fort.r, fort.cy - fort.r, fort.cx + fort.r, fort.cy + fort.r]);
  scatterObjects('chest_custom', 8, [fort.cx - fort.r, fort.cy - fort.r, fort.cx + fort.r, fort.cy + fort.r], { lootTable: 'rare' });
  scatterObjects('military', 25, [fort.cx - fort.r, fort.cy - fort.r, fort.cx + fort.r, fort.cy + fort.r]);
  scatterObjects('loot', 10, [railYard.cx - railYard.r, railYard.cy - railYard.r, railYard.cx + railYard.r, railYard.cy + railYard.r]);
  scatterObjects('chest_custom', 6, [railYard.cx - railYard.r, railYard.cy - railYard.r, railYard.cx + railYard.r, railYard.cy + railYard.r], { lootTable: 'military' });
  scatterObjects('military', 15, [railYard.cx - railYard.r, railYard.cy - railYard.r, railYard.cx + railYard.r, railYard.cy + railYard.r]);
  scatterObjects('loot', 10, [hospital.cx - hospital.r, hospital.cy - hospital.r, hospital.cx + hospital.r, hospital.cy + hospital.r]);
  scatterObjects('chest_custom', 5, [hospital.cx - hospital.r, hospital.cy - hospital.r, hospital.cx + hospital.r, hospital.cy + hospital.r], { lootTable: 'rare' });
  scatterObjects('zombie', 16, [hospital.cx - hospital.r, hospital.cy - hospital.r, hospital.cx + hospital.r, hospital.cy + hospital.r]);
  addObject('mob', fort.cx, fort.cy, { contentId: 'brute', respawnMs: 300_000 });
  occupiedGameplay.add(`${fort.cx},${fort.cy}`);

  // Fauna is biome-biased so empty travel lanes still carry movement and risk.
  scatterObjects('deer', 16, [20, 125, 205, 285]);
  scatterObjects('deer', 10, [270, 335, 470, 480]);
  scatterObjects('rabbit', 20, [20, 120, 235, 300]);
  scatterObjects('rabbit', 18, [30, 350, 340, 480]);
  scatterObjects('boar', 12, [25, 280, 185, 390]);
  scatterObjects('boar', 10, [275, 365, 470, 480]);
  scatterObjects('wolf', 14, [320, 130, 475, 285]);
  scatterObjects('wolf', 12, [20, 20, 175, 185]);
  scatterObjects('fox', 16, [20, 120, 225, 300]);
  scatterObjects('fox', 12, [265, 335, 470, 480]);
  scatterObjects('bear', 7, [330, 135, 475, 285]);
  scatterObjects('bear', 5, [25, 25, 175, 185]);

  const scatterResource = (id, count, bounds) => {
    const allowedTerrain = id === 'tree' || id === 'ironwood' ? new Set(['grass', 'mud']) : new Set(['grass', 'mud', 'rock']);
    let placed = 0;
    for (let attempt = 0; attempt < count * 140 && placed < count; attempt++) {
      const x = randomInt(bounds[0], bounds[2]); const y = randomInt(bounds[1], bounds[3]);
      const index = indexOf(x, y);
      if (x < 5 || y < 5 || x >= W - 5 || y >= H - 5) continue;
      if (reserved.has(index) || blocks[String(index)] || resources[String(index)] || occupiedGameplay.has(`${x},${y}`)) continue;
      if (protectedSpawnPoints.some(([px, py]) => Math.hypot(x - px, y - py) < 10)) continue;
      if (!allowedTerrain.has(terrainIdAt(index))) continue;
      placeResource(x, y, id);
      placed++;
    }
    if (placed < count) throw new Error(`Could only place ${placed}/${count} ${id} resources`);
  };

  scatterResource('tree', 3_500, [6, 6, 493, 493]);
  scatterResource('tree', 1_250, [18, 125, 195, 285]);
  scatterResource('tree', 1_100, [310, 125, 480, 285]);
  scatterResource('tree', 800, [265, 345, 480, 490]);
  scatterResource('ironwood', 320, [25, 130, 180, 275]);
  scatterResource('rock', 500, [6, 6, 493, 493]);
  scatterResource('rock', 240, [25, 295, 112, 382]);
  scatterResource('copper_vein', 65, [28, 300, 108, 378]);
  scatterResource('iron_vein', 55, [28, 300, 108, 378]);
  scatterResource('iron_vein', 45, [385, 385, 475, 480]);

  const workingMap = { w: W, h: H, tiles, elevations, terrain, resources, blocks, blockRotations, objects };
  const report = validateFrontierMap(workingMap, { terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs });
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

export function validateFrontierMap(map, { terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs }) {
  const errors = [];
  const tiles = map.tiles instanceof Uint8Array ? map.tiles : decodeAuthoredTiles(map);
  const elevations = map.elevations instanceof Uint8Array ? map.elevations : decodeAuthoredElevations(map);
  const terrainOverrides = { ...decodeTerrainRuns(map.terrainRuns, map.w * map.h), ...(map.terrain ?? {}) };
  if (map.w !== FRONTIER_MAP_SIZE || map.h !== FRONTIER_MAP_SIZE) errors.push(`Map must be ${FRONTIER_MAP_SIZE}x${FRONTIER_MAP_SIZE}`);
  if (tiles.length !== map.w * map.h) errors.push('Tile count does not match dimensions');
  if (elevations.length !== map.w * map.h) errors.push('Elevation count does not match dimensions');

  const usedTerrain = new Set(Object.values(terrainOverrides));
  for (const tile of new Set(tiles)) usedTerrain.add(DEFAULT_TERRAIN_ID_BY_TILE[tile] ?? 'grass');
  const usedBlocks = new Set(Object.values(map.blocks));
  const usedResources = new Set(Object.values(map.resources));
  const usedMobs = new Set(map.objects.flatMap((object) => object.type === 'mob' ? [object.contentId] : BUILTIN_MOB_TYPES.has(object.type) || Object.hasOwn(mobDefs, object.type) ? [object.type] : []));
  const usedLoot = new Set(map.objects.filter((object) => object.type === 'chest_custom').map((object) => object.lootTable));
  for (const id of usedTerrain) if (!terrainDefs[id]) errors.push(`Unknown terrain: ${id}`);
  for (const id of usedBlocks) if (!blockDefs[id]) errors.push(`Unknown block: ${id}`);
  for (const id of usedResources) if (!resourceDefs[id]) errors.push(`Unknown resource: ${id}`);
  for (const id of usedMobs) if (!mobDefs[id]) errors.push(`Unknown mob: ${id}`);
  for (const id of usedLoot) if (!lootDefs[id]) errors.push(`Unknown loot table: ${id}`);

  const terrainIdAt = (index) => terrainOverrides[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
  const passable = (index) => {
    const terrainDefinition = terrainDefs[terrainIdAt(index)];
    const blockDefinition = blockDefs[map.blocks[String(index)]];
    return !terrainDefinition?.collision?.move && !blockDefinition?.collision?.move;
  };
  const spawns = map.objects.filter((object) => object.type === 'spawn');
  const extracts = map.objects.filter((object) => object.type === 'extract');
  const critical = map.objects.filter((object) => ['spawn', 'extract', 'trader', 'trader_black'].includes(object.type));
  const gameplayObjects = map.objects.filter((object) => !object.type.startsWith('poi_'));
  const regions = map.objects.filter((object) => object.type.startsWith('poi_'));
  const traders = map.objects.filter((object) => object.type === 'trader');
  const enemies = map.objects.filter((object) => object.type === 'mob' || BUILTIN_MOB_TYPES.has(object.type) || Object.hasOwn(mobDefs, object.type));
  const enemyCounts = enemies.reduce((counts, object) => {
    const id = object.type === 'mob' ? object.contentId : object.type;
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  const fauna = ['deer', 'rabbit', 'boar', 'wolf', 'fox', 'bear'].reduce((sum, id) => sum + (enemyCounts[id] ?? 0), 0);
  const containers = map.objects.filter((object) => ['chest', 'chest_military', 'chest_custom'].includes(object.type));
  const hotRegions = regions.filter((object) => object.type === 'poi_airport' || object.type === 'poi_hotzone' || object.hot);
  const resourceCounts = Object.values(map.resources).reduce((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
  if (spawns.length < 12) errors.push('Map needs at least twelve spawn points');
  if (extracts.length < 6) errors.push('Map needs at least six extraction beacons');
  if (regions.length + traders.length < 18) errors.push('Map needs at least eighteen named regions');
  if (map.objects.filter((object) => object.type === 'poi_town').length < 5) errors.push('Map needs a town and at least four villages');
  if (map.objects.filter((object) => object.type === 'poi_airport').length < 1) errors.push('Map needs an airfield');
  if (traders.length < 3) errors.push('Map needs at least three safe traders');
  if (hotRegions.length < 5) errors.push('Map needs at least five high-value regions');
  if (enemies.length < 260) errors.push('Map needs at least 260 creature and enemy spawns');
  if ((enemyCounts.zombie ?? 0) < 95) errors.push('Map needs at least 95 infected spawns');
  if ((enemyCounts.military ?? 0) < 60) errors.push('Map needs at least 60 military spawns');
  if (fauna < 100) errors.push('Map needs at least 100 fauna spawns');
  if (containers.length < 50) errors.push('Map needs at least 50 loot containers');
  if (Object.keys(map.resources).length < 7_000) errors.push('Map needs at least 7,000 persistent resource nodes');

  for (const trader of traders) {
    const unsafeEnemy = enemies.find((enemy) => Math.hypot(enemy.x - trader.x, enemy.y - trader.y) < (trader.r ?? 8) + 10);
    if (unsafeEnemy) errors.push(`${trader.name ?? 'Trader'} contains ${unsafeEnemy.type} at ${unsafeEnemy.x},${unsafeEnemy.y}`);
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
    const x = index % map.w; const y = Math.floor(index / map.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const next = ny * map.w + nx;
      if (visited[next] || !passable(next) || Math.abs(elevations[next] - elevations[index]) > 1) continue;
      visited[next] = 1; queue[queueLength++] = next;
    }
  }
  for (const object of critical) if (!visited[object.y * map.w + object.x]) errors.push(`${object.type} at ${object.x},${object.y} is unreachable`);
  const occupied = new Set();
  for (const object of gameplayObjects) {
    const index = object.y * map.w + object.x;
    const position = `${object.x},${object.y}`;
    const mobId = object.type === 'mob' ? object.contentId : BUILTIN_MOB_TYPES.has(object.type) || Object.hasOwn(mobDefs, object.type) ? object.type : null;
    const terrainDefinition = terrainDefs[terrainIdAt(index)];
    const blockDefinition = blockDefs[map.blocks[String(index)]];
    if (object.x < 0 || object.y < 0 || object.x >= map.w || object.y >= map.h) errors.push(`${object.type} at ${position} is out of bounds`);
    if (!passable(index)) errors.push(`${object.type} at ${position} is embedded in collision`);
    if (mobId && (terrainDefinition?.collision?.enemy || blockDefinition?.collision?.enemy)) errors.push(`${object.type} at ${position} blocks enemy navigation`);
    if (!visited[index]) errors.push(`${object.type} at ${position} is unreachable`);
    if (occupied.has(position)) errors.push(`Multiple gameplay objects overlap at ${position}`);
    occupied.add(position);
  }
  let walkable = 0; let reachableWalkable = 0;
  for (let index = 0; index < tiles.length; index++) {
    if (passable(index)) walkable++;
    if (visited[index]) reachableWalkable++;
  }
  const connectivity = walkable ? reachableWalkable / walkable : 0;
  if (connectivity < .92) errors.push(`Only ${(connectivity * 100).toFixed(1)}% of walkable cells are connected`);
  if (errors.length) throw new Error(`Frontier map validation failed:\n- ${errors.join('\n- ')}`);

  return {
    size: `${map.w}x${map.h}`,
    objects: map.objects.length,
    regions: regions.length + traders.length,
    towns: map.objects.filter((object) => object.type === 'poi_town').length,
    airfields: map.objects.filter((object) => object.type === 'poi_airport').length,
    safeTraders: traders.length,
    blackMarketTraders: map.objects.filter((object) => object.type === 'trader_black').length,
    hotRegions: hotRegions.length,
    spawns: spawns.length,
    extracts: extracts.length,
    containers: containers.length,
    enemies: enemies.length,
    fauna,
    enemyCounts,
    blocks: Object.keys(map.blocks).length,
    blockKinds: usedBlocks.size,
    resources: Object.keys(map.resources).length,
    resourceCounts,
    resourceKinds: usedResources.size,
    terrainKinds: usedTerrain.size,
    connectedWalkablePercent: Number((connectivity * 100).toFixed(1)),
  };
}

export function renderFrontierPreview(map, terrainDefs, requestedScale = 2) {
  const tiles = map.tiles instanceof Uint8Array ? map.tiles : decodeAuthoredTiles(map);
  const elevations = map.elevations instanceof Uint8Array ? map.elevations : decodeAuthoredElevations(map);
  const terrainOverrides = { ...decodeTerrainRuns(map.terrainRuns, map.w * map.h), ...(map.terrain ?? {}) };
  const scale = Math.max(1, Math.min(4, requestedScale | 0));
  const png = new PNG({ width: map.w * scale, height: map.h * scale });
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const index = y * map.w + x;
    const terrainId = terrainOverrides[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[tiles[index]] ?? 'grass';
    let [red, green, blue] = numericColor(terrainDefs[terrainId]?.minimapColor);
    const level = elevations[index] ?? 0;
    red = Math.min(255, red + level * 13); green = Math.min(255, green + level * 13); blue = Math.min(255, blue + level * 10);
    if (map.blocks[String(index)]) [red, green, blue] = [190, 151, 73];
    if (map.resources[String(index)]) [red, green, blue] = tiles[index] === Tile.Tree ? [45, 78, 43] : [100, 101, 94];
    for (let py = 0; py < scale; py++) for (let px = 0; px < scale; px++) {
      const offset = ((y * scale + py) * png.width + x * scale + px) * 4;
      png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
    }
  }
  const objectColors = {
    spawn: [100, 220, 145], extract: [245, 225, 91], trader: [65, 225, 135], trader_black: [204, 80, 68],
    poi_town: [238, 219, 174], poi_airport: [235, 78, 60], poi_hotzone: [235, 78, 60],
  };
  for (const object of map.objects) {
    const color = objectColors[object.type];
    if (!color) continue;
    const radius = object.type.startsWith('poi_') ? 3 : 2;
    const cx = object.x * scale + Math.floor(scale / 2); const cy = object.y * scale + Math.floor(scale / 2);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const offset = (y * png.width + x) * 4;
      png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
