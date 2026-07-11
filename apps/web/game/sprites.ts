import { ItemId } from '@holdout/shared';

// Column order in items.png — must match tools/gen-sprites.mjs
export const ITEM_SHEET_ORDER: ItemId[] = [
  'pistol', 'smg', 'shotgun', 'rifle', 'spear', 'axe', 'pickaxe',
  'ammo_9mm', 'ammo_shell', 'ammo_556', 'cloth', 'scrap', 'wood', 'stone',
  'bandage', 'medkit', 'backpack_mk2', 'backpack_mk3',
  'helmet_scrap', 'helmet_military', 'vest_light', 'vest_military',
  'attach_reddot', 'attach_suppressor',
  'fishing_rod', 'raw_fish', 'cooked_fish', 'raw_meat', 'cooked_meat', 'canteen', 'canteen_full',
  'kit_firepit', 'kit_furnace', 'kit_workbench', 'kit_chest',
  'kit_floor_wood', 'kit_floor_stone', 'kit_wall', 'kit_door', 'kit_fence', 'kit_torch',
  'bow', 'arrow',
];

export const ITEM_INDEX: Record<string, number> = Object.fromEntries(
  ITEM_SHEET_ORDER.map((id, i) => [id, i]),
);

export const CHAR_ROWS = { survivorCount: 8, zombie: 8, military: 9, trader: 10, deer: 11, rabbit: 12, boar: 13, wolf: 14 };

export interface Sheets {
  tiles: HTMLImageElement;
  chars: HTMLImageElement;
  items: HTMLImageElement;
}

let cached: Promise<Sheets> | null = null;

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export function loadSheets(): Promise<Sheets> {
  if (!cached) {
    cached = Promise.all([load('/sprites/tiles.png'), load('/sprites/chars.png'), load('/sprites/items.png')]).then(
      ([tiles, chars, items]) => ({ tiles, chars, items }),
    );
  }
  return cached;
}
