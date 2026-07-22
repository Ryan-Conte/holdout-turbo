// ─── Holdout shared game data & protocol ───────────────────────────────────

export const TILE = 32;
export const MAP_W = 100; // default world size (authored maps may differ)
export const MAP_H = 100;

export enum Tile {
  Grass = 0,
  Water = 1,
  Tree = 2,
  Floor = 3,
  Wall = 4,
  Road = 5,
  Sand = 6,
  Rock = 7,
  Asphalt = 8,
  Bed = 9,
  DoorMat = 10,
  Workbench = 11,
  Firepit = 12,
  Furnace = 13,
  Stump = 14,
  Rubble = 15,
  // player-built base pieces
  WoodFloor = 16,
  StoneFloor = 17,
  WoodWall = 18,
  Door = 19, // players walk through; enemies and bullets do not
  Fence = 20, // blocks movement; bullets fly over
  Torch = 21, // walkable, lights the night
  // ore-veined rocks (rare rock variants — mining yields stone AND ore)
  CopperOre = 22,
  IronOre = 23,
  Anvil = 24, // forge station (weapons / ammo / attachments)
  Cliff = 25, // vertical terrain / high ground — impassable, blocks sight & bullets
}

// NOTE: water is swimmable (slow), not blocking — see SWIM_SPEED_MULT
export const BLOCKS_MOVE: Record<number, boolean> = {
  [Tile.Tree]: true,
  [Tile.Wall]: true,
  [Tile.Rock]: true,
  [Tile.Bed]: true,
  [Tile.Workbench]: true,
  [Tile.Firepit]: true,
  [Tile.Furnace]: true,
  [Tile.WoodWall]: true,
  [Tile.Fence]: true,
  [Tile.CopperOre]: true,
  [Tile.IronOre]: true,
  [Tile.Anvil]: true,
  [Tile.Cliff]: true,
};

/** enemies and animals refuse to enter these (players can swim) */
export const BLOCKS_ENEMY: Record<number, boolean> = { ...BLOCKS_MOVE, [Tile.Water]: true, [Tile.Door]: true };

export const BLOCKS_BULLET: Record<number, boolean> = {
  [Tile.Tree]: true,
  [Tile.Wall]: true,
  [Tile.Rock]: true,
  [Tile.Workbench]: true,
  [Tile.Furnace]: true,
  [Tile.WoodWall]: true,
  [Tile.Door]: true,
  [Tile.CopperOre]: true,
  [Tile.IronOre]: true,
  [Tile.Anvil]: true,
  [Tile.Cliff]: true,
};

/** base-building floors — cosmetic ground you can build other pieces on top of */
export const FLOOR_TILES: Record<number, boolean> = {
  [Tile.WoodFloor]: true,
  [Tile.StoneFloor]: true,
};

// Harvestable resource nodes: deplete into a stump/rubble, regrow on the same node
export const NODE_HITS: Partial<Record<Tile, number>> = {
  [Tile.Tree]: 6,
  [Tile.Rock]: 8,
  [Tile.CopperOre]: 8,
  [Tile.IronOre]: 10,
};
export const NODE_DEPLETED: Partial<Record<Tile, Tile>> = {
  [Tile.Tree]: Tile.Stump,
  [Tile.Rock]: Tile.Rubble,
  [Tile.CopperOre]: Tile.Rubble,
  [Tile.IronOre]: Tile.Rubble,
};
export const NODE_RESPAWN_MS = 240_000;
/** which ore a veined rock yields alongside stone */
export const ORE_YIELD: Partial<Record<Tile, ItemId>> = {
  [Tile.CopperOre]: 'copper_ore',
  [Tile.IronOre]: 'iron_ore',
};
/** rock-cluster generation: chance a rock spawns as an ore vein instead */
export const COPPER_CHANCE = 0.14;
export const IRON_CHANCE = 0.08;

/** Built-in resource behavior used when no engine document has been published yet. */
export const DEFAULT_RESOURCE_NODES: Record<string, import('./engine').ResourceNodeDef> = {
  tree: {
    id: 'tree', name: 'Common tree', tile: Tile.Tree, depletedTile: Tile.Stump,
    maxHits: 6, respawnMs: NODE_RESPAWN_MS, skill: 'woodcutting', respawnFamily: 'tree', respawnWeight: 94,
    spriteId: 'resource:tree', hitSound: 'chop', breakSound: 'tree_fall',
    drops: [{ itemId: 'wood', min: 2, max: 3, chance: 1, when: 'hit' }],
  },
  ironwood: {
    id: 'ironwood', name: 'Ironwood tree', tile: Tile.Tree, depletedTile: Tile.Stump,
    maxHits: 14, respawnMs: 480_000, skill: 'woodcutting', respawnFamily: 'tree', respawnWeight: 6,
    spriteId: 'resource:ironwood', hitSound: 'wood_heavy', breakSound: 'tree_crack',
    drops: [
      { itemId: 'wood', min: 3, max: 5, chance: 1, when: 'hit' },
      { itemId: 'iron_ore', min: 1, max: 2, chance: 0.35, when: 'depleted' },
    ],
  },
  rock: {
    id: 'rock', name: 'Stone outcrop', tile: Tile.Rock, depletedTile: Tile.Rubble,
    maxHits: 8, respawnMs: NODE_RESPAWN_MS, skill: 'mining', respawnFamily: 'rock', respawnWeight: 1,
    spriteId: 'resource:rock', hitSound: 'mine', breakSound: 'rock_break',
    drops: [{ itemId: 'stone', min: 2, max: 3, chance: 1, when: 'hit' }],
  },
};

// ─── Items ──────────────────────────────────────────────────────────────────
// The item registry lives in ./items (category builders, easy to extend).
export * from './items';
import { BuildType, ItemId, ITEMS, StationKind } from './items';

export interface BackpackTier { name: string; slots: number; maxKg: number }
export const BACKPACKS: BackpackTier[] = [
  { name: 'Field Satchel', slots: 12, maxKg: 20 },
  { name: 'Scout Backpack', slots: 16, maxKg: 32 },
  { name: 'Raider Backpack', slots: 20, maxKg: 45 },
  { name: 'Expedition Backpack MK4', slots: 32, maxKg: 80 },
];

// ─── Crafting ───────────────────────────────────────────────────────────────

export type RecipeCat = 'survival' | 'medical' | 'gear' | 'build' | 'smelt' | 'forge';

export interface Recipe {
  id: string;
  cat: RecipeCat;
  out: { id: ItemId; qty: number };
  cost: { id: ItemId; qty: number }[];
  station?: StationKind; // craftable only near that placed structure (hidden elsewhere)
}

