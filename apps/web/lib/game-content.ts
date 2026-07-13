import {
  BUILDABLES,
  BLOCKS_BULLET,
  BLOCKS_ENEMY,
  BLOCKS_MOVE,
  DEFAULT_LOOT_TABLES,
  DEFAULT_PIXEL_PALETTE,
  ENEMY_DEFS,
  ENGINE_CONTENT_KINDS,
  ENTITY_ANIMATION_STATES,
  EngineContentKind,
  ITEMS,
  ITEM_SPRITE_ORDER,
  RECIPES,
  Tile,
  TRADER_STOCK,
  TRADER_STOCK_T2,
} from '@holdout/shared';

const spriteAssets = [
  ...ITEM_SPRITE_ORDER.map((id, col) => ({
    id: `item:${id}`,
    name: ITEMS[id as keyof typeof ITEMS].name,
    width: 16,
    height: 16,
    pixels: [] as string[],
    source: { sheet: 'items' as const, col, row: 0 },
  })),
  ...Object.entries({ player: 0, zombie: 8, military: 9, trader: 10, deer: 11, rabbit: 12, boar: 13, wolf: 14 })
    .map(([id, row]) => ({
      id: `character:${id}`,
      name: id.replace('_', ' '),
      width: 16,
      height: 16,
      pixels: [] as string[],
      source: { sheet: 'chars' as const, col: 0, row, frames: 2 },
    })),
  { id: 'character:brute', name: 'Brute', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'chars' as const, col: 0, row: 8, frames: 2 } },
  { id: 'resource:tree', name: 'Common tree', width: 32, height: 32, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 10, row: 0, frames: 1 } },
  { id: 'resource:ironwood', name: 'Ironwood tree', width: 32, height: 32, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 10, row: 0, frames: 1 } },
  { id: 'resource:rock', name: 'Stone outcrop', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 12, row: 0, frames: 1 } },
  { id: 'resource:copper_vein', name: 'Copper vein', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 25, row: 0, frames: 1 } },
  { id: 'resource:iron_vein', name: 'Iron vein', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 26, row: 0, frames: 1 } },
  { id: 'block:steel_crate', name: 'Steel crate block', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 14, row: 0, frames: 1 } },
  ...Object.entries({ workbench: 14, firepit: 15, furnace: 16, wood_floor: 19, stone_floor: 20, wall: 21, door: 22, fence: 23, torch: 24, anvil: 27 })
    .map(([id, col]) => ({ id: `block:${id}`, name: BUILDABLES[id as keyof typeof BUILDABLES].name, width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col, row: 0, frames: 1 } })),
  { id: 'block:bed', name: 'Bed', width: 16, height: 32, pixels: [] as string[] },
  { id: 'block:chest', name: 'Storage chest', width: 16, height: 16, pixels: [] as string[] },
  { id: 'terrain:mud', name: 'Deep mud', width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: 4, row: 0, frames: 1 } },
  ...[
    ['grass', 'Grass', 0], ['water', 'Water', 2], ['sand', 'Sand', 3], ['road', 'Dirt road', 4],
    ['asphalt', 'Asphalt', 5], ['floor', 'Interior floor', 6], ['wall', 'Building wall', 7],
    ['doormat', 'Door mat', 8], ['tree', 'Tree ground', 0], ['rock', 'Rock ground', 12],
    ['bed', 'Bed', 13], ['copper_ore', 'Copper vein', 25], ['iron_ore', 'Iron vein', 26], ['cliff', 'Cliff', 28],
  ].map(([id, name, col]) => ({ id: `terrain:${id}`, name: String(name), width: 16, height: 16, pixels: [] as string[], source: { sheet: 'tiles' as const, col: Number(col), row: 0, frames: 1 } })),
];

const defaultClips = {
  idle: { frames: [0], frameMs: 500, loop: true },
  walk: { frames: [0, 1], frameMs: 125, loop: true },
  attack: { frames: [1, 0], frameMs: 110, loop: false },
  hit: { frames: [1, 0], frameMs: 90, loop: false },
  death: { frames: [1], frameMs: 400, loop: false },
};

