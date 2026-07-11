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
};
export const NODE_DEPLETED: Partial<Record<Tile, Tile>> = {
  [Tile.Tree]: Tile.Stump,
  [Tile.Rock]: Tile.Rubble,
};
export const NODE_RESPAWN_MS = 240_000;

// ─── Items ──────────────────────────────────────────────────────────────────
// The item registry lives in ./items (category builders, easy to extend).
export * from './items';
import { BuildType, ItemId, ITEMS } from './items';

export interface BackpackTier { name: string; slots: number; maxKg: number }
export const BACKPACKS: BackpackTier[] = [
  { name: 'Field Satchel', slots: 12, maxKg: 20 },
  { name: 'Scout Backpack', slots: 16, maxKg: 32 },
  { name: 'Raider Backpack', slots: 20, maxKg: 45 },
];

// ─── Crafting ───────────────────────────────────────────────────────────────

export type RecipeCat = 'survival' | 'medical' | 'ammo' | 'gear' | 'mods' | 'build';

export interface Recipe {
  id: string;
  cat: RecipeCat;
  out: { id: ItemId; qty: number };
  cost: { id: ItemId; qty: number }[];
  station?: 'workbench' | 'furnace'; // craftable only near that placed structure
}

export const RECIPES: Recipe[] = [
  { id: 'craft_spear', cat: 'survival', out: { id: 'spear', qty: 1 }, cost: [{ id: 'wood', qty: 4 }, { id: 'stone', qty: 1 }] },
  { id: 'craft_axe', cat: 'survival', out: { id: 'axe', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'stone', qty: 3 }] },
  { id: 'craft_pickaxe', cat: 'survival', out: { id: 'pickaxe', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'stone', qty: 3 }] },
  { id: 'craft_fishing_rod', cat: 'survival', out: { id: 'fishing_rod', qty: 1 }, cost: [{ id: 'wood', qty: 4 }, { id: 'cloth', qty: 2 }] },
  { id: 'craft_bow', cat: 'survival', out: { id: 'bow', qty: 1 }, cost: [{ id: 'wood', qty: 6 }, { id: 'cloth', qty: 3 }] },
  { id: 'craft_arrows', cat: 'survival', out: { id: 'arrow', qty: 6 }, cost: [{ id: 'wood', qty: 3 }, { id: 'stone', qty: 1 }] },
  { id: 'craft_canteen', cat: 'survival', out: { id: 'canteen', qty: 1 }, cost: [{ id: 'scrap', qty: 4 }, { id: 'cloth', qty: 1 }] },
  { id: 'craft_bandage', cat: 'medical', out: { id: 'bandage', qty: 1 }, cost: [{ id: 'cloth', qty: 2 }] },
  { id: 'craft_medkit', cat: 'medical', out: { id: 'medkit', qty: 1 }, cost: [{ id: 'bandage', qty: 2 }, { id: 'scrap', qty: 1 }] },
  { id: 'craft_9mm', cat: 'ammo', out: { id: 'ammo_9mm', qty: 12 }, cost: [{ id: 'scrap', qty: 2 }], station: 'furnace' },
  { id: 'craft_shells', cat: 'ammo', out: { id: 'ammo_shell', qty: 4 }, cost: [{ id: 'scrap', qty: 2 }, { id: 'cloth', qty: 1 }], station: 'furnace' },
  { id: 'craft_556', cat: 'ammo', out: { id: 'ammo_556', qty: 10 }, cost: [{ id: 'scrap', qty: 3 }], station: 'furnace' },
  { id: 'craft_helmet_scrap', cat: 'gear', out: { id: 'helmet_scrap', qty: 1 }, cost: [{ id: 'scrap', qty: 6 }, { id: 'cloth', qty: 2 }] },
  { id: 'craft_vest_light', cat: 'gear', out: { id: 'vest_light', qty: 1 }, cost: [{ id: 'cloth', qty: 8 }, { id: 'scrap', qty: 4 }] },
  { id: 'craft_backpack_mk2', cat: 'gear', out: { id: 'backpack_mk2', qty: 1 }, cost: [{ id: 'cloth', qty: 6 }, { id: 'scrap', qty: 4 }] },
  { id: 'craft_backpack_mk3', cat: 'gear', out: { id: 'backpack_mk3', qty: 1 }, cost: [{ id: 'cloth', qty: 10 }, { id: 'scrap', qty: 8 }, { id: 'wood', qty: 4 }] },
  { id: 'craft_reddot', cat: 'mods', out: { id: 'attach_reddot', qty: 1 }, cost: [{ id: 'scrap', qty: 8 }, { id: 'cloth', qty: 2 }], station: 'workbench' },
  { id: 'craft_suppressor', cat: 'mods', out: { id: 'attach_suppressor', qty: 1 }, cost: [{ id: 'scrap', qty: 10 }, { id: 'cloth', qty: 3 }], station: 'workbench' },
  // build kits — craft, then hold the item to place it (ghost preview)
  { id: 'craft_firepit', cat: 'build', out: { id: 'kit_firepit', qty: 1 }, cost: [{ id: 'wood', qty: 6 }, { id: 'stone', qty: 4 }] },
  { id: 'craft_furnace', cat: 'build', out: { id: 'kit_furnace', qty: 1 }, cost: [{ id: 'stone', qty: 12 }, { id: 'scrap', qty: 6 }] },
  { id: 'craft_workbench', cat: 'build', out: { id: 'kit_workbench', qty: 1 }, cost: [{ id: 'wood', qty: 8 }, { id: 'scrap', qty: 4 }] },
  { id: 'craft_chest', cat: 'build', out: { id: 'kit_chest', qty: 1 }, cost: [{ id: 'wood', qty: 10 }, { id: 'stone', qty: 4 }] },
  // base construction — cheap and stackable so you can build out a whole camp
  { id: 'craft_floor_wood', cat: 'build', out: { id: 'kit_floor_wood', qty: 4 }, cost: [{ id: 'wood', qty: 4 }] },
  { id: 'craft_floor_stone', cat: 'build', out: { id: 'kit_floor_stone', qty: 4 }, cost: [{ id: 'stone', qty: 4 }] },
  { id: 'craft_wall', cat: 'build', out: { id: 'kit_wall', qty: 2 }, cost: [{ id: 'wood', qty: 6 }, { id: 'stone', qty: 2 }] },
  { id: 'craft_door', cat: 'build', out: { id: 'kit_door', qty: 1 }, cost: [{ id: 'wood', qty: 5 }, { id: 'scrap', qty: 2 }] },
  { id: 'craft_fence', cat: 'build', out: { id: 'kit_fence', qty: 4 }, cost: [{ id: 'wood', qty: 6 }] },
  { id: 'craft_torch', cat: 'build', out: { id: 'kit_torch', qty: 2 }, cost: [{ id: 'wood', qty: 2 }, { id: 'cloth', qty: 1 }] },
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
  furnace: { type: 'furnace', name: 'Furnace', desc: 'Unlocks ammo crafting nearby.', tile: Tile.Furnace, hp: 160 },
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