/** Runtime recipes can reference sanitized DB-authored item IDs. */
export interface RuntimeRecipe extends Omit<Recipe, 'out' | 'cost'> {
  out: { id: string; qty: number };
  cost: { id: string; qty: number }[];
}

/** Versioned gameplay catalog used by both simulation and presentation. */
export interface RuntimeGameplayContent {
  version: string;
  items: import('./items').RuntimeItemRegistry;
  recipes: RuntimeRecipe[];
}

// Station philosophy:
//  · hand (no station): primitive survival + basic base pieces — always visible
//  · workbench: proper tools, gear, advanced build kits
//  · furnace: SMELTING ONLY (ore → bar)
//  · anvil: weapons, ammo, attachments
export const RECIPES: Recipe[] = [
  // ── hand crafts
  { id: 'craft_spear', cat: 'survival', out: { id: 'spear', qty: 1 }, cost: [{ id: 'wood', qty: 4 }, { id: 'stone', qty: 1 }] },
  { id: 'craft_bow', cat: 'survival', out: { id: 'bow', qty: 1 }, cost: [{ id: 'wood', qty: 6 }, { id: 'cloth', qty: 3 }] },
  { id: 'craft_arrows', cat: 'survival', out: { id: 'arrow', qty: 6 }, cost: [{ id: 'wood', qty: 3 }, { id: 'stone', qty: 1 }] },
  { id: 'craft_bandage', cat: 'medical', out: { id: 'bandage', qty: 1 }, cost: [{ id: 'cloth', qty: 2 }] },
  { id: 'craft_hand_torch', cat: 'survival', out: { id: 'torch', qty: 1 }, cost: [{ id: 'wood', qty: 1 }, { id: 'cloth', qty: 1 }] },
  { id: 'craft_firepit', cat: 'build', out: { id: 'kit_firepit', qty: 1 }, cost: [{ id: 'wood', qty: 6 }, { id: 'stone', qty: 4 }] },
  { id: 'craft_workbench', cat: 'build', out: { id: 'kit_workbench', qty: 1 }, cost: [{ id: 'wood', qty: 8 }, { id: 'scrap', qty: 4 }] },
  { id: 'craft_floor_wood', cat: 'build', out: { id: 'kit_floor_wood', qty: 4 }, cost: [{ id: 'wood', qty: 4 }] },
  { id: 'craft_floor_stone', cat: 'build', out: { id: 'kit_floor_stone', qty: 4 }, cost: [{ id: 'stone', qty: 4 }] },
  { id: 'craft_fence', cat: 'build', out: { id: 'kit_fence', qty: 4 }, cost: [{ id: 'wood', qty: 6 }] },
  { id: 'craft_torch', cat: 'build', out: { id: 'kit_torch', qty: 2 }, cost: [{ id: 'wood', qty: 2 }, { id: 'cloth', qty: 1 }] },
  { id: 'craft_bed', cat: 'build', out: { id: 'kit_bed', qty: 1 }, cost: [{ id: 'wood', qty: 8 }, { id: 'cloth', qty: 4 }] },
  // ── workbench
  { id: 'craft_axe', cat: 'survival', out: { id: 'axe', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'stone', qty: 3 }], station: 'workbench' },
  { id: 'craft_pickaxe', cat: 'survival', out: { id: 'pickaxe', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'stone', qty: 3 }], station: 'workbench' },
  { id: 'craft_fishing_rod', cat: 'survival', out: { id: 'fishing_rod', qty: 1 }, cost: [{ id: 'wood', qty: 4 }, { id: 'cloth', qty: 2 }], station: 'workbench' },
  { id: 'craft_canteen', cat: 'survival', out: { id: 'canteen', qty: 1 }, cost: [{ id: 'scrap', qty: 4 }, { id: 'cloth', qty: 1 }], station: 'workbench' },
  { id: 'craft_medkit', cat: 'medical', out: { id: 'medkit', qty: 1 }, cost: [{ id: 'bandage', qty: 2 }, { id: 'scrap', qty: 1 }], station: 'workbench' },
  { id: 'craft_helmet_scrap', cat: 'gear', out: { id: 'helmet_scrap', qty: 1 }, cost: [{ id: 'scrap', qty: 6 }, { id: 'cloth', qty: 2 }], station: 'workbench' },
  { id: 'craft_vest_light', cat: 'gear', out: { id: 'vest_light', qty: 1 }, cost: [{ id: 'cloth', qty: 8 }, { id: 'scrap', qty: 4 }], station: 'workbench' },
  { id: 'craft_backpack_mk2', cat: 'gear', out: { id: 'backpack_mk2', qty: 1 }, cost: [{ id: 'cloth', qty: 6 }, { id: 'scrap', qty: 4 }], station: 'workbench' },
  { id: 'craft_backpack_mk3', cat: 'gear', out: { id: 'backpack_mk3', qty: 1 }, cost: [{ id: 'cloth', qty: 10 }, { id: 'scrap', qty: 8 }, { id: 'wood', qty: 4 }], station: 'workbench' },
  { id: 'craft_backpack_mk4', cat: 'gear', out: { id: 'backpack_mk4', qty: 1 }, cost: [{ id: 'cloth', qty: 24 }, { id: 'scrap', qty: 20 }, { id: 'iron_bar', qty: 10 }, { id: 'animal_hide', qty: 8 }], station: 'workbench' },
  { id: 'craft_furnace', cat: 'build', out: { id: 'kit_furnace', qty: 1 }, cost: [{ id: 'stone', qty: 12 }, { id: 'scrap', qty: 6 }], station: 'workbench' },
  { id: 'craft_anvil', cat: 'build', out: { id: 'kit_anvil', qty: 1 }, cost: [{ id: 'iron_bar', qty: 4 }, { id: 'stone', qty: 8 }], station: 'workbench' },
  { id: 'craft_chest', cat: 'build', out: { id: 'kit_chest', qty: 1 }, cost: [{ id: 'wood', qty: 10 }, { id: 'stone', qty: 4 }], station: 'workbench' },
  { id: 'craft_wall', cat: 'build', out: { id: 'kit_wall', qty: 2 }, cost: [{ id: 'wood', qty: 6 }, { id: 'stone', qty: 2 }], station: 'workbench' },
  { id: 'craft_door', cat: 'build', out: { id: 'kit_door', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'scrap', qty: 2 }], station: 'workbench' },
  // ── furnace: smelting only
  { id: 'smelt_copper', cat: 'smelt', out: { id: 'copper_bar', qty: 1 }, cost: [{ id: 'copper_ore', qty: 2 }], station: 'furnace' },
  { id: 'smelt_iron', cat: 'smelt', out: { id: 'iron_bar', qty: 1 }, cost: [{ id: 'iron_ore', qty: 2 }], station: 'furnace' },
  // ── anvil: weapons, ammo, attachments
  { id: 'craft_steel_axe', cat: 'forge', out: { id: 'steel_axe', qty: 1 }, cost: [{ id: 'iron_bar', qty: 2 }, { id: 'wood', qty: 2 }], station: 'anvil' },
  { id: 'craft_steel_pickaxe', cat: 'forge', out: { id: 'steel_pickaxe', qty: 1 }, cost: [{ id: 'iron_bar', qty: 2 }, { id: 'wood', qty: 2 }], station: 'anvil' },
  { id: 'craft_revolver', cat: 'forge', out: { id: 'revolver', qty: 1 }, cost: [{ id: 'iron_bar', qty: 3 }, { id: 'copper_bar', qty: 1 }, { id: 'wood', qty: 2 }], station: 'anvil' },
  { id: 'craft_carbine', cat: 'forge', out: { id: 'carbine', qty: 1 }, cost: [{ id: 'iron_bar', qty: 5 }, { id: 'copper_bar', qty: 2 }, { id: 'wood', qty: 3 }], station: 'anvil' },
  { id: 'craft_9mm', cat: 'forge', out: { id: 'ammo_9mm', qty: 12 }, cost: [{ id: 'scrap', qty: 2 }], station: 'anvil' },
  { id: 'craft_shells', cat: 'forge', out: { id: 'ammo_shell', qty: 4 }, cost: [{ id: 'scrap', qty: 2 }, { id: 'cloth', qty: 1 }], station: 'anvil' },
  { id: 'craft_556', cat: 'forge', out: { id: 'ammo_556', qty: 10 }, cost: [{ id: 'scrap', qty: 3 }], station: 'anvil' },
  { id: 'craft_44', cat: 'forge', out: { id: 'ammo_44', qty: 8 }, cost: [{ id: 'copper_bar', qty: 1 }, { id: 'scrap', qty: 1 }], station: 'anvil' },
  { id: 'craft_reddot', cat: 'forge', out: { id: 'attach_reddot', qty: 1 }, cost: [{ id: 'scrap', qty: 8 }, { id: 'copper_bar', qty: 1 }], station: 'anvil' },
  { id: 'craft_suppressor', cat: 'forge', out: { id: 'attach_suppressor', qty: 1 }, cost: [{ id: 'scrap', qty: 10 }, { id: 'iron_bar', qty: 1 }], station: 'anvil' },
];

