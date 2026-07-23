export const DROPPED_LOOT_TTL_MS = 30 * 60_000;
export const CHEST_RESTOCK_MS = 20 * 60_000;

/** Give transient ground loot and death bags one shared server-owned lifetime. */
export function droppedLootExpiresAt(now: number): number {
  return now + DROPPED_LOOT_TTL_MS;
}

/** Start the refill countdown on first open without letting later opens postpone it. */
export function chestRestockAtAfterOpen(
  currentRestockAt: number | null,
  now: number,
): number {
  return currentRestockAt ?? now + CHEST_RESTOCK_MS;
}

/** Remove expired entries while leaving permanent containers without a TTL alone. */
export function purgeExpiredLoot<T extends { expiresAt?: number }>(
  entries: Map<string, T>,
  now: number,
): string[] {
  const removed: string[] = [];
  for (const [id, entry] of entries) {
    if (entry.expiresAt === undefined || now < entry.expiresAt) continue;
    entries.delete(id);
    removed.push(id);
  }
  return removed;
}
