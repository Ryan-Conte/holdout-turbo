// ─── Item registry ──────────────────────────────────────────────────────────
//
// Single source of truth for every item in the game. Designed to scale to
// hundreds of items: each item is one line via a category builder, grouped
// into clearly-labelled sections. To add an item:
//   1. add its id to the `ItemId` union below (keeps full type-safety)
//   2. add one builder call in the matching section of `ITEMS`
//   3. (optional) give it a sprite column in tools/gen-sprites.mjs + sprites.ts
//   4. (optional) add a crafting recipe / trader price in index.ts
//
// UI is driven off flags (food/drink/heal/place/armor/weapon/melee) so new
// items get the right context-menu verb automatically — no client changes.

export type ItemKind =
  | 'weapon'
  | 'tool'
  | 'ammo'
  | 'material'
  | 'consumable'
  | 'backpack'
  | 'armor'
  | 'mod'
  | 'placeable';

export type ArmorPiece = 'helmet' | 'vest';

/** Structures you can place in the world / your camp. */
export type BuildType =
  | 'chest' | 'workbench' | 'firepit' | 'furnace'
  | 'wood_floor' | 'stone_floor' | 'wall' | 'door' | 'fence' | 'torch';

export type ItemId =
  // weapons
  | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'bow'
  // tools
  | 'spear' | 'axe' | 'pickaxe' | 'fishing_rod'
  // ammo
  | 'ammo_9mm' | 'ammo_shell' | 'ammo_556' | 'arrow'
  // materials
  | 'cloth' | 'scrap' | 'wood' | 'stone'
  // medical
  | 'bandage' | 'medkit'
  // food & water
  | 'raw_fish' | 'cooked_fish' | 'raw_meat' | 'cooked_meat' | 'canteen' | 'canteen_full'
  // backpacks
  | 'backpack_mk2' | 'backpack_mk3'
  // armor
  | 'helmet_scrap' | 'helmet_military' | 'vest_light' | 'vest_military'
  // weapon mods
  | 'attach_reddot' | 'attach_suppressor'
  // placeables (craft then place)
  | 'kit_firepit' | 'kit_furnace' | 'kit_workbench' | 'kit_chest'
  // base building (Minecraft-style camp construction)
  | 'kit_floor_wood' | 'kit_floor_stone' | 'kit_wall' | 'kit_door' | 'kit_fence' | 'kit_torch';

export interface WeaponStats {
  damage: number;
  fireRateMs: number;
  ammo: ItemId;
  pellets: number;
  spread: number; // radians
  bulletSpeed: number; // px/s
  range: number; // px
  magSize: number;
  reloadMs: number;
  noise?: number; // aggro radius override (bows are quiet); default 380
}

export interface MeleeStats {
  damage: number;
  cooldownMs: number;
  range: number; // px
  wood: number; // yield per hit on trees
  stone: number; // yield per hit on rocks
}

export interface ArmorStats {
  piece: ArmorPiece;
  reduction: number; // 0..1 incoming damage multiplier reduction
}

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: ItemKind;
  kg: number;
  stack: number;
  desc: string;
  weapon?: WeaponStats;
  melee?: MeleeStats;
  armor?: ArmorStats;
  heal?: number; // HP restored
  food?: number; // hunger restored on eat
  drink?: number; // thirst restored on drink
  raw?: ItemId; // cooked result (cook at a firepit)
  emptyTo?: ItemId; // what a "full" consumable becomes when used up (canteen)
  fillFrom?: ItemId; // filled version, produced by using this near water (canteen)
  backpackTier?: number;
  place?: BuildType; // placing this item builds this structure
}

// bare hands — always available
export const FISTS: MeleeStats = { damage: 8, cooldownMs: 450, range: 34, wood: 1, stone: 1 };

// ─── category builders (keep item defs to one readable line) ─────────────────

const weapon = (id: ItemId, name: string, kg: number, desc: string, w: WeaponStats): ItemDef =>
  ({ id, name, kind: 'weapon', kg, stack: 1, desc, weapon: w });

const tool = (id: ItemId, name: string, kg: number, desc: string, m: MeleeStats): ItemDef =>
  ({ id, name, kind: 'tool', kg, stack: 1, desc, melee: m });

const ammo = (id: ItemId, name: string, kg: number, stack: number, desc: string): ItemDef =>
  ({ id, name, kind: 'ammo', kg, stack, desc });

const material = (id: ItemId, name: string, kg: number, desc: string, stack = 30): ItemDef =>
  ({ id, name, kind: 'material', kg, stack, desc });

const heal = (id: ItemId, name: string, kg: number, stack: number, hp: number, desc: string): ItemDef =>
  ({ id, name, kind: 'consumable', kg, stack, desc, heal: hp });