// ─── Building (hideout: permanent · world: wears out & destructible) ───────
// Structure metadata keyed by BuildType. The placeable KIT item that builds
// each one is defined in ./items with `place: <BuildType>`.

export interface Buildable {
  type: BuildType;
  name: string;
  desc: string;
  tile: Tile | null; // structure tile (null = container, hideout only)
  hideoutOnly?: boolean;
  hp: number; // world durability vs damage
}

export const BUILDABLES: Record<BuildType, Buildable> = {
  chest: { type: 'chest', name: 'Storage Chest', desc: '12 extra stash slots (camp only).', tile: null, hideoutOnly: true, hp: 0 },
  workbench: { type: 'workbench', name: 'Workbench', desc: 'Unlocks weapon-mod crafting nearby.', tile: Tile.Workbench, hp: 120 },
  firepit: { type: 'firepit', name: 'Firepit', desc: 'Cook raw meat and fish nearby.', tile: Tile.Firepit, hp: 80 },
  furnace: { type: 'furnace', name: 'Furnace', desc: 'Smelt copper and iron ore into bars nearby.', tile: Tile.Furnace, hp: 160 },
  anvil: { type: 'anvil', name: 'Anvil', desc: 'Forge weapons, ammo and attachments nearby.', tile: Tile.Anvil, hp: 240 },
  bed: { type: 'bed', name: 'Bed', desc: 'You wake up next to it at home. Camp only.', tile: Tile.Bed, hideoutOnly: true, hp: 0 },
  wood_floor: { type: 'wood_floor', name: 'Wood Floor', desc: 'Plank flooring. Build walls and stations on it.', tile: Tile.WoodFloor, hp: 40 },
  stone_floor: { type: 'stone_floor', name: 'Stone Floor', desc: 'Cut stone flooring. Build walls and stations on it.', tile: Tile.StoneFloor, hp: 60 },
  wall: { type: 'wall', name: 'Wooden Wall', desc: 'Blocks movement and bullets.', tile: Tile.WoodWall, hp: 220 },
  door: { type: 'door', name: 'Wooden Door', desc: 'You walk through; enemies and bullets do not.', tile: Tile.Door, hp: 140 },
  fence: { type: 'fence', name: 'Fence', desc: 'Blocks walkers; you can shoot over it.', tile: Tile.Fence, hp: 60 },
  torch: { type: 'torch', name: 'Torch Post', desc: 'Lights up the night around it.', tile: Tile.Torch, hp: 30 },
};

/** structures placed in the world decay after this long (no wear in hideouts) */
export const WORLD_STRUCTURE_TTL_MS = 45 * 60_000;

// ─── Skills (Runescape-style, expanded later) ──────────────────────────────

export type SkillId = 'woodcutting' | 'mining' | 'shooting' | 'melee' | 'crafting';

export const SKILL_LIST: { id: SkillId; name: string; bonus: string }[] = [
  { id: 'woodcutting', name: 'Woodcutting', bonus: '+1 wood per hit every 5 levels' },
  { id: 'mining', name: 'Mining', bonus: '+1 stone per hit every 5 levels' },
  { id: 'shooting', name: 'Shooting', bonus: '-1% weapon spread per level' },
  { id: 'melee', name: 'Melee', bonus: '+1% melee damage per level' },
  { id: 'crafting', name: 'Crafting', bonus: 'reserved for future perks' },
];

export type Skills = Record<SkillId, number>; // total xp per skill

export const EMPTY_SKILLS: Skills = { woodcutting: 0, mining: 0, shooting: 0, melee: 0, crafting: 0 };

export function skillLevel(xp: number): number {
  return Math.min(50, Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1);
}

export function xpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 40;
}

// ─── Quests ─────────────────────────────────────────────────────────────────

export type QuestKind = 'kill' | 'fetch';

