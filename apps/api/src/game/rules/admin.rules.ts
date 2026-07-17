export const ADMIN_MAX_ITEM_QUANTITY = 1_000;
export const ADMIN_MAX_SANCTION_MINUTES = 43_200; // 30 days

export function adminItemQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 1;
  return Math.max(1, Math.min(ADMIN_MAX_ITEM_QUANTITY, Math.floor(quantity)));
}

export function adminSanctionMinutes(value: unknown): number {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return 60;
  return Math.max(1, Math.min(ADMIN_MAX_SANCTION_MINUTES, Math.floor(minutes)));
}

export function adminText(value: unknown, maxLength: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, Math.max(1, maxLength)) || fallback;
}

export function adminTileCoordinate(value: unknown, maximum: number): number | null {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || maximum <= 0) return null;
  return Math.max(0, Math.min(maximum - 1, Math.floor(coordinate)));
}
