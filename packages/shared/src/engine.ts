import type { BuildType, ItemId } from './items';
import type { EnemyDef } from './index';

export const ENGINE_CONTENT_KINDS = [
  'items',
  'recipes',
  'mobs',
  'loot',
  'traders',
  'blocks',
  'sprites',
  'animations',
  'resources',
  'terrain',
  'sounds',
  'settings',
] as const;

export type EngineContentKind = (typeof ENGINE_CONTENT_KINDS)[number];

// Atlas column order. Keep this outside the web renderer so seeding and
// browser-side sprite lookup cannot drift apart.
export const ITEM_SPRITE_ORDER: readonly ItemId[] = [
  'pistol', 'smg', 'shotgun', 'rifle', 'spear', 'axe', 'pickaxe',
  'ammo_9mm', 'ammo_shell', 'ammo_556', 'cloth', 'scrap', 'wood', 'stone',
  'bandage', 'medkit', 'backpack_mk2', 'backpack_mk3',
  'helmet_scrap', 'helmet_military', 'vest_light', 'vest_military',
  'attach_reddot', 'attach_suppressor',
  'fishing_rod', 'raw_fish', 'cooked_fish', 'raw_meat', 'cooked_meat', 'canteen', 'canteen_full',
  'kit_firepit', 'kit_furnace', 'kit_workbench', 'kit_chest',
  'kit_floor_wood', 'kit_floor_stone', 'kit_wall', 'kit_door', 'kit_fence', 'kit_torch',
  'bow', 'arrow', 'revolver', 'carbine', 'dmr', 'lmg', 'prototype_rifle',
  'steel_axe', 'steel_pickaxe', 'ammo_44', 'ammo_762',
  'copper_ore', 'iron_ore', 'copper_bar', 'iron_bar',
  'gold_bar', 'diamond', 'rolex', 'data_drive', 'artifact', 'kit_anvil', 'kit_bed',
  'torch', 'animal_hide', 'antler', 'backpack_mk4',
];

export interface LootEntry {
  id: ItemId | string;
  weight: number;
  min: number;
  max: number;
}

export interface LootTableDef {
  id: string;
  name: string;
  minRolls: number;
  maxRolls: number;
  entries: LootEntry[];
}

export type LootTableRegistry = Record<string, LootTableDef>;

export interface PixelAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  /** World-space multiplier for authored high-resolution pixel frames. Legacy 16 px art defaults to 2. */
  renderScale?: number;
  pixels: string[];
  frames?: string[][];
  source?: { sheet: 'tiles' | 'chars' | 'items'; col: number; row: number; frames?: number };
}

export interface SpriteDocument {
  palette: string[];
  assets: PixelAsset[];
}

export const ENTITY_ANIMATION_STATES = ['idle', 'walk', 'attack', 'punch', 'hit', 'death'] as const;
export type EntityAnimationState = (typeof ENTITY_ANIMATION_STATES)[number];

export interface AnimationClipDef {
  frames: number[];
  frameMs: number;
  loop: boolean;
  keyframes?: AnimationKeyframeDef[];
  /** Client-side alpha blend across keyframe boundaries (0/absent = hard steps). */
  blendMs?: number;
}

export interface AnimationKeyframeDef {
  frame: number;
  durationMs: number;
  soundId?: string;
  event?: string;
}

export interface EntityAnimationProfile {
  spriteId: string;
  clips: Partial<Record<EntityAnimationState, AnimationClipDef>>;
}

export type AnimationDocument = Record<string, EntityAnimationProfile>;

export interface EngineMobDefinition extends EnemyDef {
  id: string;
  boss: boolean;
  lootTable: string;
  spriteId: string;
  respawnMs: number;
  sounds?: Partial<Record<'idle' | 'alert' | 'attack' | 'hit' | 'death', string>>;
}

export interface ResourceDropDef {
  itemId: string;
  min: number;
  max: number;
  chance: number;
  when: 'hit' | 'depleted';
}