const defaultResources = {
  tree: { id: 'tree', name: 'Common tree', tile: Tile.Tree, depletedTile: Tile.Stump, maxHits: 6, respawnMs: 240_000, skill: 'woodcutting', spriteId: 'resource:tree', hitSound: 'chop', breakSound: 'tree_fall', drops: [{ itemId: 'wood', min: 2, max: 3, chance: 1, when: 'hit' }] },
  ironwood: { id: 'ironwood', name: 'Ironwood tree', tile: Tile.Tree, depletedTile: Tile.Stump, maxHits: 14, respawnMs: 480_000, skill: 'woodcutting', spriteId: 'resource:ironwood', hitSound: 'wood_heavy', breakSound: 'tree_crack', drops: [{ itemId: 'wood', min: 3, max: 5, chance: 1, when: 'hit' }, { itemId: 'iron_ore', min: 1, max: 2, chance: 0.35, when: 'depleted' }] },
  rock: { id: 'rock', name: 'Stone outcrop', tile: Tile.Rock, depletedTile: Tile.Rubble, maxHits: 8, respawnMs: 240_000, skill: 'mining', spriteId: 'resource:rock', hitSound: 'mine', breakSound: 'rock_break', drops: [{ itemId: 'stone', min: 2, max: 3, chance: 1, when: 'hit' }] },
  copper_vein: { id: 'copper_vein', name: 'Copper vein', tile: Tile.CopperOre, depletedTile: Tile.Rubble, maxHits: 8, respawnMs: 300_000, skill: 'mining', spriteId: 'resource:copper_vein', hitSound: 'mine', breakSound: 'rock_break', drops: [{ itemId: 'stone', min: 2, max: 3, chance: 1, when: 'hit' }, { itemId: 'copper_ore', min: 1, max: 1, chance: 1, when: 'hit' }] },
  iron_vein: { id: 'iron_vein', name: 'Iron vein', tile: Tile.IronOre, depletedTile: Tile.Rubble, maxHits: 10, respawnMs: 360_000, skill: 'mining', spriteId: 'resource:iron_vein', hitSound: 'mine_heavy', breakSound: 'rock_break', drops: [{ itemId: 'stone', min: 2, max: 3, chance: 1, when: 'hit' }, { itemId: 'iron_ore', min: 1, max: 1, chance: 1, when: 'hit' }] },
};

const preset = (id: string, name: string, frequency: number, endFrequency: number, durationMs: number, wave = 'triangle', noise = 0.05) => ({ id, name, frequency, endFrequency, durationMs, wave, volume: 0.16, noise, filterHz: 2400 });
const defaultSounds = {
  presets: {
    step: preset('step', 'Soft terrain step', 105, 72, 70, 'triangle', 0.12),
    chop: preset('chop', 'Wood chop', 100, 62, 90, 'triangle', 0.16),
    wood_heavy: preset('wood_heavy', 'Heavy wood impact', 78, 42, 150, 'sawtooth', 0.22),
    tree_fall: preset('tree_fall', 'Tree falling', 90, 28, 650, 'sawtooth', 0.28),
    tree_crack: preset('tree_crack', 'Ironwood crack', 64, 22, 900, 'square', 0.32),
    mine: preset('mine', 'Pick strike', 420, 150, 80, 'square', 0.12),
    mine_heavy: preset('mine_heavy', 'Heavy pick strike', 280, 70, 150, 'square', 0.2),
    rock_break: preset('rock_break', 'Rock break', 180, 42, 380, 'sawtooth', 0.3),
    brute_roar: preset('brute_roar', 'Brute roar', 92, 48, 700, 'sawtooth', 0.18),
    brute_slam: preset('brute_slam', 'Brute slam', 68, 24, 260, 'square', 0.35),
  },
  actions: { harvest_wood: 'chop', harvest_stone: 'mine', tree_break: 'tree_fall', rock_break: 'rock_break' },
};