export interface QuestDef {
  id: number;
  name: string;
  desc: string;
  kind: QuestKind;
  target: string; // EnemyKind for kill, ItemId for fetch
  count: number;
  rewardMoney: number;
  rewardItem: ItemId | null;
  rewardQty: number;
  requires: number | null; // quest tree: claim this quest first to unlock
  tier: TraderTier; // which trader offers it (1 outpost, 2 black-market)
}

export interface QuestStatus {
  def: QuestDef;
  progress: number; // kills so far / items currently carried
  done: boolean;
  claimed: boolean;
}

// ─── Trading ────────────────────────────────────────────────────────────────

/** buy = credits the player pays; sell = credits the player receives. 0 = not traded that way. */
export interface TradeEntry { id: ItemId; buy: number; sell: number }

/** 1 = outpost quartermaster (basics) · 2 = black-market dealer (hotzones — rare stock, pays big for valuables) */
export type TraderTier = 1 | 2;

export const TRADER_STOCK: TradeEntry[] = [
  { id: 'bandage', buy: 15, sell: 5 },
  { id: 'medkit', buy: 60, sell: 20 },
  { id: 'ammo_9mm', buy: 2, sell: 1 },
  { id: 'ammo_shell', buy: 6, sell: 2 },
  { id: 'ammo_556', buy: 3, sell: 1 },
  { id: 'arrow', buy: 2, sell: 1 },
  { id: 'bow', buy: 0, sell: 30 },
  { id: 'pistol', buy: 120, sell: 40 },
  { id: 'shotgun', buy: 260, sell: 80 },
  { id: 'smg', buy: 320, sell: 100 },
  { id: 'rifle', buy: 0, sell: 180 },
  { id: 'spear', buy: 25, sell: 5 },
  { id: 'axe', buy: 80, sell: 25 },
  { id: 'pickaxe', buy: 80, sell: 25 },
  { id: 'helmet_scrap', buy: 90, sell: 30 },
  { id: 'helmet_military', buy: 0, sell: 120 },
  { id: 'vest_light', buy: 140, sell: 45 },
  { id: 'vest_military', buy: 0, sell: 200 },
  { id: 'backpack_mk2', buy: 200, sell: 60 },
  { id: 'backpack_mk3', buy: 450, sell: 140 },
  { id: 'cloth', buy: 4, sell: 1 },
  { id: 'scrap', buy: 8, sell: 3 },
  { id: 'wood', buy: 3, sell: 1 },
  { id: 'stone', buy: 3, sell: 1 },
  { id: 'animal_hide', buy: 10, sell: 4 },
  { id: 'torch', buy: 12, sell: 3 },
  // base-building kits — credits are a shortcut past the grind
  { id: 'kit_floor_wood', buy: 5, sell: 1 },
  { id: 'kit_floor_stone', buy: 5, sell: 1 },
  { id: 'kit_wall', buy: 18, sell: 5 },
  { id: 'kit_door', buy: 25, sell: 8 },
  { id: 'kit_fence', buy: 8, sell: 2 },
  { id: 'kit_torch', buy: 8, sell: 2 },
  { id: 'kit_chest', buy: 60, sell: 15 },
  { id: 'kit_firepit', buy: 25, sell: 8 },
  { id: 'kit_workbench', buy: 45, sell: 12 },
  { id: 'kit_furnace', buy: 65, sell: 18 },
];

/** Black-market dealer: rare hardware in, valuables out. Found in high-loot zones. */
export const TRADER_STOCK_T2: TradeEntry[] = [
  { id: 'ammo_762', buy: 6, sell: 2 },
  { id: 'ammo_44', buy: 5, sell: 2 },
  { id: 'ammo_556', buy: 3, sell: 1 },
  { id: 'medkit', buy: 55, sell: 22 },
  { id: 'revolver', buy: 320, sell: 110 },
  { id: 'carbine', buy: 480, sell: 160 },
  { id: 'rifle', buy: 520, sell: 190 },
  { id: 'dmr', buy: 0, sell: 520 },
  { id: 'lmg', buy: 0, sell: 720 },
  { id: 'prototype_rifle', buy: 0, sell: 1400 },
  { id: 'helmet_military', buy: 340, sell: 130 },
  { id: 'vest_military', buy: 520, sell: 210 },
  { id: 'backpack_mk4', buy: 2500, sell: 350 },
  { id: 'attach_reddot', buy: 160, sell: 55 },
  { id: 'attach_suppressor', buy: 220, sell: 75 },
  { id: 'copper_bar', buy: 14, sell: 5 },
  { id: 'iron_bar', buy: 20, sell: 8 },
  { id: 'animal_hide', buy: 12, sell: 5 },
  { id: 'antler', buy: 0, sell: 38 },
  // the whole point: rare finds sell for a fortune here
  { id: 'gold_bar', buy: 0, sell: 420 },
  { id: 'diamond', buy: 0, sell: 900 },
  { id: 'rolex', buy: 0, sell: 620 },
  { id: 'data_drive', buy: 0, sell: 780 },
  { id: 'artifact', buy: 0, sell: 1600 },
];

export const TRADER_TIER_STOCK: Record<TraderTier, TradeEntry[]> = {
  1: TRADER_STOCK,
  2: TRADER_STOCK_T2,
};

// ─── Inventory & equipment ──────────────────────────────────────────────────

export type InvSlot = { id: ItemId; qty: number; dur?: number } | null;

/** Current durability of a slot (falls back to the item's max when unset/legacy). */
export function slotDur(s: NonNullable<InvSlot>, items: import('./items').RuntimeItemRegistry = ITEMS): number {
  const max = items[s.id]?.durability;
  if (max === undefined) return Infinity;
  return s.dur ?? max;
}

export interface Inventory {
  backpack: number;
  slots: InvSlot[];
}

export interface Equipment {
  helmet: ItemId | null;
  vest: ItemId | null;
  mod: ItemId | null; // weapon mod (red dot / suppressor)
}

export function invWeight(inv: Inventory, items: import('./items').RuntimeItemRegistry = ITEMS): number {
  let kg = 0;
  for (const s of inv.slots) if (s) kg += (items[s.id]?.kg ?? 0) * s.qty;
  return Math.round(kg * 100) / 100;
}

export function invCapacity(inv: Inventory): BackpackTier {
  return BACKPACKS[Math.min(inv.backpack, BACKPACKS.length - 1)];
}

export function armorMultiplier(eq: Equipment, items: import('./items').RuntimeItemRegistry = ITEMS): number {
  let m = 1;
  if (eq.helmet && items[eq.helmet]?.armor) m *= 1 - items[eq.helmet].armor!.reduction;
  if (eq.vest && items[eq.vest]?.armor) m *= 1 - items[eq.vest].armor!.reduction;
  return m;
}

