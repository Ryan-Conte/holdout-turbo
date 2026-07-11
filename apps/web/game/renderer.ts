import {
  ContainerSnap,
  EnemySnap,
  GroundItemSnap,
  HitSnap,
  ITEMS,
  ItemId,
  NAMEPLATE_RANGE,
  PlayerSnap,
  PoiSnap,
  ProjectileSnap,
  TILE,
  Tile,
} from "@holdout/shared";
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
  ghost: { tile: number; tx: number; ty: number; valid: boolean } | null; // build placement preview
  highlight: { x: number; y: number } | null; // nearest interactable — pulsing ring
  demolish: { tx: number; ty: number; valid: boolean } | null; // demolish-mode tile marker
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
};

export class Renderer {
  private mapCanvas: HTMLCanvasElement;
  private miniCanvas: HTMLCanvasElement;
  zoom = 2;

  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private falling: FallingTree[] = [];
  private corpses: Corpse[] = [];
  private shakes = new Map<number, number>(); // tile idx -> shake start (time s)
  private prevProj = new Set<number>();
  private prevDead = new Map<string, boolean>();
  private lastTime = 0;
  private kickUntil = 0;
  private kickAngle = 0;

  constructor(
    private tiles: number[],
    private w: number,
    private h: number,
    private sheets: Sheets,
    private pois: PoiSnap[],
    private traders: { x: number; y: number }[],
    private exit: { x: number; y: number } | null,
    private extracts: { x: number; y: number }[] = [],
  ) {
    this.mapCanvas = document.createElement("canvas");
    this.mapCanvas.width = w * TILE;
    this.mapCanvas.height = h * TILE;
    this.miniCanvas = document.createElement("canvas");
    this.miniCanvas.width = w;
    this.miniCanvas.height = h;
    this.prerender();
  }

