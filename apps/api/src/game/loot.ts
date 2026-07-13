import { DEFAULT_LOOT_TABLES, InvSlot, ItemId, LootEntry, LootTableDef, LootTableRegistry } from '@holdout/shared';
import { ChestTier } from './mapgen';

function pick(table: LootTableDef, rnd: () => number): { id: ItemId; qty: number } {
  const entries = table.entries as LootEntry[];
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  let roll = rnd() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return { id: entry.id as ItemId, qty: entry.min + Math.floor(rnd() * (entry.max - entry.min + 1)) };
  }
  const last = entries[entries.length - 1];
  return { id: last.id as ItemId, qty: last.min };
}

function rollTable(rnd: () => number, table: LootTableDef): InvSlot[] {
  const count = table.minRolls + Math.floor(rnd() * (table.maxRolls - table.minRolls + 1));
  const slots: InvSlot[] = [];
  for (let index = 0; index < count; index++) slots.push(pick(table, rnd));
  return slots;
}

export function rollNamed(rnd: () => number, id: string, tables: LootTableRegistry = DEFAULT_LOOT_TABLES): InvSlot[] {
  return rollTable(rnd, tables[id] ?? DEFAULT_LOOT_TABLES.chest);
}

export function rollChest(rnd: () => number, tier: ChestTier = 'normal', tables: LootTableRegistry = DEFAULT_LOOT_TABLES): InvSlot[] {
  const id = tier === 'normal' ? 'chest' : tier;
  return rollTable(rnd, tables[id] ?? DEFAULT_LOOT_TABLES[id]);
}

export function rollGround(rnd: () => number, tables: LootTableRegistry = DEFAULT_LOOT_TABLES): { id: ItemId; qty: number } {
  return pick(tables.ground ?? DEFAULT_LOOT_TABLES.ground, rnd);
}

export function rollEnemyDrop(rnd: () => number, kind: string, tables: LootTableRegistry = DEFAULT_LOOT_TABLES): InvSlot[] {
  const id = kind === 'military' ? 'military_drop' : kind;
  return rollTable(rnd, tables[id] ?? tables.zombie ?? DEFAULT_LOOT_TABLES.zombie);
}