// ─── Enemies ────────────────────────────────────────────────────────────────

export type KnownEnemyKind = 'zombie' | 'military' | 'deer' | 'rabbit' | 'boar' | 'wolf' | 'fox' | 'bear';
export type EnemyKind = KnownEnemyKind | (string & {});

/** flee = runs from players (huntable) · melee = chases and bites · ranged = keeps distance and shoots */
export type EnemyBehavior = 'flee' | 'melee' | 'ranged';

export interface EnemyDef {
  behavior: EnemyBehavior;
  maxHp: number;
  speed: number;
  aggroRange: number; // for flee behavior this is the flight distance
  attackRange: number;
  damage: number;
  attackMs: number;
  name: string; // display/killfeed name
}

export const ENEMY_DEFS: Record<KnownEnemyKind, EnemyDef> = {
  zombie: { behavior: 'melee', maxHp: 50, speed: 105, aggroRange: 230, attackRange: 28, damage: 10, attackMs: 900, name: 'zombie' },
  military: { behavior: 'ranged', maxHp: 80, speed: 120, aggroRange: 320, attackRange: 250, damage: 10, attackMs: 1400, name: 'military guard' },
  deer: { behavior: 'flee', maxHp: 30, speed: 165, aggroRange: 240, attackRange: 0, damage: 0, attackMs: 0, name: 'deer' },
  rabbit: { behavior: 'flee', maxHp: 12, speed: 195, aggroRange: 200, attackRange: 0, damage: 0, attackMs: 0, name: 'rabbit' },
  // boars are neutral: tiny aggro radius, but fight back hard when damaged
  boar: { behavior: 'melee', maxHp: 70, speed: 150, aggroRange: 60, attackRange: 30, damage: 14, attackMs: 800, name: 'boar' },
  wolf: { behavior: 'melee', maxHp: 45, speed: 175, aggroRange: 300, attackRange: 28, damage: 12, attackMs: 700, name: 'wolf' },
  fox: { behavior: 'flee', maxHp: 20, speed: 190, aggroRange: 230, attackRange: 0, damage: 0, attackMs: 0, name: 'red fox' },
  // bears ignore distant survivors, but become a serious close-range threat.
  bear: { behavior: 'melee', maxHp: 180, speed: 135, aggroRange: 75, attackRange: 34, damage: 24, attackMs: 1050, name: 'black bear' },
};

export interface EnemySnap {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  moving: boolean;
  attackAt?: number;
  hitAt?: number;
}

// ─── POIs / instances ───────────────────────────────────────────────────────

export type PoiKind = 'town' | 'airport' | 'outpost' | 'wilds' | 'hotzone';

export interface PoiSnap {
  name: string;
  kind: PoiKind;
  x: number;
  y: number;
  r: number;
  safe?: boolean;
  hot?: boolean; // high-loot area: rare chests, harder quests, black-market trader
}

export type InstanceKind = 'world' | 'hideout' | 'clan_hideout';

export interface CharacterAppearance {
  body: number;
  skinTone: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  accent: number;
  cosmetics: {
    head: string | null;
    face: string | null;
    back: string | null;
    badge: string | null;
  };
}

export const CHARACTER_BODY_NAMES = ['Standard', 'Compact', 'Broad'] as const;
export const CHARACTER_HAIR_NAMES = ['Shaved', 'Crop', 'Sidecut', 'Mohawk', 'Long'] as const;
export const CHARACTER_SKIN_COLORS = ['#f2c7a5', '#dca477', '#bd7f55', '#925d3f', '#68402f', '#3f2923'] as const;
export const CHARACTER_HAIR_COLORS = ['#201a17', '#493326', '#7a5030', '#b07a3d', '#d2b071', '#7a2e26', '#d5d1c5', '#34404d'] as const;
export const CHARACTER_OUTFIT_COLORS = ['#8a3a3a', '#3a5a8a', '#3a7a4a', '#8a6a2a', '#6a4a8a', '#2a7a7a', '#8a4a6a', '#5a6a2a'] as const;
export const CHARACTER_ACCENT_COLORS = ['#d8a24a', '#d8d2b8', '#6fa6bd', '#76b069', '#c85a4a', '#9b79c4', '#d27d48', '#555b63'] as const;

export const DEFAULT_CHARACTER_APPEARANCE: CharacterAppearance = {
  body: 0,
  skinTone: 1,
  hairStyle: 1,
  hairColor: 1,
  outfit: 0,
  accent: 0,
  cosmetics: { head: null, face: null, back: null, badge: null },
};

export function sanitizeCharacterAppearance(value: unknown, legacyLook = 0): CharacterAppearance {
  const source = value && typeof value === 'object' ? value as Partial<CharacterAppearance> : {};
  const cosmetics: Partial<CharacterAppearance['cosmetics']> = source.cosmetics && typeof source.cosmetics === 'object'
    ? source.cosmetics
    : {};
  const index = (candidate: unknown, max: number, fallback: number) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.max(0, Math.min(max - 1, number | 0)) : fallback;
  };
  const cosmetic = (candidate: unknown) => typeof candidate === 'string' && candidate.trim()
    ? candidate.trim().slice(0, 60)
    : null;
  return {
    body: index(source.body, CHARACTER_BODY_NAMES.length, DEFAULT_CHARACTER_APPEARANCE.body),
    skinTone: index(source.skinTone, CHARACTER_SKIN_COLORS.length, DEFAULT_CHARACTER_APPEARANCE.skinTone),
    hairStyle: index(source.hairStyle, CHARACTER_HAIR_NAMES.length, DEFAULT_CHARACTER_APPEARANCE.hairStyle),
    hairColor: index(source.hairColor, CHARACTER_HAIR_COLORS.length, DEFAULT_CHARACTER_APPEARANCE.hairColor),
    outfit: index(source.outfit, CHARACTER_OUTFIT_COLORS.length, index(legacyLook, CHARACTER_OUTFIT_COLORS.length, 0)),
    accent: index(source.accent, CHARACTER_ACCENT_COLORS.length, DEFAULT_CHARACTER_APPEARANCE.accent),
    cosmetics: {
      head: cosmetic(cosmetics.head), face: cosmetic(cosmetics.face),
      back: cosmetic(cosmetics.back), badge: cosmetic(cosmetics.badge),
    },
  };
}

// ─── Networked state ────────────────────────────────────────────────────────