  private tileAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Tile.Tree;
    return this.tiles[y * this.w + x];
  }

  /** Public read of the live tile map (used by the client for build validity). */
  tileAtPublic(x: number, y: number): number {
    return this.tileAt(x, y);
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
    const ctx = this.mapCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) this.drawBaseTile(ctx, tx, ty);

    // safe zone markers baked into the ground
    for (const poi of this.pois) {
      if (!poi.safe) continue;
      ctx.save();
      ctx.strokeStyle = "rgba(150, 200, 130, 0.35)";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(poi.x, poi.y, poi.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const mctx = this.miniCanvas.getContext("2d")!;
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        mctx.fillStyle = MINI_COLORS[this.tileAt(tx, ty)] ?? "#000";
        mctx.fillRect(tx, ty, 1, 1);
      }
  }

  private drawBaseTile(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
    const t = this.tileAt(tx, ty);
    const dx = tx * TILE;
    const dy = ty * TILE;
    switch (t) {
      case Tile.Grass:
      case Tile.Tree:
      case Tile.Rock:
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
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        this.blitTile(ctx, 14, dx, dy);
        break;
      }
      case Tile.Firepit: {
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
        this.blitTile(ctx, 15, dx, dy);
        break;
      }
      case Tile.Furnace: {
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
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
        this.blitTile(ctx, hash2(tx, ty) < 0.5 ? 0 : 1, dx, dy);
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
        this.blitTile(ctx, 23, dx, dy);
        break;
      case Tile.Torch:
        this.blitTile(ctx, 24, dx, dy);
        break;
    }
  }

  /** Server changed a tile (harvest / regrowth). */
  applyTile(i: number, tile: number) {
    const old = this.tiles[i];
    this.tiles[i] = tile;
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
    const ctx = this.mapCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    this.drawBaseTile(ctx, tx, ty);
    const mctx = this.miniCanvas.getContext("2d")!;
    mctx.fillStyle = MINI_COLORS[tile] ?? "#000";
    mctx.fillRect(tx, ty, 1, 1);
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
    const sw = Math.min(this.mapCanvas.width - sx, viewW + TILE * 2);
    const sh = Math.min(this.mapCanvas.height - sy, viewH + TILE * 2);
    if (sw > 0 && sh > 0)
      ctx.drawImage(this.mapCanvas, sx, sy, sw, sh, sx, sy, sw, sh);

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
      ctx.translate(c.x, c.y + 6);
      ctx.rotate(Math.PI / 2);
      this.blitChar(ctx, c.row, 0, -16, -16);
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
            fn: () => this.drawTreeSprite(ctx, cx, by, 0, 1, shakeX),
          });
        } else if (t === Tile.Rock) {
          const i = ty * this.w + tx;
          const dx = tx * TILE;
          const dy = ty * TILE;
          const shakeAt = this.shakes.get(i);
          let shakeX = 0;
          if (shakeAt !== undefined) {
            const el = view.time - shakeAt;
            if (el < 0.25) shakeX = Math.sin(el * 50) * 1.6 * (1 - el / 0.25);
            else this.shakes.delete(i);
          }
          drawables.push({
            y: dy + TILE - 4,
            fn: () =>
              ctx.drawImage(
                this.sheets.tiles,
                12 * SPR,
                0,
                SPR,
                SPR,
                dx + shakeX,
                dy,
                TILE,
                TILE,
              ),
          });
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
        fn: () => this.drawEnemy(ctx, e, view.time),
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
      if (col >= 0) this.blitTile(ctx, col, gx, gy);
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
  ) {
    const s = size / Math.max(this.w, this.h);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.miniCanvas, 0, 0, this.w * s, this.h * s);
    ctx.globalAlpha = 1;

    for (const poi of view.pois) {
      const x = (poi.x / TILE) * s;
      const y = (poi.y / TILE) * s;
      ctx.strokeStyle = poi.safe
        ? "rgba(140, 210, 130, 0.9)"
        : poi.kind === "airport"
          ? "rgba(216, 162, 74, 0.8)"
          : "rgba(194, 80, 71, 0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(230, 228, 210, 0.95)";
      ctx.fillText(poi.name, x, y - 6);
    }
    for (const tr of this.traders) {
      ctx.fillStyle = "#d8c26a";
      ctx.fillRect((tr.x / TILE) * s - 1.5, (tr.y / TILE) * s - 1.5, 3, 3);
    }
    for (const ex of this.extracts) {
      const x = (ex.x / TILE) * s;
      const y = (ex.y / TILE) * s;
      ctx.strokeStyle = "#5ff08a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 3, y);
      ctx.closePath();
      ctx.stroke();
    }
    for (const p of view.players) {
      if (p.dead) continue;
      const x = (p.dx / TILE) * s;
      const y = (p.dy / TILE) * s;
      const isYou = p.id === view.youId;
      const isFriend = view.friendNames.has(p.name);
      ctx.fillStyle = isYou ? "#f0d878" : isFriend ? "#78d878" : "#e8e8e8";
      ctx.beginPath();
      ctx.arc(x, y, isYou ? 2.5 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (isFriend && !isYou) {
        ctx.strokeStyle = "rgba(120, 216, 120, 0.7)";
        ctx.stroke();
      }
    }
  }

  // ── entity painters ─────────────────────────────────────────────────────

  private drawContainer(ctx: CanvasRenderingContext2D, c: ContainerSnap) {
    const { x, y } = c;
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
  ) {
    const def = ITEMS[weapon];
    ctx.save();
    ctx.translate(x, y + 2);
    let a = angle;
    let reach = 8;
    if (swingPhase !== null) {
      if (weapon === "spear") reach += Math.sin(swingPhase * Math.PI) * 14;
      else a += -0.9 + easeOut(swingPhase) * 1.6;
    }
    ctx.rotate(a);
    ctx.translate(reach, 0);
    ctx.rotate(Math.PI / 4); // icons are drawn diagonal-ish; nudge toward pointing right
    this.blitItem(ctx, weapon, -12, -12, 24);
    ctx.restore();

    if (swingPhase !== null && weapon !== "spear") {
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
  ) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const frame = moving ? Math.floor(time * 8 + seed) % 2 : 0;
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
    const row = seed % CHAR_ROWS.survivorCount;
    const swingPhase =
      p.swing > 0 && view.serverNow - p.swing < 400
        ? Math.min(1, (view.serverNow - p.swing) / 400)
        : null;

    // swimming: half-submerged sprite + ripples instead of the normal body
    const swimming =
      this.tileAt(Math.floor(p.dx / TILE), Math.floor(p.dy / TILE)) ===
      Tile.Water;
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
      const frame = p.moving ? Math.floor(view.time * 6 + seed) % 2 : 0;
      this.blitChar(ctx, row, frame, p.dx - 16, p.dy - 16);
      ctx.restore();
      // nameplate still renders below
    }
    const bob = swimming
      ? 0
      : this.drawShadowAndSprite(ctx, p.dx, p.dy, row, p.moving, view.time, seed);

    // armor overlays
    if (!swimming && p.helmet) {
      ctx.fillStyle = p.helmet === "helmet_military" ? "#44513a" : "#8a8a92";
      ctx.fillRect(p.dx - 7, p.dy - 16 - bob, 14, 5);
    }
    if (!swimming && p.vest) {
      ctx.fillStyle = p.vest === "vest_military" ? "#3c4834" : "#867454";
      ctx.fillRect(p.dx - 8, p.dy - 4 - bob, 16, 7);
    }

    if (p.weapon && !swimming)
      this.drawHeldItem(ctx, p.dx, p.dy, p.weapon, p.angle, swingPhase);
    else if (swingPhase !== null && !swimming) {
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
    time: number,
  ) {
    const seed = hashStr(e.id);
    const ANIMAL_ROWS: Partial<Record<string, number>> = {
      deer: CHAR_ROWS.deer,
      rabbit: CHAR_ROWS.rabbit,
      boar: CHAR_ROWS.boar,
      wolf: CHAR_ROWS.wolf,
    };
    const animalRow = ANIMAL_ROWS[e.kind];
    if (animalRow !== undefined) {
      // quadruped: flip toward its heading so it runs the right way
      ctx.save();
      ctx.translate(e.dx, e.dy);
      if (Math.cos(e.angle) < 0) ctx.scale(-1, 1);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 13, e.kind === "rabbit" ? 6 : 10, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      const frame = e.moving ? Math.floor(time * (e.kind === "rabbit" ? 14 : 10) + seed) % 2 : 0;
      this.blitChar(ctx, animalRow, frame, -16, -16);
      ctx.restore();
    } else {
      this.drawShadowAndSprite(
        ctx,
        e.dx,
        e.dy,
        e.kind === "zombie" ? CHAR_ROWS.zombie : CHAR_ROWS.military,
        e.moving,
        e.kind === "zombie" ? time * 0.7 : time,
        seed,
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
    default: return -1; // chest has no tile sprite; ghost falls back to the green box
  }
}
