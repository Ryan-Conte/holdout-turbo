import { AuthoredMap, MapObject, Tile } from '@holdout/shared';

export const MIN_MAP_SIZE = 20;
export const MAX_MAP_SIZE = 200;
export const MIN_MAP_ZOOM = 0.1;
export const MAX_MAP_ZOOM = 4;
export const MAP_HISTORY_LIMIT = 40;

export interface MapCamera { x: number; y: number; zoom: number }
export interface ViewportSize { width: number; height: number }
export interface MobSummary { name?: string; boss?: boolean; spriteId?: string; respawnMs?: number }
export interface LootSummary { name?: string }

export type MapEditorTool =
  | { mode: 'select' | 'pan' | 'erase' }
  | { mode: 'terrainDef'; id: string }
  | { mode: 'resource'; id: string; tile: Tile }
  | { mode: 'block'; id: string; rotation: number }
  | { mode: 'elevation'; level: number }
  | { mode: 'object'; template: Omit<MapObject, 'x' | 'y'>; id: string };

export const TERRAIN_PALETTE: { tile: Tile; label: string; color: string }[] = [
  { tile: Tile.Grass, label: 'Grass', color: '#557c43' },
  { tile: Tile.Water, label: 'Water', color: '#3f6f96' },
  { tile: Tile.Sand, label: 'Sand', color: '#c0a76c' },
  { tile: Tile.Road, label: 'Dirt road', color: '#81775b' },
  { tile: Tile.Asphalt, label: 'Asphalt', color: '#4a4b50' },
  { tile: Tile.Floor, label: 'Interior floor', color: '#9a7450' },
  { tile: Tile.Wall, label: 'Building wall', color: '#49382b' },
  { tile: Tile.Tree, label: 'Tree', color: '#315e35' },
  { tile: Tile.Rock, label: 'Rock', color: '#797b7e' },
  { tile: Tile.CopperOre, label: 'Copper vein', color: '#bd713d' },
  { tile: Tile.IronOre, label: 'Iron vein', color: '#9aa4ad' },
  { tile: Tile.Cliff, label: 'Cliff', color: '#62584c' },
];

export const TERRAIN_ID_BY_TILE = Object.fromEntries(
  TERRAIN_PALETTE.map((entry) => [entry.tile, entry.label.toLowerCase().replaceAll(' ', '_')]),
) as Record<number, string>;
Object.assign(TERRAIN_ID_BY_TILE, {
  [Tile.Road]: 'road',
  [Tile.Floor]: 'floor',
  [Tile.Wall]: 'wall',
  [Tile.Tree]: 'tree',
  [Tile.Rock]: 'rock',
  [Tile.CopperOre]: 'copper_ore',
  [Tile.IronOre]: 'iron_ore',
});

export const MAP_OBJECT_PALETTE: {
  id: string;
  label: string;
  group: string;
  color: string;
  template: Omit<MapObject, 'x' | 'y'>;
}[] = [
  { id: 'spawn', label: 'Player spawn', group: 'World', color: '#f0d878', template: { type: 'spawn' } },
  { id: 'extract', label: 'Extraction beacon', group: 'World', color: '#62e593', template: { type: 'extract' } },
  { id: 'loot', label: 'Loose loot spawn', group: 'Loot', color: '#ddd5b8', template: { type: 'loot' } },
  { id: 'chest', label: 'Standard chest', group: 'Loot', color: '#bd7e36', template: { type: 'chest' } },
  { id: 'chest_military', label: 'Military chest', group: 'Loot', color: '#78935a', template: { type: 'chest_military' } },
  { id: 'zombie', label: 'Zombie', group: 'Mobs', color: '#77975e', template: { type: 'zombie' } },
  { id: 'military', label: 'Military guard', group: 'Mobs', color: '#bd7651', template: { type: 'military' } },
  { id: 'deer', label: 'Deer', group: 'Wildlife', color: '#c39a68', template: { type: 'deer' } },
  { id: 'rabbit', label: 'Rabbit', group: 'Wildlife', color: '#c8bba4', template: { type: 'rabbit' } },
  { id: 'boar', label: 'Boar', group: 'Wildlife', color: '#69503e', template: { type: 'boar' } },
  { id: 'wolf', label: 'Wolf', group: 'Wildlife', color: '#7b7f85', template: { type: 'wolf' } },
  { id: 'trader', label: 'Outpost trader', group: 'NPCs', color: '#79d078', template: { type: 'trader', name: 'Outpost', r: 8 } },
  { id: 'trader_black', label: 'Black-market trader', group: 'NPCs', color: '#a86fd0', template: { type: 'trader_black' } },
  { id: 'poi_town', label: 'Town zone', group: 'Zones', color: '#c95b4e', template: { type: 'poi_town', name: 'Town', r: 14 } },
  { id: 'poi_airport', label: 'Airport hot zone', group: 'Zones', color: '#d8a24a', template: { type: 'poi_airport', name: 'Airport', r: 16 } },
  { id: 'poi_outpost', label: 'Safe zone', group: 'Zones', color: '#71c879', template: { type: 'poi_outpost', name: 'Outpost', r: 8 } },
  { id: 'poi_hotzone', label: 'High-loot zone', group: 'Zones', color: '#ed6646', template: { type: 'poi_hotzone', name: 'Hot Zone', r: 12 } },
  { id: 'poi_zone', label: 'Custom zone', group: 'Zones', color: '#6fa6bd', template: { type: 'poi_zone', name: 'New Zone', r: 10, zoneKind: 'wilds', safe: false, hot: false } },
];

export const TILE_COLORS: Record<number, string> = {
  [Tile.Grass]: '#527741', [Tile.Water]: '#3f7197', [Tile.Tree]: '#294f30',
  [Tile.Floor]: '#96704c', [Tile.Wall]: '#49382b', [Tile.Road]: '#81765a',
  [Tile.Sand]: '#bda66e', [Tile.Rock]: '#777a7d', [Tile.Asphalt]: '#44464b',
  [Tile.Bed]: '#6f7b86', [Tile.DoorMat]: '#7b6844', [Tile.CopperOre]: '#ad683d',
  [Tile.IronOre]: '#929ba5', [Tile.Cliff]: '#5f564b',
};

export function coordinateNoise(x: number, y: number): number {
  let value = Math.imul(x + 17, 374761393) + Math.imul(y + 29, 668265263);
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function cloneAuthoredMap(map: AuthoredMap): AuthoredMap {
  return {
    w: map.w,
    h: map.h,
    tiles: map.tiles.slice(),
    elevations: map.elevations?.slice() ?? new Array(map.w * map.h).fill(0),
    terrain: { ...(map.terrain ?? {}) },
    resources: { ...(map.resources ?? {}) },
    blocks: { ...(map.blocks ?? {}) },
    blockRotations: { ...(map.blockRotations ?? {}) },
    objects: map.objects.map((object) => ({ ...object })),
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function terrainTileLabel(tile: number): string {
  return TERRAIN_PALETTE.find((entry) => entry.tile === tile)?.label ?? `Tile ${tile}`;
}

export function mapObjectLabel(object: MapObject, mobs: Record<string, MobSummary>): string {
  if (object.type === 'mob') return mobs[object.contentId ?? '']?.name ?? object.contentId ?? 'Custom mob';
  if (object.type === 'chest_custom') return `Chest: ${object.lootTable ?? 'chest'}`;
  return MAP_OBJECT_PALETTE.find((entry) => entry.template.type === object.type)?.label ?? object.type;
}