export interface PlayerSnap {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number; // weapon/action aim
  facing: number; // body movement/action direction
  hp: number;
  maxHp: number;
  weapon: ItemId | null;
  helmet: ItemId | null;
  vest: ItemId | null;
  dead: boolean;
  moving: boolean;
  swing: number; // server ms timestamp of last melee swing (0 if stale)
  attackAt?: number;
  hitAt?: number;
  look?: number; // chosen character sprite row
  appearance?: CharacterAppearance;
  /** Verified server-side role marker. Never accepted from client payloads. */
  admin?: boolean;
  /** Ephemeral trial survivor; never accepted from client state. */
  guest?: boolean;
  /** Highest client input sequence processed by the authoritative server. */
  ack?: number;
}

/** Server-authorized ally positions may bypass LOS for tactical map rendering only. */
export interface MapPlayerSnap {
  id: string;
  name: string;
  x: number;
  y: number;
  relation: 'friend' | 'clan' | 'admin';
}

export interface ProjectileSnap {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

export interface ContainerSnap {
  id: string;
  x: number;
  y: number;
  kind: 'chest' | 'bag' | 'crate' | 'storage';
  looted: boolean;
}

export interface GroundItemSnap { id: string; x: number; y: number; item: ItemId; qty: number; dur?: number }

export interface WorldInit {
  kind: InstanceKind;
  name: string;
  seed: number;
  width: number;
  height: number;
  tiles: number[];
  tileRuns?: number[]; // compact [value,count] pairs; used when tiles is empty
  pois: PoiSnap[];
  traders: { x: number; y: number; tier?: TraderTier }[];
  extracts: { x: number; y: number }[]; // extraction beacons — hold E to go home with your loot
  exit: { x: number; y: number } | null; // hideout exit mat
  ownHideout: boolean; // true when this is YOUR hideout (enables building)
  canDemolish: boolean; // personal owner or clan owner/officer
  unders: Record<number, number>; // tile index → floor tile beneath a placed station
  elevations: number[];
  elevationRuns?: number[]; // compact [value,count] pairs; used when elevations is empty
  terrainKinds: Record<string, string>; // tile index -> published terrain definition
  terrainRuns?: TerrainRun[]; // compact sparse terrain overrides when terrainKinds is empty
  resourceKinds: Record<string, string>; // tile index -> published resource definition
  blockKinds: Record<string, string>; // tile index -> published world-block definition
  blockRotations: Record<string, number>; // tile index -> clockwise quarter turns (0-3)
  openDoors: number[]; // currently open block indexes
  stationFuel: Record<number, number>; // fueled firepits/furnaces; positive entries only
  gameplay: RuntimeGameplayContent; // authoritative items + recipes for this content revision
  visuals: import('./engine').RuntimeVisualContent;
  you: string;
  /** Temporary session with no persistence, community actions, chat, or hideout. */
  guest: boolean;
  /** Whether the current socket may open the in-game moderation console. */
  admin: boolean;
}

export interface StateSnap {
  t: number;
  day: number; // 0..1, 0 = midnight
  population: number; // stable instance population; does not vary with LOS culling
  players: PlayerSnap[];
  mapPlayers: MapPlayerSnap[];
  enemies: EnemySnap[];
  projectiles: ProjectileSnap[];
  containers: ContainerSnap[];
  ground: GroundItemSnap[];
}

export interface InventoryUpdate {
  inv: Inventory;
  equipped: number | null;
  equipment: Equipment;
  armorDur: Partial<Record<'helmet' | 'vest', number>>;
  hp: number;
  kills: number;
  deaths: number;
  money: number;
  skills: Skills;
  quests: QuestStatus[]; // all currently unlocked jobs, for the persistent tracker
  mag: number; // rounds loaded in the equipped weapon (0 when none/melee)
  reloading: boolean;
  nearWorkbench: boolean;
  nearFirepit: boolean;
  nearFurnace: boolean;
  nearAnvil: boolean;
  nearWater: boolean;
  hunger: number; // 0-100
  thirst: number; // 0-100
  stamina: number; // 0-100 — sprinting and heavy actions drain it
  staminaExhausted: boolean;
  look: number; // chosen character sprite row
  appearance: CharacterAppearance;
}

/** timed action feedback (looting/fishing/drinking/cooking) — ms 0 clears the bar.
 *  container+slot are set for loot actions so the client can draw a progress ring
 *  on the exact slot being taken. */
export interface ActionSnap { label: string; ms: number; kind?: string; container?: string; slot?: number }

export interface ContainerContents { id: string; slots: InvSlot[]; storage?: boolean }

export interface InputPayload {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  angle: number;
  shoot: boolean;
  sprint?: boolean; // hold to run — drains stamina
  /** Monotonic client sequence used only to reconcile render-side prediction. */
  seq?: number;
}

export interface KillFeedEntry { killer: string; victim: string; weapon: ItemId | null }

export interface HitSnap {
  x: number;
  y: number;
  amount: number;
  kind: 'player' | 'enemy' | 'node';
  material?: 'wood' | 'stone';
  soundId?: string;
  /** Lets clients retire the matching tracer on the exact authoritative impact. */
  projectileId?: number;
  projectileAngle?: number;
}

/** `under` = a station's floor; `resourceId` changes the live resource variant. */
export interface TileUpdate { i: number; tile: number; under?: number; resourceId?: string | null }
export interface StationFuelUpdate { i: number; fuel: number }

export interface EntityDeathSnap { x: number; y: number; target: string; fallbackRow: number }
export interface BlockUpdate { i: number; blockId?: string; rotation?: number; open?: boolean }
export interface TradeOpen { stock: TradeEntry[]; money: number; quests: QuestStatus[]; tier: TraderTier }

export interface ChatMsg { id: string; name: string; text: string; channel?: 'local' | 'clan'; admin?: boolean }

export interface AdminPlayerSummary {
  id: string;
  name: string;
  instanceId: string;
  instanceName: string;
  instanceKind: InstanceKind;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  connected: boolean;
  admin: boolean;
  guest: boolean;
  protected: boolean;
  mutedUntil: number;
}

export interface AdminSanctionSummary {
  userId: string;
  name: string;
  bannedUntil: number;
  banReason: string;
  mutedUntil: number;
  muteReason: string;
}

export interface AdminPanelState {
  server: string;
  protected: boolean;
  players: AdminPlayerSummary[];
  sanctions: AdminSanctionSummary[];
}

export type AdminActionPayload =
  | { type: 'give_item'; targetId: string; itemId: string; quantity: number }
  | { type: 'goto'; targetId: string }
  | { type: 'bring'; targetId: string }
  | { type: 'send_home'; targetId: string }
  | { type: 'heal'; targetId: string }
  | { type: 'kick'; targetId: string; reason?: string }
  | { type: 'mute'; targetId: string; minutes: number; reason?: string }
  | { type: 'ban'; targetId: string; minutes: number; reason?: string }
  | { type: 'clear_mute'; targetUserId: string }
  | { type: 'clear_ban'; targetUserId: string }
  | { type: 'teleport'; tileX: number; tileY: number }
  | { type: 'protection'; enabled: boolean }
  | { type: 'announce'; message: string };

export const EV = {
  // client → server
  input: 'c:input',
  interact: 'c:interact',
  containerTake: 'c:container:take',
  containerPut: 'c:container:put',
  containerMove: 'c:container:move', // reorder within an open container
  containerClose: 'c:container:close',
  invMove: 'c:inv:move',
  invDrop: 'c:inv:drop',
  invUse: 'c:inv:use',
  invEquip: 'c:inv:equip',
  unequipArmor: 'c:armor:off',
  craft: 'c:craft',
  respawn: 'c:respawn',
  tradeBuy: 'c:trade:buy',
  tradeSell: 'c:trade:sell',
  hideoutEnter: 'c:hideout:enter',
  clanHideoutEnter: 'c:clan:hideout:enter',
  clanTreasury: 'c:clan:treasury',
  socialRefresh: 'c:social:refresh',
  hideoutLeave: 'c:hideout:leave',
  reload: 'c:reload',
  build: 'c:build',
  demolish: 'c:demolish', // reclaim a built piece in your own camp (returns the kit)
  repair: 'c:repair', // mend a worn weapon/tool/armor at the right station
  look: 'c:look', // pick your character's appearance
  chat: 'c:chat',
  questClaim: 'c:quest:claim',
  stationFuel: 'c:station:fuel', // add carried wood to an open firepit/furnace
  adminRequest: 'c:admin:request',
  adminAction: 'c:admin:action',
  // server → client
  init: 's:init',
  state: 's:state',
  inventory: 's:inventory',
  container: 's:container',
  containerGone: 's:container:gone',
  trade: 's:trade',
  toast: 's:toast',
  killfeed: 's:killfeed',
  death: 's:death',
  hit: 's:hit',
  tile: 's:tile',
  chatMsg: 's:chat',
  action: 's:action',
  station: 's:station', // opened a placed structure (firepit/furnace/workbench)
  stationFuelUpdate: 's:station:fuel', // broadcast so firelight follows authoritative fuel
  clanTreasuryUpdate: 's:clan:treasury',
  gameplay: 's:gameplay', // hot-reloaded versioned items and recipes
  visuals: 's:visuals', // hot-reloaded pixel frames and entity animation profiles
  entityDeath: 's:entity-death',
  block: 's:block',
  adminState: 's:admin:state',
} as const;

/** payload of EV.station */
export interface StationOpen {
  type: BuildType;
  index?: number;
  fuel?: number;
  maxFuel?: number;
  fuelPerWood?: number;
}

// ─── Authored maps (editor) ────────────────────────────────────────────────

export type MapObjectType =
  | 'chest' | 'chest_military' | 'loot' | 'zombie' | 'military'
  | 'deer' | 'rabbit' | 'boar' | 'wolf' | 'fox' | 'bear'
  | 'chest_custom' | 'mob'
  | 'spawn' | 'trader' | 'trader_black' | 'extract'
  | 'poi_town' | 'poi_airport' | 'poi_outpost' | 'poi_hotzone' | 'poi_zone';

export interface MapObject {
  type: MapObjectType;
  x: number; // tile coords
  y: number;
  name?: string; // for POIs
  r?: number; // poi radius in tiles
  contentId?: string; // custom mob/trader/content record id
  lootTable?: string; // chest or mob drop table id
  respawnMs?: number;
  zoneKind?: PoiKind; // custom zone presentation on the minimap
  safe?: boolean;
  hot?: boolean;
}

export interface AuthoredMap {
  w: number;
  h: number;
  tiles?: number[]; // legacy dense storage
  tileRuns?: number[]; // compact [value,count] byte runs
  elevations?: number[];
  elevationRuns?: number[]; // compact [value,count] byte runs
  terrain?: Record<string, string>; // sparse tile index -> terrain definition override
  terrainRuns?: TerrainRun[]; // compact [start,count,id] override spans
  resources?: Record<string, string>; // tile index -> resource definition id
  blocks?: Record<string, string>; // tile index -> world-block definition id
  blockRotations?: Record<string, number>; // tile index -> clockwise quarter turns (0-3)
  objects: MapObject[];
}

export const AUTHORED_MAP_MIN_SIZE = 20;
export const AUTHORED_MAP_MAX_SIZE = 2000;
export const DEFAULT_TERRAIN_ID_BY_TILE: Partial<Record<Tile, string>> = {
  [Tile.Grass]: 'grass', [Tile.Water]: 'water', [Tile.Tree]: 'tree', [Tile.Floor]: 'floor',
  [Tile.Wall]: 'wall', [Tile.Road]: 'road', [Tile.Sand]: 'sand', [Tile.Rock]: 'rock',
  [Tile.Asphalt]: 'asphalt', [Tile.Bed]: 'bed', [Tile.DoorMat]: 'doormat',
  [Tile.CopperOre]: 'copper_ore', [Tile.IronOre]: 'iron_ore', [Tile.Cliff]: 'cliff',
};

export type TerrainRun = [start: number, count: number, terrainId: string];

export function encodeTerrainRuns(terrain: Record<string, string>): TerrainRun[] {
  const entries = Object.entries(terrain)
    .map(([rawIndex, id]) => [Number(rawIndex) | 0, id] as const)
    .filter(([index, id]) => index >= 0 && typeof id === 'string' && Boolean(id))
    .sort((a, b) => a[0] - b[0]);
  const runs: TerrainRun[] = [];
  for (const [index, id] of entries) {
    const previous = runs[runs.length - 1];
    if (previous && previous[2] === id && previous[0] + previous[1] === index) previous[1]++;
    else runs.push([index, 1, id]);
  }
  return runs;
}

export function decodeTerrainRuns(runs: readonly TerrainRun[] | undefined, cellCount: number): Record<string, string> {
  const terrain: Record<string, string> = {};
  if (!Array.isArray(runs)) return terrain;
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 3 || typeof run[2] !== 'string') continue;
    const start = Math.max(0, Number(run[0]) | 0);
    const count = Math.max(0, Math.min(cellCount - start, Number(run[1]) | 0));
    if (!count || start >= cellCount) continue;
    for (let offset = 0; offset < count; offset++) terrain[String(start + offset)] = run[2];
  }
  return terrain;
}

