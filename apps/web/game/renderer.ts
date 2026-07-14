import {
  BLOCKS_BULLET,
  DEFAULT_TERRAIN_ID_BY_TILE,
  DEFAULT_CHARACTER_APPEARANCE,
  ContainerSnap,
  EntityDeathSnap,
  EnemySnap,
  GroundItemSnap,
  HitSnap,
  ITEMS,
  ItemId,
  NAMEPLATE_RANGE,
  PlayerSnap,
  PoiSnap,
  ProjectileSnap,
  RuntimeVisualContent,
  EntityAnimationState,
  TILE,
  Tile,
} from "@holdout/shared";
import { drawCharacterAppearance } from "./character-appearance";
import { CHAR_ROWS, ITEM_INDEX, Sheets } from "./sprites";

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
}

export interface RenderEnemy extends EnemySnap {
  dx: number;
  dy: number;
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
interface FallingTree {
  tx: number;
  ty: number;
  t0: number;
  dir: number;
}
interface Corpse {
  x: number;
  y: number;
  row: number;
  target?: string;
  t0: number;
}

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
  zoom = 2;

  private particles: Particle[] = [];
  private flashes: Flash[] = [];
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

  private unders: Map<number, number>;
  private visualFrames = new Map<string, HTMLCanvasElement[]>();
  private animationSoundSteps = new Map<string, string>();
  private entitySoundStates = new Map<string, EntityAnimationState>();
  private lastTerrainFootstepAt = 0;
  private openDoors = new Set<number>();

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
    private onSound?: (soundId: string, volume: number) => void,
  ) {
    this.openDoors = new Set(initialOpenDoors);
    this.unders = new Map(Object.entries(unders).map(([k, v]) => [Number(k), v]));
    if (this.elevations.length !== w * h) this.elevations = new Uint8Array(w * h);
    this.buildVisualFrames();
    this.mapCanvas = w <= 512 && h <= 512 ? document.createElement("canvas") : null;
    if (this.mapCanvas) {
      this.mapCanvas.width = w * TILE;
      this.mapCanvas.height = h * TILE;
    }
    this.miniCanvas = document.createElement("canvas");
    this.miniCanvas.width = Math.min(512, w);
    this.miniCanvas.height = Math.min(512, h);
    this.prerender();
  }

  private buildVisualFrames() {
    this.visualFrames.clear();
    for (const [id, asset] of Object.entries(this.visuals.assets ?? {})) {
      const frames = asset.frames?.length ? asset.frames : asset.pixels?.length ? [asset.pixels] : [];
      const canvases = frames.filter((frame) => frame.length === asset.width * asset.height).map((frame) => {
        const canvas = document.createElement('canvas');
        canvas.width = asset.width; canvas.height = asset.height;
        const ctx = canvas.getContext('2d')!;
        frame.forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(index % asset.width, Math.floor(index / asset.width), 1, 1); });
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

  applyBlock(index: number, blockId?: string, rotation = 0, open?: boolean) {
    if (blockId) this.blockKinds[String(index)] = blockId;
    else delete this.blockKinds[String(index)];
    rotation = ((rotation | 0) % 4 + 4) % 4;
    if (blockId && rotation) this.blockRotations[String(index)] = rotation;
    else delete this.blockRotations[String(index)];
    if (!blockId || open === false) this.openDoors.delete(index);
    else if (open === true) this.openDoors.add(index);
    const context = this.miniCanvas.getContext('2d');
    if (!context) return;
    const x = index % this.w; const y = Math.floor(index / this.w);
    const mapContext = this.mapCanvas?.getContext('2d');
    if (mapContext) { this.drawTerrainCell(mapContext, x, y); this.drawFoundationLayer(mapContext, x, y); }
    this.updateMinimapCell(x, y, blockId ? '#b58b45' : undefined);
  }

  playerBlockId(buildType: string): string | undefined {
    return Object.values(this.visuals.blocks ?? {}).find((block) => block.playerPlacement?.buildType === buildType)?.id;
  }

  entityDeath(death: EntityDeathSnap) {
    this.corpses.push({
      x: death.x,
      y: death.y,
      row: death.fallbackRow,
      target: death.target,
      t0: this.lastTime,
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
      const shifted = Math.max(0, elapsedMs + (clip.loop === false ? 0 : seed * 17));
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
    const phaseMs = clip?.loop === false ? elapsedMs : elapsedMs + seed * 17;
    const step = Math.max(0, Math.floor(phaseMs / Math.max(16, clip?.frameMs ?? 125)));
    const at = clip?.loop === false ? Math.min(sequence.length - 1, step) : step % sequence.length;
    return Math.max(0, Math.min(totalFrames - 1, sequence[at] ?? 0));
  }

  private drawResourceSprite(ctx: CanvasRenderingContext2D, spriteId: string | undefined, x: number, y: number, shakeX: number): boolean {
    const frame = spriteId ? this.visualFrames.get(spriteId)?.[0] : undefined;
    if (!frame) return false;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x - frame.width + shakeX, y - frame.height * 2, frame.width * 2, frame.height * 2);
    return true;
  }

  private drawWorldBlock(ctx: CanvasRenderingContext2D, blockId: string, x: number, y: number, rotation = 0) {
    const block = this.visuals.blocks?.[blockId];
    if (!block) return;
    const frame = this.visualFrames.get(block.spriteId)?.[0];
    if (frame) {
      const width = frame.width * 2 * block.scale;
      const height = frame.height * 2 * block.scale;
      const quarterTurn = ((rotation % 4) + 4) % 4;
      const renderedHeight = quarterTurn % 2 ? width : height;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.translate(x, y - renderedHeight / 2 - block.offsetY);
      ctx.rotate(quarterTurn * Math.PI / 2);
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x - frame.width, y - frame.height, frame.width * 2, frame.height * 2);
    return true;
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
    id: ItemId,
    dx: number,
    dy: number,
    size = TILE,
  ) {
    const i = ITEM_INDEX[id] ?? 0;
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

  /** Server changed a tile (harvest / regrowth / build). `under` = floor beneath a station. */
  applyTile(i: number, tile: number, under?: number) {
    const old = this.tiles[i];
    this.tiles[i] = tile;
    if (under !== undefined) this.unders.set(i, under);
    else this.unders.delete(i);
    this.fogVersion++; // sightlines may have changed
    const tx = i % this.w;
    const ty = Math.floor(i / this.w);
    if (old === Tile.Tree && tile === Tile.Grass) {
      this.falling.push({
        tx,
        ty,
        t0: this.lastTime,
        dir: hash2(tx, ty) < 0.5 ? -1 : 1,
      });
      this.burst(
        tx * TILE + 16,
        ty * TILE + 8,
        ["#3d7542", "#2e5e33", "#5c3f26"],
        14,
        60,
      );
    } else if (old === Tile.Rock && tile === Tile.Grass) {
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

    // muzzle flashes + gunfeel from newly-seen projectiles
    const seen = new Set<number>();
    for (const pr of view.projectiles) {
      seen.add(pr.id);
      if (!this.prevProj.has(pr.id)) {
        this.flashes.push({ x: pr.x, y: pr.y, angle: pr.angle, t0: view.time });
        if (you && Math.hypot(pr.x - you.dx, pr.y - you.dy) < 34) {
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
        });
        this.burst(p.dx, p.dy, ["#a83232", "#7c1f1f"], 14, 80);
      }
      this.prevDead.set(p.id, p.dead);
    }

    for (const g of view.ground) this.drawGroundItem(ctx, g, view.time);
    for (const c of view.containers) this.drawContainer(ctx, c);

    // aim line for your own equipped gun (Zero Sievert style)
    if (you && !you.dead && you.weapon && ITEMS[you.weapon].weapon) {
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
    this.corpses = this.corpses.filter((c) => view.time - c.t0 < 2);
    for (const c of this.corpses) {
      const age = (view.time - c.t0) / 2;
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - age);
      const custom = c.target
        ? this.drawEngineSprite(ctx, c.target, 'death', (view.time - c.t0) * 1000, 0, c.x, c.y)
        : false;
      if (!custom) {
        ctx.translate(c.x, c.y + 6);
        ctx.rotate(Math.PI / 2);
        this.blitChar(ctx, c.row, 0, -16, -16);
      }
      ctx.restore();
    }

    // y-sorted world entities: trees, rocks, players, enemies, traders, falling trees
    type Drawable = { y: number; fn: () => void };
    const drawables: Drawable[] = [];

    const tMinX = Math.max(0, Math.floor(sx / TILE));
    const tMaxX = Math.min(this.w - 1, Math.ceil((sx + sw) / TILE));
    const tMinY = Math.max(0, Math.floor(sy / TILE));
    const tMaxY = Math.min(this.h - 1, Math.ceil((sy + sh) / TILE));
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
              if (this.drawResourceSprite(ctx, resource?.spriteId, dx + TILE / 2, dy + TILE, shakeX)) return;
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
          const rotation = (this.blockRotations[String(index)] ?? 0) + (this.openDoors.has(index) && block.playerPlacement?.buildType === 'door' ? 1 : 0);
          drawables.push({ y: by, fn: () => this.drawWorldBlock(ctx, blockId, cx, by, rotation) });
        }
      }

    this.falling = this.falling.filter((f) => view.time - f.t0 < 0.7);
    for (const f of this.falling) {
      const t01 = (view.time - f.t0) / 0.7;
      const cx = f.tx * TILE + TILE / 2;
      const by = f.ty * TILE + TILE - 2;
      drawables.push({
        y: by,
        fn: () =>
          this.drawTreeSprite(
            ctx,
            cx,
            by,
            f.dir * t01 * t01 * (Math.PI / 2),
            1 - t01 * t01,
          ),
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

    for (const pr of view.projectiles) this.drawProjectile(ctx, pr);

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
      ctx.fillStyle = "rgba(6, 8, 12, 0.42)";
      for (const i of this.fogBlocked) {
        const tx = i % this.w;
        const ty = Math.floor(i / this.w);
        if (tx < tMinX || tx > tMaxX || ty < tMinY || ty > tMaxY) continue;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
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

    // warm light halos from torches and firepits once it gets dark
    const darknessNow = (1 - (0.5 - 0.5 * Math.cos(view.day * Math.PI * 2))) * 0.55;
    if (darknessNow > 0.12) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let ty = tMinY; ty <= tMaxY; ty++)
        for (let tx = tMinX; tx <= tMaxX; tx++) {
          const t = this.tileAt(tx, ty);
          if (t !== Tile.Torch && t !== Tile.Firepit) continue;
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          const flicker = 0.85 + 0.15 * Math.sin(view.time * 9 + tx * 3 + ty * 7);
          const r = (t === Tile.Firepit ? 120 : 90) * flicker;
          const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
          const a = Math.min(0.5, darknessNow) * flicker;
          g.addColorStop(0, `rgba(255, 180, 80, ${0.5 * a})`);
          g.addColorStop(0.5, `rgba(255, 140, 50, ${0.22 * a})`);
          g.addColorStop(1, "rgba(255, 120, 40, 0)");
          ctx.fillStyle = g;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
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

    this.drawNight(ctx, w, h, view.day);
  }

  private drawNight(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    day: number,
  ) {
    const brightness = 0.5 - 0.5 * Math.cos(day * Math.PI * 2);
    const darkness = (1 - brightness) * 0.68; // real nights are dark — bring a torch
    // golden-hour tint around sunrise (~0.25) and sunset (~0.75)
    const dusk = Math.max(
      0,
      1 - Math.abs(day - 0.77) / 0.07,
      1 - Math.abs(day - 0.23) / 0.07,
    );
    if (dusk > 0) {
      ctx.fillStyle = `rgba(255, 130, 50, ${dusk * 0.1})`;
      ctx.fillRect(0, 0, w, h);
    }
    // Zero Sievert-ish permanent edge vignette + night darkness
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      80,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    );
    grad.addColorStop(0, `rgba(8, 12, 26, ${Math.max(0.05, darkness * 0.6)})`);
    grad.addColorStop(1, `rgba(4, 6, 16, ${Math.max(0.28, darkness)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  drawMinimap(
    ctx: CanvasRenderingContext2D,
    size: number,
    view: {
      pois: PoiSnap[];
      players: RenderPlayer[];
      youId: string;
      friendNames: Set<string>;
    },
    detailed = false,
  ) {
    const s = size / Math.max(this.w, this.h);
    const mapWidth = this.w * s;
    const mapHeight = this.h * s;
    const offsetX = (size - mapWidth) / 2;
    const offsetY = (size - mapHeight) / 2;
    const point = (x: number, y: number) => ({ x: offsetX + (x / TILE) * s, y: offsetY + (y / TILE) * s });
    const markerScale = detailed ? Math.max(1.5, Math.min(2.5, size / 320)) : 1;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#080a07';
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.miniCanvas, offsetX, offsetY, mapWidth, mapHeight);
    ctx.globalAlpha = 1;

    if (detailed) {
      ctx.strokeStyle = 'rgba(220, 210, 170, 0.11)';
      ctx.lineWidth = 1;
      for (let section = 1; section < 8; section++) {
        const x = offsetX + mapWidth * (section / 8);
        const y = offsetY + mapHeight * (section / 8);
        ctx.beginPath();
        ctx.moveTo(x, offsetY);
        ctx.lineTo(x, offsetY + mapHeight);
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + mapWidth, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(220, 210, 170, 0.42)';
      ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, mapWidth - 1, mapHeight - 1);
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
        ctx.arc(x, y, (poi.r / TILE) * s, 0, Math.PI * 2);
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
    for (const tr of this.traders) {
      const { x, y } = point(tr.x, tr.y);
      const marker = detailed ? 4 : 1.5;
      ctx.fillStyle = "#d8c26a";
      ctx.fillRect(x - marker, y - marker, marker * 2, marker * 2);
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
      ctx.fillStyle = isYou ? "#f0d878" : isFriend ? "#78d878" : "#e8e8e8";
      ctx.beginPath();
      ctx.arc(x, y, detailed ? (isYou ? 6 : 4) : (isYou ? 2.5 : 1.8), 0, Math.PI * 2);
      ctx.fill();
      if (isYou || (isFriend && !isYou)) {
        ctx.strokeStyle = isYou ? 'rgba(240, 216, 120, 0.55)' : "rgba(120, 216, 120, 0.7)";
        ctx.lineWidth = detailed ? 2 : 1;
        if (detailed && isYou) {
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
    }
  }

  // ── entity painters ─────────────────────────────────────────────────────

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
      ctx.fillStyle = c.looted ? "#565b4d" : "#47563a";
      ctx.fillRect(x - 12, y - 9, 24, 17);
      ctx.fillStyle = c.looted ? "#63685a" : "#576a45";
      ctx.fillRect(x - 12, y - 9, 24, 5);
      ctx.strokeStyle = "#20281a";
      ctx.strokeRect(x - 12.5, y - 9.5, 25, 18);
      ctx.fillStyle = "#d8d2b8";
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("★", x, y + 2);
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
      ctx.fillStyle = "#403a30";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#524a3d";
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

  private drawHeldItem(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    weapon: ItemId,
    angle: number,
    swingPhase: number | null,
    recoil = 0,
  ) {
    const def = ITEMS[weapon];
    const isGun = !!def.weapon;
    ctx.save();
    ctx.translate(x, y + 2);
    let a = angle;
    let reach = isGun ? 10 - recoil * 4 : 8; // guns kick back into the shoulder
    if (swingPhase !== null && !isGun) {
      if (weapon === "spear") reach += Math.sin(swingPhase * Math.PI) * 14;
      else a += -0.9 + easeOut(swingPhase) * 1.6;
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
      ctx.save();
      ctx.translate(x, y + 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - swingPhase)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, angle - 0.8, angle - 0.8 + easeOut(swingPhase) * 1.6);
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
    const frame = frameOverride ?? (moving ? Math.floor(time * 8 + seed) % 2 : 0);
    const bob = moving ? Math.abs(Math.sin(time * 10 + seed)) * 1.5 : 0;
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
    const appearance = p.appearance ?? {
      ...DEFAULT_CHARACTER_APPEARANCE,
      outfit: p.look !== undefined ? p.look % CHAR_ROWS.survivorCount : seed % CHAR_ROWS.survivorCount,
    };
    const row = appearance.outfit % CHAR_ROWS.survivorCount;
    const swingPhase =
      p.swing > 0 && view.serverNow - p.swing < 400
        ? Math.min(1, (view.serverNow - p.swing) / 400)
        : null;
    const playerHitElapsed = p.hitAt ? view.serverNow - p.hitAt : Infinity;
    const playerAttackElapsed = p.attackAt ? view.serverNow - p.attackAt : swingPhase !== null ? view.serverNow - p.swing : Infinity;
    const playerState: EntityAnimationState = playerHitElapsed < 300 ? 'hit' : playerAttackElapsed < 700 ? 'attack' : p.moving ? 'walk' : 'idle';
    const playerElapsed = playerState === 'hit' ? playerHitElapsed : playerState === 'attack' ? playerAttackElapsed : view.time * 1000;
    const fallbackFrame = this.animationFrame('player', playerState, playerElapsed, seed, 2);
    const drawFacing = (draw: () => void) => {
      ctx.save();
      if (Math.cos(p.facing ?? p.angle) < 0) { ctx.translate(p.dx * 2, 0); ctx.scale(-1, 1); }
      draw();
      ctx.restore();
    };

    // swimming: half-submerged sprite + ripples instead of the normal body
    const playerTx = Math.floor(p.dx / TILE);
    const playerTy = Math.floor(p.dy / TILE);
    const authoredTerrain = this.terrainAt(playerTx, playerTy);
    const swimming = this.tileAt(playerTx, playerTy) === Tile.Water || Boolean(authoredTerrain?.swimmable);
    if (isYou && p.moving && !swimming && authoredTerrain?.footstepSound && view.serverNow - this.lastTerrainFootstepAt >= 340) {
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
        12 + Math.sin(view.time * 4 + seed) * 2,
        4.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(p.dx - 16, p.dy - 16, 32, 22); // clip below the waterline
      ctx.clip();
      drawFacing(() => {
        const custom = this.drawEngineSprite(ctx, 'player', playerState, playerElapsed, seed, p.dx, p.dy);
        if (!custom) this.blitChar(ctx, row, fallbackFrame, p.dx - 16, p.dy - 16);
        drawCharacterAppearance(ctx, appearance, p.dx - 16, p.dy - 16, 2, Boolean(p.helmet));
      });
      ctx.restore();
      // nameplate still renders below
    }
    let bob = 0;
    if (!swimming) {
      bob = p.moving ? Math.abs(Math.sin(view.time * 10 + seed)) * 1.5 : 0;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(p.dx, p.dy + 14, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      drawFacing(() => {
        const custom = this.drawEngineSprite(ctx, 'player', playerState, playerElapsed, seed, p.dx, p.dy - bob);
        if (!custom) this.blitChar(ctx, row, fallbackFrame, p.dx - 16, p.dy - 16 - bob);
        drawCharacterAppearance(ctx, appearance, p.dx - 16, p.dy - 16 - bob, 2, Boolean(p.helmet));
      });
    }

    // armor overlays
    if (!swimming && p.helmet) {
      ctx.fillStyle = p.helmet === "helmet_military" ? "#44513a" : "#8a8a92";
      ctx.fillRect(p.dx - 7, p.dy - 16 - bob, 14, 5);
    }
    if (!swimming && p.vest) {
      ctx.fillStyle = p.vest === "vest_military" ? "#3c4834" : "#867454";
      ctx.fillRect(p.dx - 8, p.dy - 4 - bob, 16, 7);
    }

    if (p.weapon && !swimming) {
      const recoil = isYou && view.time < this.kickUntil ? (this.kickUntil - view.time) / 0.09 : 0;
      this.drawHeldItem(ctx, p.dx, p.dy, p.weapon, p.angle, swingPhase, recoil);
    } else if (swingPhase !== null && !swimming) {
      // bare-fist jab, alternating hands
      const side = Math.floor(p.swing / 400) & 1 ? 1 : -1;
      const ext = Math.sin(swingPhase * Math.PI) * 12;
      ctx.save();
      ctx.translate(p.dx, p.dy + 2);
      ctx.rotate(p.angle);
      ctx.fillStyle = "#d8a878";
      ctx.fillRect(6 + ext, side * 4 - 2, 5, 4);
      ctx.restore();
    }

    // nameplate — only nearby or friends (positional info discipline)
    const you = view.players.find((v) => v.id === view.youId);
    const distToYou = you ? Math.hypot(p.dx - you.dx, p.dy - you.dy) : 0;
    const isFriend = view.friendNames.has(p.name);
    if (isYou || isFriend || distToYou < NAMEPLATE_RANGE) {
      ctx.font = "7px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = isYou ? "#f0dfa0" : isFriend ? "#a8e0a0" : "#dcd8c8";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText(p.name, p.dx, p.dy - 22);
      ctx.fillText(p.name, p.dx, p.dy - 22);

      const hpw = 20;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(p.dx - hpw / 2, p.dy - 20.5, hpw, 2.5);
      ctx.fillStyle = p.hp > 50 ? "#7fb069" : p.hp > 25 ? "#d8a24a" : "#c25047";
      ctx.fillRect(p.dx - hpw / 2, p.dy - 20.5, (hpw * p.hp) / p.maxHp, 2.5);
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
    const state: EntityAnimationState = hitElapsed < 300 ? 'hit' : attackElapsed < 700 ? 'attack' : e.moving ? 'walk' : 'idle';
    const elapsed = state === 'hit' ? hitElapsed : state === 'attack' ? attackElapsed : time * 1000;
    const previousSoundState = this.entitySoundStates.get(e.id);
    if (previousSoundState !== state) {
      this.entitySoundStates.set(e.id, state);
      const soundAction = state === 'attack' ? 'attack' : state === 'hit' ? 'hit' : state === 'idle' && previousSoundState === undefined ? undefined : state === 'idle' ? 'idle' : undefined;
      const cue = soundAction ? this.visuals.mobSounds?.[e.kind]?.[soundAction] : undefined;
      if (cue) this.onSound?.(cue, 0.55);
    }
    const custom = this.drawEngineSprite(ctx, `mob:${e.kind}`, state, elapsed, seed, e.dx, e.dy);
    const ANIMAL_ROWS: Partial<Record<string, number>> = {
      deer: CHAR_ROWS.deer,
      rabbit: CHAR_ROWS.rabbit,
      boar: CHAR_ROWS.boar,
      wolf: CHAR_ROWS.wolf,
    };
    const animalRow = ANIMAL_ROWS[e.kind];
    if (!custom && animalRow !== undefined) {
      // quadruped: flip toward its heading so it runs the right way
      ctx.save();
      ctx.translate(e.dx, e.dy);
      if (Math.cos(e.angle) < 0) ctx.scale(-1, 1);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 13, e.kind === "rabbit" ? 6 : 10, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      const frame = this.animationFrame(`mob:${e.kind}`, state, elapsed, seed, 2);
      this.blitChar(ctx, animalRow, frame, -16, -16);
      ctx.restore();
    } else if (!custom) {
      this.drawShadowAndSprite(
        ctx,
        e.dx,
        e.dy,
        e.kind === "zombie" ? CHAR_ROWS.zombie : CHAR_ROWS.military,
        e.moving,
        e.kind === "zombie" ? time * 0.7 : time,
        seed,
        this.animationFrame(`mob:${e.kind}`, state, elapsed, seed, 2),
      );
    }
    if (e.kind === "military")
      this.drawHeldItem(ctx, e.dx, e.dy, "rifle", e.angle, null);

    if (e.hp < e.maxHp) {
      const hpw = 20;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.dx - hpw / 2, e.dy - 21, hpw, 2.5);
      ctx.fillStyle =
        e.kind === "zombie" ? "#7fa062"
        : e.kind === "wolf" ? "#a04040"
        : animalRow !== undefined ? "#c8a878"
        : "#c07a4a";
      ctx.fillRect(e.dx - hpw / 2, e.dy - 21, (hpw * e.hp) / e.maxHp, 2.5);
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
    this.drawShadowAndSprite(ctx, x, y, CHAR_ROWS.trader, false, time, 7);
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

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
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