const food = (id: ItemId, name: string, kg: number, stack: number, hunger: number, desc: string, raw?: ItemId): ItemDef =>
  ({ id, name, kind: 'consumable', kg, stack, desc, food: hunger, ...(raw ? { raw } : {}) });

const armorItem = (id: ItemId, name: string, kg: number, piece: ArmorPiece, reduction: number, desc: string): ItemDef =>
  ({ id, name, kind: 'armor', kg, stack: 1, desc, armor: { piece, reduction } });

const backpack = (id: ItemId, name: string, kg: number, tier: number, desc: string): ItemDef =>
  ({ id, name, kind: 'backpack', kg, stack: 1, desc, backpackTier: tier });

const mod = (id: ItemId, name: string, kg: number, desc: string): ItemDef =>
  ({ id, name, kind: 'mod', kg, stack: 1, desc });

const placeable = (id: ItemId, name: string, kg: number, build: BuildType, desc: string, stack = 5): ItemDef =>
  ({ id, name, kind: 'placeable', kg, stack, desc, place: build });

// ─── the registry ────────────────────────────────────────────────────────────

export const ITEMS: Record<ItemId, ItemDef> = {
  // ── weapons
  pistol: weapon('pistol', 'Rustler Pistol', 1.2, 'Reliable sidearm. Uses 9mm.',
    { damage: 15, fireRateMs: 350, ammo: 'ammo_9mm', pellets: 1, spread: 0.05, bulletSpeed: 720, range: 520, magSize: 12, reloadMs: 1200 }),
  smg: weapon('smg', 'Scrapper SMG', 2.6, 'Fast and loud. Uses 9mm.',
    { damage: 9, fireRateMs: 110, ammo: 'ammo_9mm', pellets: 1, spread: 0.11, bulletSpeed: 760, range: 460, magSize: 30, reloadMs: 1700 }),
  shotgun: weapon('shotgun', 'Coach Shotgun', 3.4, 'Devastating up close. Uses shells.',
    { damage: 8, fireRateMs: 900, ammo: 'ammo_shell', pellets: 6, spread: 0.28, bulletSpeed: 640, range: 300, magSize: 6, reloadMs: 2400 }),
  rifle: weapon('rifle', 'Vanguard Rifle', 3.2, 'Military full-auto. Uses 5.56.',
    { damage: 13, fireRateMs: 130, ammo: 'ammo_556', pellets: 1, spread: 0.07, bulletSpeed: 820, range: 560, magSize: 30, reloadMs: 1900 }),
  bow: weapon('bow', 'Hunting Bow', 1.0, 'Silent and deadly. Craft arrows from wood and stone.',
    { damage: 24, fireRateMs: 1000, ammo: 'arrow', pellets: 1, spread: 0.035, bulletSpeed: 540, range: 440, magSize: 1, reloadMs: 500, noise: 90 }),

  // ── tools
  spear: tool('spear', 'Wooden Spear', 1.4, 'Sharpened branch. Better reach than fists.',
    { damage: 16, cooldownMs: 600, range: 50, wood: 1, stone: 1 }),
  axe: tool('axe', 'Hatchet', 1.8, 'Chops trees fast. Decent melee weapon.',
    { damage: 22, cooldownMs: 650, range: 38, wood: 3, stone: 1 }),
  pickaxe: tool('pickaxe', 'Pickaxe', 2.2, 'Breaks rock fast. Decent melee weapon.',
    { damage: 18, cooldownMs: 650, range: 38, wood: 1, stone: 3 }),
  fishing_rod: tool('fishing_rod', 'Fishing Rod', 1.0, 'Equip, face water and click to fish.',
    { damage: 4, cooldownMs: 800, range: 40, wood: 1, stone: 1 }),

  // ── ammo
  ammo_9mm: ammo('ammo_9mm', '9mm Rounds', 0.01, 60, 'Pistol & SMG ammunition.'),
  ammo_shell: ammo('ammo_shell', 'Shotgun Shells', 0.03, 24, 'Shotgun ammunition.'),
  ammo_556: ammo('ammo_556', '5.56 Rounds', 0.012, 60, 'Rifle ammunition.'),
  arrow: ammo('arrow', 'Arrows', 0.05, 30, 'Bow ammunition. Cheap to craft.'),

  // ── materials
  cloth: material('cloth', 'Cloth', 0.1, 'Torn fabric.'),
  scrap: material('scrap', 'Scrap Metal', 0.4, 'Rusty metal bits.'),
  wood: material('wood', 'Wood', 0.5, 'Chopped from trees.'),
  stone: material('stone', 'Stone', 0.6, 'Mined from rocks.'),

  // ── medical
  bandage: heal('bandage', 'Bandage', 0.05, 10, 30, 'Restores 30 HP.'),
  medkit: heal('medkit', 'Medkit', 0.8, 3, 100, 'Restores 100 HP.'),

  // ── food & water
  raw_fish: food('raw_fish', 'Raw Fish', 0.4, 10, 6, 'Eat raw (+6 hunger) or cook at a firepit.', 'cooked_fish'),
  cooked_fish: food('cooked_fish', 'Cooked Fish', 0.3, 10, 30, 'A proper meal. +30 hunger.'),
  raw_meat: food('raw_meat', 'Raw Meat', 0.5, 10, 5, 'Eat raw (+5 hunger) or cook at a firepit.', 'cooked_meat'),
  cooked_meat: food('cooked_meat', 'Cooked Meat', 0.4, 10, 35, 'Rich and filling. +35 hunger.'),
  canteen: {
    id: 'canteen', name: 'Canteen (empty)', kind: 'consumable', kg: 0.3, stack: 1,
    desc: 'Use near water to fill it (5 drinks).', fillFrom: 'canteen_full',
  },
  canteen_full: {
    id: 'canteen_full', name: 'Canteen (water)', kind: 'consumable', kg: 0.35, stack: 5,
    desc: 'Drink for +40 thirst. Refill at any water.', drink: 40, emptyTo: 'canteen',
  },

  // ── backpacks
  backpack_mk2: backpack('backpack_mk2', 'Scout Backpack', 1.0, 1, '16 slots, 32 kg capacity.'),
  backpack_mk3: backpack('backpack_mk3', 'Raider Backpack', 1.5, 2, '20 slots, 45 kg capacity.'),

  // ── armor
  helmet_scrap: armorItem('helmet_scrap', 'Scrap Helmet', 1.0, 'helmet', 0.1, 'Bolted-together head protection. -10% damage.'),
  helmet_military: armorItem('helmet_military', 'Combat Helmet', 1.4, 'helmet', 0.18, 'Military issue. -18% damage.'),
  vest_light: armorItem('vest_light', 'Padded Vest', 2.0, 'vest', 0.15, 'Layered cloth and scrap. -15% damage.'),
  vest_military: armorItem('vest_military', 'Kevlar Vest', 3.5, 'vest', 0.3, 'Military body armor. -30% damage.'),

  // ── weapon mods (fit into the MOD slot)
  attach_reddot: mod('attach_reddot', 'Red Dot Sight', 0.3, 'Weapon mod: -35% spread. Crafted at a workbench.'),
  attach_suppressor: mod('attach_suppressor', 'Suppressor', 0.5, 'Weapon mod: gunfire barely draws attention. Crafted at a workbench.'),

  // ── placeables (craft, then hold to place)
  kit_firepit: placeable('kit_firepit', 'Firepit Kit', 2.0, 'firepit', 'Place it, then cook raw food nearby.'),
  kit_furnace: placeable('kit_furnace', 'Furnace Kit', 4.0, 'furnace', 'Place it to unlock ammo crafting nearby.'),
  kit_workbench: placeable('kit_workbench', 'Workbench Kit', 3.0, 'workbench', 'Place it to unlock weapon-mod crafting nearby.'),
  kit_chest: placeable('kit_chest', 'Chest Kit', 3.0, 'chest', 'Place it in your camp for 12 stash slots.'),

  // ── base building (stackable, cheap — build your camp out like Minecraft)
  kit_floor_wood: placeable('kit_floor_wood', 'Wood Flooring', 0.5, 'wood_floor', 'Plank flooring for your camp.', 20),
  kit_floor_stone: placeable('kit_floor_stone', 'Stone Flooring', 0.7, 'stone_floor', 'Cut stone flooring for your camp.', 20),
  kit_wall: placeable('kit_wall', 'Wooden Wall', 1.2, 'wall', 'Solid wall — blocks movement and bullets.', 10),
  kit_door: placeable('kit_door', 'Wooden Door', 1.4, 'door', 'You can walk through it; enemies and bullets cannot.', 5),
  kit_fence: placeable('kit_fence', 'Fence', 0.8, 'fence', 'Low fence — blocks walkers, lets bullets over.', 10),
  kit_torch: placeable('kit_torch', 'Torch Post', 0.4, 'torch', 'Lights up the night around it.', 10),
};

// ── weapon-mod effects (applied while the mod is in the MOD equipment slot)
export const MOD_SPREAD_MULT = 0.65; // red dot
export const SUPPRESSED_AGGRO_RANGE = 120; // vs default 380

// ── context-menu verb helper (used by the UI so new items just work)
export function useVerb(def: ItemDef): string | null {
  if (def.place) return 'PLACE';
  if (def.kind === 'weapon' || def.kind === 'tool') return 'EQUIP';
  if (def.kind === 'armor') return 'WEAR';
  if (def.kind === 'mod') return 'FIT';
  if (def.kind === 'backpack') return 'UPGRADE';
  if (def.drink) return 'DRINK';
  if (def.fillFrom) return 'FILL';
  if (def.food) return 'EAT';
  if (def.heal) return 'USE';
  return null;
}
