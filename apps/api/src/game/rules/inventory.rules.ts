import type { Equipment, Inventory, InvSlot, ItemId, RuntimeItemRegistry } from '@holdout/shared';

export function addInventoryItem(
  inventory: Inventory,
  items: RuntimeItemRegistry,
  id: string,
  quantity: number,
  durability?: number,
): number {
  const definition = items[id];
  const requested = Math.max(0, Math.floor(quantity));
  if (!definition || requested <= 0) return requested;
  const currentDurability = definition.durability !== undefined && Number.isFinite(durability)
    ? Math.max(1, Math.min(definition.durability, Math.floor(durability!)))
    : undefined;
  let left = requested;
  for (const slot of inventory.slots) {
    if (left <= 0) break;
    if (slot && slot.id === id && slot.qty < definition.stack && slot.dur === currentDurability) {
      const added = Math.min(definition.stack - slot.qty, left);
      slot.qty += added;
      left -= added;
    }
  }
  for (let index = 0; index < inventory.slots.length && left > 0; index++) {
    if (inventory.slots[index]) continue;
    const added = Math.min(definition.stack, left);
    inventory.slots[index] = {
      id: id as ItemId,
      qty: added,
      ...(currentDurability !== undefined ? { dur: currentDurability } : {}),
    };
    left -= added;
  }
  return left;
}

export function removeInventoryItem(inventory: Inventory, id: string, quantity: number): number {
  let left = Math.max(0, Math.floor(quantity));
  const requested = left;
  for (let index = 0; index < inventory.slots.length && left > 0; index++) {
    const slot = inventory.slots[index];
    if (!slot || slot.id !== id) continue;
    const taken = Math.min(slot.qty, left);
    slot.qty -= taken;
    left -= taken;
    if (slot.qty <= 0) inventory.slots[index] = null;
  }
  return requested - left;
}

export function countInventoryItem(inventory: Inventory, id: string): number {
  return inventory.slots.reduce((total, slot) => total + (slot?.id === id ? slot.qty : 0), 0);
}

export function collectCarriedDrops(
  inventory: Inventory,
  equipment: Equipment,
  armorDurability: Partial<Record<'helmet' | 'vest', number>>,
  items: RuntimeItemRegistry,
): NonNullable<InvSlot>[] {
  const drops = inventory.slots.filter((slot): slot is NonNullable<InvSlot> => Boolean(slot)).map((slot) => ({ ...slot }));
  for (const piece of ['helmet', 'vest'] as const) {
    const id = equipment[piece];
    if (!id) continue;
    const max = items[id]?.durability;
    const durability = max === undefined ? undefined : Math.max(1, Math.min(max, armorDurability[piece] ?? max));
    drops.push({ id, qty: 1, ...(durability !== undefined ? { dur: durability } : {}) });
  }
  if (equipment.mod) drops.push({ id: equipment.mod, qty: 1 });
  return drops;
}

export function canPayRecipe(inventory: Inventory, costs: { id: string; qty: number }[]): boolean {
  return costs.every((cost) => countInventoryItem(inventory, cost.id) >= cost.qty);
}
