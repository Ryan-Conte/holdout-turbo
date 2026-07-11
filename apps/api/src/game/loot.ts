import { InvSlot, ItemId } from '@holdout/shared';
import { ChestTier } from './mapgen';

interface LootEntry {
  id: ItemId;
  weight: number;
  min: number;
  max: number;
}

const CHEST_TABLE: LootEntry[] = [
  { id: 'cloth', weight: 20, min: 2, max: 5 },
  { id: 'scrap', weight: 18, min: 1, max: 4 },
  { id: 'wood', weight: 10, min: 1, max: 3 },
  { id: 'stone', weight: 8, min: 1, max: 3 },
  { id: 'ammo_9mm', weight: 14, min: 8, max: 24 },
  { id: 'ammo_shell', weight: 8, min: 2, max: 8 },
  { id: 'bandage', weight: 10, min: 1, max: 2 },
  { id: 'medkit', weight: 4, min: 1, max: 1 },
  { id: 'pistol', weight: 6, min: 1, max: 1 },
  { id: 'smg', weight: 4, min: 1, max: 1 },
  { id: 'shotgun', weight: 3, min: 1, max: 1 },
  { id: 'axe', weight: 4, min: 1, max: 1 },
  { id: 'pickaxe', weight: 3, min: 1, max: 1 },
  { id: 'spear', weight: 3, min: 1, max: 1 },
  { id: 'helmet_scrap', weight: 3, min: 1, max: 1 },
  { id: 'vest_light', weight: 2, min: 1, max: 1 },
  { id: 'backpack_mk2', weight: 2, min: 1, max: 1 },
  { id: 'backpack_mk3', weight: 1, min: 1, max: 1 },
];

// airport hangars / guarded stashes — better odds on the good stuff
const MILITARY_TABLE: LootEntry[] = [
  { id: 'rifle', weight: 10, min: 1, max: 1 },
  { id: 'ammo_556', weight: 20, min: 10, max: 30 },
  { id: 'ammo_9mm', weight: 10, min: 12, max: 30 },
  { id: 'ammo_shell', weight: 8, min: 4, max: 10 },
  { id: 'medkit', weight: 12, min: 1, max: 2 },
  { id: 'bandage', weight: 10, min: 1, max: 3 },
  { id: 'smg', weight: 6, min: 1, max: 1 },
  { id: 'shotgun', weight: 5, min: 1, max: 1 },
  { id: 'scrap', weight: 10, min: 2, max: 6 },
  { id: 'helmet_military', weight: 5, min: 1, max: 1 },
  { id: 'vest_military', weight: 4, min: 1, max: 1 },
  { id: 'backpack_mk2', weight: 5, min: 1, max: 1 },
  { id: 'backpack_mk3', weight: 4, min: 1, max: 1 },
];

const GROUND_TABLE: LootEntry[] = [
  { id: 'cloth', weight: 26, min: 1, max: 3 },
  { id: 'scrap', weight: 22, min: 1, max: 2 },
  { id: 'wood', weight: 12, min: 1, max: 2 },
  { id: 'stone', weight: 8, min: 1, max: 2 },
  { id: 'ammo_9mm', weight: 14, min: 5, max: 12 },
  { id: 'ammo_shell', weight: 6, min: 1, max: 4 },
  { id: 'bandage', weight: 9, min: 1, max: 1 },
  { id: 'pistol', weight: 5, min: 1, max: 1 },
  { id: 'smg', weight: 2, min: 1, max: 1 },
];

// what shambles out of a zombie's pockets
const ZOMBIE_TABLE: LootEntry[] = [
  { id: 'cloth', weight: 40, min: 1, max: 3 },
  { id: 'scrap', weight: 25, min: 1, max: 2 },
  { id: 'bandage', weight: 20, min: 1, max: 1 },
  { id: 'ammo_9mm', weight: 15, min: 3, max: 8 },
];

const DEER_TABLE: LootEntry[] = [
  { id: 'raw_meat', weight: 70, min: 2, max: 3 },
  { id: 'cloth', weight: 30, min: 1, max: 2 },
];

const RABBIT_TABLE: LootEntry[] = [
  { id: 'raw_meat', weight: 75, min: 1, max: 1 },
  { id: 'cloth', weight: 25, min: 1, max: 1 },
];

const BOAR_TABLE: LootEntry[] = [
  { id: 'raw_meat', weight: 70, min: 3, max: 4 },
  { id: 'cloth', weight: 30, min: 1, max: 3 },
];

const WOLF_TABLE: LootEntry[] = [
  { id: 'raw_meat', weight: 55, min: 1, max: 2 },
  { id: 'cloth', weight: 45, min: 2, max: 3 },
];

const MILITARY_DROP_TABLE: LootEntry[] = [
  { id: 'ammo_556', weight: 28, min: 6, max: 16 },
  { id: 'rifle', weight: 11, min: 1, max: 1 },
  { id: 'medkit', weight: 14, min: 1, max: 1 },
  { id: 'bandage', weight: 18, min: 1, max: 2 },
  { id: 'scrap', weight: 19, min: 1, max: 3 },
  { id: 'helmet_military', weight: 6, min: 1, max: 1 },
  { id: 'vest_military', weight: 4, min: 1, max: 1 },
];

function pick(table: LootEntry[], rnd: () => number): { id: ItemId; qty: number } {
  const total = table.reduce((s, e) => s + e.weight, 0);
  let roll = rnd() * total;
  for (const e of table) {
    roll -= e.weight;
    if (roll <= 0) return { id: e.id, qty: e.min + Math.floor(rnd() * (e.max - e.min + 1)) };
  }
  const last = table[table.length - 1];
  return { id: last.id, qty: last.min };
}

export function rollChest(rnd: () => number, tier: ChestTier = 'normal'): InvSlot[] {
  const table = tier === 'military' ? MILITARY_TABLE : CHEST_TABLE;
  const n = tier === 'military' ? 3 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
  const slots: InvSlot[] = [];
  for (let i = 0; i < n; i++) slots.push(pick(table, rnd));
  return slots;
}

export function rollGround(rnd: () => number): { id: ItemId; qty: number } {
  return pick(GROUND_TABLE, rnd);
}

const DROP_TABLES: Record<string, { table: LootEntry[]; rolls: (rnd: () => number) => number }> = {
  zombie: { table: ZOMBIE_TABLE, rolls: (rnd) => 1 + Math.floor(rnd() * 2) },
  military: { table: MILITARY_DROP_TABLE, rolls: (rnd) => 1 + Math.floor(rnd() * 2) },
  deer: { table: DEER_TABLE, rolls: () => 2 },
  rabbit: { table: RABBIT_TABLE, rolls: () => 1 },
  boar: { table: BOAR_TABLE, rolls: () => 2 },
  wolf: { table: WOLF_TABLE, rolls: () => 2 },
};

export function rollEnemyDrop(rnd: () => number, kind: string): InvSlot[] {
  const entry = DROP_TABLES[kind] ?? DROP_TABLES.zombie;
  const n = entry.rolls(rnd);
  const slots: InvSlot[] = [];
  for (let i = 0; i < n; i++) slots.push(pick(entry.table, rnd));
  return slots;
}