// ─── Inventory & equipment ──────────────────────────────────────────────────

export type InvSlot = { id: ItemId; qty: number } | null;

export interface Inventory {
  backpack: number;
  slots: InvSlot[];
}

export interface Equipment {
  helmet: ItemId | null;
  vest: ItemId | null;
  mod: ItemId | null; // weapon mod (red dot / suppressor)
}

export function invWeight(inv: Inventory): number {
  let kg = 0;
  for (const s of inv.slots) if (s) kg += ITEMS[s.id].kg * s.qty;
  return Math.round(kg * 100) / 100;
}

export function invCapacity(inv: Inventory): BackpackTier {
  return BACKPACKS[Math.min(inv.backpack, BACKPACKS.length - 1)];
}

export function armorMultiplier(eq: Equipment): number {
  let m = 1;
  if (eq.helmet && ITEMS[eq.helmet].armor) m *= 1 - ITEMS[eq.helmet].armor!.reduction;
  if (eq.vest && ITEMS[eq.vest].armor) m *= 1 - ITEMS[eq.vest].armor!.reduction;
  return m;
}

// ─── Enemies ────────────────────────────────────────────────────────────────

export type EnemyKind = 'zombie' | 'military' | 'deer' | 'rabbit' | 'boar' | 'wolf';

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

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  zombie: { behavior: 'melee', maxHp: 50, speed: 105, aggroRange: 230, attackRange: 28, damage: 10, attackMs: 900, name: 'zombie' },
  military: { behavior: 'ranged', maxHp: 80, speed: 120, aggroRange: 320, attackRange: 250, damage: 10, attackMs: 1400, name: 'military guard' },
  deer: { behavior: 'flee', maxHp: 30, speed: 165, aggroRange: 240, attackRange: 0, damage: 0, attackMs: 0, name: 'deer' },
  rabbit: { behavior: 'flee', maxHp: 12, speed: 195, aggroRange: 200, attackRange: 0, damage: 0, attackMs: 0, name: 'rabbit' },
  // boars are neutral: tiny aggro radius, but fight back hard when damaged
  boar: { behavior: 'melee', maxHp: 70, speed: 150, aggroRange: 60, attackRange: 30, damage: 14, attackMs: 800, name: 'boar' },
  wolf: { behavior: 'melee', maxHp: 45, speed: 175, aggroRange: 300, attackRange: 28, damage: 12, attackMs: 700, name: 'wolf' },
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
}

