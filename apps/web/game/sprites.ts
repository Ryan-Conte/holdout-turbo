import { ItemId, ITEM_SPRITE_ORDER } from '@holdout/shared';

// Column order in items.png — must match tools/gen-sprites.mjs
export const ITEM_SHEET_ORDER: ItemId[] = [...ITEM_SPRITE_ORDER];

export const ITEM_INDEX: Record<string, number> = Object.fromEntries(
  ITEM_SHEET_ORDER.map((id, i) => [id, i]),
);

export const CHAR_ROWS = {
  survivorCount: 8,
  zombie: 8,
  military: 9,
  trader: 10,
  deer: 11,
  rabbit: 12,
  boar: 13,
  wolf: 14,
  fox: 15,
  bear: 16,
  moose: 17,
  raccoon: 18,
  cougar: 19,
};

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