const defaultWorldBlocks = {
  steel_crate: { id: 'steel_crate', name: 'Steel crate', spriteId: 'block:steel_crate', scale: 1, offsetY: 0, maxHp: 120, destructible: true, collision: { move: true, enemy: true, bullets: true, sight: false }, hitSound: 'mine_heavy', breakSound: 'rock_break', drops: [{ itemId: 'scrap', min: 2, max: 5, chance: 1, when: 'depleted' }] },
  ...Object.fromEntries(Object.entries(BUILDABLES).map(([buildType, buildable]) => {
    const kit = Object.values(ITEMS).find((item) => item.place === buildType)!;
    const tile = buildable.tile;
    return [buildType, {
      id: buildType, name: buildable.name, spriteId: `block:${buildType}`, scale: 1, offsetY: 0,
      maxHp: Math.max(1, buildable.hp), destructible: buildable.hp > 0,
      collision: {
        move: tile === null ? true : Boolean(BLOCKS_MOVE[tile]),
        enemy: tile === null ? true : Boolean(BLOCKS_ENEMY[tile]),
        bullets: tile === null ? false : Boolean(BLOCKS_BULLET[tile]),
        sight: tile === null ? false : Boolean(BLOCKS_BULLET[tile]),
      },
      drops: [],
      playerPlacement: { buildType, kitItemId: kit.id, simulationTile: tile, hideoutOnly: Boolean(buildable.hideoutOnly), foundation: buildType === 'wood_floor' || buildType === 'stone_floor', storageSlots: buildType === 'chest' ? 12 : 0 },
    }];
  })),
};