// ─── POIs / instances ───────────────────────────────────────────────────────

export type PoiKind = 'town' | 'airport' | 'outpost' | 'wilds';

export interface PoiSnap {
  name: string;
  kind: PoiKind;
  x: number;
  y: number;
  r: number;
  safe?: boolean;
}

export type InstanceKind = 'world' | 'hideout';

// ─── Networked state ────────────────────────────────────────────────────────

export interface PlayerSnap {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  weapon: ItemId | null;
  helmet: ItemId | null;
  vest: ItemId | null;
  dead: boolean;
  moving: boolean;
  swing: number; // server ms timestamp of last melee swing (0 if stale)
}

export interface ProjectileSnap { id: number; x: number; y: number; angle: number }

export interface ContainerSnap {
  id: string;
  x: number;
  y: number;
  kind: 'chest' | 'bag' | 'crate' | 'storage';
  looted: boolean;
}

export interface GroundItemSnap { id: string; x: number; y: number; item: ItemId; qty: number }

export interface WorldInit {
  kind: InstanceKind;
  name: string;
  seed: number;
  width: number;
  height: number;
  tiles: number[];
  pois: PoiSnap[];
  traders: { x: number; y: number }[];
  extracts: { x: number; y: number }[]; // extraction beacons — hold E to go home with your loot
  exit: { x: number; y: number } | null; // hideout exit mat
  ownHideout: boolean; // true when this is YOUR hideout (enables building)
  you: string;
}

export interface StateSnap {
  t: number;
  day: number; // 0..1, 0 = midnight
  players: PlayerSnap[];
  enemies: EnemySnap[];
  projectiles: ProjectileSnap[];
  containers: ContainerSnap[];
  ground: GroundItemSnap[];
}

export interface InventoryUpdate {
  inv: Inventory;
  equipped: number | null;
  equipment: Equipment;
  hp: number;
  kills: number;
  deaths: number;
  money: number;
  skills: Skills;
  mag: number; // rounds loaded in the equipped weapon (0 when none/melee)
  reloading: boolean;
  nearWorkbench: boolean;
  nearFirepit: boolean;
  nearFurnace: boolean;
  nearWater: boolean;
  hunger: number; // 0-100
  thirst: number; // 0-100
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
}

export interface KillFeedEntry { killer: string; victim: string; weapon: ItemId | null }

export interface HitSnap {
  x: number;
  y: number;
  amount: number;
  kind: 'player' | 'enemy' | 'node';
  material?: 'wood' | 'stone';
}

export interface TileUpdate { i: number; tile: number }

export interface TradeOpen { stock: TradeEntry[]; money: number; quests: QuestStatus[] }

export interface ChatMsg { id: string; name: string; text: string }

export const EV = {
  // client → server
  input: 'c:input',
  interact: 'c:interact',
  containerTake: 'c:container:take',
  containerPut: 'c:container:put',
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
  hideoutLeave: 'c:hideout:leave',
  reload: 'c:reload',
  build: 'c:build',
  demolish: 'c:demolish', // reclaim a built piece in your own camp (returns the kit)
  chat: 'c:chat',
  questClaim: 'c:quest:claim',
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
} as const;

/** payload of EV.station */
export interface StationOpen { type: BuildType }

// ─── Authored maps (editor) ────────────────────────────────────────────────

export type MapObjectType =
  | 'chest' | 'chest_military' | 'loot' | 'zombie' | 'military'
  | 'deer' | 'rabbit' | 'boar' | 'wolf'
  | 'spawn' | 'trader' | 'extract' | 'poi_town' | 'poi_airport' | 'poi_outpost';

export interface MapObject {
  type: MapObjectType;
  x: number; // tile coords
  y: number;
  name?: string; // for POIs
  r?: number; // poi radius in tiles
}

export interface AuthoredMap {
  w: number;
  h: number;
  tiles: number[];
  objects: MapObject[];
}

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
export const NAMEPLATE_RANGE = 240;
export const STARTING_MONEY = 25;
