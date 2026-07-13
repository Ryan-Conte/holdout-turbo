import type {
  BuildType,
  CharacterAppearance,
  EnemyKind,
  Equipment,
  InputPayload,
  InstanceKind,
  Inventory,
  InvSlot,
  ItemId,
  PoiSnap,
  Skills,
  TraderTier,
} from '@holdout/shared';
import type { HideoutData, QuestProg } from '../db/db.service';
import type { ChestTier } from './mapgen';

export interface ServerPlayer {
  sid: string;
  userId: string;
  name: string;
  instanceId: string;
  x: number;
  y: number;
  angle: number;
  facing: number;
  hp: number;
  dead: boolean;
  moving: boolean;
  input: InputPayload;
  inv: Inventory;
  equipment: Equipment;
  equipped: number | null;
  money: number;
  skills: Skills;
  quests: Record<string, QuestProg>;
  hunger: number;
  thirst: number;
  stamina: number;
  staminaExhausted: boolean;
  lastExertAt: number;
  starveAcc: number;
  regenAcc: number;
  lastPushedSurvival: number;
  lastStaminaBucket: number;
  lastPushedStaminaExhausted: boolean;
  action: {
    kind: 'loot' | 'fish' | 'drink' | 'fill' | 'cook' | 'extract' | 'craft';
    until: number;
    data?: { id?: string; slot?: number };
  } | null;
  actionStart: { x: number; y: number };
  mags: Partial<Record<ItemId, number>>;
  reloadUntil: number;
  reloadTarget: ItemId | null;
  lastAttackAt: number;
  lastHitAt: number;
  lastSwingAt: number;
  kills: number;
  deaths: number;
  openContainer: string | null;
  returnPos: { x: number; y: number } | null;
  ignoreInteractUntil: number;
  loggedOutAt: number | null;
  lastStationMask: number;
  armorDur: Partial<Record<'helmet' | 'vest', number>>;
  appearance: CharacterAppearance;
}

export interface Enemy {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  homeX: number;
  homeY: number;
  targetSid: string | null;
  nextAttackAt: number;
  burstLeft: number;
  nextBurstShotAt: number;
  wanderAngle: number;
  nextWanderAt: number;
  wandering: boolean;
  moving: boolean;
  detourUntil: number;
  detourAngle: number;
  enraged: boolean;
  lastSeenAt: number;
  lastSeenX: number;
  lastSeenY: number;
  respawnMs: number;
  lastAttackAt: number;
  lastHitAt: number;
}

export interface GameContainer {
  id: string;
  x: number;
  y: number;
  kind: 'chest' | 'bag' | 'crate' | 'storage';
  tier: ChestTier;
  slots: InvSlot[];
  restockAt: number | null;
  lootTable?: string;
}

export interface GroundItem {
  id: string;
  x: number;
  y: number;
  item: ItemId;
  qty: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  traveled: number;
  range: number;
  damage: number;
  owner: string;
  ownerKind: EnemyKind | null;
  weapon: ItemId | null;
}

export interface GameInstance {
  id: string;
  kind: InstanceKind;
  name: string;
  ownerId: string | null;
  seed: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  elevations: Uint8Array;
  terrainKinds: Record<string, string>;
  resourceKinds: Record<string, string>;
  blockKinds: Record<string, string>;
  blockRotations: Record<string, number>;
  openDoors: Set<number>;
  pois: PoiSnap[];
  traders: { x: number; y: number; tier?: TraderTier }[];
  extracts: { x: number; y: number }[];
  exit: { x: number; y: number } | null;
  spawns: { x: number; y: number }[];
  lootSpots: { x: number; y: number }[];
  containers: Map<string, GameContainer>;
  ground: Map<string, GroundItem>;
  enemies: Map<string, Enemy>;
  unders: Map<number, number>;
  projectiles: Projectile[];
  nodeHits: Map<number, number>;
  blockHp: Map<number, number>;
  nodeRespawns: { i: number; tile: number; at: number; resourceId?: string }[];
  enemyRespawns: { x: number; y: number; kind: EnemyKind; at: number; respawnMs?: number }[];
  lastGroundSpawn: number;
  players: number;
  hideout?: HideoutData;
  structures: Map<number, { type: BuildType; hp: number; expiresAt: number; under?: number }>;
}
