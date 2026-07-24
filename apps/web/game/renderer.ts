import {
  BLOCKS_BULLET,
  BLOCKS_MOVE,
  DEFAULT_TERRAIN_ID_BY_TILE,
  ContainerSnap,
  EntityDeathSnap,
  EnemySnap,
  FISTS,
  GroundItemSnap,
  HitSnap,
  ITEMS,
  ItemId,
  NAMEPLATE_RANGE,
  PlayerSnap,
  PLAYER_RADIUS,
  PoiSnap,
  ProjectileSnap,
  RuntimeVisualContent,
  RuntimeGameplayContent,
  RuntimeItemRegistry,
  WorldEventSnap,
  EntityAnimationState,
  TILE,
  Tile,
} from "@holdout/shared";
import { CHAR_ROWS, ITEM_INDEX, Sheets } from "./sprites";
import { runtimePixelVisible } from "@/lib/runtime-visuals";

const SPR = 16; // art cell size; rendered at 2× (TILE = 32)

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface RenderPlayer extends PlayerSnap {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

export interface RenderEnemy extends EnemySnap {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

export interface DamageFloat {
  x: number;
  y: number;
  amount: number;
  kind: "player" | "enemy" | "node" | "xp";
  label?: string; // xp floats: skill abbreviation
  age: number; // 0..1
}

export interface WorldView {
  players: RenderPlayer[];
  enemies: RenderEnemy[];
  projectiles: ProjectileSnap[];
  containers: ContainerSnap[];
  ground: GroundItemSnap[];
  events: WorldEventSnap[];
  floats: DamageFloat[];
  bubbles: Map<string, { text: string; at: number }>; // playerId -> chat bubble (at = performance.now ms)
  youId: string;
  friendNames: Set<string>;
  time: number; // seconds, client clock
  serverNow: number; // ms, server clock
  day: number;
  ghost: { tile: number; blockId?: string; rotation: number; tx: number; ty: number; valid: boolean } | null; // build placement preview
  highlight: { x: number; y: number } | null; // nearest interactable — pulsing ring
  demolish: { tx: number; ty: number; valid: boolean } | null; // demolish-mode tile marker
  fog: boolean; // dim tiles the player has no line of sight to (world only)
  cursor: { x: number; y: number } | null; // world-space aim point — drawn crosshair
}

export interface MinimapRenderOptions {
  detailed?: boolean;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  visibleTiles?: number;
  clampToMap?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
}

interface Flash {
  x: number;
  y: number;
  angle: number;
  t0: number;
}
interface ProjectileImpact {
  x: number;
  y: number;
  angle: number;
  t0: number;
}
interface FallingTree {
  tx: number;
  ty: number;
  t0: number;
  dir: number;
  spriteId?: string;
  impacted: boolean;
}
interface Corpse {
  x: number;
  y: number;
  row: number;
  target?: string;
  t0: number;
  dir: number;
}

interface NightLight {
  x: number;
  y: number;
  radius: number;
  strength: number;
  warmth: number;
  flickerSeed: number;
}

const TORCH_POST_LIGHT_RADIUS = 190;
const FIREPIT_LIGHT_RADIUS = 120;

const MINI_COLORS: Record<number, string> = {
  [Tile.Grass]: "#3f6b38",
  [Tile.Water]: "#33628f",
  [Tile.Tree]: "#2a4d2a",
  [Tile.Floor]: "#8a6a48",
  [Tile.Wall]: "#4c3a28",
  [Tile.Road]: "#7a755f",
  [Tile.Sand]: "#b99e6b",
  [Tile.Rock]: "#77777d",
  [Tile.Asphalt]: "#3f3f45",
  [Tile.Bed]: "#7a8a99",
  [Tile.DoorMat]: "#7d6c48",
  [Tile.Workbench]: "#8a683c",
  [Tile.Firepit]: "#d8722a",
  [Tile.Furnace]: "#6a6a72",
  [Tile.Stump]: "#5c3f26",
  [Tile.Rubble]: "#77777d",
  [Tile.WoodFloor]: "#9a7a4c",
  [Tile.StoneFloor]: "#8a8a90",
  [Tile.WoodWall]: "#6a4c2a",
  [Tile.Door]: "#7a5a34",
  [Tile.Fence]: "#7a5a34",
  [Tile.Torch]: "#d8722a",
  [Tile.CopperOre]: "#c87a3a",
  [Tile.IronOre]: "#9aa4b0",
  [Tile.Anvil]: "#5c5c64",
  [Tile.Cliff]: "#5a5048",
};

export class Renderer {
  private mapCanvas: HTMLCanvasElement | null;
  private miniCanvas: HTMLCanvasElement;
  private nightCanvas: HTMLCanvasElement;
  zoom = 2;

  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private projectileImpacts: ProjectileImpact[] = [];
  private retiredProjectiles = new Map<number, number>();
  // LOS fog cache: recomputed when the player crosses a tile or the map changes
  private fogKey = "";
  private fogVersion = 0;
  private fogBlocked: Set<number> = new Set();
  private falling: FallingTree[] = [];
  private corpses: Corpse[] = [];
  private shakes = new Map<number, number>(); // tile idx -> shake start (time s)
  private prevProj = new Set<number>();
  private prevDead = new Map<string, boolean>();
  private lastTime = 0;
  private kickUntil = 0;
  private kickAngle = 0;
  private predictedShots: { angle: number; t0: number }[] = [];
  private localMeleeAt = -Infinity;
  private localMeleeSuppressUntil = -Infinity;
  private doorProgress = new Map<number, number>();
  private facingDirections = new Map<string, -1 | 1>();
  private motionTransitions = new Map<string, { moving: boolean; changedAt: number }>();
  private reducedMotion = false;

  private unders: Map<number, number>;
  private visualFrames = new Map<string, HTMLCanvasElement[]>();
  private animationSoundSteps = new Map<string, string>();
  private entitySoundStates = new Map<string, EntityAnimationState>();
  private lastTerrainFootstepAt = 0;
  private openDoors = new Set<number>();
  private stationFuel: Map<number, number>;
  private gameplayItems: RuntimeItemRegistry = ITEMS as unknown as RuntimeItemRegistry;

  /** Keep roughly the same useful field of view from phones through desktop. */
  fitViewport(width: number, height: number) {
    const safeWidth = Math.max(320, Number.isFinite(width) ? width : 320);
    const safeHeight = Math.max(240, Number.isFinite(height) ? height : 240);
    const horizontalZoom = safeWidth / (TILE * 22);
    const verticalZoom = safeHeight / (TILE * 11);
    this.zoom = Math.max(0.9, Math.min(2, horizontalZoom, verticalZoom));
  }

  constructor(
    private tiles: Uint8Array,
    private w: number,
    private h: number,
    private sheets: Sheets,
    private pois: PoiSnap[],
    private traders: { x: number; y: number }[],
    private exit: { x: number; y: number } | null,
    private extracts: { x: number; y: number }[] = [],
    unders: Record<number, number> = {},
    private elevations: Uint8Array = new Uint8Array(),
    private visuals: RuntimeVisualContent = { assets: {}, animations: {}, resources: {}, sounds: { presets: {}, actions: {} }, mobSounds: {}, blocks: {}, terrain: {} },
    private terrainKinds: Record<string, string> = {},
    private resourceKinds: Record<string, string> = {},
    private blockKinds: Record<string, string> = {},
    private blockRotations: Record<string, number> = {},
    initialOpenDoors: number[] = [],
    initialStationFuel: Record<number, number> = {},
    gameplay?: RuntimeGameplayContent,
    private onSound?: (soundId: string, volume: number) => void,
  ) {
    this.openDoors = new Set(initialOpenDoors);
    this.doorProgress = new Map(initialOpenDoors.map((index) => [index, 1]));
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.stationFuel = new Map(Object.entries(initialStationFuel).map(([key, fuel]) => [Number(key), Math.max(0, Number(fuel) || 0)]));
    if (gameplay?.items) this.gameplayItems = { ...(ITEMS as unknown as RuntimeItemRegistry), ...gameplay.items };
    this.unders = new Map(Object.entries(unders).map(([k, v]) => [Number(k), v]));
    if (this.elevations.length !== w * h) this.elevations = new Uint8Array(w * h);
    this.buildVisualFrames();
    // iOS Safari silently produces a blank/invalid 2D canvas when a world-sized
    // cache exceeds its dimension or pixel budget. Only cache genuinely small
    // instances; large worlds are drawn from the visible tile window each frame.
    const mapPixelWidth = w * TILE;
    const mapPixelHeight = h * TILE;
    const canCacheWholeMap = mapPixelWidth <= 4096
      && mapPixelHeight <= 4096
      && mapPixelWidth * mapPixelHeight <= 16_777_216;
    if (canCacheWholeMap) {
      const candidate = document.createElement('canvas');
      candidate.width = mapPixelWidth;
      candidate.height = mapPixelHeight;
      this.mapCanvas = candidate.getContext('2d') ? candidate : null;
    } else {
      this.mapCanvas = null;
    }
    this.miniCanvas = document.createElement("canvas");
    this.nightCanvas = document.createElement("canvas");
    const miniScale = Math.min(1, 1024 / Math.max(w, h));
    this.miniCanvas.width = Math.max(1, Math.round(w * miniScale));
    this.miniCanvas.height = Math.max(1, Math.round(h * miniScale));
    this.prerender();
  }

  private buildVisualFrames() {
    this.visualFrames.clear();
    for (const [id, asset] of Object.entries(this.visuals.assets ?? {})) {
      const frames = asset.frames?.length ? asset.frames : asset.pixels?.length ? [asset.pixels] : [];
      const validFrames = frames.filter((frame) => frame.length === asset.width * asset.height);
      // Source-only seed entries have no database pixels yet. Keep their
      // compatibility renderer available until real engine art is published.
      if (!validFrames.some((frame) => frame.some(runtimePixelVisible))) continue;
      const canvases = validFrames.map((frame) => {
        const canvas = document.createElement('canvas');
        canvas.width = asset.width; canvas.height = asset.height;
        const ctx = canvas.getContext('2d')!;
        frame.forEach((color, index) => {
          if (!runtimePixelVisible(color)) return;
          ctx.fillStyle = color;
          ctx.fillRect(index % asset.width, Math.floor(index / asset.width), 1, 1);
        });
        return canvas;
      });
      if (canvases.length) this.visualFrames.set(id, canvases);
    }
  }

  applyVisuals(visuals: RuntimeVisualContent) {
    this.visuals = visuals;
    this.buildVisualFrames();
    this.prerender();
  }

  applyGameplay(gameplay: RuntimeGameplayContent) {
    this.gameplayItems = { ...(ITEMS as unknown as RuntimeItemRegistry), ...(gameplay.items ?? {}) };
  }

  applyBlock(index: number, blockId?: string, rotation = 0, open?: boolean) {
    if (blockId) this.blockKinds[String(index)] = blockId;
    else delete this.blockKinds[String(index)];
    rotation = ((rotation | 0) % 4 + 4) % 4;
    if (blockId && rotation) this.blockRotations[String(index)] = rotation;
    else delete this.blockRotations[String(index)];
    if (!blockId || open === false) this.openDoors.delete(index);
    else if (open === true) this.openDoors.add(index);
    if (!blockId) {
      this.stationFuel.delete(index);
      this.doorProgress.delete(index);
    }
    const context = this.miniCanvas.getContext('2d');
    if (!context) return;
    const x = index % this.w; const y = Math.floor(index / this.w);
    const mapContext = this.mapCanvas?.getContext('2d');
    if (mapContext) { this.drawTerrainCell(mapContext, x, y); this.drawFoundationLayer(mapContext, x, y); }
    this.updateMinimapCell(x, y, blockId ? '#b58b45' : undefined);
  }

  applyStationFuel(index: number, fuel: number) {
    if (fuel > 0) this.stationFuel.set(index, fuel);
    else this.stationFuel.delete(index);
  }

  playerBlockId(buildType: string): string | undefined {
    return Object.values(this.visuals.blocks ?? {}).find((block) => block.playerPlacement?.buildType === buildType)?.id;
  }

  hasBlockAtPublic(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return Boolean(this.blockKinds[String(y * this.w + x)]);
  }

  blockBuildTypeAtPublic(x: number, y: number): string | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    const block = this.visuals.blocks?.[this.blockKinds[String(y * this.w + x)]];
    return block?.playerPlacement?.buildType;
  }

  blockIsFoundationAtPublic(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const block = this.visuals.blocks?.[this.blockKinds[String(y * this.w + x)]];
    return Boolean(block?.playerPlacement?.foundation);
  }

  entityDeath(death: EntityDeathSnap) {
    this.corpses.push({
      x: death.x,
      y: death.y,
      row: death.fallbackRow,
      target: death.target,
      t0: this.lastTime,
      dir: hash2(Math.floor(death.x), Math.floor(death.y)) < 0.5 ? -1 : 1,
    });
    this.burst(death.x, death.y, ["#a83232", "#7c1f1f"], 12, 70);
    if (death.target.startsWith('mob:')) {
      const cue = this.visuals.mobSounds?.[death.target.slice(4)]?.death;
      if (cue) this.onSound?.(cue, 0.7);
    }
  }

  private animationFrame(target: string, state: EntityAnimationState, elapsedMs: number, seed: number, totalFrames: number): number {
    const profile = this.visuals.animations?.[target];
    const clip = profile?.clips?.[state] ?? profile?.clips?.idle;
    if (clip?.keyframes?.length) {
      const keyframes = clip.keyframes;
      const totalMs = keyframes.reduce((sum, keyframe) => sum + Math.max(16, keyframe.durationMs), 0);
      const shifted = Math.max(0, elapsedMs + (clip.loop === false || state === 'walk' ? 0 : seed * 17));
      const phase = clip.loop === false ? Math.min(totalMs - 1, shifted) : shifted % totalMs;
      let elapsed = 0;
      let at = keyframes.length - 1;
      for (let index = 0; index < keyframes.length; index++) {
        elapsed += Math.max(16, keyframes[index].durationMs);
        if (phase < elapsed) { at = index; break; }
      }
      const cycle = clip.loop === false ? 0 : Math.floor(shifted / totalMs);
      const soundKey = `${target}:${state}:${seed}`;
      const soundStep = `${cycle}:${at}`;
      const previous = this.animationSoundSteps.get(soundKey);
      if (previous !== soundStep) {
        this.animationSoundSteps.set(soundKey, soundStep);
        const cue = keyframes[at].soundId;
        if (cue && (previous !== undefined || elapsedMs < keyframes[at].durationMs)) this.onSound?.(cue, 0.65);
      }
      return Math.max(0, Math.min(totalFrames - 1, keyframes[at].frame));
    }
    const sequence = clip?.frames?.length ? clip.frames : state === 'walk' ? [0, 1] : [0];
    const phaseMs = clip?.loop === false || state === 'walk' ? elapsedMs : elapsedMs + seed * 17;
    const step = Math.max(0, Math.floor(phaseMs / Math.max(16, clip?.frameMs ?? 125)));
    const at = clip?.loop === false ? Math.min(sequence.length - 1, step) : step % sequence.length;
    return Math.max(0, Math.min(totalFrames - 1, sequence[at] ?? 0));
  }

  private animationDuration(target: string, state: EntityAnimationState, fallbackMs: number): number {
    const clip = this.visuals.animations?.[target]?.clips?.[state];
    if (clip?.keyframes?.length) {
      return clip.keyframes.reduce((sum, keyframe) => sum + Math.max(16, keyframe.durationMs), 0);
    }
    if (clip?.frames?.length) return clip.frames.length * Math.max(16, clip.frameMs ?? 125);
    return fallbackMs;
  }

  private sheetAnimationFrame(target: string, state: EntityAnimationState, elapsedMs: number, seed: number): number {
    if (state === 'walk') {
      const clip = this.visuals.animations?.[target]?.clips?.walk;
      const frameMs = Math.max(55, clip?.frameMs ?? 105);
      const step = Math.floor(Math.max(0, elapsedMs) / frameMs);
      return [1, 2, 3, 2][step % 4];
    }
    return this.animationFrame(target, state, elapsedMs, seed, 4);
  }

  private facesLeft(id: string, angle: number): boolean {
    const horizontal = Math.cos(angle);
    let direction = this.facingDirections.get(id);
    if (!direction) direction = horizontal < 0 ? -1 : 1;
    else if (direction === 1 && horizontal < -0.14) direction = -1;
    else if (direction === -1 && horizontal > 0.14) direction = 1;
    this.facingDirections.set(id, direction);
    return direction === -1;
  }

  private motionPose(id: string, moving: boolean, time: number, seed: number, vx: number, vy: number, hitElapsed = Infinity) {
    const previous = this.motionTransitions.get(id);
    if (!previous || previous.moving !== moving) this.motionTransitions.set(id, { moving, changedAt: time });
    const transition = this.motionTransitions.get(id)!;
    const transitionAge = Math.max(0, time - transition.changedAt);
    const speed = Math.hypot(vx, vy);

    if (this.reducedMotion) {
      const hitShake = hitElapsed < 150 ? Math.sin(hitElapsed * 0.13) * (1 - hitElapsed / 150) : 0;
      return { x: hitShake, y: 0, shadowScale: 1, lean: 0, animationElapsedMs: moving ? transitionAge * 1000 : time * 1000 };
    }

    const cadence = Math.min(17, 12.5 + speed * 0.02);
    const phase = moving
      ? transitionAge * cadence
      : time * cadence + (seed % 997) * 0.031;
    const moveBlend = moving ? easeOutCubic(Math.min(1, transitionAge / 0.14)) : 0;
    const stride = Math.sin(phase);
    const bob = moving
      ? (1 - Math.cos(phase * 2)) * 0.68 * moveBlend
      : Math.sin(time * 2.1 + (seed % 211) * 0.07) * 0.2;
    const sway = moving ? stride * 0.55 * moveBlend : 0;
    const startLean = moving && transitionAge < 0.18
      ? Math.sin((transitionAge / 0.18) * Math.PI) * 0.026
      : 0;
    const stopSettle = !moving && transitionAge < 0.22
      ? Math.sin((transitionAge / 0.22) * Math.PI * 2) * (1 - transitionAge / 0.22) * 0.7
      : 0;
    const hitShake = hitElapsed < 180 ? Math.sin(hitElapsed * 0.12) * (1 - hitElapsed / 180) * 1.8 : 0;
    const directionLean = moving && speed > 1
      ? Math.max(-0.025, Math.min(0.025, vx / 5000)) * moveBlend
      : 0;
    return {
      x: sway + hitShake,
      y: -bob + stopSettle,
      shadowScale: Math.max(0.86, 1 - bob * 0.045),
      lean: startLean * Math.sign(vx || Math.cos(phase)) + directionLean,
      animationElapsedMs: moving ? transitionAge * 1000 : time * 1000,
    };
  }

  private drawResourceSprite(ctx: CanvasRenderingContext2D, spriteId: string | undefined, x: number, y: number, shakeX: number): boolean {
    const frame = spriteId ? this.visualFrames.get(spriteId)?.[0] : undefined;
    if (!frame) return false;
    const renderScale = spriteId ? this.visuals.assets?.[spriteId]?.renderScale ?? 2 : 2;
    const width = frame.width * renderScale;
    const height = frame.height * renderScale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x - width / 2 + shakeX, y - height, width, height);
    return true;
  }

  private drawWorldBlock(ctx: CanvasRenderingContext2D, blockId: string, x: number, y: number, rotation = 0) {
    const block = this.visuals.blocks?.[blockId];
    if (!block) return;
    const frame = this.visualFrames.get(block.spriteId)?.[0];
    if (frame) {
      const renderScale = this.visuals.assets?.[block.spriteId]?.renderScale ?? 2;
      const width = frame.width * renderScale * block.scale;
      const height = frame.height * renderScale * block.scale;
      const quarterTurn = ((rotation % 4) + 4) % 4;
      const angle = quarterTurn * Math.PI / 2;
      const renderedHeight = Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.translate(x, y - renderedHeight / 2 - block.offsetY);
      ctx.rotate(angle);
      ctx.drawImage(frame, -width / 2, -height / 2, width, height);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#8f6c38'; ctx.fillRect(x - 13, y - 25, 26, 25);
    ctx.strokeStyle = '#e1bb65'; ctx.strokeRect(x - 13, y - 25, 26, 25);
    ctx.fillStyle = '#17130c'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
    ctx.fillText(blockId.slice(0, 8).toUpperCase(), x, y - 11);
  }

  private drawEngineSprite(ctx: CanvasRenderingContext2D, target: string, state: EntityAnimationState, elapsedMs: number, seed: number, x: number, y: number): boolean {
    const profile = this.visuals.animations?.[target];
    const frames = profile ? this.visualFrames.get(profile.spriteId) : undefined;
    if (!frames?.length) return false;
    const frame = frames[this.animationFrame(target, state, elapsedMs, seed, frames.length)];
    const renderScale = this.visuals.assets?.[profile!.spriteId]?.renderScale ?? 2;
    const width = frame.width * renderScale;
    const height = frame.height * renderScale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x - width / 2, y - height / 2, width, height);
    return true;
  }

  private engineSpriteRenderSize(target: string): { width: number; height: number } | undefined {
    const profile = this.visuals.animations?.[target];
    const frame = profile ? this.visualFrames.get(profile.spriteId)?.[0] : undefined;
    if (!profile || !frame) return undefined;
    const renderScale = this.visuals.assets?.[profile.spriteId]?.renderScale ?? 2;
    return { width: frame.width * renderScale, height: frame.height * renderScale };
  }

  private tileAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Tile.Tree;
    return this.tiles[y * this.w + x];
  }

  private terrainAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    const index = y * this.w + x;
    const id = this.terrainKinds[String(index)] ?? DEFAULT_TERRAIN_ID_BY_TILE[this.tiles[index] as Tile] ?? 'grass';
    return this.visuals.terrain?.[id];
  }

  /** Public read of the live tile map (used by the client for build validity). */
  tileAtPublic(x: number, y: number): number {
    return this.tileAt(x, y);
  }

  /** Terrain facts needed by render-only movement prediction. */
  movementAtPublic(x: number, y: number): { moveMultiplier: number; swimmable: boolean } {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const terrain = this.terrainAt(tx, ty);
    return {
      moveMultiplier: terrain?.moveMultiplier ?? 1,
      swimmable: this.tileAt(tx, ty) === Tile.Water || Boolean(terrain?.swimmable),
    };
  }

  /** Mirrors authoritative axis collision so prediction stops at walls and cliffs. */
  movePredictedPublic(x: number, y: number, dx: number, dy: number, radius = PLAYER_RADIUS): { x: number; y: number } {
    const elevationAt = (px: number, py: number) => {
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? -99 : (this.elevations[ty * this.w + tx] ?? 0);
    };
    const blocked = (px: number, py: number) => {
      const minX = Math.floor((px - radius) / TILE);
      const maxX = Math.floor((px + radius) / TILE);
      const minY = Math.floor((py - radius) / TILE);
      const maxY = Math.floor((py + radius) / TILE);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
          const index = ty * this.w + tx;
          const openDoor = this.openDoors.has(index);
          const tile = this.tiles[index];
          if (BLOCKS_MOVE[tile] && !(openDoor && tile === Tile.Door)) return true;
          const block = this.visuals.blocks?.[this.blockKinds[String(index)]];
          if (block?.collision.move && !(openDoor && block.playerPlacement?.buildType === 'door')) return true;
          if (this.terrainAt(tx, ty)?.collision.move) return true;
        }
      }
      return false;
    };
    let nextX = x;
    let nextY = y;
    const candidateX = x + dx;
    if (Math.abs(elevationAt(x, y) - elevationAt(candidateX, y)) <= 1 && !blocked(candidateX, y)) nextX = candidateX;
    const candidateY = y + dy;
    if (Math.abs(elevationAt(nextX, y) - elevationAt(nextX, candidateY)) <= 1 && !blocked(nextX, candidateY)) nextY = candidateY;
    return { x: nextX, y: nextY };
  }

  /** Immediate cosmetic response; the server still decides whether the attack exists. */
  previewLocalAttack(x: number, y: number, angle: number, weapon: ItemId | null, time: number): 'gun' | 'melee' {
    const definition = weapon ? this.gameplayItems[weapon] : undefined;
    if (definition?.weapon) {
      this.flashes.push({
        x: x + Math.cos(angle) * (PLAYER_RADIUS + 6),
        y: y + Math.sin(angle) * (PLAYER_RADIUS + 6),
        angle,
        t0: time,
      });
      this.kickUntil = time + 0.09;
      this.kickAngle = angle;
      const side = angle + Math.PI / 2;
      this.particles.push({
        x: x + Math.cos(angle) * 8,
        y: y + Math.sin(angle) * 8,
        vx: Math.cos(side) * (40 + Math.random() * 30) - Math.cos(angle) * 15,
        vy: Math.sin(side) * (40 + Math.random() * 30) - 40,
        g: 260,
        life: 0,
        ttl: 0.5,
        size: 2,
        color: '#c8a84a',
      });
      this.predictedShots.push({ angle, t0: time });
      this.predictedShots = this.predictedShots.filter((shot) => time - shot.t0 < 1.2).slice(-12);
      return 'gun';
    }
    const meleeDurationMs = definition?.melee?.cooldownMs ?? FISTS.cooldownMs;
    this.localMeleeAt = time;
    this.localMeleeSuppressUntil = time + meleeDurationMs / 1000 + 0.08;
    return 'melee';
  }

  /** Client-side sightline check — mirrors the server's wall-vision rules. */
  private losTo(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 12);
    const sx = (x2 - x1) / steps;
    const sy = (y2 - y1) / steps;
    const startTx = Math.floor(x1 / TILE); const startTy = Math.floor(y1 / TILE);
    let previousElevation = this.elevations[startTy * this.w + startTx] ?? 0;
    for (let s = 1; s <= steps; s++) {
      const tx = Math.floor((x1 + sx * s) / TILE);
      const ty = Math.floor((y1 + sy * s) / TILE);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
      const elevation = this.elevations[ty * this.w + tx] ?? 0;
      if (Math.abs(elevation - previousElevation) > 1) return false;
      const index = ty * this.w + tx;
      const block = this.visuals.blocks?.[this.blockKinds[String(index)]];
      const openDoor = this.openDoors.has(index);
      const tileBlocks = BLOCKS_BULLET[this.tiles[index]] && !(openDoor && this.tiles[index] === Tile.Door);
      const blockBlocks = block?.collision.sight && !(openDoor && block.playerPlacement?.buildType === 'door');
      if (s < steps && (tileBlocks || blockBlocks || this.terrainAt(tx, ty)?.collision.sight)) return false;
      previousElevation = elevation;
    }
    return true;
  }

  // ── sprite helpers ──────────────────────────────────────────────────────

  private blitTile(
    ctx: CanvasRenderingContext2D,
    col: number,
    dx: number,
    dy: number,
  ) {
    ctx.drawImage(
      this.sheets.tiles,
      col * SPR,
      0,
      SPR,
      SPR,
      dx,
      dy,
      TILE,
      TILE,
    );
  }

  private blitItem(
    ctx: CanvasRenderingContext2D,
    id: string,
    dx: number,
    dy: number,
    size = TILE,
  ) {
    const definition = this.gameplayItems[id];
    const engineFrame = this.visualFrames.get(definition?.spriteId ?? `item:${id}`)?.[0];
    if (engineFrame) {
      ctx.drawImage(engineFrame, dx, dy, size, size);
      return;
    }
    const i = ITEM_INDEX[id as ItemId];
    if (i === undefined) {
      ctx.save();
      ctx.fillStyle = '#302d29';
      ctx.fillRect(dx + size * .2, dy + size * .2, size * .6, size * .6);
      ctx.fillStyle = '#d8a94a';
      ctx.font = `${Math.max(7, Math.round(size * .45))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', dx + size / 2, dy + size / 2);
      ctx.restore();
      return;
    }
    ctx.drawImage(this.sheets.items, i * SPR, 0, SPR, SPR, dx, dy, size, size);
  }

  private blitChar(
    ctx: CanvasRenderingContext2D,
    row: number,
    frame: number,
    dx: number,
    dy: number,
  ) {
    ctx.drawImage(
      this.sheets.chars,
      frame * SPR,
      row * SPR,
      SPR,
      SPR,
      dx,
      dy,
      TILE,
      TILE,
    );
  }

  private drawTreeSprite(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bottomY: number,
    rot: number,
    alpha: number,
    shakeX = 0,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + shakeX, bottomY);
    if (rot !== 0) ctx.rotate(rot);
    // 32×32 source → 64×64, trunk bottom anchored at origin
    ctx.drawImage(this.sheets.tiles, 10 * SPR, 0, 32, 32, -32, -60, 64, 64);
    ctx.restore();
  }

  private drawFallingResourceSprite(
    ctx: CanvasRenderingContext2D,
    spriteId: string | undefined,
    cx: number,
    bottomY: number,
    rotation: number,
    alpha: number,
  ) {
    const frame = spriteId ? this.visualFrames.get(spriteId)?.[0] : undefined;
    if (!frame) {
      this.drawTreeSprite(ctx, cx, bottomY, rotation, alpha);
      return;
    }
    const renderScale = this.visuals.assets?.[spriteId!]?.renderScale ?? 2;
    const width = frame.width * renderScale;
    const height = frame.height * renderScale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, bottomY);
    ctx.rotate(rotation);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, -width / 2, -height, width, height);
    ctx.restore();
  }

  // ── static ground prerender (trees/rocks are dynamic entities) ─────────

  private prerender() {
    const ctx = this.mapCanvas?.getContext("2d");
    if (ctx && this.mapCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
      for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) this.drawTerrainCell(ctx, tx, ty);
      for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) this.drawFoundationLayer(ctx, tx, ty);
      for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) this.drawElevationCell(ctx, tx, ty);
      this.drawZoneRings(ctx);
    }

    const mctx = this.miniCanvas.getContext("2d")!;
    for (let my = 0; my < this.miniCanvas.height; my++)
      for (let mx = 0; mx < this.miniCanvas.width; mx++) {
        const tx = Math.min(this.w - 1, Math.floor((mx + .5) * this.w / this.miniCanvas.width));
        const ty = Math.min(this.h - 1, Math.floor((my + .5) * this.h / this.miniCanvas.height));
        mctx.fillStyle = this.terrainAt(tx, ty)?.minimapColor ?? '#527741';
        mctx.fillRect(mx, my, 1, 1);
        if (this.blockKinds[String(ty * this.w + tx)]) { mctx.fillStyle = '#b58b45'; mctx.fillRect(mx, my, 1, 1); }
        const level = this.elevations[ty * this.w + tx] ?? 0;
        if (level) { mctx.fillStyle = `rgba(245,220,160,${level * .12})`; mctx.fillRect(mx, my, 1, 1); }
      }
  }

  private drawElevationCell(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const level = this.elevations[ty * this.w + tx] ?? 0;
    if (!level) return;
    const x = tx * TILE; const y = ty * TILE;
    ctx.fillStyle = `rgba(222,198,132,${level * .035})`; ctx.fillRect(x, y, TILE, TILE);
    const south = ty + 1 < this.h ? this.elevations[(ty + 1) * this.w + tx] ?? 0 : 0;
    const east = tx + 1 < this.w ? this.elevations[ty * this.w + tx + 1] ?? 0 : 0;
    if (level > south) { const depth = Math.min(12, (level - south) * 4); ctx.fillStyle = `rgba(38,31,25,${Math.min(.75, .24 + (level - south) * .18)})`; ctx.fillRect(x, y + TILE - depth, TILE, depth); }
    if (level > east) { ctx.fillStyle = 'rgba(35,30,24,.3)'; ctx.fillRect(x + TILE - 3, y, 3, TILE); }
    ctx.fillStyle = 'rgba(242,224,170,.15)'; ctx.fillRect(x, y, TILE, 2);
  }

  private drawZoneRings(ctx: CanvasRenderingContext2D) {
    for (const poi of this.pois) {
      if (!poi.safe && !poi.hot) continue;
      ctx.save();
      ctx.strokeStyle = poi.hot ? "rgba(240, 90, 58, 0.4)" : "rgba(150, 200, 130, 0.35)";
      ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(poi.x, poi.y, poi.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  private drawVisibleGround(ctx: CanvasRenderingContext2D, minX: number, minY: number, maxX: number, maxY: number) {
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) this.drawTerrainCell(ctx, tx, ty);
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) this.drawFoundationLayer(ctx, tx, ty);
    for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) this.drawElevationCell(ctx, tx, ty);
    this.drawZoneRings(ctx);
  }

  private updateMinimapCell(tx: number, ty: number, color?: string) {
    const context = this.miniCanvas.getContext('2d');
    if (!context) return;
    const mx = Math.floor(tx * this.miniCanvas.width / this.w);
    const my = Math.floor(ty * this.miniCanvas.height / this.h);
    context.fillStyle = color ?? this.terrainAt(tx, ty)?.minimapColor ?? '#527741';
    context.fillRect(mx, my, 1, 1);
  }

  private drawTerrainCell(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const terrain = this.terrainAt(tx, ty);
    ctx.clearRect(tx * TILE, ty * TILE, TILE, TILE);
    ctx.fillStyle = terrain?.minimapColor ?? '#527741';
    ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    const frame = terrain ? this.visualFrames.get(terrain.spriteId)?.[0] : undefined;
    if (frame) ctx.drawImage(frame, tx * TILE, ty * TILE, TILE, TILE);
    else this.drawBaseTile(ctx, tx, ty);
  }

  private drawFoundationLayer(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const index = ty * this.w + tx;
    const blockId = this.blockKinds[String(index)];
    const block = this.visuals.blocks?.[blockId];
    const under = this.unders.get(index);
    const floorId = block?.playerPlacement?.foundation
      ? blockId
      : under === Tile.WoodFloor ? 'wood_floor' : under === Tile.StoneFloor ? 'stone_floor' : '';
    if (floorId && this.visuals.blocks?.[floorId]) this.drawWorldBlock(ctx, floorId, tx * TILE + TILE / 2, ty * TILE + TILE, this.blockRotations[String(index)] ?? 0);
  }

  /** Base under a placed piece: the floor it was built on, else grass. */
  private blitUnderlay(ctx: CanvasRenderingContext2D, tx: number, ty: number, dx: number, dy: number) {
    const under = this.unders.get(ty * this.w + tx);
    if (under === Tile.WoodFloor) this.blitTile(ctx, 19, dx, dy);
    else if (under === Tile.StoneFloor) this.blitTile(ctx, 20, dx, dy);
    else this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
  }

  private drawBaseTile(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const t = this.tileAt(tx, ty);
    const dx = tx * TILE;
    const dy = ty * TILE;
    switch (t) {
      case Tile.Grass:
      case Tile.Tree:
      case Tile.Rock:
      case Tile.CopperOre:
      case Tile.IronOre:
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        break;
      case Tile.Water:
        this.blitTile(ctx, 2, dx, dy);
        break;
      case Tile.Sand:
        this.blitTile(ctx, 3, dx, dy);
        break;
      case Tile.Road:
        this.blitTile(ctx, 4, dx, dy);
        break;
      case Tile.Asphalt:
        this.blitTile(ctx, 5, dx, dy);
        break;
      case Tile.Floor:
        this.blitTile(ctx, 6, dx, dy);
        break;
      case Tile.Wall:
        this.blitTile(ctx, 7, dx, dy);
        break;
      case Tile.DoorMat: {
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        this.blitTile(ctx, 8, dx, dy);
        break;
      }
      case Tile.Workbench: {
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 14, dx, dy);
        break;
      }
      case Tile.Firepit: {
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 15, dx, dy);
        break;
      }
      case Tile.Furnace: {
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 16, dx, dy);
        break;
      }
      case Tile.Stump: {
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        this.blitTile(ctx, 17, dx, dy);
        break;
      }
      case Tile.Rubble: {
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        this.blitTile(ctx, 18, dx, dy);
        break;
      }
      case Tile.Bed: {
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        const isTop =
          this.tileAt(tx, ty + 1) === Tile.Bed &&
          this.tileAt(tx, ty - 1) !== Tile.Bed;
        this.blitTile(ctx, isTop ? 9 : 13, dx, dy);
        break;
      }
      case Tile.WoodFloor:
        this.blitTile(ctx, 19, dx, dy);
        break;
      case Tile.StoneFloor:
        this.blitTile(ctx, 20, dx, dy);
        break;
      case Tile.WoodWall:
        this.blitTile(ctx, 21, dx, dy);
        break;
      case Tile.Door:
        this.blitTile(ctx, 22, dx, dy);
        break;
      case Tile.Fence:
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 23, dx, dy);
        break;
      case Tile.Torch:
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 24, dx, dy);
        break;
      case Tile.Anvil: {
        this.blitUnderlay(ctx, tx, ty, dx, dy);
        this.blitTile(ctx, 27, dx, dy);
        break;
      }
      case Tile.Cliff:
        this.blitTile(ctx, 28, dx, dy);
        break;
    }
  }

  /** Server changed a tile (harvest / regrowth / build), including its rerolled resource variant. */
  applyTile(i: number, tile: number, under?: number, resourceId?: string | null) {
    const old = this.tiles[i];
    const oldResourceId = this.resourceKinds[String(i)];
    const fallingSpriteId = this.visuals.resources?.[oldResourceId]?.spriteId
      ?? this.visuals.resources?.tree?.spriteId;
    this.tiles[i] = tile;
    if ((old === Tile.Firepit || old === Tile.Furnace) && tile !== old) this.stationFuel.delete(i);
    if (resourceId === null) delete this.resourceKinds[String(i)];
    else if (resourceId !== undefined) this.resourceKinds[String(i)] = resourceId;
    if (under !== undefined) this.unders.set(i, under);
    else this.unders.delete(i);
    this.fogVersion++; // sightlines may have changed
    const tx = i % this.w;
    const ty = Math.floor(i / this.w);
    if (old === Tile.Tree && (tile === Tile.Stump || tile === Tile.Grass)) {
      this.falling.push({
        tx,
        ty,
        t0: this.lastTime || performance.now() / 1000,
        dir: hash2(tx, ty) < 0.5 ? -1 : 1,
        spriteId: fallingSpriteId,
        impacted: false,
      });
      this.burst(
        tx * TILE + 16,
        ty * TILE + 8,
        ["#3d7542", "#2e5e33", "#5c3f26"],
        14,
        60,
      );
    } else if ((old === Tile.Rock || old === Tile.CopperOre || old === Tile.IronOre)
      && (tile === Tile.Rubble || tile === Tile.Grass)) {
      this.burst(
        tx * TILE + 16,
        ty * TILE + 12,
        ["#92929a", "#5c5c62", "#77777d"],
        16,
        70,
      );
    }
    const ctx = this.mapCanvas?.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      this.drawTerrainCell(ctx, tx, ty);
      this.drawFoundationLayer(ctx, tx, ty);
    }
    this.updateMinimapCell(tx, ty);
    this.shakes.delete(i);
  }

  /** Server hit event → shakes, particles. */
  hitFx(h: HitSnap) {
    if (h.projectileId !== undefined) {
      const now = this.lastTime || performance.now() / 1000;
      this.retiredProjectiles.set(h.projectileId, now + 0.25);
      this.projectileImpacts.push({
        x: h.x,
        y: h.y,
        angle: h.projectileAngle ?? 0,
        t0: now,
      });
    }
    if (h.kind === "node") {
      const tx = Math.floor(h.x / TILE);
      const ty = Math.floor(h.y / TILE);
      this.shakes.set(ty * this.w + tx, this.lastTime);
      if (h.material === "stone")
        this.burst(h.x, h.y, ["#92929a", "#6f6f75"], 6, 55);
      else this.burst(h.x, h.y - 20, ["#3d7542", "#4f8a52", "#5c3f26"], 7, 50);
    } else {
      this.burst(h.x, h.y, ["#a83232", "#7c1f1f", "#c24848"], 6, 65);
    }
  }

  private burst(
    x: number,
    y: number,
    colors: string[],
    n: number,
    speed: number,
  ) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 30,
        g: 160,
        life: 0,
        ttl: 0.45 + Math.random() * 0.35,
        size: 2 + Math.random() * 2,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  // ── frame ───────────────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, view: WorldView) {
    const dt = this.lastTime ? Math.min(0.1, view.time - this.lastTime) : 0.016;
    this.lastTime = view.time;

    const you = view.players.find((p) => p.id === view.youId);
    const activeEntities = new Set([...view.players.map((player) => player.id), ...view.enemies.map((enemy) => enemy.id)]);
    for (const id of this.motionTransitions.keys()) if (!activeEntities.has(id)) this.motionTransitions.delete(id);
    for (const id of this.facingDirections.keys()) if (!activeEntities.has(id)) this.facingDirections.delete(id);
    let camX = you ? you.dx : (this.w * TILE) / 2;
    let camY = you ? you.dy : (this.h * TILE) / 2;
    // recoil kick: nudge the camera opposite the last shot
    if (view.time < this.kickUntil) {
      const k = (this.kickUntil - view.time) / 0.09;
      camX -= Math.cos(this.kickAngle) * 2.5 * k;
      camY -= Math.sin(this.kickAngle) * 2.5 * k;
    }
    const z = this.zoom;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0c0f0a";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-camX, -camY);

    const viewW = w / z;
    const viewH = h / z;
    const sx = Math.max(0, camX - viewW / 2 - TILE);
    const sy = Math.max(0, camY - viewH / 2 - TILE);
    const sw = Math.min(this.w * TILE - sx, viewW + TILE * 2);
    const sh = Math.min(this.h * TILE - sy, viewH + TILE * 2);
    if (sw > 0 && sh > 0) {
      if (this.mapCanvas) ctx.drawImage(this.mapCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
      else {
        const minX = Math.max(0, Math.floor(sx / TILE));
        const minY = Math.max(0, Math.floor(sy / TILE));
        const maxX = Math.min(this.w - 1, Math.ceil((sx + sw) / TILE));
        const maxY = Math.min(this.h - 1, Math.ceil((sy + sh) / TILE));
        this.drawVisibleGround(ctx, minX, minY, maxX, maxY);
      }
    }
    if (!this.reducedMotion) {
      this.drawAmbientTerrain(
        ctx,
        Math.max(0, Math.floor(sx / TILE)),
        Math.max(0, Math.floor(sy / TILE)),
        Math.min(this.w - 1, Math.ceil((sx + sw) / TILE)),
        Math.min(this.h - 1, Math.ceil((sy + sh) / TILE)),
        view.time,
      );
    }

    // muzzle flashes + gunfeel from newly-seen projectiles
    const seen = new Set<number>();
    const predictedBursts: number[] = [];
    for (const [id, expiresAt] of this.retiredProjectiles) {
      if (expiresAt <= view.time) this.retiredProjectiles.delete(id);
    }
    for (const pr of view.projectiles) {
      if (this.retiredProjectiles.has(pr.id)) continue;
      seen.add(pr.id);
      if (!this.prevProj.has(pr.id)) {
        const nearYou = Boolean(you && Math.hypot(pr.x - you.dx, pr.y - you.dy) < 120);
        const predictedIndex = nearYou ? this.predictedShots.findIndex((shot) => {
          const angleDelta = Math.abs(Math.atan2(Math.sin(pr.angle - shot.angle), Math.cos(pr.angle - shot.angle)));
          return view.time - shot.t0 < 1.2 && angleDelta < 0.35;
        }) : -1;
        const samePredictedBurst = nearYou && predictedBursts.some((angle) => {
          const angleDelta = Math.abs(Math.atan2(Math.sin(pr.angle - angle), Math.cos(pr.angle - angle)));
          return angleDelta < 0.65;
        });
        const locallyPreviewed = predictedIndex >= 0 || samePredictedBurst;
        if (predictedIndex >= 0) {
          predictedBursts.push(this.predictedShots[predictedIndex].angle);
          this.predictedShots.splice(predictedIndex, 1);
        }
        if (!locallyPreviewed) this.flashes.push({ x: pr.x, y: pr.y, angle: pr.angle, t0: view.time });
        if (nearYou && !locallyPreviewed && you) {
          // your shot: camera kick + ejected casing
          this.kickUntil = view.time + 0.09;
          this.kickAngle = pr.angle;
          const side = pr.angle + Math.PI / 2;
          this.particles.push({
            x: you.dx + Math.cos(pr.angle) * 8,
            y: you.dy + Math.sin(pr.angle) * 8,
            vx:
              Math.cos(side) * (40 + Math.random() * 30) -
              Math.cos(pr.angle) * 15,
            vy: Math.sin(side) * (40 + Math.random() * 30) - 40,
            g: 260,
            life: 0,
            ttl: 0.5,
            size: 2,
            color: "#c8a84a",
          });
        }
      }
    }
    this.prevProj = seen;

    // corpses on death transitions
    for (const p of view.players) {
      const was = this.prevDead.get(p.id) ?? false;
      if (p.dead && !was) {
        this.corpses.push({
          x: p.dx,
          y: p.dy,
          row: hashStr(p.name) % CHAR_ROWS.survivorCount,
          target: 'player',
          t0: view.time,
          dir: hashStr(p.id) % 2 ? -1 : 1,
        });
        this.burst(p.dx, p.dy, ["#a83232", "#7c1f1f"], 14, 80);
      }
      this.prevDead.set(p.id, p.dead);
    }

    for (const g of view.ground) this.drawGroundItem(ctx, g, view.time);
    for (const event of view.events) this.drawWorldEvent(ctx, event, view.time);
    for (const c of view.containers) this.drawContainer(ctx, c);

    // aim line for your own equipped gun (Zero Sievert style)
    if (you && !you.dead && you.weapon && this.gameplayItems[you.weapon]?.weapon) {
      ctx.save();
      ctx.strokeStyle = "rgba(230, 220, 180, 0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(
        you.dx + Math.cos(you.angle) * 18,
        you.dy + Math.sin(you.angle) * 18,
      );
      ctx.lineTo(
        you.dx + Math.cos(you.angle) * 110,
        you.dy + Math.sin(you.angle) * 110,
      );
      ctx.stroke();
      ctx.restore();
    }

    // corpses under everything alive
    this.corpses = this.corpses.filter((c) => view.time - c.t0 < 3.4);
    for (const c of this.corpses) {
      const elapsed = view.time - c.t0;
      const fall = easeInCubic(Math.min(1, elapsed / 0.52));
      const settleAge = Math.max(0, elapsed - 0.52);
      const settle = settleAge < 0.42
        ? Math.sin((settleAge / 0.42) * Math.PI * 2) * 0.045 * (1 - settleAge / 0.42)
        : 0;
      const fade = Math.max(0, Math.min(1, (elapsed - 2.55) / 0.85));
      ctx.save();
      ctx.globalAlpha = 0.88 * (1 - fade);
      ctx.translate(c.x, c.y + fall * 7);
      ctx.rotate(c.dir * (fall * Math.PI / 2 + settle));
      const custom = c.target
        ? this.drawEngineSprite(ctx, c.target, 'death', elapsed * 1000, 0, 0, 0)
        : false;
      if (!custom) this.blitChar(ctx, c.row, 0, -16, -16);
      ctx.restore();
    }

    // y-sorted world entities: trees, rocks, players, enemies, traders, falling trees
    type Drawable = { y: number; fn: () => void };
    const drawables: Drawable[] = [];

    const tMinX = Math.max(0, Math.floor(sx / TILE));
    const tMaxX = Math.min(this.w - 1, Math.ceil((sx + sw) / TILE));
    const tMinY = Math.max(0, Math.floor(sy / TILE));
    const tMaxY = Math.min(this.h - 1, Math.ceil((sy + sh) / TILE));
    const nightLights: NightLight[] = [];
    const lightMargin = Math.ceil(TORCH_POST_LIGHT_RADIUS / TILE);
    for (let ty = Math.max(0, tMinY - lightMargin); ty <= Math.min(this.h - 1, tMaxY + lightMargin); ty++)
      for (let tx = Math.max(0, tMinX - lightMargin); tx <= Math.min(this.w - 1, tMaxX + lightMargin); tx++) {
        const index = ty * this.w + tx;
        const tile = this.tileAt(tx, ty);
        const blockType = this.visuals.blocks?.[this.blockKinds[String(index)]]?.playerPlacement?.buildType;
        if (tile === Tile.Torch || blockType === 'torch') {
          nightLights.push({ x: (tx + 0.5) * TILE, y: (ty + 0.42) * TILE, radius: TORCH_POST_LIGHT_RADIUS, strength: 0.96, warmth: 1, flickerSeed: index });
        } else if ((tile === Tile.Firepit || blockType === 'firepit') && (this.stationFuel.get(index) ?? 0) > 0) {
          nightLights.push({ x: (tx + 0.5) * TILE, y: (ty + 0.55) * TILE, radius: FIREPIT_LIGHT_RADIUS, strength: 0.78, warmth: 0.85, flickerSeed: index });
        }
      }
    for (const player of view.players) {
      if (player.dead || !player.weapon) continue;
      const radius = this.gameplayItems[player.weapon]?.lightRadius;
      if (!radius) continue;
      nightLights.push({
        x: player.dx + Math.cos(player.angle) * 12,
        y: player.dy + Math.sin(player.angle) * 12,
        radius,
        strength: 0.84,
        warmth: 0.9,
        flickerSeed: hashStr(player.id),
      });
    }
    for (let ty = tMinY; ty <= tMaxY; ty++)
      for (let tx = tMinX; tx <= tMaxX; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === Tile.Tree) {
          const i = ty * this.w + tx;
          const resource = this.visuals.resources?.[this.resourceKinds[String(i)]];
          const cx = tx * TILE + TILE / 2;
          const by = ty * TILE + TILE - 2;
          const shakeAt = this.shakes.get(i);
          let shakeX = 0;
          if (shakeAt !== undefined) {
            const el = view.time - shakeAt;
            if (el < 0.3) shakeX = Math.sin(el * 45) * 2.2 * (1 - el / 0.3);
            else this.shakes.delete(i);
          }
          drawables.push({
            y: by,
            fn: () => { if (!this.drawResourceSprite(ctx, resource?.spriteId, cx, by, shakeX)) this.drawTreeSprite(ctx, cx, by, 0, 1, shakeX); },
          });
        } else if (t === Tile.Rock || t === Tile.CopperOre || t === Tile.IronOre) {
          const i = ty * this.w + tx;
          const resource = this.visuals.resources?.[this.resourceKinds[String(i)]];
          const resourceSprite = (t === Tile.CopperOre || t === Tile.IronOre) && resource?.tile === Tile.Rock ? undefined : resource?.spriteId;
          const dx = tx * TILE;
          const dy = ty * TILE;
          const col = t === Tile.Rock ? 12 : t === Tile.CopperOre ? 25 : 26;
          const shakeAt = this.shakes.get(i);
          let shakeX = 0;
          if (shakeAt !== undefined) {
            const el = view.time - shakeAt;
            if (el < 0.25) shakeX = Math.sin(el * 50) * 1.6 * (1 - el / 0.25);
            else this.shakes.delete(i);
          }
          drawables.push({
            y: dy + TILE - 4,
            fn: () => {
              if (this.drawResourceSprite(ctx, resourceSprite, dx + TILE / 2, dy + TILE, shakeX)) return;
              ctx.drawImage(
                this.sheets.tiles,
                col * SPR,
                0,
                SPR,
                SPR,
                dx + shakeX,
                dy,
                TILE,
                TILE,
              );
            },
          });
        }
        const blockId = this.blockKinds[String(ty * this.w + tx)];
        const block = this.visuals.blocks?.[blockId];
        if (blockId && block && !block.playerPlacement?.foundation) {
          const cx = tx * TILE + TILE / 2;
          const by = ty * TILE + TILE;
          const index = ty * this.w + tx;
          let door = this.doorProgress.get(index) ?? (this.openDoors.has(index) ? 1 : 0);
          if (block.playerPlacement?.buildType === 'door') {
            const target = this.openDoors.has(index) ? 1 : 0;
            door += (target - door) * (1 - Math.exp(-13 * dt));
            if (Math.abs(target - door) < 0.002) door = target;
            this.doorProgress.set(index, door);
          } else {
            door = 0;
            this.doorProgress.delete(index);
          }
          const rotation = (this.blockRotations[String(index)] ?? 0) + door;
          drawables.push({ y: by, fn: () => this.drawWorldBlock(ctx, blockId, cx, by, rotation) });
        }
        const stationKind = block?.playerPlacement?.buildType
          ?? (t === Tile.Torch ? 'torch' : t === Tile.Firepit ? 'firepit' : t === Tile.Furnace ? 'furnace' : undefined);
        if (
          (stationKind === 'torch' || stationKind === 'firepit' || stationKind === 'furnace')
          && (stationKind === 'torch' || (this.stationFuel.get(ty * this.w + tx) ?? 0) > 0)
        ) {
          const cx = tx * TILE + TILE / 2;
          const by = ty * TILE + TILE;
          drawables.push({ y: by + 0.01, fn: () => this.drawStationFx(ctx, stationKind, cx, by, view.time, ty * this.w + tx) });
        }
      }

    const treeRecoilEnd = 0.24;
    const treeImpactAt = 1.08;
    const treeFadeAt = 2.3;
    const treeLife = 2.85;
    this.falling = this.falling.filter((f) => view.time - f.t0 < treeLife);
    for (const f of this.falling) {
      const age = Math.max(0, view.time - f.t0);
      let angle = 0;
      if (age < treeRecoilEnd) {
        const recoil = age / treeRecoilEnd;
        angle = f.dir * Math.sin(recoil * Math.PI * 3) * 0.055 * (1 - recoil);
      } else if (age < treeImpactAt) {
        const fall = easeInCubic((age - treeRecoilEnd) / (treeImpactAt - treeRecoilEnd));
        angle = f.dir * fall * (Math.PI / 2 + 0.055);
      } else {
        const settleAge = Math.min(1, (age - treeImpactAt) / 0.46);
        const bounce = Math.sin(settleAge * Math.PI * 2) * 0.06 * (1 - settleAge);
        angle = f.dir * (Math.PI / 2 + bounce);
      }
      const cx = f.tx * TILE + TILE / 2;
      const by = f.ty * TILE + TILE - 2;
      if (!f.impacted && age >= treeImpactAt) {
        f.impacted = true;
        this.burst(
          cx + f.dir * 48,
          by - 3,
          ["#263a27", "#49643d", "#6d8651", "#5c3f26", "#93623d"],
          24,
          82,
        );
      }
      const alpha = age <= treeFadeAt
        ? 1
        : Math.max(0, 1 - (age - treeFadeAt) / (treeLife - treeFadeAt));
      drawables.push({
        y: by,
        fn: () => this.drawFallingResourceSprite(ctx, f.spriteId, cx, by, angle, alpha),
      });
    }

    for (const tr of this.traders)
      drawables.push({
        y: tr.y + 14,
        fn: () => this.drawTrader(ctx, tr.x, tr.y, view.time),
      });

    for (const ex of this.extracts) this.drawExtract(ctx, ex.x, ex.y, view.time);

    for (const p of view.players)
      if (!p.dead)
        drawables.push({
          y: p.dy + 14,
          fn: () => this.drawPlayer(ctx, p, p.id === view.youId, view),
        });
    for (const e of view.enemies)
      drawables.push({
        y: e.dy + 14,
        fn: () => this.drawEnemy(ctx, e, view),
      });

    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

    for (const pr of view.projectiles) {
      if (!this.retiredProjectiles.has(pr.id)) this.drawProjectile(ctx, pr);
    }

    // Close the tracer at the authoritative collision point instead of holding
    // its final network sample while the hit effect is already playing.
    this.projectileImpacts = this.projectileImpacts.filter((impact) => view.time - impact.t0 < 0.1);
    for (const impact of this.projectileImpacts) {
      const age = Math.max(0, view.time - impact.t0);
      ctx.save();
      ctx.translate(impact.x, impact.y);
      ctx.rotate(impact.angle);
      ctx.globalAlpha = 1 - age / 0.1;
      ctx.fillStyle = "#fff3bd";
      ctx.fillRect(-10, -1, 10, 2);
      ctx.fillStyle = "#e5a640";
      ctx.fillRect(-3, -2, 3, 4);
      ctx.restore();
    }

    // flashes
    this.flashes = this.flashes.filter((f) => view.time - f.t0 < 0.08);
    for (const f of this.flashes) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.fillStyle = "rgba(255, 232, 160, 0.9)";
      ctx.fillRect(0, -2, 7, 4);
      ctx.fillStyle = "rgba(255, 200, 90, 0.7)";
      ctx.fillRect(5, -1, 4, 2);
      ctx.restore();
    }

    // particles
    this.particles = this.particles.filter((p) => (p.life += dt) < p.ttl);
    for (const p of this.particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.life / p.ttl;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // LOS fog: dim what you cannot see past walls/forest — matches server vision rules
    if (view.fog && you) {
      const key = `${Math.floor(you.dx / TILE)},${Math.floor(you.dy / TILE)},${this.fogVersion}`;
      if (key !== this.fogKey) {
        this.fogKey = key;
        this.fogBlocked.clear();
        const px = you.dx;
        const py = you.dy;
        for (let ty = tMinY; ty <= tMaxY; ty++)
          for (let tx = tMinX; tx <= tMaxX; tx++) {
            const cx = tx * TILE + TILE / 2;
            const cy = ty * TILE + TILE / 2;
            if (Math.hypot(cx - px, cy - py) < 140) continue; // you always sense your surroundings
            if (!this.losTo(px, py, cx, cy)) this.fogBlocked.add(ty * this.w + tx);
          }
      }
      ctx.save();
      ctx.beginPath();
      for (const i of this.fogBlocked) {
        const tx = i % this.w;
        const ty = Math.floor(i / this.w);
        if (tx < tMinX || tx > tMaxX || ty < tMinY || ty > tMaxY) continue;
        ctx.rect(tx * TILE, ty * TILE, TILE, TILE);
      }
      ctx.filter = 'blur(4px)';
      ctx.fillStyle = "rgba(6, 8, 12, 0.31)";
      ctx.fill();
      ctx.filter = 'none';
      ctx.fillStyle = "rgba(6, 8, 12, 0.13)";
      ctx.fill();
      ctx.restore();
    }

    // pulsing ring under the nearest interactable (what E will act on)
    if (view.highlight) {
      const pulse = 0.5 + 0.5 * Math.sin(view.time * 5);
      ctx.save();
      ctx.strokeStyle = `rgba(216, 162, 74, ${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(view.highlight.x, view.highlight.y, 15 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const f of view.floats) this.drawFloat(ctx, f);

    // build placement ghost — green when valid, red when not
    if (view.ghost) {
      const gx = view.ghost.tx * TILE;
      const gy = view.ghost.ty * TILE;
      const col = tileSpriteCol(view.ghost.tile);
      ctx.save();
      ctx.globalAlpha = 0.55;
      if (view.ghost.blockId && this.visuals.blocks?.[view.ghost.blockId]) this.drawWorldBlock(ctx, view.ghost.blockId, gx + TILE / 2, gy + TILE, view.ghost.rotation);
      else if (col >= 0) {
        ctx.save();
        ctx.translate(gx + TILE / 2, gy + TILE / 2);
        ctx.rotate(view.ghost.rotation * Math.PI / 2);
        this.blitTile(ctx, col, -TILE / 2, -TILE / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = view.ghost.valid ? "#3ad46a" : "#d43a3a";
      ctx.fillRect(gx, gy, TILE, TILE);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = view.ghost.valid ? "#5ff08a" : "#f05a5a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(gx + 0.5, gy + 0.5, TILE - 1, TILE - 1);
      ctx.restore();
    }

    // demolish marker — hatched red X over the targeted piece
    if (view.demolish) {
      const gx = view.demolish.tx * TILE;
      const gy = view.demolish.ty * TILE;
      ctx.save();
      ctx.globalAlpha = view.demolish.valid ? 0.9 : 0.35;
      ctx.strokeStyle = "#f05a3a";
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, TILE - 2, TILE - 2);
      ctx.beginPath();
      ctx.moveTo(gx + 6, gy + 6);
      ctx.lineTo(gx + TILE - 6, gy + TILE - 6);
      ctx.moveTo(gx + TILE - 6, gy + 6);
      ctx.lineTo(gx + 6, gy + TILE - 6);
      ctx.stroke();
      ctx.restore();
    }

    // crosshair at the aim point — the gun barrel sits on this line
    if (view.cursor && you && !you.dead) {
      const c = view.cursor;
      ctx.save();
      ctx.strokeStyle = "rgba(240, 216, 120, 0.85)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx1, dy1, dx2, dy2] of [[0, -9, 0, -5], [0, 9, 0, 5], [-9, 0, -5, 0], [9, 0, 5, 0]]) {
        ctx.moveTo(c.x + dx1, c.y + dy1);
        ctx.lineTo(c.x + dx2, c.y + dy2);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(240, 216, 120, 0.9)";
      ctx.fillRect(c.x - 0.75, c.y - 0.75, 1.5, 1.5);
      ctx.restore();
    }

    // chat bubbles (RuneScape style)
    const nowMs = performance.now();
    for (const p of view.players) {
      const b = view.bubbles.get(p.id);
      if (!b || nowMs - b.at > 5000 || p.dead) continue;
      const alpha = nowMs - b.at > 4200 ? 1 - (nowMs - b.at - 4200) / 800 : 1;
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      const text = b.text.length > 40 ? b.text.slice(0, 40) + "…" : b.text;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = `rgba(8,10,6,${0.75 * alpha})`;
      ctx.fillRect(p.dx - tw / 2 - 4, p.dy - 40, tw + 8, 12);
      ctx.fillStyle = `rgba(240,235,210,${alpha})`;
      ctx.fillText(text, p.dx, p.dy - 31);
    }

    ctx.restore();

    this.drawNight(ctx, w, h, view.day, nightLights.map((light) => ({
      ...light,
      x: w / 2 + (light.x - camX) * z,
      y: h / 2 + (light.y - camY) * z,
      radius: light.radius * z,
    })), view.time);
  }

  private drawNight(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    day: number,
    lights: NightLight[],
    time: number,
  ) {
    const brightness = 0.5 - 0.5 * Math.cos(day * Math.PI * 2);
    const darkness = (1 - brightness) * 0.88;
    if (this.nightCanvas.width !== w || this.nightCanvas.height !== h) {
      this.nightCanvas.width = w;
      this.nightCanvas.height = h;
    }
    const night = this.nightCanvas.getContext('2d');
    if (!night) return;
    night.clearRect(0, 0, w, h);
    night.globalCompositeOperation = 'source-over';
    // golden-hour tint around sunrise (~0.25) and sunset (~0.75)
    const dusk = Math.max(
      0,
      1 - Math.abs(day - 0.77) / 0.07,
      1 - Math.abs(day - 0.23) / 0.07,
    );
    if (dusk > 0) {
      night.fillStyle = `rgba(255, 118, 42, ${dusk * 0.12})`;
      night.fillRect(0, 0, w, h);
    }
    // Zero Sievert-ish permanent edge vignette + night darkness
    const grad = night.createRadialGradient(
      w / 2,
      h / 2,
      80,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    );
    grad.addColorStop(0, `rgba(5, 8, 20, ${Math.max(0.035, darkness * 0.86)})`);
    grad.addColorStop(1, `rgba(2, 3, 12, ${Math.max(0.24, Math.min(0.94, darkness + 0.06))})`);
    night.fillStyle = grad;
    night.fillRect(0, 0, w, h);

    const lightVisibility = Math.max(0, Math.min(1, (darkness - 0.06) / 0.5));
    if (lightVisibility > 0 && lights.length) {
      night.globalCompositeOperation = 'destination-out';
      for (const light of lights) {
        const flicker = 0.96 + 0.04 * Math.sin(time * 10 + light.flickerSeed * 0.017);
        const radius = light.radius * flicker;
        if (light.x + radius < 0 || light.y + radius < 0 || light.x - radius > w || light.y - radius > h) continue;
        const reveal = light.strength * lightVisibility;
        const cutout = night.createRadialGradient(light.x, light.y, 2, light.x, light.y, radius);
        cutout.addColorStop(0, `rgba(0, 0, 0, ${reveal})`);
        cutout.addColorStop(0.32, `rgba(0, 0, 0, ${reveal * 0.82})`);
        cutout.addColorStop(0.72, `rgba(0, 0, 0, ${reveal * 0.28})`);
        cutout.addColorStop(1, 'rgba(0, 0, 0, 0)');
        night.fillStyle = cutout;
        night.fillRect(light.x - radius, light.y - radius, radius * 2, radius * 2);
      }
    }
    night.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.nightCanvas, 0, 0);

    if (lightVisibility > 0 && lights.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const light of lights) {
        const radius = light.radius * 0.7;
        const warmth = light.warmth * lightVisibility;
        const glow = ctx.createRadialGradient(light.x, light.y, 2, light.x, light.y, radius);
        glow.addColorStop(0, `rgba(255, 190, 92, ${0.22 * warmth})`);
        glow.addColorStop(0.48, `rgba(255, 128, 45, ${0.08 * warmth})`);
        glow.addColorStop(1, 'rgba(255, 105, 30, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(light.x - radius, light.y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    }
  }

  drawMinimap(
    ctx: CanvasRenderingContext2D,
    size: number,
    view: {
      pois: PoiSnap[];
      players: { id: string; name: string; dx: number; dy: number; dead: boolean }[];
      youId: string;
      friendNames: Set<string>;
      clanNames: Set<string>;
      events: WorldEventSnap[];
    },
    options: MinimapRenderOptions = {},
  ) {
    const detailed = options.detailed ?? false;
    const maxDimension = Math.max(this.w, this.h);
    const requestedSpan = options.visibleTiles ?? maxDimension / Math.max(1, options.zoom ?? 1);
    const span = Math.max(4, Math.min(maxDimension, requestedSpan));
    const clampAxis = (center: number, length: number) => span >= length
      ? length / 2
      : Math.max(span / 2, Math.min(length - span / 2, center));
    let centerX = options.centerX ?? this.w / 2;
    let centerY = options.centerY ?? this.h / 2;
    if (options.clampToMap !== false) {
      centerX = clampAxis(centerX, this.w);
      centerY = clampAxis(centerY, this.h);
    }
    const left = centerX - span / 2;
    const top = centerY - span / 2;
    const pixelsPerTile = size / span;
    const point = (x: number, y: number) => ({
      x: (x / TILE - left) * pixelsPerTile,
      y: (y / TILE - top) * pixelsPerTile,
    });
    const markerScale = detailed ? Math.max(1.5, Math.min(2.5, size / 320)) : 1;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#080a07';
    ctx.fillRect(0, 0, size, size);

    const sourceLeft = Math.max(0, left);
    const sourceTop = Math.max(0, top);
    const sourceRight = Math.min(this.w, left + span);
    const sourceBottom = Math.min(this.h, top + span);
    if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(
        this.miniCanvas,
        sourceLeft * this.miniCanvas.width / this.w,
        sourceTop * this.miniCanvas.height / this.h,
        (sourceRight - sourceLeft) * this.miniCanvas.width / this.w,
        (sourceBottom - sourceTop) * this.miniCanvas.height / this.h,
        (sourceLeft - left) * pixelsPerTile,
        (sourceTop - top) * pixelsPerTile,
        (sourceRight - sourceLeft) * pixelsPerTile,
        (sourceBottom - sourceTop) * pixelsPerTile,
      );
      ctx.globalAlpha = 1;
    }

    if (detailed) {
      ctx.strokeStyle = 'rgba(220, 210, 170, 0.11)';
      ctx.lineWidth = 1;
      for (let section = 1; section < 8; section++) {
        const x = size * (section / 8);
        const y = size * (section / 8);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(220, 210, 170, 0.42)';
      ctx.strokeRect(
        (0 - left) * pixelsPerTile + 0.5,
        (0 - top) * pixelsPerTile + 0.5,
        this.w * pixelsPerTile - 1,
        this.h * pixelsPerTile - 1,
      );
    }

    for (const poi of view.pois) {
      const { x, y } = point(poi.x, poi.y);
      ctx.strokeStyle = poi.safe
        ? "rgba(140, 210, 130, 0.9)"
        : poi.hot
          ? "rgba(240, 90, 58, 0.95)"
          : poi.kind === "airport"
            ? "rgba(216, 162, 74, 0.8)"
            : "rgba(194, 80, 71, 0.8)";
      ctx.lineWidth = detailed ? 1.5 : 1;
      const marker = 3 * markerScale;
      ctx.strokeRect(x - marker, y - marker, marker * 2, marker * 2);
      if (poi.hot || (detailed && poi.safe)) {
        ctx.setLineDash(detailed ? [5, 4] : [3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, (poi.r / TILE) * pixelsPerTile, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const fontSize = detailed ? Math.max(10, Math.min(13, Math.round(size / 64))) : 8;
      ctx.font = `${detailed ? '700 ' : ''}${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = poi.hot ? "rgba(255, 170, 150, 0.95)" : "rgba(230, 228, 210, 0.95)";
      const label = poi.hot ? `! ${poi.name}` : poi.name;
      if (detailed) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(5, 7, 5, 0.9)';
        ctx.strokeText(label, x, y - marker - 4);
      }
      ctx.fillText(label, x, y - marker - 4);
    }
    for (const event of view.events) {
      const { x, y } = point(event.x, event.y);
      const supply = event.type === 'supply_drop';
      const pulse = 0.5 + Math.sin(Date.now() / 280) * 0.5;
      const marker = (detailed ? 7 : 4) * markerScale;
      ctx.save();
      ctx.strokeStyle = supply ? '#65d9e8' : '#f05a4a';
      ctx.fillStyle = supply ? 'rgba(101, 217, 232, 0.2)' : 'rgba(240, 90, 74, 0.2)';
      ctx.lineWidth = detailed ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y, marker + pulse * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = supply ? '#b9f4f7' : '#ffd0c8';
      ctx.font = `700 ${detailed ? 11 : 8}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(supply ? 'D' : 'B', x, y + 0.5);
      if (detailed) {
        ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(5, 7, 5, 0.92)';
        ctx.strokeText(event.name, x, y - marker - 8);
        ctx.fillStyle = supply ? '#9eeaf0' : '#ff9b8d';
        ctx.fillText(event.name, x, y - marker - 8);
      }
      ctx.restore();
    }
    if (detailed) {
      for (const tr of this.traders) {
        const { x, y } = point(tr.x, tr.y);
        const marker = 4;
        ctx.fillStyle = "#d8c26a";
        ctx.fillRect(x - marker, y - marker, marker * 2, marker * 2);
      }
    }
    for (const ex of this.extracts) {
      const { x, y } = point(ex.x, ex.y);
      const marker = detailed ? 6 : 3;
      ctx.strokeStyle = "#5ff08a";
      ctx.lineWidth = detailed ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y - marker);
      ctx.lineTo(x + marker, y);
      ctx.lineTo(x, y + marker);
      ctx.lineTo(x - marker, y);
      ctx.closePath();
      ctx.stroke();
    }
    for (const p of view.players) {
      if (p.dead) continue;
      const { x, y } = point(p.dx, p.dy);
      const isYou = p.id === view.youId;
      const isFriend = view.friendNames.has(p.name);
      const isClan = view.clanNames.has(p.name);
      if (!isYou && !isFriend && !isClan) continue;
      ctx.fillStyle = isYou ? "#f0d878" : isClan ? "#68bfe8" : "#78d878";
      ctx.beginPath();
      ctx.arc(x, y, detailed ? (isYou ? 6 : 4) : (isYou ? 2.5 : 1.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isYou ? 'rgba(240, 216, 120, 0.55)' : isClan ? 'rgba(104, 191, 232, 0.75)' : "rgba(120, 216, 120, 0.7)";
      ctx.lineWidth = detailed ? 2 : 1;
      ctx.beginPath();
      ctx.arc(x, y, detailed && isYou ? 10 : detailed ? 6 : isYou ? 4 : 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── entity painters ─────────────────────────────────────────────────────

  private drawWorldEvent(
    ctx: CanvasRenderingContext2D,
    event: WorldEventSnap,
    time: number,
  ) {
    const pulse = 0.5 + Math.sin(time * 4.5 + hashStr(event.id)) * 0.5;
    const supply = event.type === 'supply_drop';
    ctx.save();
    ctx.strokeStyle = supply
      ? `rgba(101, 217, 232, ${0.38 + pulse * 0.38})`
      : `rgba(240, 90, 74, ${0.38 + pulse * 0.38})`;
    ctx.fillStyle = supply
      ? 'rgba(101, 217, 232, 0.07)'
      : 'rgba(240, 90, 74, 0.07)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(event.x, event.y, 25 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (supply) {
      const gradient = ctx.createLinearGradient(event.x, event.y - 70, event.x, event.y - 5);
      gradient.addColorStop(0, 'rgba(101, 217, 232, 0)');
      gradient.addColorStop(1, `rgba(101, 217, 232, ${0.28 + pulse * 0.22})`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(event.x - 10, event.y - 70);
      ctx.lineTo(event.x + 10, event.y - 70);
      ctx.lineTo(event.x + 4, event.y - 5);
      ctx.lineTo(event.x - 4, event.y - 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawContainer(ctx: CanvasRenderingContext2D, c: ContainerSnap) {
    const { x, y } = c;
    const tx = Math.floor(x / TILE); const ty = Math.floor(y / TILE);
    const block = this.visuals.blocks?.[this.blockKinds[String(ty * this.w + tx)]];
    if (c.kind === 'storage' && block?.playerPlacement?.buildType === 'chest') return;
    ctx.save();
    if (c.looted) ctx.globalAlpha = 0.7;
    if (c.kind === "chest") {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x - 11, y + 6, 22, 5);
      ctx.fillStyle = c.looted ? "#6a5d4c" : "#7c5226";
      ctx.fillRect(x - 11, y - 8, 22, 16);
      ctx.fillStyle = c.looted ? "#7c7060" : "#94662c";
      ctx.fillRect(x - 11, y - 8, 22, 5);
      ctx.strokeStyle = "#33240f";
      ctx.strokeRect(x - 11.5, y - 8.5, 23, 17);
      ctx.fillStyle = c.looted ? "#55503f" : "#d8a24a";
      ctx.fillRect(x - 2, y - 4, 4, 6);
    } else if (c.kind === "crate") {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x - 12, y + 6, 24, 5);
      ctx.fillStyle = c.looted ? "#565b4d" : c.event === 'supply_drop' ? "#376874" : "#47563a";
      ctx.fillRect(x - 12, y - 9, 24, 17);
      ctx.fillStyle = c.looted ? "#63685a" : c.event === 'supply_drop' ? "#4b8792" : "#576a45";
      ctx.fillRect(x - 12, y - 9, 24, 5);
      ctx.strokeStyle = "#20281a";
      ctx.strokeRect(x - 12.5, y - 9.5, 25, 18);
      ctx.fillStyle = "#d8d2b8";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(c.event === 'supply_drop' ? "D" : "★", x, y + 2);
    } else if (c.kind === "storage") {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(x - 13, y + 7, 26, 5);
      ctx.fillStyle = "#4a4438";
      ctx.fillRect(x - 13, y - 10, 26, 18);
      ctx.fillStyle = "#5c5546";
      ctx.fillRect(x - 13, y - 10, 26, 6);
      ctx.strokeStyle = "#26221a";
      ctx.strokeRect(x - 13.5, y - 10.5, 27, 19);
      ctx.fillStyle = "#d8a24a";
      ctx.fillRect(x - 3, y - 5, 6, 7);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x - 8, y + 5, 16, 4);
      ctx.fillStyle = c.event === 'boss_reward' ? "#6f4c29" : "#403a30";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.event === 'boss_reward' ? "#9b7136" : "#524a3d";
      ctx.beginPath();
      ctx.arc(x - 2, y - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#231f18";
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGroundItem(
    ctx: CanvasRenderingContext2D,
    g: GroundItemSnap,
    time: number,
  ) {
    const bob = Math.sin(time * 3 + (g.x + g.y) * 0.05) * 2;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 8, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    this.blitItem(ctx, g.item, g.x - 12, g.y - 12 + bob, 24);
    const s = (Math.sin(time * 5 + g.x) + 1) / 2;
    ctx.fillStyle = `rgba(255,255,220,${0.3 + s * 0.45})`;
    ctx.fillRect(g.x + 8, g.y - 12 + bob, 2, 2);
  }

  private drawAmbientTerrain(
    ctx: CanvasRenderingContext2D,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    time: number,
  ) {
    ctx.save();
    ctx.lineWidth = 0.75;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (this.tileAt(tx, ty) !== Tile.Water && !this.terrainAt(tx, ty)?.swimmable) continue;
        const seed = hash2(tx, ty);
        const drift = (time * (4.5 + seed * 2) + seed * 20) % 16;
        const y = ty * TILE + 7 + drift;
        const x = tx * TILE + 4 + seed * 9;
        ctx.strokeStyle = `rgba(164, 211, 231, ${0.12 + Math.sin(time * 2.4 + seed * 8) * 0.035})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5 + seed * 4, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawStationFx(
    ctx: CanvasRenderingContext2D,
    kind: string,
    x: number,
    bottomY: number,
    time: number,
    seed: number,
  ) {
    // Fuel state controls visibility; reduced-motion keeps a steady flame
    // rather than hiding the only visual indication that the station is lit.
    const flicker = this.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 17 + seed * 0.73);
    const baseY = kind === 'torch' ? bottomY - 20 : kind === 'furnace' ? bottomY - 8 : bottomY - 11;
    ctx.save();
    if (kind === 'furnace') {
      ctx.globalAlpha = 0.55 + flicker * 0.25;
      ctx.fillStyle = '#f0a13a';
      ctx.fillRect(x - 4, baseY - 1, 8, 4);
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(x - 2, baseY - 1, 4, 2);
    } else {
      const height = 5 + Math.round(flicker * 3);
      ctx.globalAlpha = 0.78 + flicker * 0.18;
      ctx.fillStyle = '#d86127';
      ctx.fillRect(x - 3, baseY - height + 2, 6, height);
      ctx.fillStyle = '#f2b13d';
      ctx.fillRect(x - 2 + (flicker > 0.65 ? 1 : 0), baseY - height, 4, height - 1);
      ctx.fillStyle = '#ffe47c';
      ctx.fillRect(x - 1, baseY - height + 1, 2, Math.max(2, height - 3));
    }
    ctx.restore();
  }

  private drawHeldItem(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    weapon: ItemId,
    angle: number,
    swingPhase: number | null,
    recoil = 0,
  ) {
    const def = this.gameplayItems[weapon] ?? ITEMS[weapon];
    const isGun = !!def.weapon;
    ctx.save();
    ctx.translate(x, y + 2);
    let a = angle;
    let reach = isGun ? 10 - recoil * 4 : 8; // guns kick back into the shoulder
    if (swingPhase !== null && !isGun) {
      if (weapon === "spear") reach += spearThrust(swingPhase) * 14;
      else a += meleeSwingOffset(swingPhase);
    }
    ctx.rotate(a);
    // guns are drawn barrel-right in the sheet: keep them ON the aim line so the
    // muzzle matches the crosshair; flip vertically when aiming left so they
    // never render upside-down. Tools keep the diagonal-icon nudge.
    if (isGun) {
      if (Math.cos(angle) < 0) ctx.scale(1, -1);
      ctx.translate(reach, 0);
    } else {
      ctx.translate(reach, 0);
      ctx.rotate(Math.PI / 4);
    }
    this.blitItem(ctx, weapon, -12, -12, 24);
    ctx.restore();

    if (swingPhase !== null && !isGun && weapon !== "spear") {
      const strike = Math.max(0, Math.min(1, (swingPhase - 0.16) / 0.46));
      const trail = Math.max(0, 1 - Math.abs(swingPhase - 0.44) / 0.3);
      ctx.save();
      ctx.translate(x, y + 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.42 * trail})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, angle - 0.82, angle - 0.82 + easeOutCubic(strike) * 1.62);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawShadowAndSprite(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    row: number,
    moving: boolean,
    time: number,
    seed: number,
    frameOverride?: number,
  ) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const frame = frameOverride ?? (moving ? [1, 2, 3, 2][Math.floor(time * 9 + seed) % 4] : 0);
    const bob = this.reducedMotion ? 0 : moving ? (1 - Math.cos(time * 18 + seed)) * 0.7 : Math.sin(time * 2.1 + seed) * 0.18;
    this.blitChar(ctx, row, frame, x - 16, y - 16 - bob);
    return bob;
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: RenderPlayer,
    isYou: boolean,
    view: WorldView,
  ) {
    const seed = hashStr(p.name);
    // Character customization is temporarily dormant while the player
    // animation set is being rebuilt. Profiles retain their saved appearance,
    // but live players use one stable base row with no procedural overlays.
    const row = 0;
    const meleeVisualMs = p.weapon
      ? this.gameplayItems[p.weapon]?.melee?.cooldownMs ?? FISTS.cooldownMs
      : FISTS.cooldownMs;
    const serverSwingPhase =
      p.swing > 0 && view.serverNow - p.swing < meleeVisualMs
        ? Math.min(1, (view.serverNow - p.swing) / meleeVisualMs)
        : null;
    const localMeleeElapsed = view.time - this.localMeleeAt;
    const localMeleeDuration = meleeVisualMs / 1000;
    const localSwingPhase = isYou && localMeleeElapsed >= 0 && localMeleeElapsed < localMeleeDuration
      ? Math.min(1, localMeleeElapsed / localMeleeDuration)
      : null;
    const swingPhase = isYou && view.time < this.localMeleeSuppressUntil ? localSwingPhase : serverSwingPhase;
    const playerHitElapsed = p.hitAt ? view.serverNow - p.hitAt : Infinity;
    const playerAttackElapsed = p.attackAt
      ? view.serverNow - p.attackAt
      : localSwingPhase !== null
        ? localMeleeElapsed * 1000
        : swingPhase !== null ? view.serverNow - p.swing : Infinity;
    const playerActionState: EntityAnimationState = p.weapon ? 'attack' : 'punch';
    const playerActionDuration = this.animationDuration(
      'player',
      playerActionState,
      p.weapon ? meleeVisualMs : FISTS.cooldownMs,
    );
    const playerState: EntityAnimationState = playerHitElapsed < 300
      ? 'hit'
      : playerAttackElapsed < playerActionDuration
        ? playerActionState
        : p.moving
          ? 'walk'
          : 'idle';
    const pose = this.motionPose(p.id, p.moving, view.time, seed, p.vx, p.vy, playerHitElapsed);
    const playerElapsed = playerState === 'hit'
      ? playerHitElapsed
      : playerState === 'attack'
        ? playerAttackElapsed
        : playerState === 'walk'
          ? pose.animationElapsedMs
          : view.time * 1000;
    const fallbackFrame = this.sheetAnimationFrame('player', playerState, playerElapsed, seed);
    const bodyX = p.dx + pose.x;
    const bodyY = p.dy + pose.y;
    const playerSpriteSize = this.engineSpriteRenderSize('player') ?? { width: 32, height: 32 };
    const facingLeft = this.facesLeft(p.id, p.facing ?? p.angle);
    const drawFacing = (draw: () => void) => {
      ctx.save();
      ctx.translate(bodyX, bodyY);
      ctx.rotate(pose.lean);
      if (facingLeft) ctx.scale(-1, 1);
      ctx.translate(-bodyX, -bodyY);
      draw();
      ctx.restore();
    };
    const drawBody = () => {
      ctx.save();
      if (playerHitElapsed < 120) ctx.filter = 'brightness(1.75) saturate(0.55)';
      drawFacing(() => {
        const custom = this.drawEngineSprite(ctx, 'player', playerState, playerElapsed, seed, bodyX, bodyY);
        if (!custom) this.blitChar(ctx, row, fallbackFrame, bodyX - 16, bodyY - 16);
      });
      ctx.restore();
    };

    // swimming: half-submerged sprite + ripples instead of the normal body
    const playerTx = Math.floor(p.dx / TILE);
    const playerTy = Math.floor(p.dy / TILE);
    const authoredTerrain = this.terrainAt(playerTx, playerTy);
    const swimming = this.tileAt(playerTx, playerTy) === Tile.Water || Boolean(authoredTerrain?.swimmable);
    const footstepCadence = Math.max(190, 315 - Math.hypot(p.vx, p.vy) * 0.45);
    if (isYou && p.moving && !swimming && authoredTerrain?.footstepSound && view.serverNow - this.lastTerrainFootstepAt >= footstepCadence) {
      this.lastTerrainFootstepAt = view.serverNow;
      this.onSound?.(authoredTerrain.footstepSound, 0.35);
    }
    if (swimming) {
      ctx.save();
      ctx.strokeStyle = "rgba(220,235,245,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(
        p.dx,
        p.dy + 4,
        12 + (this.reducedMotion ? 0 : Math.sin(view.time * 4 + seed) * 2),
        4.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(
        p.dx - playerSpriteSize.width / 2 - 1,
        p.dy - playerSpriteSize.height / 2 - 1,
        playerSpriteSize.width + 2,
        playerSpriteSize.height / 2 + 7,
      ); // clip below the waterline
      ctx.clip();
      drawBody();
      ctx.restore();
      // nameplate still renders below
    }
    if (!swimming) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(
        p.dx,
        p.dy + Math.max(14, playerSpriteSize.height * .28),
        Math.max(9, playerSpriteSize.width * .22) * pose.shadowScale,
        3.5 * pose.shadowScale,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      drawBody();
    }

    // armor overlays
    ctx.save();
    if (playerHitElapsed < 120) ctx.filter = 'brightness(1.75) saturate(0.55)';
    if (!swimming && p.helmet) {
      ctx.fillStyle = p.helmet === "helmet_military" ? "#44513a" : "#8a8a92";
      ctx.fillRect(bodyX - 7, bodyY - playerSpriteSize.height / 2 + 4, 14, 5);
    }
    if (!swimming && p.vest) {
      ctx.fillStyle = p.vest === "vest_military" ? "#3c4834" : "#867454";
      ctx.fillRect(bodyX - 8, bodyY - 4, 16, 7);
    }
    ctx.restore();

    if (p.weapon && !swimming) {
      const recoil = isYou && view.time < this.kickUntil ? (this.kickUntil - view.time) / 0.09 : 0;
      this.drawHeldItem(ctx, bodyX, bodyY, p.weapon, p.angle, swingPhase, recoil);
    }

    // nameplate — only nearby or friends (positional info discipline)
    const you = view.players.find((v) => v.id === view.youId);
    const distToYou = you ? Math.hypot(p.dx - you.dx, p.dy - you.dy) : 0;
    const isFriend = view.friendNames.has(p.name);
    if (isYou || isFriend || distToYou < NAMEPLATE_RANGE) {
      const nameplateOffset = Math.max(22, playerSpriteSize.height / 2 + 4);
      const nameplateY = p.dy - nameplateOffset;
      const healthY = nameplateY + 1.5;
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      const nameplate = p.admin ? `[ADMIN] ${p.name}` : p.name;
      ctx.fillStyle = p.admin ? "#68d5f0" : isYou ? "#f0dfa0" : isFriend ? "#a8e0a0" : "#dcd8c8";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText(nameplate, p.dx, nameplateY);
      ctx.fillText(nameplate, p.dx, nameplateY);

      const hpw = 20;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(p.dx - hpw / 2, healthY, hpw, 2.5);
      ctx.fillStyle = p.hp > 50 ? "#7fb069" : p.hp > 25 ? "#d8a24a" : "#c25047";
      ctx.fillRect(p.dx - hpw / 2, healthY, (hpw * p.hp) / p.maxHp, 2.5);
    }
  }

  private drawEnemy(
    ctx: CanvasRenderingContext2D,
    e: RenderEnemy,
    view: WorldView,
  ) {
    const time = view.time;
    const seed = hashStr(e.id);
    const attackElapsed = e.attackAt ? view.serverNow - e.attackAt : Infinity;
    const hitElapsed = e.hitAt ? view.serverNow - e.hitAt : Infinity;
    const attackState: EntityAnimationState = e.kind === 'military' ? 'attack' : 'punch';
    const attackDuration = this.animationDuration(`mob:${e.kind}`, attackState, e.kind === 'military' ? 700 : 500);
    const state: EntityAnimationState = hitElapsed < 300
      ? 'hit'
      : attackElapsed < attackDuration
        ? attackState
        : e.moving
          ? 'walk'
          : 'idle';
    const pose = this.motionPose(e.id, e.moving, time, seed, e.vx, e.vy, hitElapsed);
    const elapsed = state === 'hit'
      ? hitElapsed
      : state === 'attack'
        ? attackElapsed
        : state === 'walk'
          ? pose.animationElapsedMs
          : time * 1000;
    const previousSoundState = this.entitySoundStates.get(e.id);
    if (previousSoundState !== state) {
      this.entitySoundStates.set(e.id, state);
      const soundAction = state === 'attack' || state === 'punch' ? 'attack' : state === 'hit' ? 'hit' : state === 'idle' && previousSoundState === undefined ? undefined : state === 'idle' ? 'idle' : undefined;
      const cue = soundAction ? this.visuals.mobSounds?.[e.kind]?.[soundAction] : undefined;
      if (cue) this.onSound?.(cue, 0.55);
    }
    const ANIMAL_ROWS: Partial<Record<string, number>> = {
      deer: CHAR_ROWS.deer,
      rabbit: CHAR_ROWS.rabbit,
      boar: CHAR_ROWS.boar,
      wolf: CHAR_ROWS.wolf,
      fox: CHAR_ROWS.fox,
      bear: CHAR_ROWS.bear,
      moose: CHAR_ROWS.moose,
      raccoon: CHAR_ROWS.raccoon,
      cougar: CHAR_ROWS.cougar,
    };
    const animalRow = ANIMAL_ROWS[e.kind];
    const bodyX = e.dx + pose.x;
    const bodyY = e.dy + pose.y;
    const enemySpriteSize = this.engineSpriteRenderSize(`mob:${e.kind}`) ?? { width: 32, height: 32 };
    const shadowWidth =
      e.kind === 'rabbit' || e.kind === 'raccoon' ? 6
      : e.kind === 'bear' || e.kind === 'moose' ? 12
      : animalRow !== undefined ? 10
      : 9;
    if (e.boss) {
      const pulse = 0.5 + Math.sin(time * 5 + seed) * 0.5;
      ctx.strokeStyle = `rgba(240, 90, 74, ${0.38 + pulse * 0.42})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(e.dx, e.dy + 4, 21 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = "rgba(0,0,0,0.27)";
    ctx.beginPath();
    ctx.ellipse(e.dx, e.dy + 13, shadowWidth * pose.shadowScale, 3 * pose.shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(bodyX, bodyY);
    ctx.rotate(pose.lean);
    if (e.boss) ctx.scale(1.25, 1.25);
    if (this.facesLeft(e.id, e.angle)) ctx.scale(-1, 1);
    if (hitElapsed < 120) ctx.filter = 'brightness(1.8) saturate(0.45)';
    const custom = this.drawEngineSprite(ctx, `mob:${e.kind}`, state, elapsed, seed, 0, 0);
    if (!custom) {
      const row = animalRow ?? (e.kind === "zombie" ? CHAR_ROWS.zombie : CHAR_ROWS.military);
      this.blitChar(ctx, row, this.sheetAnimationFrame(`mob:${e.kind}`, state, elapsed, seed), -16, -16);
    }
    ctx.restore();
    if (e.kind === "military")
      this.drawHeldItem(ctx, bodyX, bodyY, "rifle", e.angle, null);

    if (e.hp < e.maxHp || e.boss) {
      const hpw = e.boss ? 46 : 20;
      const spriteScale = e.boss ? 1.25 : 1;
      const healthOffset = Math.max(e.boss ? 27 : 21, enemySpriteSize.height * spriteScale / 2 + 3);
      const healthY = e.dy - healthOffset;
      if (e.boss) {
        ctx.font = '700 8px monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(e.boss.name, e.dx, healthY - 4);
        ctx.fillStyle = '#ffb0a2';
        ctx.fillText(e.boss.name, e.dx, healthY - 4);
      }
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.dx - hpw / 2, healthY, hpw, e.boss ? 4 : 2.5);
      ctx.fillStyle =
        e.boss ? "#db4d3f"
        : e.kind === "zombie" ? "#7fa062"
        : e.kind === "wolf" || e.kind === "bear" || e.kind === "cougar" || e.kind === "moose" ? "#a04040"
        : animalRow !== undefined ? "#c8a878"
        : "#c07a4a";
      ctx.fillRect(e.dx - hpw / 2, healthY, (hpw * e.hp) / e.maxHp, e.boss ? 4 : 2.5);
    }
  }

  private drawExtract(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    time: number,
  ) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    ctx.save();
    // ground pad
    ctx.fillStyle = "rgba(60, 200, 110, 0.12)";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(95, 240, 138, ${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(x, y, 16 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // beacon post + light
    ctx.fillStyle = "#3a4a3e";
    ctx.fillRect(x - 2, y - 18, 4, 18);
    ctx.fillStyle = `rgba(95, 240, 138, ${0.6 + pulse * 0.4})`;
    ctx.fillRect(x - 3, y - 24, 6, 7);
    // rising smoke-flare particles
    const fy = (time * 22) % 26;
    ctx.globalAlpha = Math.max(0, 0.55 - fy / 40);
    ctx.fillStyle = "#8af0a8";
    ctx.fillRect(x - 1 + Math.sin(time * 2) * 3, y - 24 - fy, 2, 2);
    ctx.globalAlpha = 1;
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#8af0a8";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeText("EXTRACT", x, y - 30);
    ctx.fillText("EXTRACT", x, y - 30);
    ctx.restore();
  }

  private drawTrader(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    time: number,
  ) {
    const profile = this.visuals.animations?.trader;
    const hasPublishedTrader = !!profile && !!this.visualFrames.get(profile.spriteId)?.length;
    if (hasPublishedTrader) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(x, y + 14, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawEngineSprite(ctx, "trader", "idle", time * 1000, 7, x, y);
    } else {
      this.drawShadowAndSprite(ctx, x, y, CHAR_ROWS.trader, false, time, 7);
    }
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#d8c26a";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.strokeText("TRADER", x, y - 22);
    ctx.fillText("TRADER", x, y - 22);
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, pr: ProjectileSnap) {
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.rotate(pr.angle);
    ctx.fillStyle = "#f5ecc8";
    ctx.fillRect(-6, -1, 8, 2);
    ctx.fillStyle = "#d8a24a";
    ctx.fillRect(-2, -1, 4, 2);
    ctx.restore();
  }

  private drawFloat(ctx: CanvasRenderingContext2D, f: DamageFloat) {
    const rise = f.age * 18;
    const alpha = 1 - f.age;
    ctx.font = f.kind === "xp" ? "bold 8px monospace" : "bold 9px monospace";
    ctx.textAlign = "center";
    const text =
      f.kind === "xp" ? `+${f.amount} ${f.label ?? "xp"}`
      : f.kind === "node" ? `+${f.amount}`
      : `-${f.amount}`;
    const color =
      f.kind === "xp"
        ? `rgba(120,210,230,${alpha})`
        : f.kind === "node"
          ? `rgba(150,230,120,${alpha})`
          : f.kind === "enemy"
            ? `rgba(255,225,130,${alpha})`
            : `rgba(255,110,100,${alpha})`;
    ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.strokeText(text, f.x, f.y - 14 - rise);
    ctx.fillStyle = color;
    ctx.fillText(text, f.x, f.y - 14 - rise);
  }
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function meleeSwingOffset(t: number): number {
  if (t < 0.18) return -0.78 * easeInCubic(t / 0.18);
  if (t < 0.62) return -0.78 + 1.62 * easeOutCubic((t - 0.18) / 0.44);
  return 0.84 * (1 - easeOutCubic((t - 0.62) / 0.38));
}

function spearThrust(t: number): number {
  if (t < 0.18) return -0.16 * easeInCubic(t / 0.18);
  if (t < 0.58) return -0.16 + 1.16 * easeOutCubic((t - 0.18) / 0.4);
  return 1 - easeOutCubic((t - 0.58) / 0.42);
}

/** tiles.png column for a structure tile (for the build ghost); -1 = no sprite. */
function tileSpriteCol(tile: number): number {
  switch (tile) {
    case Tile.Workbench: return 14;
    case Tile.Firepit: return 15;
    case Tile.Furnace: return 16;
    case Tile.WoodFloor: return 19;
    case Tile.StoneFloor: return 20;
    case Tile.WoodWall: return 21;
    case Tile.Door: return 22;
    case Tile.Fence: return 23;
    case Tile.Torch: return 24;
    case Tile.Anvil: return 27;
    case Tile.Bed: return 13;
    default: return -1; // chest has no tile sprite; ghost falls back to the green box
  }
}