/** Encode a byte grid as alternating value/count pairs for JSON and socket transport. */
export function encodeByteRuns(values: ArrayLike<number>): number[] {
  if (!values.length) return [];
  const runs: number[] = [];
  let value = Math.max(0, Math.min(255, Number(values[0]) | 0));
  let count = 1;
  for (let index = 1; index < values.length; index++) {
    const next = Math.max(0, Math.min(255, Number(values[index]) | 0));
    if (next === value) count++;
    else {
      runs.push(value, count);
      value = next;
      count = 1;
    }
  }
  runs.push(value, count);
  return runs;
}

/** Validate that byte runs are canonical and cover exactly the requested grid. */
export function isCompleteByteRuns(runs: unknown, expectedLength: number): runs is number[] {
  if (!Array.isArray(runs) || runs.length === 0 || runs.length % 2 !== 0) return false;
  const expected = Math.max(0, expectedLength | 0);
  let length = 0;
  for (let index = 0; index < runs.length; index += 2) {
    const value = Number(runs[index]);
    const count = Number(runs[index + 1]);
    if (!Number.isInteger(value) || value < 0 || value > 255 || !Number.isInteger(count) || count <= 0) return false;
    length += count;
    if (length > expected) return false;
  }
  return length === expected;
}

/** Decode bounded value/count pairs. Missing or malformed tails retain the fallback value. */
export function decodeByteRuns(runs: readonly number[] | undefined, length: number, fallback = 0): Uint8Array {
  const size = Math.max(0, length | 0);
  const output = new Uint8Array(size);
  if (fallback) output.fill(Math.max(0, Math.min(255, fallback | 0)));
  if (!Array.isArray(runs) || runs.length % 2 !== 0) return output;
  let offset = 0;
  for (let index = 0; index < runs.length && offset < size; index += 2) {
    const value = Math.max(0, Math.min(255, Number(runs[index]) | 0));
    const count = Math.max(0, Math.min(size - offset, Number(runs[index + 1]) | 0));
    if (!count) continue;
    output.fill(value, offset, offset + count);
    offset += count;
  }
  return output;
}