const defaultTerrain = {
  grass: { id: 'grass', name: 'Grass', spriteId: 'terrain:grass', simulationTile: Tile.Grass, minimapColor: '#527741', moveMultiplier: 1, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  water: { id: 'water', name: 'Water', spriteId: 'terrain:water', simulationTile: Tile.Water, minimapColor: '#3f7197', moveMultiplier: 1, swimmable: true, collision: { move: false, enemy: true, bullets: false, sight: false } },
  sand: { id: 'sand', name: 'Sand', spriteId: 'terrain:sand', simulationTile: Tile.Sand, minimapColor: '#bda66e', moveMultiplier: .9, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  road: { id: 'road', name: 'Dirt road', spriteId: 'terrain:road', simulationTile: Tile.Road, minimapColor: '#81765a', moveMultiplier: 1, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  asphalt: { id: 'asphalt', name: 'Asphalt', spriteId: 'terrain:asphalt', simulationTile: Tile.Asphalt, minimapColor: '#44464b', moveMultiplier: 1, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  floor: { id: 'floor', name: 'Interior floor', spriteId: 'terrain:floor', simulationTile: Tile.Floor, minimapColor: '#96704c', moveMultiplier: 1, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  wall: { id: 'wall', name: 'Building wall', spriteId: 'terrain:wall', simulationTile: Tile.Wall, minimapColor: '#49382b', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  tree: { id: 'tree', name: 'Tree', spriteId: 'terrain:tree', simulationTile: Tile.Tree, minimapColor: '#294f30', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  rock: { id: 'rock', name: 'Rock', spriteId: 'terrain:rock', simulationTile: Tile.Rock, minimapColor: '#777a7d', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  copper_ore: { id: 'copper_ore', name: 'Copper vein', spriteId: 'terrain:copper_ore', simulationTile: Tile.CopperOre, minimapColor: '#ad683d', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  iron_ore: { id: 'iron_ore', name: 'Iron vein', spriteId: 'terrain:iron_ore', simulationTile: Tile.IronOre, minimapColor: '#929ba5', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  cliff: { id: 'cliff', name: 'Cliff', spriteId: 'terrain:cliff', simulationTile: Tile.Cliff, minimapColor: '#5f564b', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: true, sight: true } },
  doormat: { id: 'doormat', name: 'Door mat', spriteId: 'terrain:doormat', simulationTile: Tile.DoorMat, minimapColor: '#7b6844', moveMultiplier: 1, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false } },
  bed: { id: 'bed', name: 'Bed', spriteId: 'terrain:bed', simulationTile: Tile.Bed, minimapColor: '#6f7b86', moveMultiplier: 1, swimmable: false, collision: { move: true, enemy: true, bullets: false, sight: false } },
  mud: { id: 'mud', name: 'Deep mud', spriteId: 'terrain:mud', simulationTile: Tile.Grass, minimapColor: '#655943', moveMultiplier: 0.65, swimmable: false, collision: { move: false, enemy: false, bullets: false, sight: false }, footstepSound: 'step' },
};

export function defaultGameContent(kind: EngineContentKind): unknown {
  switch (kind) {
    case 'items':
      return ITEMS;
    case 'recipes':
      return RECIPES;
    case 'mobs':
      return {
        ...Object.fromEntries(Object.entries(ENEMY_DEFS).map(([id, def]) => [id, {
        id,
        ...def,
        boss: false,
        lootTable: id === 'military' ? 'military_drop' : id,
        spriteId: `character:${id}`,
        respawnMs: 90_000,
        }])),
        brute: { id: 'brute', name: 'infected brute', behavior: 'melee', maxHp: 240, speed: 82, aggroRange: 280, attackRange: 38, damage: 28, attackMs: 1450, boss: true, lootTable: 'zombie', spriteId: 'character:brute', respawnMs: 240_000, sounds: { alert: 'brute_roar', attack: 'brute_slam', death: 'brute_roar' } },
      };
    case 'loot':
      return DEFAULT_LOOT_TABLES;
    case 'traders':
      return {
        outpost: { id: 'outpost', name: 'Outpost quartermaster', questTier: 1, stock: TRADER_STOCK },
        black_market: { id: 'black_market', name: 'Black-market dealer', questTier: 2, stock: TRADER_STOCK_T2 },
      };
    case 'blocks':
      return { version: 1, world: defaultWorldBlocks, legacyBuildables: BUILDABLES };
    case 'sprites':
      return { palette: DEFAULT_PIXEL_PALETTE, assets: spriteAssets };
    case 'animations':
      return {
        player: { spriteId: 'character:player', clips: defaultClips },
        ...Object.fromEntries(Object.keys(ENEMY_DEFS).map((id) => [`mob:${id}`, { spriteId: `character:${id}`, clips: defaultClips }])),
        'mob:brute': { spriteId: 'character:brute', clips: { ...defaultClips, attack: { frames: [0, 1, 1, 0], frameMs: 180, loop: false, keyframes: [{ frame: 0, durationMs: 220, soundId: 'brute_roar', event: 'windup' }, { frame: 1, durationMs: 320, soundId: 'brute_slam', event: 'impact' }, { frame: 0, durationMs: 260, event: 'recover' }] } } },
      };
    case 'resources':
      return defaultResources;
    case 'terrain':
      return defaultTerrain;
    case 'sounds':
      return defaultSounds;
    case 'settings':
      return {
        map: { minSize: 20, maxSize: 200 },
        publishing: { contentPollMs: 10_000, questPollMs: 60_000 },
        notes: 'Global tuning values are introduced here as their runtime systems are migrated.',
      };
  }
}

export function isEngineContentKind(value: string): value is EngineContentKind {
  return (ENGINE_CONTENT_KINDS as readonly string[]).includes(value);
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function text(value: unknown, fallback: string, max = 80): string {
  const result = typeof value === 'string' ? value.trim() : '';
  return (result || fallback).slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Validate content at the trust boundary before it can become a live document. */
export function sanitizeGameContent(kind: EngineContentKind, input: unknown): unknown {
  const maxBytes = kind === 'sprites' ? 4_000_000 : 2_000_000;
  if (JSON.stringify(input).length > maxBytes) throw new Error(`Content document exceeds ${maxBytes / 1_000_000} MB`);

  if (kind === 'items') {
    const out: Record<string, unknown> = {};
    const itemKinds = ['weapon', 'tool', 'ammo', 'material', 'consumable', 'backpack', 'armor', 'mod', 'placeable'];
    for (const [rawId, rawItem] of Object.entries(record(input)).slice(0, 5000)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const item = record(rawItem);
      if (!id) continue;
      const kind = itemKinds.includes(String(item.kind)) ? String(item.kind) : 'material';
      const sanitized: Record<string, unknown> = {
        id,
        name: text(item.name, id),
        kind,
        kg: finite(item.kg, 0.1, 0, 100_000),
        stack: finite(item.stack, 1, 1, 1_000_000) | 0,
        desc: text(item.desc, '', 500),
        spriteId: text(item.spriteId, `item:${id}`, 80),
      };
      if (item.durability !== undefined) sanitized.durability = finite(item.durability, 1, 1, 1_000_000) | 0;

      if (kind === 'weapon') {
        const weapon = record(item.weapon);
        sanitized.weapon = {
          damage: finite(weapon.damage, 10, 0, 1_000_000),
          fireRateMs: finite(weapon.fireRateMs, 400, 1, 600_000),
          ammo: text(weapon.ammo, 'ammo_9mm', 60),
          pellets: finite(weapon.pellets, 1, 1, 1000) | 0,
          spread: finite(weapon.spread, 0.05, 0, Math.PI * 2),
          bulletSpeed: finite(weapon.bulletSpeed, 700, 1, 100_000),
          range: finite(weapon.range, 500, 1, 100_000),
          magSize: finite(weapon.magSize, 10, 1, 100_000) | 0,
          reloadMs: finite(weapon.reloadMs, 1500, 1, 600_000),
          ...(weapon.noise !== undefined ? { noise: finite(weapon.noise, 380, 0, 100_000) } : {}),
        };
      }
      if (kind === 'tool') {
        const melee = record(item.melee);
        sanitized.melee = {
          damage: finite(melee.damage, 10, 0, 1_000_000),
          cooldownMs: finite(melee.cooldownMs, 600, 1, 600_000),
          range: finite(melee.range, 38, 1, 100_000),
          wood: finite(melee.wood, 1, 0, 100_000),
          stone: finite(melee.stone, 1, 0, 100_000),
        };
      }
      if (kind === 'armor') {
        const armor = record(item.armor);
        sanitized.armor = {
          piece: armor.piece === 'helmet' ? 'helmet' : 'vest',
          reduction: finite(armor.reduction, 0.1, 0, 1),
        };
      }
      if (kind === 'consumable') {
        for (const effect of ['heal', 'food', 'drink'] as const) {
          if (item[effect] !== undefined) sanitized[effect] = finite(item[effect], 0, 0, 1_000_000);
        }
        for (const relation of ['raw', 'emptyTo', 'fillFrom'] as const) {
          const value = text(item[relation], '', 60);
          if (value) sanitized[relation] = value;
        }
      }
      if (kind === 'backpack') sanitized.backpackTier = finite(item.backpackTier, 1, 0, 100) | 0;
      if (kind === 'placeable') {
        const buildType = text(item.place, '', 40);
        if (buildType in BUILDABLES) sanitized.place = buildType;
      }
      out[id] = sanitized;
    }
    if (!Object.keys(out).length) throw new Error('At least one item is required');
    return out;
  }

  if (kind === 'mobs') {
    const out: Record<string, unknown> = {};
    for (const [rawId, rawDef] of Object.entries(record(input)).slice(0, 500)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const def = record(rawDef);
      if (!id) continue;
      const behavior = ['flee', 'melee', 'ranged'].includes(String(def.behavior)) ? String(def.behavior) : 'melee';
      out[id] = {
        id,
        name: text(def.name, id),
        behavior,
        maxHp: finite(def.maxHp, 50, 1, 1_000_000),
        speed: finite(def.speed, 100, 0, 1000),
        aggroRange: finite(def.aggroRange, 200, 0, 5000),
        attackRange: finite(def.attackRange, 28, 0, 5000),
        damage: finite(def.damage, 10, 0, 100_000),
        attackMs: finite(def.attackMs, 900, 50, 600_000),
        boss: Boolean(def.boss),
        lootTable: text(def.lootTable, id, 50),
        spriteId: text(def.spriteId, `character:${id}`, 80),
        respawnMs: finite(def.respawnMs, 90_000, 1000, 86_400_000),
        sounds: Object.fromEntries(Object.entries(record(def.sounds)).slice(0, 10).map(([action, sound]) => [text(action, '', 30), text(sound, '', 60)]).filter(([action, sound]) => action && sound)),
      };
    }
    if (!Object.keys(out).length) throw new Error('At least one mob is required');
    return out;
  }

  if (kind === 'loot') {
    const out: Record<string, unknown> = {};
    for (const [rawId, rawTable] of Object.entries(record(input)).slice(0, 500)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const tableDef = record(rawTable);
      const entries = Array.isArray(tableDef.entries) ? tableDef.entries.slice(0, 1000).map((raw) => {
        const entry = record(raw);
        const min = finite(entry.min, 1, 1, 100_000);
        return {
          id: text(entry.id, '', 60),
          weight: finite(entry.weight, 1, 0.0001, 1_000_000),
          min,
          max: finite(entry.max, min, min, 100_000),
        };
      }).filter((entry) => entry.id) : [];
      if (!id || !entries.length) continue;
      const minRolls = finite(tableDef.minRolls, 1, 1, 100);
      out[id] = {
        id,
        name: text(tableDef.name, id),
        minRolls,
        maxRolls: finite(tableDef.maxRolls, minRolls, minRolls, 100),
        entries,
      };
    }
    if (!Object.keys(out).length) throw new Error('At least one loot table is required');
    return out;
  }

  if (kind === 'animations') {
    const out: Record<string, unknown> = {};
    for (const [rawTarget, rawProfile] of Object.entries(record(input)).slice(0, 600)) {
      const target = text(rawTarget, '', 80).replace(/[^a-z0-9:_-]/gi, '_');
      const profile = record(rawProfile);
      const rawClips = record(profile.clips);
      const clips: Record<string, unknown> = {};
      for (const state of ENTITY_ANIMATION_STATES) {
        const rawClip = record(rawClips[state]);
        if (!Object.keys(rawClip).length) continue;
        const frames = Array.isArray(rawClip.frames)
          ? rawClip.frames.slice(0, 128).map((frame) => finite(frame, 0, 0, 255) | 0)
          : [0];
        const keyframes = Array.isArray(rawClip.keyframes) ? rawClip.keyframes.slice(0, 128).map((rawKeyframe) => {
          const keyframe = record(rawKeyframe);
          return {
            frame: finite(keyframe.frame, 0, 0, 255) | 0,
            durationMs: finite(keyframe.durationMs, finite(rawClip.frameMs, 125, 16, 10_000), 16, 10_000),
            ...(keyframe.soundId ? { soundId: text(keyframe.soundId, '', 60) } : {}),
            ...(keyframe.event ? { event: text(keyframe.event, '', 60) } : {}),
          };
        }) : [];
        clips[state] = { frames: frames.length ? frames : [0], frameMs: finite(rawClip.frameMs, 125, 16, 10_000), loop: Boolean(rawClip.loop), ...(keyframes.length ? { keyframes } : {}) };
      }
      if (target) out[target] = { spriteId: text(profile.spriteId, 'character:player', 80), clips };
    }
    if (!out.player) out.player = { spriteId: 'character:player', clips: defaultClips };
    return out;
  }

  if (kind === 'sprites') {
    const source = record(input);
    const palette = Array.isArray(source.palette)
      ? source.palette.slice(0, 64).map((color) => text(color, '#00000000', 9)).filter((color) => /^#[0-9a-f]{8}$/i.test(color))
      : DEFAULT_PIXEL_PALETTE.slice();
    const assets = Array.isArray(source.assets) ? source.assets.slice(0, 1000).map((rawAsset, index) => {
      const asset = record(rawAsset);
      const width = finite(asset.width, 16, 1, 64) | 0;
      const height = finite(asset.height, 16, 1, 64) | 0;
      const size = width * height;
      const cleanFrame = (raw: unknown) => Array.isArray(raw)
        ? raw.slice(0, size).map((color) => /^#[0-9a-f]{8}$/i.test(String(color)) ? String(color).toLowerCase() : '#00000000')
        : [];
      const legacy = cleanFrame(asset.pixels);
      const frames = Array.isArray(asset.frames) ? asset.frames.slice(0, 64).map(cleanFrame) : [];
      const sourceRef = record(asset.source);
      return {
        id: text(asset.id, `sprite_${index}`, 80), name: text(asset.name, `Sprite ${index + 1}`), width, height,
        pixels: legacy.length === size ? legacy : frames[0]?.length === size ? frames[0] : [],
        frames: (frames.length ? frames : legacy.length === size ? [legacy] : []).map((frame) => frame.length === size ? frame : new Array(size).fill('#00000000')),
        ...(sourceRef.sheet && ['tiles', 'chars', 'items'].includes(String(sourceRef.sheet)) ? { source: { sheet: sourceRef.sheet, col: finite(sourceRef.col, 0, 0, 4096) | 0, row: finite(sourceRef.row, 0, 0, 4096) | 0, frames: finite(sourceRef.frames, 1, 1, 64) | 0 } } : {}),
      };
    }) : [];
    return { palette: palette.length ? palette : DEFAULT_PIXEL_PALETTE, assets };
  }

  if (kind === 'resources') {
    const out: Record<string, unknown> = {};
    for (const [rawId, rawResource] of Object.entries(record(input)).slice(0, 500)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const resource = record(rawResource);
      if (!id) continue;
      const drops = Array.isArray(resource.drops) ? resource.drops.slice(0, 100).map((rawDrop) => {
        const drop = record(rawDrop);
        const min = finite(drop.min, 1, 1, 100_000);
        return { itemId: text(drop.itemId, '', 60), min, max: finite(drop.max, min, min, 100_000), chance: finite(drop.chance, 1, 0, 1), when: drop.when === 'depleted' ? 'depleted' : 'hit' };
      }).filter((drop) => drop.itemId) : [];
      out[id] = { id, name: text(resource.name, id), tile: finite(resource.tile, Tile.Tree, 0, 255) | 0, depletedTile: finite(resource.depletedTile, Tile.Stump, 0, 255) | 0, maxHits: finite(resource.maxHits, 6, 1, 100_000) | 0, respawnMs: finite(resource.respawnMs, 240_000, 1000, 86_400_000), skill: resource.skill === 'mining' ? 'mining' : 'woodcutting', spriteId: text(resource.spriteId, '', 80), hitSound: text(resource.hitSound, '', 60), breakSound: text(resource.breakSound, '', 60), drops };
    }
    if (!Object.keys(out).length) throw new Error('At least one resource definition is required');
    return out;
  }

  if (kind === 'blocks') {
    const blockDoc = record(input);
    const rawWorld = Object.keys(record(blockDoc.world)).length ? record(blockDoc.world) : {};
    const world: Record<string, unknown> = {};
    for (const [rawId, rawBlock] of Object.entries(rawWorld).slice(0, 1000)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const block = record(rawBlock);
      if (!id) continue;
      const collision = record(block.collision);
      const drops = Array.isArray(block.drops) ? block.drops.slice(0, 100).map((rawDrop) => {
        const drop = record(rawDrop); const min = finite(drop.min, 1, 1, 100_000);
        return { itemId: text(drop.itemId, '', 60), min, max: finite(drop.max, min, min, 100_000), chance: finite(drop.chance, 1, 0, 1), when: 'depleted' };
      }).filter((drop) => drop.itemId) : [];
      const placement = record(block.playerPlacement);
      const buildType = text(placement.buildType, '', 40);
      world[id] = { id, name: text(block.name, id), spriteId: text(block.spriteId, '', 80), scale: finite(block.scale, 1, .1, 8), offsetY: finite(block.offsetY, 0, -256, 256), maxHp: finite(block.maxHp, 100, 1, 1_000_000), destructible: Boolean(block.destructible), collision: { move: Boolean(collision.move), enemy: Boolean(collision.enemy), bullets: Boolean(collision.bullets), sight: Boolean(collision.sight) }, hitSound: text(block.hitSound, '', 60), breakSound: text(block.breakSound, '', 60), drops, ...(buildType in BUILDABLES ? { playerPlacement: { buildType, kitItemId: text(placement.kitItemId, '', 60), simulationTile: placement.simulationTile === null ? null : finite(placement.simulationTile, Tile.Grass, 0, 255) | 0, hideoutOnly: Boolean(placement.hideoutOnly), foundation: Boolean(placement.foundation), storageSlots: finite(placement.storageSlots, 0, 0, 1000) | 0 } } : {}) };
    }
    return { version: 1, world, legacyBuildables: blockDoc.legacyBuildables ?? BUILDABLES };
  }

  if (kind === 'terrain') {
    const out: Record<string, unknown> = {};
    for (const [rawId, rawTerrain] of Object.entries(record(input)).slice(0, 1000)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const terrain = record(rawTerrain);
      if (!id) continue;
      const collision = record(terrain.collision);
      const color = text(terrain.minimapColor, '#557c43', 7);
      out[id] = {
        id,
        name: text(terrain.name, id),
        spriteId: text(terrain.spriteId, '', 80),
        simulationTile: finite(terrain.simulationTile, Tile.Grass, 0, 255) | 0,
        minimapColor: /^#[0-9a-f]{6}$/i.test(color) ? color : '#557c43',
        moveMultiplier: finite(terrain.moveMultiplier, 1, 0.05, 5),
        swimmable: Boolean(terrain.swimmable),
        collision: { move: Boolean(collision.move), enemy: Boolean(collision.enemy), bullets: Boolean(collision.bullets), sight: Boolean(collision.sight) },
        footstepSound: text(terrain.footstepSound, '', 60),
      };
    }
    return out;
  }

  if (kind === 'sounds') {
    const soundDoc = record(input);
    const presets: Record<string, unknown> = {};
    for (const [rawId, rawPreset] of Object.entries(record(soundDoc.presets)).slice(0, 500)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const sound = record(rawPreset);
      if (!id) continue;
      const wave = ['sine', 'square', 'sawtooth', 'triangle'].includes(String(sound.wave)) ? String(sound.wave) : 'triangle';
      presets[id] = { id, name: text(sound.name, id), wave, frequency: finite(sound.frequency, 220, 20, 20_000), endFrequency: finite(sound.endFrequency, 110, 20, 20_000), durationMs: finite(sound.durationMs, 120, 10, 10_000), volume: finite(sound.volume, 0.15, 0, 1), noise: finite(sound.noise, 0, 0, 1), filterHz: finite(sound.filterHz, 2400, 20, 20_000) };
    }
    return { presets, actions: Object.fromEntries(Object.entries(record(soundDoc.actions)).slice(0, 500).map(([action, sound]) => [text(action, '', 60), text(sound, '', 60)]).filter(([action, sound]) => action && sound)) };
  }

  if (kind === 'recipes') {
    if (!Array.isArray(input)) throw new Error('Recipes must be an array');
    return input.slice(0, 5000).map((raw, index) => {
      const recipe = record(raw);
      const output = record(recipe.out);
      const costs = Array.isArray(recipe.cost) ? recipe.cost : [];
      return {
        id: text(recipe.id, `recipe_${index}`, 60),
        cat: text(recipe.cat, 'survival', 30),
        out: { id: text(output.id, '', 60), qty: finite(output.qty, 1, 1, 100_000) },
        cost: costs.slice(0, 50).map((rawCost) => {
          const cost = record(rawCost);
          return { id: text(cost.id, '', 60), qty: finite(cost.qty, 1, 1, 100_000) };
        }).filter((cost) => cost.id),
        ...(recipe.station ? { station: text(recipe.station, '', 30) } : {}),
      };
    }).filter((recipe) => recipe.out.id);
  }

  if (kind === 'traders') {
    const out: Record<string, unknown> = {};
    for (const [rawId, rawTrader] of Object.entries(record(input)).slice(0, 100)) {
      const id = rawId.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 50);
      const trader = record(rawTrader);
      const stock = Array.isArray(trader.stock) ? trader.stock.slice(0, 1000).map((rawEntry) => {
        const entry = record(rawEntry);
        return { id: text(entry.id, '', 60), buy: finite(entry.buy, 0, 0, 1_000_000_000), sell: finite(entry.sell, 0, 0, 1_000_000_000) };
      }).filter((entry) => entry.id) : [];
      if (id) out[id] = { id, name: text(trader.name, id), questTier: finite(trader.questTier, 1, 1, 100) | 0, stock };
    }
    return out;
  }

  if (!input || typeof input !== 'object') throw new Error(`${kind} content must be an object or array`);
  return JSON.parse(JSON.stringify(input));
}