export interface ResourceNodeDef {
  id: string;
  name: string;
  tile: number;
  depletedTile: number;
  maxHits: number;
  respawnMs: number;
  skill: 'woodcutting' | 'mining';
  /** Variants in the same family are selected by weight whenever a node regrows. */
  respawnFamily?: 'tree' | 'rock';
  respawnWeight?: number;
  spriteId?: string;
  hitSound?: string;
  breakSound?: string;
  drops: ResourceDropDef[];
}

export interface EngineBlockDefinition {
  id: string;
  name: string;
  spriteId: string;
  scale: number;
  offsetY: number;
  maxHp: number;
  destructible: boolean;
  collision: {
    move: boolean;
    enemy: boolean;
    bullets: boolean;
    sight: boolean;
  };
  hitSound?: string;
  breakSound?: string;
  drops: ResourceDropDef[];
  playerPlacement?: {
    buildType: BuildType;
    kitItemId: ItemId;
    simulationTile: number | null;
    hideoutOnly: boolean;
    foundation: boolean;
    storageSlots: number;
  };
}

export interface BlockDocument {
  version: 1;
  world: Record<string, EngineBlockDefinition>;
  legacyBuildables?: unknown;
}

export interface EngineTerrainDefinition {
  id: string;
  name: string;
  spriteId: string;
  simulationTile: number;
  minimapColor: string;
  moveMultiplier: number;
  swimmable: boolean;
  collision: {
    move: boolean;
    enemy: boolean;
    bullets: boolean;
    sight: boolean;
  };
  footstepSound?: string;
}

export type TerrainDocument = Record<string, EngineTerrainDefinition>;

export type SoundWave = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface SoundPresetDef {
  id: string;
  name: string;
  wave: SoundWave;
  frequency: number;
  endFrequency: number;
  durationMs: number;
  volume: number;
  noise: number;
  filterHz: number;
}

export interface SoundDocument {
  presets: Record<string, SoundPresetDef>;
  actions: Record<string, string>;
}

export interface RuntimeVisualContent {
  assets: Record<string, Pick<PixelAsset, 'width' | 'height' | 'renderScale' | 'pixels' | 'frames'>>;
  animations: AnimationDocument;
  resources: Record<string, ResourceNodeDef>;
  sounds: SoundDocument;
  mobSounds: Record<string, NonNullable<EngineMobDefinition['sounds']>>;
  blocks: Record<string, EngineBlockDefinition>;
  terrain: TerrainDocument;
}

export interface EngineBotSettings {
  count: number;
  respawnMs: number;
  playerAggroChance: number;
  buildChance: number;
  names: string[];
}