export function decodeAuthoredTiles(map: AuthoredMap, fallback = Tile.Grass): Uint8Array {
  const length = Math.max(0, (map.w | 0) * (map.h | 0));
  if (Array.isArray(map.tiles) && map.tiles.length === length) {
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index++) output[index] = Math.max(0, Math.min(255, Number(map.tiles[index]) | 0));
    return output;
  }
  return decodeByteRuns(map.tileRuns, length, fallback);
}

export function decodeAuthoredElevations(map: AuthoredMap): Uint8Array {
  const length = Math.max(0, (map.w | 0) * (map.h | 0));
  if (Array.isArray(map.elevations) && map.elevations.length === length) {
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index++) output[index] = Math.max(0, Math.min(3, Number(map.elevations[index]) | 0));
    return output;
  }
  const output = decodeByteRuns(map.elevationRuns, length, 0);
  for (let index = 0; index < output.length; index++) output[index] = Math.min(3, output[index]);
  return output;
}

// Game-engine persistence types and the shared fallback loot registry.
export * from './engine';

// ─── Constants ──────────────────────────────────────────────────────────────

export const PLAYER_RADIUS = 12;
export const PLAYER_SPEED = 170;
export const PLAYER_MAX_HP = 100;
export const INTERACT_RANGE = 56;
export const TICK_MS = 50;
export const DAY_LENGTH_MS = 600_000;

// ── day/night — night is dangerous, extraction gets you home with the loot
export function isNight(day: number): boolean {
  return day < 0.22 || day > 0.78;
}
export const NIGHT_AGGRO_MULT = 1.6; // zombies & wolves see further in the dark
export const NIGHT_SPEED_MULT = 1.2; // zombies shamble faster at night
export const EXTRACT_TIME_MS = 5000; // hold still at a beacon to extract
export const HOME_REST_HP_PER_S = 2; // resting at your base heals fast
export const STATION_FUEL_MAX = 40;
export const STATION_FUEL_PER_WOOD = 4;
export const STATION_FUEL_PER_ACTION = 1;

// ── stamina — sprinting and heavy actions cost it
export const STAMINA_MAX = 100;
export const SPRINT_SPEED_MULT = 1.55;
export const FATIGUE_SPEED_MULT = 0.45; // overweight and exhausted survivors move at the same penalty
export const SPRINT_DRAIN_PER_S = 22; // ~4.5s of continuous sprint from full
export const STAMINA_REGEN_PER_S = 14; // refills while you catch your breath
export const STAMINA_REGEN_DELAY_MS = 700; // brief pause after exertion before regen
export const STAMINA_EXHAUSTED_REGEN_DELAY_MS = 2600; // hitting zero carries a meaningful recovery penalty
export const STAMINA_EXHAUSTED_RECOVERY = 25; // sprint remains locked until this much stamina returns
export const MINE_STAMINA_COST = 6; // per swing chopping/mining a node
export const SWIM_SPEED_MULT = 0.45;
export const HUNGER_DECAY_PER_S = 100 / 3600; // empty in ~1h of play
export const THIRST_DECAY_PER_S = 100 / 2400; // empty in ~40min
export const STARVE_DMG_PER_S = 0.5;
// staying fed & hydrated slowly heals you (reward for playing the survival loop)
export const REGEN_THRESHOLD = 75; // hunger AND thirst must be above this
export const REGEN_HP_PER_S = 0.6;
export const LOOT_TIME_BASE_MS = 500; // + per-kg factor, Tarkov-style
export const LOOT_TIME_PER_KG_MS = 350;
export const FISH_TIME_MS = 4000;
export const DRINK_TIME_MS = 1500;
export const COOK_TIME_MS = 2500;
export const CRAFT_TIME_MS = 1200; // crafting is a timed action — queueable client-side
export const HIDEOUT_W = 26; // roomy grass field — enough to build a real base
export const HIDEOUT_H = 20;
export const HIDEOUT_STORAGE_SLOTS = 12;
export const CLAN_HOLDOUT_W = 42;
export const CLAN_HOLDOUT_H = 30;
export const CLAN_HOLDOUT_STORAGE_SLOTS = 24;
export const NAMEPLATE_RANGE = 240;
export const STARTING_MONEY = 25;