export interface EngineSettingsDocument {
  map: {
    minSize: number;
    maxSize: number;
  };
  publishing: {
    contentPollMs: number;
    questPollMs: number;
  };
  bots: EngineBotSettings;
  notes: string;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettingsDocument = {
  map: { minSize: 20, maxSize: 2000 },
  publishing: { contentPollMs: 10_000, questPollMs: 60_000 },
  bots: {
    count: 0,
    respawnMs: 25_000,
    playerAggroChance: 0.42,
    buildChance: 0.38,
    names: [],
  },
  notes: 'Global tuning values are introduced here as their runtime systems are migrated.',
};

export const DEFAULT_PIXEL_PALETTE = [
  '#00000000', '#16191bff', '#353b3fff', '#697176ff', '#b6b2a1ff', '#eee7d2ff',
  '#3d5b35ff', '#6f8d4dff', '#9eb56cff', '#654533ff', '#9a6745ff', '#cf9a62ff',
  '#593a36ff', '#944b3fff', '#d16b52ff', '#263b50ff', '#3d6680ff', '#6a9bb4ff',
];

const table = (
  id: string,
  name: string,
  minRolls: number,
  maxRolls: number,
  entries: LootEntry[],
): LootTableDef => ({ id, name, minRolls, maxRolls, entries });

export const DEFAULT_LOOT_TABLES: LootTableRegistry = {
  chest: table('chest', 'Standard chest', 2, 4, [
    { id: 'cloth', weight: 20, min: 2, max: 5 }, { id: 'scrap', weight: 18, min: 1, max: 4 },
    { id: 'wood', weight: 10, min: 1, max: 3 }, { id: 'stone', weight: 8, min: 1, max: 3 },
    { id: 'ammo_9mm', weight: 14, min: 8, max: 24 }, { id: 'ammo_shell', weight: 8, min: 2, max: 8 },
    { id: 'bandage', weight: 10, min: 1, max: 2 }, { id: 'medkit', weight: 4, min: 1, max: 1 },
    { id: 'pistol', weight: 6, min: 1, max: 1 }, { id: 'smg', weight: 4, min: 1, max: 1 },
    { id: 'shotgun', weight: 3, min: 1, max: 1 }, { id: 'axe', weight: 4, min: 1, max: 1 },
    { id: 'pickaxe', weight: 3, min: 1, max: 1 }, { id: 'spear', weight: 3, min: 1, max: 1 },
    { id: 'helmet_scrap', weight: 3, min: 1, max: 1 }, { id: 'vest_light', weight: 2, min: 1, max: 1 },
    { id: 'backpack_mk2', weight: 2, min: 1, max: 1 }, { id: 'backpack_mk3', weight: 1, min: 1, max: 1 },
  ]),
  military: table('military', 'Military chest', 3, 4, [
    { id: 'rifle', weight: 10, min: 1, max: 1 }, { id: 'ammo_556', weight: 20, min: 10, max: 30 },
    { id: 'ammo_9mm', weight: 10, min: 12, max: 30 }, { id: 'ammo_shell', weight: 8, min: 4, max: 10 },
    { id: 'medkit', weight: 12, min: 1, max: 2 }, { id: 'bandage', weight: 10, min: 1, max: 3 },
    { id: 'smg', weight: 6, min: 1, max: 1 }, { id: 'shotgun', weight: 5, min: 1, max: 1 },
    { id: 'scrap', weight: 10, min: 2, max: 6 }, { id: 'helmet_military', weight: 5, min: 1, max: 1 },
    { id: 'vest_military', weight: 4, min: 1, max: 1 }, { id: 'backpack_mk2', weight: 5, min: 1, max: 1 },
    { id: 'backpack_mk3', weight: 4, min: 1, max: 1 },
  ]),
  rare: table('rare', 'Hot-zone chest', 3, 4, [
    { id: 'ammo_762', weight: 16, min: 8, max: 20 }, { id: 'ammo_556', weight: 10, min: 10, max: 24 },
    { id: 'medkit', weight: 10, min: 1, max: 2 }, { id: 'rifle', weight: 7, min: 1, max: 1 },
    { id: 'dmr', weight: 5, min: 1, max: 1 }, { id: 'lmg', weight: 2, min: 1, max: 1 },
    { id: 'prototype_rifle', weight: 1, min: 1, max: 1 }, { id: 'attach_reddot', weight: 6, min: 1, max: 1 },
    { id: 'attach_suppressor', weight: 5, min: 1, max: 1 }, { id: 'helmet_military', weight: 5, min: 1, max: 1 },
    { id: 'vest_military', weight: 4, min: 1, max: 1 }, { id: 'backpack_mk3', weight: 4, min: 1, max: 1 },
    { id: 'iron_bar', weight: 6, min: 1, max: 3 }, { id: 'gold_bar', weight: 5, min: 1, max: 1 },
    { id: 'rolex', weight: 4, min: 1, max: 1 }, { id: 'data_drive', weight: 3, min: 1, max: 1 },
    { id: 'diamond', weight: 2, min: 1, max: 1 }, { id: 'artifact', weight: 1, min: 1, max: 1 },
  ]),
  ground: table('ground', 'Ground loot', 1, 1, [
    { id: 'cloth', weight: 26, min: 1, max: 3 }, { id: 'scrap', weight: 22, min: 1, max: 2 },
    { id: 'wood', weight: 12, min: 1, max: 2 }, { id: 'stone', weight: 8, min: 1, max: 2 },
    { id: 'ammo_9mm', weight: 14, min: 5, max: 12 }, { id: 'ammo_shell', weight: 6, min: 1, max: 4 },
    { id: 'bandage', weight: 9, min: 1, max: 1 }, { id: 'pistol', weight: 5, min: 1, max: 1 },
    { id: 'smg', weight: 2, min: 1, max: 1 },
  ]),
  zombie: table('zombie', 'Zombie drops', 1, 2, [
    { id: 'cloth', weight: 40, min: 1, max: 3 }, { id: 'scrap', weight: 25, min: 1, max: 2 },
    { id: 'bandage', weight: 20, min: 1, max: 1 }, { id: 'ammo_9mm', weight: 15, min: 3, max: 8 },
  ]),
  military_drop: table('military_drop', 'Military drops', 1, 2, [
    { id: 'ammo_556', weight: 28, min: 6, max: 16 }, { id: 'rifle', weight: 11, min: 1, max: 1 },
    { id: 'medkit', weight: 14, min: 1, max: 1 }, { id: 'bandage', weight: 18, min: 1, max: 2 },
    { id: 'scrap', weight: 19, min: 1, max: 3 }, { id: 'helmet_military', weight: 6, min: 1, max: 1 },
    { id: 'vest_military', weight: 4, min: 1, max: 1 },
  ]),
  deer: table('deer', 'Deer drops', 2, 3, [
    { id: 'raw_meat', weight: 60, min: 2, max: 4 }, { id: 'animal_hide', weight: 32, min: 1, max: 2 }, { id: 'antler', weight: 8, min: 1, max: 1 },
  ]),
  rabbit: table('rabbit', 'Rabbit drops', 1, 2, [{ id: 'raw_meat', weight: 75, min: 1, max: 1 }, { id: 'animal_hide', weight: 25, min: 1, max: 1 }]),
  boar: table('boar', 'Boar drops', 2, 3, [{ id: 'raw_meat', weight: 72, min: 3, max: 5 }, { id: 'animal_hide', weight: 28, min: 1, max: 2 }]),
  wolf: table('wolf', 'Wolf drops', 2, 3, [{ id: 'raw_meat', weight: 58, min: 1, max: 3 }, { id: 'animal_hide', weight: 42, min: 1, max: 3 }]),
  fox: table('fox', 'Fox drops', 1, 2, [{ id: 'raw_meat', weight: 38, min: 1, max: 1 }, { id: 'animal_hide', weight: 62, min: 1, max: 2 }]),
  bear: table('bear', 'Bear drops', 3, 4, [{ id: 'raw_meat', weight: 65, min: 3, max: 6 }, { id: 'animal_hide', weight: 35, min: 2, max: 4 }]),
  moose: table('moose', 'Moose drops', 3, 4, [
    { id: 'raw_meat', weight: 58, min: 4, max: 7 },
    { id: 'animal_hide', weight: 30, min: 2, max: 4 },
    { id: 'antler', weight: 12, min: 1, max: 2 },
  ]),
  raccoon: table('raccoon', 'Raccoon drops', 1, 2, [
    { id: 'raw_meat', weight: 35, min: 1, max: 1 },
    { id: 'animal_hide', weight: 65, min: 1, max: 2 },
  ]),
  cougar: table('cougar', 'Cougar drops', 2, 3, [
    { id: 'raw_meat', weight: 45, min: 2, max: 4 },
    { id: 'animal_hide', weight: 55, min: 2, max: 3 },
  ]),
};
