import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import {
  ActionSnap,
  BACKPACKS,
  BLOCKS_ENEMY,
  BUILDABLES,
  BuildType,
  COOK_TIME_MS,
  CRAFT_TIME_MS,
  DRINK_TIME_MS,
  FISH_TIME_MS,
  HUNGER_DECAY_PER_S,
  LOOT_TIME_BASE_MS,
  LOOT_TIME_PER_KG_MS,
  NODE_DEPLETED,
  STARVE_DMG_PER_S,
  SWIM_SPEED_MULT,
  THIRST_DECAY_PER_S,
  WORLD_STRUCTURE_TTL_MS,
  BLOCKS_BULLET,
  BLOCKS_MOVE,
  ContainerContents,
  ContainerSnap,
  DAY_LENGTH_MS,
  EMPTY_SKILLS,
  ENEMY_DEFS,
  EV,
  EXTRACT_TIME_MS,
  HOME_REST_HP_PER_S,
  NIGHT_AGGRO_MULT,
  NIGHT_SPEED_MULT,
  isNight,
  EnemyKind,
  Equipment,
  FISTS,
  FLOOR_TILES,
  GroundItemSnap,
  HIDEOUT_H,
  HIDEOUT_STORAGE_SLOTS,
  HIDEOUT_W,
  HitSnap,
  MOD_SPREAD_MULT,
  INTERACT_RANGE,
  ITEMS,
  InputPayload,
  InstanceKind,
  InvSlot,
  Inventory,
  ItemId,
  MeleeStats,
  NODE_HITS,
  NODE_RESPAWN_MS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PoiSnap,
  QuestDef,
  QuestStatus,
  RECIPES,
  REGEN_HP_PER_S,
  REGEN_THRESHOLD,
  STARTING_MONEY,
  SUPPRESSED_AGGRO_RANGE,
  Skills,
  StateSnap,
  StationOpen,
  TICK_MS,
  TILE,
  TRADER_STOCK,
  Tile,
  WeaponStats,
  WorldInit,
  armorMultiplier,
  invCapacity,
  invWeight,
  skillLevel,
} from '@holdout/shared';
import { DbService, HideoutData, QuestProg } from '../db/db.service';
import { ChestTier, GeneratedMap, fromAuthored, generateMap, mulberry32 } from './mapgen';
import { rollChest, rollEnemyDrop, rollGround } from './loot';

interface ServerPlayer {
  sid: string;
  userId: string;
  name: string;
  instanceId: string;
  x: number;
  y: number;
  angle: number;
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
  starveAcc: number;
  regenAcc: number;
  lastPushedSurvival: number; // floor(hunger)*1000 + floor(thirst), change-detect
  action: { kind: 'loot' | 'fish' | 'drink' | 'fill' | 'cook' | 'extract' | 'craft'; until: number; data?: { id?: string; slot?: number } } | null;
  actionStart: { x: number; y: number };
  mags: Partial<Record<ItemId, number>>;
  reloadUntil: number;
  reloadTarget: ItemId | null;
  lastAttackAt: number;
  lastSwingAt: number;
  kills: number;
  deaths: number;
  openContainer: string | null;
  returnPos: { x: number; y: number } | null;
  ignoreInteractUntil: number; // swallow held-E repeats right after an instance switch
}

interface Enemy {
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
  enraged: boolean; // damaged animals keep chasing well past their neutral aggro radius
}

/** Survivor NPCs — scripted "players": they roam, chop wood, and some shoot on sight. */
interface Npc {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  hostile: boolean; // raiders attack on sight; harvesters only when provoked
  weapon: ItemId;
  targetSid: string | null;
  targetI: number; // tree tile index being chopped (-1 = none)
  nextSwingAt: number;
  lastSwingAt: number;
  nextShotAt: number;
  nextThinkAt: number;
  wanderAngle: number;
  wandering: boolean;
  moving: boolean;
  detourUntil: number;
  detourAngle: number;
}

interface Container {
  id: string;
  x: number;
  y: number;
  kind: 'chest' | 'bag' | 'crate' | 'storage';
  tier: ChestTier;
  slots: InvSlot[];
  restockAt: number | null;
}

interface GroundItem { id: string; x: number; y: number; item: ItemId; qty: number }

interface Projectile {
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

interface Instance {
  id: string;
  kind: InstanceKind;
  name: string;
  ownerId: string | null;
  seed: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  pois: PoiSnap[];
  traders: { x: number; y: number }[];
  extracts: { x: number; y: number }[];
  exit: { x: number; y: number } | null;
  spawns: { x: number; y: number }[];
  lootSpots: { x: number; y: number }[];
  containers: Map<string, Container>;
  ground: Map<string, GroundItem>;
  enemies: Map<string, Enemy>;
  npcs: Map<string, Npc>;
  npcRespawns: { at: number; hostile: boolean }[];
  projectiles: Projectile[];
  nodeHits: Map<number, number>;
  nodeRespawns: { i: number; tile: number; at: number }[];
  enemyRespawns: { x: number; y: number; kind: EnemyKind; at: number }[];
  lastGroundSpawn: number;
  players: number; // live count, for hideout GC
  hideout?: HideoutData; // persistence backing for hideout instances
  structures: Map<number, { type: BuildType; hp: number; expiresAt: number }>; // world-placed, tile-indexed
}

const ENEMY_RADIUS = 12;
const ENEMY_RESPAWN_MS = 90_000;
const WORLD = 'world';

@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Game');
  private io: Server;
  private rnd = mulberry32((Math.random() * 2 ** 31) | 0);

  private instances = new Map<string, Instance>();
  private players = new Map<string, ServerPlayer>();

  private nextId = 1;
  private tickTimer: NodeJS.Timeout;
  private saveTimer: NodeJS.Timeout;
  private questTimer: NodeJS.Timeout;
  private lastTick = Date.now();
  private quests: QuestDef[] = [];

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    this.quests = await this.db.loadQuests().catch(() => []);
    // hot-reload quests so admin edits apply without a restart
    this.questTimer = setInterval(() => {
      void this.db.loadQuests().then((q) => (this.quests = q)).catch(() => undefined);
    }, 60_000);
    const authored = await this.db.loadActiveMap().catch(() => null);
    const gen = authored ? fromAuthored(authored) : generateMap();
    const world = this.makeInstance(WORLD, 'world', authored ? 'Authored Zone' : 'The Exclusion Zone', null, gen);
    this.instances.set(WORLD, world);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.saveTimer = setInterval(() => this.saveAll(), 30_000);
    this.log.log(
      `World ready (${authored ? 'authored map' : `procedural seed ${gen.seed}`}) — ${world.containers.size} containers, ${world.enemies.size} enemies, POIs: ${gen.pois.map((p) => p.name).join(', ') || 'none'}`,
    );
  }

  onModuleDestroy() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    clearInterval(this.questTimer);
    return this.saveAll();
  }

  private saveProfileOf(p: ServerPlayer) {
    return this.db.saveProfile(
      p.userId, p.inv, p.equipment, p.skills, p.quests, p.money, p.kills, p.deaths,
      Math.round(p.hunger), Math.round(p.thirst),
    );
  }

  private addXp(p: ServerPlayer, skill: keyof Skills, amount: number) {
    p.skills[skill] = (p.skills[skill] ?? 0) + Math.max(0, Math.round(amount));
  }

  setServer(io: Server) {
    this.io = io;
  }

  // ── instance construction ─────────────────────────────────────────────────

  private makeInstance(id: string, kind: InstanceKind, name: string, ownerId: string | null, gen: GeneratedMap): Instance {
    const inst: Instance = {
      id,
      kind,
      name,
      ownerId,
      seed: gen.seed,
      w: gen.w,
      h: gen.h,
      tiles: gen.tiles,
      pois: gen.pois,
      traders: gen.traders,
      extracts: gen.extracts,
      exit: null,
      spawns: gen.spawns,
      lootSpots: gen.lootSpots,
      containers: new Map(),
      ground: new Map(),
      enemies: new Map(),
      npcs: new Map(),
      npcRespawns: [],
      projectiles: [],
      nodeHits: new Map(),
      nodeRespawns: [],
      enemyRespawns: [],
      lastGroundSpawn: 0,
      players: 0,
      structures: new Map(),
    };
    for (const spot of gen.chestSpots) {
      const cid = `c${this.nextId++}`;
      const tx = Math.floor(spot.x / TILE);
      const ty = Math.floor(spot.y / TILE);
      const onTarmac = gen.tiles[ty * gen.w + tx] === Tile.Asphalt;
      inst.containers.set(cid, {
        id: cid, x: spot.x, y: spot.y,
        kind: onTarmac ? 'crate' : 'chest',
        tier: spot.tier,
        slots: rollChest(this.rnd, spot.tier),
        restockAt: null,
      });
    }
    for (const spot of gen.lootSpots) this.spawnGroundAt(inst, spot.x, spot.y);
    for (const s of gen.enemySpawns) this.spawnEnemy(inst, s.x, s.y, s.kind);
    if (kind === 'world') {
      // survivor NPCs — the zone should feel inhabited even with few real players
      for (let i = 0; i < 3; i++) this.spawnNpc(inst, false);
      for (let i = 0; i < 2; i++) this.spawnNpc(inst, true);
    }
    return inst;
  }

  /** Hideout v2: a flat grass camp ringed by trees — bed + one chest to start, buildable. */
  private async hideoutInstance(ownerId: string): Promise<Instance> {
    const id = `h:${ownerId}`;
    const existing = this.instances.get(id);
    if (existing) return existing;

    const W = HIDEOUT_W;
    const H = HIDEOUT_H;
    const tiles = new Uint8Array(W * H).fill(Tile.Grass);
    for (let x = 0; x < W; x++) { tiles[x] = Tile.Tree; tiles[(H - 1) * W + x] = Tile.Tree; }
    for (let y = 0; y < H; y++) { tiles[y * W] = Tile.Tree; tiles[y * W + W - 1] = Tile.Tree; }
    tiles[3 * W + 3] = Tile.Bed;
    tiles[4 * W + 3] = Tile.Bed;
    const exitTx = Math.floor(W / 2);
    tiles[(H - 2) * W + exitTx] = Tile.DoorMat;

    const hideout = await this.db.loadHideout(ownerId);
    while (hideout.storage.length < HIDEOUT_STORAGE_SLOTS) hideout.storage.push(null);
    hideout.storage.length = HIDEOUT_STORAGE_SLOTS;

    const inst: Instance = {
      id,
      kind: 'hideout',
      name: 'Home Base',
      ownerId,
      seed: 0,
      w: W,
      h: H,
      tiles,
      pois: [],
      traders: [],
      extracts: [],
      exit: { x: (exitTx + 0.5) * TILE, y: (H - 2 + 0.5) * TILE },
      spawns: [{ x: 4.5 * TILE, y: 4.5 * TILE }], // wake up next to your bed
      lootSpots: [],
      containers: new Map(),
      ground: new Map(),
      enemies: new Map(),
      npcs: new Map(),
      npcRespawns: [],
      projectiles: [],
      nodeHits: new Map(),
      nodeRespawns: [],
      enemyRespawns: [],
      lastGroundSpawn: 0,
      players: 0,
      hideout,
      structures: new Map(),
    };
    // starter chest
    inst.containers.set(`hs:${ownerId}`, {
      id: `hs:${ownerId}`,
      x: 5.5 * TILE,
      y: 3.5 * TILE,
      kind: 'storage',
      tier: 'normal',
      slots: hideout.storage,
      restockAt: null,
    });
    // player-built tiles + chests
    for (const o of hideout.objects) {
      if (o.tx < 1 || o.ty < 1 || o.tx >= W - 1 || o.ty >= H - 1) continue;
      const b = BUILDABLES[o.type];
      if (b?.tile) tiles[o.ty * W + o.tx] = b.tile;
    }
    this.syncHideoutContainers(inst);
    this.instances.set(id, inst);
    return inst;
  }

  /** Rebuild the hideout's built-chest containers from hideout.objects (slot arrays shared by reference). */
  private syncHideoutContainers(inst: Instance) {
    if (!inst.ownerId || !inst.hideout) return;
    for (const id of [...inst.containers.keys()]) if (id.startsWith('hc:')) inst.containers.delete(id);
    inst.hideout.objects.forEach((o, i) => {
      if (o.type !== 'chest') return;
      const slots = Array.isArray(o.slots) ? o.slots : new Array<InvSlot>(HIDEOUT_STORAGE_SLOTS).fill(null);
      while (slots.length < HIDEOUT_STORAGE_SLOTS) slots.push(null);
      slots.length = HIDEOUT_STORAGE_SLOTS;
      o.slots = slots;
      inst.containers.set(`hc:${inst.ownerId}:${i}`, {
        id: `hc:${inst.ownerId}:${i}`,
        x: (o.tx + 0.5) * TILE,
        y: (o.ty + 0.5) * TILE,
        kind: 'storage',
        tier: 'normal',
        slots,
        restockAt: null,
      });
    });
  }

  private persistHideout(inst: Instance) {
    if (inst.kind !== 'hideout' || !inst.ownerId || !inst.hideout) return;
    // chest slot arrays are shared by reference with containers — just save
    void this.db.saveHideout(inst.ownerId, inst.hideout);
  }

  private inst(p: ServerPlayer): Instance {
    return this.instances.get(p.instanceId) ?? this.instances.get(WORLD)!;
  }

  private initFor(inst: Instance, sid: string): WorldInit {
    return {
      kind: inst.kind,
      name: inst.name,
      seed: inst.seed,
      width: inst.w,
      height: inst.h,
      tiles: Array.from(inst.tiles),
      pois: inst.pois,
      traders: inst.traders,
      extracts: inst.extracts,
      exit: inst.exit,
      ownHideout: inst.kind === 'hideout' && inst.ownerId === this.players.get(sid)?.userId,
      you: sid,
    };
  }

  private switchInstance(p: ServerPlayer, inst: Instance, x: number, y: number) {
    const old = this.instances.get(p.instanceId);
    if (old) old.players = Math.max(0, old.players - 1);
    const socket = this.io?.sockets.sockets.get(p.sid);
    if (socket) {
      if (old) void socket.leave(old.id);
      void socket.join(inst.id);
    }
    p.instanceId = inst.id;
    p.x = x;
    p.y = y;
    p.openContainer = null;
    p.ignoreInteractUntil = Date.now() + 900; // a held E must not instantly open the stash at home
    inst.players++;
    this.emitTo(p.sid, EV.init, this.initFor(inst, p.sid));
    this.pushInventory(p);
    // hideout GC: drop empty hideout instances (storage already persisted)
    if (old && old.kind === 'hideout' && old.players === 0) this.instances.delete(old.id);
  }

  private isSafeAt(inst: Instance, x: number, y: number): boolean {
    if (inst.kind === 'hideout') return true;
    return inst.pois.some((p) => p.safe && Math.hypot(p.x - x, p.y - y) < p.r);
  }

  // ── join / leave ──────────────────────────────────────────────────────────

  async addPlayer(sid: string, userId: string, name: string): Promise<WorldInit> {
    // reconnect handover: keep live state, kick the old socket
    for (const [oldSid, existing] of this.players) {
      if (existing.userId !== userId) continue;
      this.players.delete(oldSid);
      for (const i of this.instances.values())
        for (const e of i.enemies.values()) if (e.targetSid === oldSid) e.targetSid = sid;
      existing.sid = sid;
      existing.input = { up: false, down: false, left: false, right: false, angle: existing.angle, shoot: false };
      this.players.set(sid, existing);
      const inst = this.inst(existing);
      void this.io?.sockets.sockets.get(sid)?.join(inst.id);
      this.io?.sockets.sockets.get(oldSid)?.disconnect(true);
      this.pushInventory(existing);
      return this.initFor(inst, sid);
    }

    const row = await this.db.loadProfile(userId);
    let inv: Inventory;
    let equipment: Equipment = { helmet: null, vest: null, mod: null };
    let money = STARTING_MONEY;
    let kills = 0;
    let deaths = 0;
    let skills: Skills = { ...EMPTY_SKILLS };
    let quests: Record<string, QuestProg> = {};
    let hunger = 100;
    let thirst = 100;
    if (row) {
      inv = row.inventory;
      inv.backpack = Math.min(inv.backpack ?? 0, BACKPACKS.length - 1);
      const cap = BACKPACKS[inv.backpack].slots;
      while (inv.slots.length < cap) inv.slots.push(null);
      inv.slots.length = cap;
      equipment = row.equipment;
      money = row.money;
      kills = row.kills;
      deaths = row.deaths;
      skills = row.skills;
      quests = row.quests;
      hunger = row.hunger;
      thirst = row.thirst;
    } else {
      inv = this.starterInventory();
    }
    // you always wake up at home — leave through the door mat to deploy into the zone
    const home = await this.hideoutInstance(userId);
    const spawn = home.spawns[0];
    const p: ServerPlayer = {
      sid,
      userId,
      name,
      instanceId: home.id,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      hp: PLAYER_MAX_HP,
      dead: false,
      moving: false,
      input: { up: false, down: false, left: false, right: false, angle: 0, shoot: false },
      inv,
      equipment,
      equipped: this.firstWeaponSlot(inv),
      money,
      skills,
      quests,
      hunger,
      thirst,
      starveAcc: 0,
      regenAcc: 0,
      lastPushedSurvival: -1,
      action: null,
      actionStart: { x: spawn.x, y: spawn.y },
      mags: {},
      reloadUntil: 0,
      reloadTarget: null,
      lastAttackAt: 0,
      lastSwingAt: 0,
      kills,
      deaths,
      openContainer: null,
      returnPos: null,
      ignoreInteractUntil: Date.now() + 900, // a key held through the login screen opens nothing
    };
    this.players.set(sid, p);
    home.players++;
    void this.io?.sockets.sockets.get(sid)?.join(home.id);
    this.pushInventory(p);
    this.toast(sid, 'Welcome home — step on the mat to deploy into the zone');
    this.log.log(`${name} joined (${this.players.size} online)`);
    return this.initFor(home, sid);
  }

  async removePlayer(sid: string) {
    const p = this.players.get(sid);
    if (!p) return;
    this.players.delete(sid);
    const inst = this.instances.get(p.instanceId);
    if (inst) {
      inst.players = Math.max(0, inst.players - 1);
      if (inst.kind === 'hideout' && inst.players === 0) this.instances.delete(inst.id);
      for (const e of inst.enemies.values()) if (e.targetSid === sid) e.targetSid = null;
    }
    this.log.log(`${p.name} left (${this.players.size} online)`);
    await this.saveProfileOf(p);
  }

  /** You wake up with nothing but your fists. */
  private starterInventory(): Inventory {
    return { backpack: 0, slots: new Array(BACKPACKS[0].slots).fill(null) };
  }

  private firstWeaponSlot(inv: Inventory): number | null {
    const i = inv.slots.findIndex((s) => s && (ITEMS[s.id].kind === 'weapon' || ITEMS[s.id].kind === 'tool'));
    return i >= 0 ? i : null;
  }

  // ── input & interactions ──────────────────────────────────────────────────

  setInput(sid: string, input: InputPayload) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const angle = Number(input.angle);
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      angle: Number.isFinite(angle) ? angle : p.angle,
      shoot: !!input.shoot,
    };
    p.angle = p.input.angle;
  }

  interact(sid: string) {
    const p = this.players.get(sid);
    if (!p || p.dead || Date.now() < p.ignoreInteractUntil) return;
    const inst = this.inst(p);

    // hideout exit mat
    if (inst.kind === 'hideout' && inst.exit && Math.hypot(inst.exit.x - p.x, inst.exit.y - p.y) < INTERACT_RANGE) {
      this.leaveHideout(sid);
      return;
    }
    // trader
    for (const tr of inst.traders) {
      if (Math.hypot(tr.x - p.x, tr.y - p.y) < INTERACT_RANGE) {
        this.sendTrade(p);
        return;
      }
    }
    // extraction beacon — hold still to go home with the loot (not from safety)
    for (const ex of inst.extracts) {
      if (Math.hypot(ex.x - p.x, ex.y - p.y) < INTERACT_RANGE) {
        if (this.isSafeAt(inst, p.x, p.y)) {
          this.toast(sid, 'You cannot extract from inside a safe zone');
          return;
        }
        this.startAction(p, 'extract', 'Extracting…', EXTRACT_TIME_MS);
        return;
      }
    }
    // containers vs stations — open whichever is closer
    let best: Container | null = null;
    let bestD = INTERACT_RANGE;
    for (const c of inst.containers.values()) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { best = c; bestD = d; }
    }
    // nearest placed station tile (firepit / furnace / workbench)
    const STATION_TILES: Partial<Record<number, BuildType>> = {
      [Tile.Firepit]: 'firepit',
      [Tile.Furnace]: 'furnace',
      [Tile.Workbench]: 'workbench',
    };
    let station: BuildType | null = null;
    let stationD = INTERACT_RANGE;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor(p.y / TILE);
    for (let ty = pty - 2; ty <= pty + 2; ty++)
      for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) continue;
        const st = STATION_TILES[inst.tiles[ty * inst.w + tx]];
        if (!st) continue;
        const d = Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y);
        if (d < stationD) { station = st; stationD = d; }
      }
    if (station && stationD < bestD) {
      this.emitTo(sid, EV.station, { type: station } satisfies StationOpen);
      return;
    }
    if (best) {
      p.openContainer = best.id;
      this.emitTo(sid, EV.container, {
        id: best.id,
        slots: best.slots,
        storage: best.kind === 'storage',
      } satisfies ContainerContents);
      return;
    }
    // ground items
    let bestG: GroundItem | null = null;
    bestD = INTERACT_RANGE;
    for (const g of inst.ground.values()) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bestD) { bestG = g; bestD = d; }
    }
    if (bestG) {
      const leftover = this.addItem(p.inv, bestG.item, bestG.qty);
      if (leftover === bestG.qty) {
        this.toast(sid, 'Inventory full');
        return;
      }
      if (leftover > 0) {
        bestG.qty = leftover;
        this.toast(sid, `Picked up some ${ITEMS[bestG.item].name} (bag full)`);
      } else {
        inst.ground.delete(bestG.id);
        this.toast(sid, `Picked up ${ITEMS[bestG.item].name} x${bestG.qty}`);
      }
      this.pushInventory(p);
      return;
    }
    // nothing else nearby: drink straight from adjacent water
    if (this.nearTile(p, Tile.Water, 2) && p.thirst < 100) {
      this.startAction(p, 'drink', 'Drinking…', DRINK_TIME_MS);
    }
  }

  /** Any tile of the given type within r tiles of the player? */
  private nearTile(p: ServerPlayer, tile: Tile, r = 2): boolean {
    const inst = this.inst(p);
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || y < 0 || x >= inst.w || y >= inst.h) continue;
        if (inst.tiles[y * inst.w + x] === tile) return true;
      }
    return false;
  }

  private startAction(
    p: ServerPlayer,
    kind: NonNullable<ServerPlayer['action']>['kind'],
    label: string,
    ms: number,
    data?: { id?: string; slot?: number },
  ) {
    if (p.action) return false;
    p.action = { kind, until: Date.now() + ms, data };
    p.actionStart = { x: p.x, y: p.y };
    this.emitTo(p.sid, EV.action, { label, ms, kind, container: data?.id, slot: data?.slot } satisfies ActionSnap);
    return true;
  }

  private completeAction(p: ServerPlayer, inst: Instance, act: NonNullable<ServerPlayer['action']>) {
    this.emitTo(p.sid, EV.action, { label: '', ms: 0 } satisfies ActionSnap);
    switch (act.kind) {
      case 'loot':
        if (act.data?.id !== undefined && act.data.slot !== undefined)
          this.takeNow(p, inst, act.data.id, act.data.slot);
        break;
      case 'fish': {
        if (this.rnd() < 0.7) {
          const leftover = this.addItem(p.inv, 'raw_fish', 1);
          if (leftover > 0) this.dropAt(inst, p.x, p.y + 20, 'raw_fish', 1);
          this.toast(p.sid, 'You caught a fish!');
          this.addXp(p, 'crafting', 4);
        } else {
          this.toast(p.sid, 'It got away…');
        }
        this.pushInventory(p);
        break;
      }
      case 'drink':
        p.thirst = Math.min(100, p.thirst + 40);
        this.toast(p.sid, 'You drink from the water (+40 thirst)');
        this.pushInventory(p);
        break;
      case 'fill': {
        const slot = act.data?.slot ?? -1;
        const item = p.inv.slots[slot];
        const fillDef = item ? ITEMS[item.id] : null;
        if (item && fillDef?.fillFrom) {
          const filled = ITEMS[fillDef.fillFrom];
          p.inv.slots[slot] = { id: fillDef.fillFrom, qty: filled.stack };
          this.toast(p.sid, `${filled.name} filled (${filled.stack} drinks)`);
          this.pushInventory(p);
        }
        break;
      }
      case 'cook': {
        const slot = act.data?.slot ?? -1;
        const item = p.inv.slots[slot];
        const def = item ? ITEMS[item.id] : null;
        if (item && def?.raw && this.nearTile(p, Tile.Firepit)) {
          item.qty -= 1;
          if (item.qty <= 0) p.inv.slots[slot] = null;
          const leftover = this.addItem(p.inv, def.raw, 1);
          if (leftover > 0) this.dropAt(inst, p.x, p.y + 20, def.raw, 1);
          this.toast(p.sid, `Cooked ${ITEMS[def.raw].name}`);
          this.addXp(p, 'crafting', 3);
          this.pushInventory(p);
        }
        break;
      }
      case 'extract':
        void this.extractHome(p);
        break;
      case 'craft': {
        const recipe = RECIPES.find((r) => r.id === act.data?.id);
        // re-validate — materials may have moved while the bar filled
        if (recipe && this.craftChecks(p, recipe)) this.doCraft(p, inst, recipe);
        break;
      }
    }
  }

  /** Extraction beacon success: back to your base, loot intact. */
  private async extractHome(p: ServerPlayer) {
    if (p.dead) return;
    const home = await this.hideoutInstance(p.userId);
    p.returnPos = null;
    this.switchInstance(p, home, home.spawns[0].x, home.spawns[0].y);
    this.toast(p.sid, 'Extraction successful — loot secured at home');
    void this.saveProfileOf(p);
  }

  containerTake(sid: string, containerId: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.action) return;
    const inst = this.inst(p);
    const c = inst.containers.get(containerId);
    if (!c || Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return;
    const item = c.slots[slot];
    if (!item) return;
    // Tarkov-style: taking loot costs time (heavier = slower); your own stash is instant
    if (c.kind === 'storage') {
      this.takeNow(p, inst, containerId, slot);
      return;
    }
    const ms = Math.min(3000, LOOT_TIME_BASE_MS + ITEMS[item.id].kg * item.qty * LOOT_TIME_PER_KG_MS);
    this.startAction(p, 'loot', `Taking ${ITEMS[item.id].name}…`, ms, { id: containerId, slot });
  }

  private takeNow(p: ServerPlayer, inst: Instance, containerId: string, slot: number) {
    const c = inst.containers.get(containerId);
    if (!c || Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return;
    const item = c.slots[slot];
    if (!item) return;
    const leftover = this.addItem(p.inv, item.id, item.qty);
    if (leftover === item.qty) {
      this.toast(p.sid, 'Not enough space or weight');
      return;
    }
    c.slots[slot] = leftover > 0 ? { id: item.id, qty: leftover } : null;

    if (c.kind === 'storage') this.persistHideout(inst);
    if (c.slots.every((s) => !s)) {
      if (c.kind === 'bag') {
        inst.containers.delete(c.id);
        this.io?.to(inst.id).emit(EV.containerGone, c.id);
      } else if (c.kind !== 'storage') {
        c.restockAt = Date.now() + 180_000;
      }
    }
    this.pushInventory(p);
    this.emitTo(p.sid, EV.container, {
      id: c.id,
      slots: inst.containers.has(c.id) ? c.slots : [],
      storage: c.kind === 'storage',
    });
  }

  /** Deposit into hideout storage. */
  containerPut(sid: string, containerId: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const c = inst.containers.get(containerId);
    // deposit into any reachable container (world chests/crates for dumping loot,
    // or your hideout stash) — bags are ephemeral, skip them
    if (!c || c.kind === 'bag' || Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = ITEMS[item.id];
    let qty = item.qty;
    for (const s of c.slots) {
      if (qty <= 0) break;
      if (s && s.id === item.id && s.qty < def.stack) {
        const add = Math.min(def.stack - s.qty, qty);
        s.qty += add;
        qty -= add;
      }
    }
    for (let i = 0; i < c.slots.length && qty > 0; i++) {
      if (!c.slots[i]) {
        const add = Math.min(def.stack, qty);
        c.slots[i] = { id: item.id, qty: add };
        qty -= add;
      }
    }
    if (qty === item.qty) {
      this.toast(sid, 'No room in there');
      return;
    }
    if (qty > 0) p.inv.slots[slot] = { id: item.id, qty };
    else {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    if (c.kind === 'storage') this.persistHideout(inst);
    this.pushInventory(p);
    this.emitTo(sid, EV.container, { id: c.id, slots: c.slots, storage: c.kind === 'storage' });
  }

  closeContainer(sid: string) {
    const p = this.players.get(sid);
    if (p) p.openContainer = null;
  }

  invMove(sid: string, from: number, to: number) {
    const p = this.players.get(sid);
    if (!p) return;
    const s = p.inv.slots;
    if (from === to || from < 0 || to < 0 || from >= s.length || to >= s.length) return;
    const a = s[from];
    const b = s[to];
    if (!a) return;
    if (b && b.id === a.id && ITEMS[a.id].stack > 1) {
      const room = ITEMS[a.id].stack - b.qty;
      const moved = Math.min(room, a.qty);
      b.qty += moved;
      a.qty -= moved;
      if (a.qty <= 0) s[from] = null;
    } else {
      s[from] = b;
      s[to] = a;
      if (p.equipped === from) p.equipped = to;
      else if (p.equipped === to) p.equipped = from;
    }
    this.pushInventory(p);
  }

  invDrop(sid: string, slot: number, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const item = p.inv.slots[slot];
    if (!item) return;
    const droppedId = item.id;
    const n = Math.max(1, Math.min(Math.floor(qty) || item.qty, item.qty));
    item.qty -= n;
    if (item.qty <= 0) {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    this.dropAt(inst, p.x + (this.rnd() - 0.5) * 24, p.y + 20 + this.rnd() * 10, droppedId, n);
    this.pushInventory(p);
  }

  invUse(sid: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = ITEMS[item.id];
    if (def.kind === 'placeable') {
      // placement is a client-driven flow; nothing to do here
      this.toast(sid, `Hold ${def.name} and click the ground to place it`);
      return;
    }
    if (def.kind === 'consumable') {
      // fillable container (empty canteen) — fill at water
      if (def.fillFrom) {
        if (!this.nearTile(p, Tile.Water, 2)) {
          this.toast(sid, 'Find water to fill that');
          return;
        }
        this.startAction(p, 'fill', `Filling ${def.name}…`, DRINK_TIME_MS, { slot });
      } else if (def.drink) {
        if (p.thirst >= 100) {
          this.toast(sid, 'You are not thirsty');
          return;
        }
        p.thirst = Math.min(100, p.thirst + def.drink);
        item.qty -= 1;
        if (item.qty <= 0) p.inv.slots[slot] = def.emptyTo ? { id: def.emptyTo, qty: 1 } : null;
        this.toast(sid, `Drank ${def.name} (+${def.drink} thirst)`);
        this.pushInventory(p);
      } else if (def.raw && this.nearTile(p, Tile.Firepit)) {
        this.startAction(p, 'cook', `Cooking ${def.name}…`, COOK_TIME_MS, { slot });
      } else if (def.food) {
        if (p.hunger >= 100) {
          this.toast(sid, 'You are not hungry');
          return;
        }
        p.hunger = Math.min(100, p.hunger + def.food);
        item.qty -= 1;
        if (item.qty <= 0) p.inv.slots[slot] = null;
        this.toast(sid, `Ate ${def.name} (+${def.food} hunger)${def.raw ? ' — cook it at a firepit for more' : ''}`);
        this.pushInventory(p);
      } else if (def.heal) {
        if (p.hp >= PLAYER_MAX_HP) {
          this.toast(sid, 'Already at full health');
          return;
        }
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + def.heal);
        item.qty -= 1;
        if (item.qty <= 0) p.inv.slots[slot] = null;
        this.toast(sid, `Used ${def.name} (+${def.heal} HP)`);
        this.pushInventory(p);
      }
    } else if (def.kind === 'backpack' && def.backpackTier !== undefined) {
      if (def.backpackTier <= p.inv.backpack) {
        this.toast(sid, 'You already have an equal or better backpack');
        return;
      }
      p.inv.slots[slot] = null;
      p.inv.backpack = def.backpackTier;
      const cap = BACKPACKS[def.backpackTier].slots;
      while (p.inv.slots.length < cap) p.inv.slots.push(null);
      this.toast(sid, `Equipped ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === 'armor' && def.armor) {
      const piece = def.armor.piece;
      const old = p.equipment[piece];
      p.equipment[piece] = item.id;
      p.inv.slots[slot] = old ? { id: old, qty: 1 } : null;
      if (p.equipped === slot) p.equipped = null;
      this.toast(sid, `Equipped ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === 'mod') {
      const old = p.equipment.mod;
      p.equipment.mod = item.id;
      p.inv.slots[slot] = old ? { id: old, qty: 1 } : null;
      if (p.equipped === slot) p.equipped = null;
      this.toast(sid, `Fitted ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === 'weapon' || def.kind === 'tool') {
      this.invEquip(sid, slot);
    }
  }

  unequipArmor(sid: string, piece: 'helmet' | 'vest' | 'mod') {
    const p = this.players.get(sid);
    if (!p || (piece !== 'helmet' && piece !== 'vest' && piece !== 'mod')) return;
    const id = p.equipment[piece];
    if (!id) return;
    if (this.addItem(p.inv, id, 1) > 0) {
      this.toast(sid, 'No space in backpack');
      return;
    }
    p.equipment[piece] = null;
    this.pushInventory(p);
  }

  invEquip(sid: string, slot: number) {
    const p = this.players.get(sid);
    if (!p) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const kind = ITEMS[item.id].kind;
    // weapons, tools and consumables can be held in hand (click to use / attack)
    if (kind !== 'weapon' && kind !== 'tool' && kind !== 'consumable') return;
    p.equipped = p.equipped === slot ? null : slot;
    this.pushInventory(p);
  }

  /** Crafting is a short timed action — the client queues repeat crafts. */
  craft(sid: string, recipeId: string) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.action) return;
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;
    if (!this.craftChecks(p, recipe)) return;
    this.startAction(p, 'craft', `Crafting ${ITEMS[recipe.out.id].name}…`, CRAFT_TIME_MS, { id: recipeId });
  }

  /** Station / material / weight validation, with feedback toasts. */
  private craftChecks(p: ServerPlayer, recipe: (typeof RECIPES)[number]): boolean {
    if (recipe.station === 'workbench' && !this.nearTile(p, Tile.Workbench)) {
      this.toast(p.sid, 'You need to be at a workbench (B to build one)');
      return false;
    }
    if (recipe.station === 'furnace' && !this.nearTile(p, Tile.Furnace)) {
      this.toast(p.sid, 'You need to be at a furnace (B to build one)');
      return false;
    }
    for (const cost of recipe.cost) {
      if (this.countItem(p.inv, cost.id) < cost.qty) {
        this.toast(p.sid, `Missing ${ITEMS[cost.id].name}`);
        return false;
      }
    }
    const costKg = recipe.cost.reduce((s, c) => s + ITEMS[c.id].kg * c.qty, 0);
    const outKg = ITEMS[recipe.out.id].kg * recipe.out.qty;
    if (invWeight(p.inv) - costKg + outKg > invCapacity(p.inv).maxKg + 1e-9) {
      this.toast(p.sid, 'Too heavy to carry');
      return false;
    }
    return true;
  }

  private doCraft(p: ServerPlayer, inst: Instance, recipe: (typeof RECIPES)[number]) {
    for (const cost of recipe.cost) this.removeItem(p.inv, cost.id, cost.qty);
    const leftover = this.addItem(p.inv, recipe.out.id, recipe.out.qty);
    if (leftover > 0) {
      this.dropAt(inst, p.x, p.y + 20, recipe.out.id, leftover);
      this.toast(p.sid, `Crafted ${ITEMS[recipe.out.id].name} (no slot — dropped at feet)`);
    } else {
      this.toast(p.sid, `Crafted ${ITEMS[recipe.out.id].name}${recipe.out.qty > 1 ? ` x${recipe.out.qty}` : ''}`);
    }
    this.addXp(p, 'crafting', 8);
    this.pushInventory(p);
  }

  /** Place a placeable KIT item from an inventory slot at a tile. */
  build(sid: string, slot: number, tx: number, ty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const held = p.inv.slots[slot];
    const heldDef = held ? ITEMS[held.id] : null;
    if (!held || !heldDef?.place) {
      this.toast(sid, 'That is not a placeable item');
      return;
    }
    const type: BuildType = heldDef.place;
    const inst = this.inst(p);
    const inHideout = inst.kind === 'hideout';
    if (inHideout && (inst.ownerId !== p.userId || !inst.hideout)) {
      this.toast(sid, 'This is not your camp');
      return;
    }
    const buildable = BUILDABLES[type];
    if (!buildable) return;
    if (!inHideout && buildable.hideoutOnly) {
      this.toast(sid, `${buildable.name} can only be placed in your camp`);
      return;
    }
    tx = tx | 0;
    ty = ty | 0;
    if (tx < 1 || ty < 1 || tx >= inst.w - 1 || ty >= inst.h - 1) return;
    if (Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) > TILE * 4) {
      this.toast(sid, 'Too far away to place that');
      return;
    }
    if (!inHideout && this.isSafeAt(inst, (tx + 0.5) * TILE, (ty + 0.5) * TILE)) {
      this.toast(sid, 'No building inside the safe zone');
      return;
    }
    const i = ty * inst.w + tx;
    const targetTile = inst.tiles[i];
    const isFloorPiece = type === 'wood_floor' || type === 'stone_floor';
    // floors go on grass; everything else can also sit ON a floor (Minecraft-style layering)
    const ok = isFloorPiece ? targetTile === Tile.Grass : targetTile === Tile.Grass || FLOOR_TILES[targetTile];
    if (!ok) {
      this.toast(sid, isFloorPiece ? 'Flooring needs clear grass' : 'Needs clear grass or flooring');
      return;
    }
    for (const c of inst.containers.values())
      if (Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty) {
        this.toast(sid, 'Something is already there');
        return;
      }
    if (inst.exit && Math.hypot(inst.exit.x - (tx + 0.5) * TILE, inst.exit.y - (ty + 0.5) * TILE) < TILE * 1.5) {
      this.toast(sid, 'Keep the exit clear');
      return;
    }
    // don't wall yourself in on the tile you're standing on
    if (buildable.tile && BLOCKS_MOVE[buildable.tile] && Math.floor(p.x / TILE) === tx && Math.floor(p.y / TILE) === ty) {
      this.toast(sid, 'You are standing there');
      return;
    }

    // consume one kit item
    this.removeItem(p.inv, held.id, 1);

    if (buildable.tile) {
      // building on top of a floor replaces it — retire the floor object underneath
      if (inHideout && inst.hideout && FLOOR_TILES[targetTile]) {
        const fi = inst.hideout.objects.findIndex((o) => o.tx === tx && o.ty === ty);
        if (fi >= 0) {
          inst.hideout.objects.splice(fi, 1);
          this.syncHideoutContainers(inst);
        }
      }
      inst.tiles[i] = buildable.tile;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: buildable.tile });
      if (inHideout && inst.hideout) {
        inst.hideout.objects.push({ type, tx, ty });
        this.persistHideout(inst);
      } else {
        inst.structures.set(i, { type, hp: buildable.hp, expiresAt: Date.now() + WORLD_STRUCTURE_TTL_MS });
      }
    } else if (inHideout && inst.hideout) {
      inst.hideout.objects.push({ type, tx, ty, slots: new Array<InvSlot>(HIDEOUT_STORAGE_SLOTS).fill(null) });
      this.syncHideoutContainers(inst);
      this.persistHideout(inst);
    }
    if (p.equipped === slot && !p.inv.slots[slot]) p.equipped = null;
    this.addXp(p, 'crafting', 6);
    this.toast(sid, `Placed ${buildable.name}${inHideout ? '' : ' (wears out out here)'}`);
    this.pushInventory(p);
  }

  /** Reclaim a piece you built in your own camp — returns the kit item. */
  demolish(sid: string, tx: number, ty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    if (inst.kind !== 'hideout' || inst.ownerId !== p.userId || !inst.hideout) {
      this.toast(sid, 'You can only demolish in your own camp');
      return;
    }
    tx = tx | 0;
    ty = ty | 0;
    if (Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) > TILE * 4) {
      this.toast(sid, 'Too far away');
      return;
    }
    const oi = inst.hideout.objects.findIndex((o) => o.tx === tx && o.ty === ty);
    if (oi < 0) {
      this.toast(sid, 'Nothing you built there');
      return;
    }
    const obj = inst.hideout.objects[oi];
    if (obj.type === 'chest' && obj.slots?.some((s) => !!s)) {
      this.toast(sid, 'Empty the chest first');
      return;
    }
    const kit = Object.values(ITEMS).find((d) => d.place === obj.type);
    if (kit && this.addItem(p.inv, kit.id, 1) > 0) {
      this.toast(sid, 'No space to carry the kit');
      return;
    }
    inst.hideout.objects.splice(oi, 1);
    const buildable = BUILDABLES[obj.type];
    if (buildable.tile) {
      const i = ty * inst.w + tx;
      inst.tiles[i] = Tile.Grass;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: Tile.Grass });
    }
    this.syncHideoutContainers(inst);
    this.persistHideout(inst);
    this.toast(sid, `Demolished ${buildable.name}${kit ? ` — ${ITEMS[kit.id].name} returned` : ''}`);
    this.pushInventory(p);
  }

  /** Damage a world-placed structure (melee or bullets). Returns true if it was one. */
  private damageStructure(inst: Instance, i: number, dmg: number): boolean {
    const s = inst.structures.get(i);
    if (!s) return false;
    s.hp -= dmg;
    this.hitFx(inst, (i % inst.w) * TILE + 16, Math.floor(i / inst.w) * TILE + 16, dmg, 'node', 'stone');
    if (s.hp <= 0) {
      inst.structures.delete(i);
      inst.tiles[i] = Tile.Grass;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: Tile.Grass });
    }
    return true;
  }

  /** Safe-zone local chat with overhead bubbles. */
  chat(sid: string, text: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    if (!this.isSafeAt(inst, p.x, p.y)) {
      this.toast(sid, 'You can only chat inside safe zones');
      return;
    }
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
    if (!clean) return;
    this.io?.to(inst.id).emit(EV.chatMsg, { id: p.sid, name: p.name, text: clean });
  }

  // ── quests ────────────────────────────────────────────────────────────────

  private questStatus(p: ServerPlayer): QuestStatus[] {
    return this.quests.map((def) => {
      const prog = p.quests[def.id] ?? { kills: 0, claimed: false };
      const progress = def.kind === 'kill' ? Math.min(prog.kills, def.count) : Math.min(this.countItem(p.inv, def.target as ItemId), def.count);
      return { def, progress, done: progress >= def.count, claimed: !!prog.claimed };
    });
  }

  private sendTrade(p: ServerPlayer) {
    this.emitTo(p.sid, EV.trade, { stock: TRADER_STOCK, money: p.money, quests: this.questStatus(p) });
  }

  questClaim(sid: string, questId: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || !this.nearTrader(p)) return;
    const def = this.quests.find((q) => q.id === questId);
    if (!def) return;
    const prog = p.quests[def.id] ?? { kills: 0, claimed: false };
    if (prog.claimed) return;
    if (def.kind === 'fetch') {
      if (this.countItem(p.inv, def.target as ItemId) < def.count) {
        this.toast(sid, 'You do not have the goods yet');
        return;
      }
      this.removeItem(p.inv, def.target as ItemId, def.count);
    } else if (prog.kills < def.count) {
      this.toast(sid, 'The job is not done yet');
      return;
    }
    prog.claimed = true;
    p.quests[def.id] = prog;
    p.money += def.rewardMoney;
    if (def.rewardItem) {
      const leftover = this.addItem(p.inv, def.rewardItem, def.rewardQty);
      if (leftover > 0) this.dropAt(this.inst(p), p.x, p.y + 20, def.rewardItem, leftover);
    }
    this.toast(sid, `Job complete: ${def.name} (+${def.rewardMoney}cr${def.rewardItem ? ` +${ITEMS[def.rewardItem].name}` : ''})`);
    void this.saveProfileOf(p);
    this.pushInventory(p);
    this.sendTrade(p);
  }

  respawn(sid: string) {
    const p = this.players.get(sid);
    if (!p || !p.dead) return;
    const world = this.instances.get(WORLD)!;
    if (p.instanceId !== WORLD) this.switchInstance(p, world, p.x, p.y);
    const spawn = world.spawns[Math.floor(this.rnd() * world.spawns.length)];
    p.x = spawn.x;
    p.y = spawn.y;
    p.hp = PLAYER_MAX_HP;
    p.dead = false;
    p.inv = this.starterInventory();
    p.equipment = { helmet: null, vest: null, mod: null };
    p.equipped = null;
    p.mags = {};
    p.hunger = 100;
    p.thirst = 100;
    p.action = null;
    this.pushInventory(p);
    void this.saveProfileOf(p);
  }

  // ── trading ───────────────────────────────────────────────────────────────

  private nearTrader(p: ServerPlayer): boolean {
    return this.inst(p).traders.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < INTERACT_RANGE * 1.5);
  }

  tradeBuy(sid: string, id: string, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || !this.nearTrader(p)) return;
    const entry = TRADER_STOCK.find((e) => e.id === id && e.buy > 0);
    if (!entry) return;
    const n = Math.max(1, Math.min(99, Math.floor(qty) || 1));
    const affordable = Math.min(n, Math.floor(p.money / entry.buy));
    if (affordable <= 0) {
      this.toast(sid, 'Not enough credits');
      return;
    }
    const leftover = this.addItem(p.inv, entry.id, affordable);
    const bought = affordable - leftover;
    if (bought <= 0) {
      this.toast(sid, 'Not enough space or weight');
      return;
    }
    p.money -= bought * entry.buy;
    this.toast(sid, `Bought ${ITEMS[entry.id].name} x${bought} (-${bought * entry.buy}cr)`);
    this.pushInventory(p);
    this.emitTo(sid, EV.trade, { stock: TRADER_STOCK, money: p.money });
  }

  tradeSell(sid: string, slot: number, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || !this.nearTrader(p)) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const entry = TRADER_STOCK.find((e) => e.id === item.id && e.sell > 0);
    if (!entry) {
      this.toast(sid, 'The trader is not interested in that');
      return;
    }
    const n = Math.max(1, Math.min(Math.floor(qty) || item.qty, item.qty));
    item.qty -= n;
    if (item.qty <= 0) {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    p.money += n * entry.sell;
    this.toast(sid, `Sold ${ITEMS[item.id].name} x${n} (+${n * entry.sell}cr)`);
    this.pushInventory(p);
    this.emitTo(sid, EV.trade, { stock: TRADER_STOCK, money: p.money });
  }

  // ── hideout ───────────────────────────────────────────────────────────────

  async enterHideout(sid: string, ownerId?: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const owner = ownerId && typeof ownerId === 'string' ? ownerId : p.userId;
    if (owner === p.userId) {
      // no free warp home — the only way out of the zone is an extraction beacon
      this.toast(sid, 'Reach an extraction beacon to get home');
      return;
    }
    if (inst.kind !== 'world' || !this.isSafeAt(inst, p.x, p.y)) {
      this.toast(sid, 'You can only visit a camp from a safe zone');
      return;
    }
    const ok = await this.db.areFriends(owner, p.userId);
    if (!ok) {
      this.toast(sid, 'You are not on that hideout’s access list');
      return;
    }
    p.returnPos = { x: p.x, y: p.y };
    const h = await this.hideoutInstance(owner);
    const spawn = h.spawns[0];
    this.switchInstance(p, h, spawn.x, spawn.y);
    this.toast(sid, owner === p.userId ? 'Welcome home' : 'Entered a friend’s hideout');
  }

  leaveHideout(sid: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (this.inst(p).kind !== 'hideout') return;
    const world = this.instances.get(WORLD)!;
    // came in from a safe zone → go back there; fresh from home → random deployment
    const ret = p.returnPos ?? world.spawns[Math.floor(this.rnd() * world.spawns.length)];
    p.returnPos = null;
    this.switchInstance(p, world, ret.x, ret.y);
    this.toast(sid, 'Deployed into the zone — H from a safe zone gets you home');
  }

  // ── inventory primitives ──────────────────────────────────────────────────

  private addItem(inv: Inventory, id: ItemId, qty: number): number {
    const def = ITEMS[id];
    const cap = invCapacity(inv);
    const room = Math.max(0, cap.maxKg - invWeight(inv));
    const maxByWeight = def.kg > 0 ? Math.floor(room / def.kg + 1e-9) : qty;
    const remaining = Math.min(qty, maxByWeight);
    if (remaining <= 0) return qty;
    let toPlace = remaining;
    for (const s of inv.slots) {
      if (toPlace <= 0) break;
      if (s && s.id === id && s.qty < def.stack) {
        const add = Math.min(def.stack - s.qty, toPlace);
        s.qty += add;
        toPlace -= add;
      }
    }
    for (let i = 0; i < inv.slots.length && toPlace > 0; i++) {
      if (!inv.slots[i]) {
        const add = Math.min(def.stack, toPlace);
        inv.slots[i] = { id, qty: add };
        toPlace -= add;
      }
    }
    return qty - (remaining - toPlace);
  }

  private removeItem(inv: Inventory, id: ItemId, qty: number): number {
    let left = qty;
    for (let i = 0; i < inv.slots.length && left > 0; i++) {
      const s = inv.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.qty, left);
        s.qty -= take;
        left -= take;
        if (s.qty <= 0) inv.slots[i] = null;
      }
    }
    return qty - left;
  }

  private countItem(inv: Inventory, id: ItemId): number {
    return inv.slots.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0);
  }

  private dropAt(inst: Instance, x: number, y: number, id: ItemId, qty: number) {
    if (!id || qty <= 0) return;
    const gid = `g${this.nextId++}`;
    inst.ground.set(gid, { id: gid, x, y, item: id, qty });
  }

  private spawnGroundAt(inst: Instance, x: number, y: number) {
    const roll = rollGround(this.rnd);
    const gid = `g${this.nextId++}`;
    inst.ground.set(gid, { id: gid, x, y, item: roll.id, qty: roll.qty });
  }

  private spawnEnemy(inst: Instance, x: number, y: number, kind: EnemyKind) {
    // never spawn inside solid tiles — search nearby free ground
    if (this.isBlocked(inst, x, y, ENEMY_RADIUS)) {
      let found = false;
      for (let r = 1; r <= 4 && !found; r++)
        for (let dy = -r; dy <= r && !found; dy++)
          for (let dx = -r; dx <= r && !found; dx++) {
            const nx = x + dx * TILE;
            const ny = y + dy * TILE;
            if (!this.isBlocked(inst, nx, ny, ENEMY_RADIUS)) {
              x = nx;
              y = ny;
              found = true;
            }
          }
      if (!found) return; // nowhere sane to put it
    }
    const def = ENEMY_DEFS[kind];
    const id = `e${this.nextId++}`;
    inst.enemies.set(id, {
      id, kind, x, y,
      angle: this.rnd() * Math.PI * 2,
      hp: def.maxHp,
      maxHp: def.maxHp,
      homeX: x,
      homeY: y,
      targetSid: null,
      nextAttackAt: 0,
      burstLeft: 0,
      nextBurstShotAt: 0,
      wanderAngle: this.rnd() * Math.PI * 2,
      nextWanderAt: 0,
      wandering: false,
      moving: false,
      detourUntil: 0,
      detourAngle: 0,
      enraged: false,
    });
  }

  // ── simulation ────────────────────────────────────────────────────────────

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const p of this.players.values()) {
      if (p.dead) continue;
      const inst = this.inst(p);
      // survival decay (paused inside hideouts — it's a rest space)
      if (inst.kind !== 'hideout') {
        p.hunger = Math.max(0, p.hunger - HUNGER_DECAY_PER_S * dt);
        p.thirst = Math.max(0, p.thirst - THIRST_DECAY_PER_S * dt);
        if (p.hunger <= 0 || p.thirst <= 0) {
          p.starveAcc += STARVE_DMG_PER_S * dt * ((p.hunger <= 0 ? 1 : 0) + (p.thirst <= 0 ? 1 : 0));
          if (p.starveAcc >= 1) {
            const dmg = Math.floor(p.starveAcc);
            p.starveAcc -= dmg;
            this.damagePlayer(p, dmg, p.thirst <= 0 ? 'dehydration' : 'starvation', null, null);
          }
        }
        // well fed & hydrated → slow passive healing (reward the survival loop)
        if (p.hunger > REGEN_THRESHOLD && p.thirst > REGEN_THRESHOLD && p.hp < PLAYER_MAX_HP) {
          p.regenAcc += REGEN_HP_PER_S * dt;
          if (p.regenAcc >= 1) {
            const heal = Math.floor(p.regenAcc);
            p.regenAcc -= heal;
            p.hp = Math.min(PLAYER_MAX_HP, p.hp + heal);
            this.pushInventory(p);
          }
        }
        const key = Math.floor(p.hunger) * 1000 + Math.floor(p.thirst);
        if (key !== p.lastPushedSurvival) {
          p.lastPushedSurvival = key;
          if (Math.floor(p.hunger) === 25 || Math.floor(p.thirst) === 25)
            this.toast(p.sid, p.thirst <= p.hunger ? 'You are getting thirsty' : 'You are getting hungry');
          this.pushInventory(p);
        }
      } else if (p.hp < PLAYER_MAX_HP) {
        // resting at home patches you up quickly
        p.regenAcc += HOME_REST_HP_PER_S * dt;
        if (p.regenAcc >= 1) {
          const heal = Math.floor(p.regenAcc);
          p.regenAcc -= heal;
          p.hp = Math.min(PLAYER_MAX_HP, p.hp + heal);
          this.pushInventory(p);
        }
      }
      // timed actions: cancel on movement, complete on schedule
      if (p.action) {
        if (Math.hypot(p.x - p.actionStart.x, p.y - p.actionStart.y) > 14) {
          p.action = null;
          this.emitTo(p.sid, EV.action, { label: '', ms: 0 } satisfies ActionSnap);
        } else if (now >= p.action.until) {
          const act = p.action;
          p.action = null;
          this.completeAction(p, inst, act);
        }
      }
      // finish reloads
      if (p.reloadTarget && now >= p.reloadUntil) {
        const def = ITEMS[p.reloadTarget];
        if (def.weapon) {
          const have = p.mags[p.reloadTarget] ?? 0;
          const need = def.weapon.magSize - have;
          const taken = this.removeItem(p.inv, def.weapon.ammo, need);
          p.mags[p.reloadTarget] = have + taken;
        }
        p.reloadTarget = null;
        p.reloadUntil = 0;
        this.pushInventory(p);
      }
      let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        const speed = PLAYER_SPEED * (this.inWater(inst, p) ? SWIM_SPEED_MULT : 1);
        this.moveEntity(inst, p, dx * speed * dt, dy * speed * dt, PLAYER_RADIUS);
        p.moving = true;
      } else {
        p.moving = false;
      }
      if (p.input.shoot) this.tryAttack(p, inst, now);
    }

    const night = isNight((now % DAY_LENGTH_MS) / DAY_LENGTH_MS);
    for (const inst of this.instances.values()) {
      if (inst.kind === 'world') {
        this.updateEnemies(inst, dt, now, night);
        this.updateNpcs(inst, dt, now);
        // chest restock
        for (const c of inst.containers.values()) {
          if (c.kind !== 'bag' && c.kind !== 'storage' && c.restockAt && now >= c.restockAt) {
            c.slots = rollChest(this.rnd, c.tier);
            c.restockAt = null;
          }
        }
        // node regrowth
        for (let i = inst.nodeRespawns.length - 1; i >= 0; i--) {
          const nr = inst.nodeRespawns[i];
          if (now < nr.at) continue;
          const cx = (nr.i % inst.w) * TILE + TILE / 2;
          const cy = Math.floor(nr.i / inst.w) * TILE + TILE / 2;
          let occupied = false;
          for (const p of this.players.values())
            if (p.instanceId === inst.id && !p.dead && Math.hypot(p.x - cx, p.y - cy) < TILE * 1.2) { occupied = true; break; }
          if (occupied) {
            nr.at = now + 10_000;
            continue;
          }
          inst.tiles[nr.i] = nr.tile;
          this.io?.to(inst.id).emit(EV.tile, { i: nr.i, tile: nr.tile });
          inst.nodeRespawns.splice(i, 1);
        }
        // enemy respawns
        for (let i = inst.enemyRespawns.length - 1; i >= 0; i--) {
          const er = inst.enemyRespawns[i];
          if (now < er.at) continue;
          this.spawnEnemy(inst, er.x, er.y, er.kind);
          inst.enemyRespawns.splice(i, 1);
        }
        // world structures wear out
        for (const [i, s] of inst.structures) {
          if (now < s.expiresAt) continue;
          inst.structures.delete(i);
          inst.tiles[i] = Tile.Grass;
          this.io?.to(inst.id).emit(EV.tile, { i, tile: Tile.Grass });
        }
        // ground loot top-up
        if (inst.ground.size < 45 && now - inst.lastGroundSpawn > 5000 && inst.lootSpots.length > 0) {
          const spot = inst.lootSpots[Math.floor(this.rnd() * inst.lootSpots.length)];
          this.spawnGroundAt(inst, spot.x + (this.rnd() - 0.5) * 12, spot.y + (this.rnd() - 0.5) * 12);
          inst.lastGroundSpawn = now;
        }
      }
      this.updateProjectiles(inst, dt, now);
      this.broadcast(inst, now);
    }
  }

  private isBlocked(inst: Instance, x: number, y: number, radius: number, blocks: Record<number, boolean> = BLOCKS_MOVE): boolean {
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++)
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return true;
        if (blocks[inst.tiles[ty * inst.w + tx]]) return true;
      }
    return false;
  }

  private tileUnder(inst: Instance, x: number, y: number): Tile {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return Tile.Grass;
    return inst.tiles[ty * inst.w + tx] as Tile;
  }

  private inWater(inst: Instance, p: { x: number; y: number }): boolean {
    return this.tileUnder(inst, p.x, p.y) === Tile.Water;
  }

  private moveEntity(
    inst: Instance,
    e: { x: number; y: number },
    dx: number,
    dy: number,
    radius: number,
    blocks: Record<number, boolean> = BLOCKS_MOVE,
  ): boolean {
    let moved = false;
    const nx = e.x + dx;
    if (!this.isBlocked(inst, nx, e.y, radius, blocks)) { e.x = nx; moved = true; }
    const ny = e.y + dy;
    if (!this.isBlocked(inst, e.x, ny, radius, blocks)) { e.y = ny; moved = true; }
    return moved;
  }

  // ── attacks ───────────────────────────────────────────────────────────────

  private tryAttack(p: ServerPlayer, inst: Instance, now: number) {
    const slot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const def = slot ? ITEMS[slot.id] : null;
    if (def?.weapon) this.tryShoot(p, inst, def.weapon, slot!.id, now);
    else if (def?.kind === 'consumable') this.tryConsume(p, p.equipped!, now);
    else this.tryMelee(p, inst, def?.melee ?? FISTS, now);
  }

  /** Left-click with a held consumable → use one (rate-limited, no toast spam when full). */
  private tryConsume(p: ServerPlayer, slot: number, now: number) {
    if (now - p.lastAttackAt < 600) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = ITEMS[item.id];
    // items with a contextual action (cook raw / fill canteen) always try; pure
    // heal/food/drink are skipped when the need is already full so holding the
    // button doesn't chew the stack or spam "not hungry"
    if (!def.raw && !def.fillFrom) {
      if (def.heal && p.hp >= PLAYER_MAX_HP) return;
      if (def.food && p.hunger >= 100) return;
      if (def.drink && p.thirst >= 100) return;
    }
    p.lastAttackAt = now;
    p.lastSwingAt = now; // a little arm motion reads as "using it"
    this.invUse(p.sid, slot);
  }

  private tryShoot(p: ServerPlayer, inst: Instance, w: WeaponStats, weaponId: ItemId, now: number) {
    if (now - p.lastAttackAt < w.fireRateMs) return;
    if (now < p.reloadUntil) return; // mid-reload
    if (this.inWater(inst, p)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, 'You cannot shoot while swimming');
        p.lastAttackAt = now;
      }
      return;
    }
    if (this.isSafeAt(inst, p.x, p.y)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, 'Weapons are locked in the safe zone');
        p.lastAttackAt = now;
      }
      return;
    }
    const mag = p.mags[weaponId] ?? 0;
    if (mag <= 0) {
      this.startReload(p, weaponId, w, now, true);
      return;
    }
    p.mags[weaponId] = mag - 1;
    p.lastAttackAt = now;
    // skills + mods tighten spread
    let spread = w.spread * (1 - 0.01 * (skillLevel(p.skills.shooting) - 1));
    if (p.equipment.mod === 'attach_reddot') spread *= MOD_SPREAD_MULT;
    spread = Math.max(w.spread * 0.4, spread);
    const mx = p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 6);
    const my = p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 6);
    for (let i = 0; i < w.pellets; i++) {
      const a = p.angle + (this.rnd() - 0.5) * 2 * spread;
      inst.projectiles.push({
        id: this.nextId++,
        x: mx, y: my,
        vx: Math.cos(a) * w.bulletSpeed,
        vy: Math.sin(a) * w.bulletSpeed,
        angle: a,
        traveled: 0,
        range: w.range,
        damage: w.damage,
        owner: p.sid,
        ownerKind: null,
        weapon: weaponId,
      });
    }
    // gunshot noise draws the dead (bows are quiet; suppressors quieter still)
    const noise = Math.min(w.noise ?? 380, p.equipment.mod === 'attach_suppressor' ? SUPPRESSED_AGGRO_RANGE : Infinity);
    for (const e of inst.enemies.values()) {
      if (e.targetSid) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < noise) e.targetSid = p.sid;
    }
    this.pushInventory(p);
  }

  private startReload(p: ServerPlayer, weaponId: ItemId, w: WeaponStats, now: number, auto = false) {
    if (now < p.reloadUntil) return;
    const mag = p.mags[weaponId] ?? 0;
    if (mag >= w.magSize) return;
    if (this.countItem(p.inv, w.ammo) <= 0) {
      if (!auto || now - p.lastAttackAt > 800) {
        this.toast(p.sid, `No ${ITEMS[w.ammo].name}`);
        p.lastAttackAt = now;
      }
      return;
    }
    p.reloadUntil = now + w.reloadMs;
    p.reloadTarget = weaponId;
    this.pushInventory(p);
  }

  reload(sid: string) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.equipped === null) return;
    const slot = p.inv.slots[p.equipped];
    const def = slot ? ITEMS[slot.id] : null;
    if (def?.weapon) this.startReload(p, slot!.id, def.weapon, Date.now());
  }

  private tryMelee(p: ServerPlayer, inst: Instance, m: MeleeStats, now: number) {
    if (now - p.lastAttackAt < m.cooldownMs) return;
    if (this.inWater(inst, p)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, 'You cannot fight while swimming');
        p.lastAttackAt = now;
      }
      return;
    }
    // fishing rod + facing water = fish instead of swinging
    const eqSlot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    if (eqSlot?.id === 'fishing_rod') {
      for (const dist of [28, 48, 64]) {
        const wx = p.x + Math.cos(p.angle) * dist;
        const wy = p.y + Math.sin(p.angle) * dist;
        if (this.tileUnder(inst, wx, wy) === Tile.Water) {
          p.lastAttackAt = now;
          p.lastSwingAt = now;
          this.startAction(p, 'fish', 'Fishing…', FISH_TIME_MS);
          return;
        }
      }
    }
    p.lastAttackAt = now;
    p.lastSwingAt = now;

    const attackerSafe = this.isSafeAt(inst, p.x, p.y);
    const reach = m.range + PLAYER_RADIUS;
    const inArc = (tx: number, ty: number) => {
      const d = Math.hypot(tx - p.x, ty - p.y);
      if (d > reach) return Infinity;
      let da = Math.atan2(ty - p.y, tx - p.x) - p.angle;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      return Math.abs(da) < 1.0 ? d : Infinity;
    };

    if (!attackerSafe) {
      let victim: ServerPlayer | Enemy | Npc | null = null;
      let victimKind: 'player' | 'enemy' | 'npc' = 'player';
      let bestD = reach;
      for (const other of this.players.values()) {
        if (other.sid === p.sid || other.dead || other.instanceId !== inst.id) continue;
        if (this.isSafeAt(inst, other.x, other.y)) continue;
        const d = inArc(other.x, other.y);
        if (d < bestD) { victim = other; victimKind = 'player'; bestD = d; }
      }
      for (const e of inst.enemies.values()) {
        const d = inArc(e.x, e.y);
        if (d < bestD) { victim = e; victimKind = 'enemy'; bestD = d; }
      }
      for (const n of inst.npcs.values()) {
        const d = inArc(n.x, n.y);
        if (d < bestD) { victim = n; victimKind = 'npc'; bestD = d; }
      }
      if (victim) {
        const dmg = Math.round(m.damage * Math.min(1.3, 1 + 0.01 * (skillLevel(p.skills.melee) - 1)));
        this.addXp(p, 'melee', dmg);
        if (victimKind === 'enemy') this.damageEnemy(inst, victim as Enemy, dmg, p);
        else if (victimKind === 'npc') this.damageNpc(inst, victim as Npc, dmg, p, null);
        else this.damagePlayer(victim as ServerPlayer, dmg, p.name, null, p);
        return;
      }
    }

    // harvest node in front (canopies render tall — probe generously)
    for (const dist of [20, 36, 52]) {
      const hx = p.x + Math.cos(p.angle) * dist;
      const hy = p.y + Math.sin(p.angle) * dist;
      const tx = Math.floor(hx / TILE);
      const ty = Math.floor(hy / TILE);
      if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) continue;
      const i = ty * inst.w + tx;
      if (this.damageStructure(inst, i, m.damage)) return; // world-placed structures take melee damage
      const tile = inst.tiles[i] as Tile;
      const totalHits = NODE_HITS[tile];
      if (!totalHits) continue;

      const isTree = tile === Tile.Tree;
      const skill = isTree ? 'woodcutting' : 'mining';
      const bonus = Math.floor((skillLevel(p.skills[skill]) - 1) / 5);
      const yieldQty = (isTree ? m.wood : m.stone) + bonus;
      const resource: ItemId = isTree ? 'wood' : 'stone';
      this.addXp(p, skill, 6);
      const leftover = this.addItem(p.inv, resource, yieldQty);
      if (leftover >= yieldQty) {
        this.toast(p.sid, 'Inventory full');
        return;
      }
      this.hitFx(inst, tx * TILE + TILE / 2, ty * TILE + TILE / 2, yieldQty - leftover, 'node', isTree ? 'wood' : 'stone');

      const left = (inst.nodeHits.get(i) ?? totalHits) - 1;
      if (left <= 0) {
        inst.nodeHits.delete(i);
        const depleted = NODE_DEPLETED[tile] ?? Tile.Grass;
        inst.tiles[i] = depleted;
        this.io?.to(inst.id).emit(EV.tile, { i, tile: depleted });
        inst.nodeRespawns.push({ i, tile, at: now + NODE_RESPAWN_MS });
        this.toast(p.sid, isTree ? 'Tree felled' : 'Rock broken');
      } else {
        inst.nodeHits.set(i, left);
      }
      this.pushInventory(p);
      return;
    }
  }

  // ── enemies ───────────────────────────────────────────────────────────────

  private updateEnemies(inst: Instance, dt: number, now: number, night = false) {
    for (const e of inst.enemies.values()) {
      const def = ENEMY_DEFS[e.kind];
      // the dark belongs to the dead (and the wolves)
      const hunter = e.kind === 'zombie' || e.kind === 'wolf';
      const aggro = def.aggroRange * (night && hunter ? NIGHT_AGGRO_MULT : 1);
      const speed = def.speed * (night && e.kind === 'zombie' ? NIGHT_SPEED_MULT : 1);
      let target = e.targetSid ? this.players.get(e.targetSid) : undefined;
      if (
        !target ||
        target.dead ||
        target.instanceId !== inst.id ||
        this.isSafeAt(inst, target.x, target.y) ||
        Math.hypot(target.x - e.x, target.y - e.y) > Math.max(aggro * 1.6, e.enraged ? 480 : 0)
      ) {
        target = undefined;
        e.targetSid = null;
        let bestD = aggro;
        for (const p of this.players.values()) {
          if (p.dead || p.instanceId !== inst.id || this.isSafeAt(inst, p.x, p.y)) continue;
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          // walls (and forest) break line of sight — you can hide
          if (d < bestD && this.losClear(inst, e.x, e.y, p.x, p.y)) { target = p; bestD = d; }
        }
        if (target) e.targetSid = target.sid;
      }

      e.moving = false;
      if (target) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        e.angle = Math.atan2(dy, dx);

        // wall-stuck safeguard: steer around obstacles instead of grinding into them
        const steer = (speed: number, dirX: number, dirY: number) => {
          if (now < e.detourUntil) {
            this.moveEntity(inst, e, Math.cos(e.detourAngle) * speed * dt, Math.sin(e.detourAngle) * speed * dt, ENEMY_RADIUS, BLOCKS_ENEMY);
            e.moving = true;
            return;
          }
          const beforeX = e.x;
          const beforeY = e.y;
          this.moveEntity(inst, e, dirX * speed * dt, dirY * speed * dt, ENEMY_RADIUS, BLOCKS_ENEMY);
          e.moving = true;
          const moved = Math.hypot(e.x - beforeX, e.y - beforeY);
          if (moved < speed * dt * 0.35) {
            e.detourAngle = Math.atan2(dirY, dirX) + (this.rnd() < 0.5 ? 1 : -1) * (Math.PI / 2 + this.rnd() * 0.6);
            e.detourUntil = now + 450 + this.rnd() * 350;
          }
        };
        const chase = (speed: number) => steer(speed, dx / dist, dy / dist);

        if (def.behavior === 'flee') {
          // animals never fight — they bolt away from whoever spooked them
          e.angle = Math.atan2(-dy, -dx);
          steer(def.speed, -dx / dist, -dy / dist);
          continue;
        }

        if (def.behavior === 'melee') {
          if (dist > def.attackRange - 4) {
            chase(speed);
          } else if (now >= e.nextAttackAt) {
            e.nextAttackAt = now + def.attackMs;
            this.damagePlayer(target, def.damage, `a ${def.name}`, null, null);
            this.hitFx(inst, target.x, target.y, def.damage, 'player');
          }
        } else {
          if (dist > def.attackRange) {
            chase(def.speed);
          } else if (dist < 120) {
            this.moveEntity(inst, e, (-dx / dist) * def.speed * 0.7 * dt, (-dy / dist) * def.speed * 0.7 * dt, ENEMY_RADIUS, BLOCKS_ENEMY);
            e.moving = true;
          }
          if (e.burstLeft <= 0 && now >= e.nextAttackAt && dist <= def.attackRange + 40) {
            e.burstLeft = 3;
            e.nextAttackAt = now + def.attackMs + this.rnd() * 700;
          }
          if (e.burstLeft > 0 && now >= e.nextBurstShotAt) {
            e.burstLeft--;
            e.nextBurstShotAt = now + 110;
            const a = e.angle + (this.rnd() - 0.5) * 0.24;
            inst.projectiles.push({
              id: this.nextId++,
              x: e.x + Math.cos(e.angle) * (ENEMY_RADIUS + 6),
              y: e.y + Math.sin(e.angle) * (ENEMY_RADIUS + 6),
              vx: Math.cos(a) * 700,
              vy: Math.sin(a) * 700,
              angle: a,
              traveled: 0,
              range: 480,
              damage: def.damage,
              owner: e.id,
              ownerKind: e.kind,
              weapon: 'rifle',
            });
          }
        }
      } else {
        const homeDist = Math.hypot(e.homeX - e.x, e.homeY - e.y);
        if (homeDist > 10 * TILE) {
          const a = Math.atan2(e.homeY - e.y, e.homeX - e.x);
          e.angle = a;
          this.moveEntity(inst, e, Math.cos(a) * def.speed * 0.6 * dt, Math.sin(a) * def.speed * 0.6 * dt, ENEMY_RADIUS, BLOCKS_ENEMY);
          e.moving = true;
        } else {
          if (now >= e.nextWanderAt) {
            e.wandering = this.rnd() < 0.55;
            e.wanderAngle = this.rnd() * Math.PI * 2;
            e.nextWanderAt = now + 1500 + this.rnd() * 2500;
          }
          if (e.wandering) {
            e.angle = e.wanderAngle;
            const ok = this.moveEntity(
              inst, e,
              Math.cos(e.wanderAngle) * def.speed * 0.35 * dt,
              Math.sin(e.wanderAngle) * def.speed * 0.35 * dt,
              ENEMY_RADIUS,
              BLOCKS_ENEMY,
            );
            if (!ok) e.wanderAngle = this.rnd() * Math.PI * 2;
            e.moving = true;
          }
        }
      }
    }
  }

  private damageEnemy(inst: Instance, e: Enemy, dmg: number, attacker: ServerPlayer | null, ranged = false) {
    e.hp -= dmg;
    this.hitFx(inst, e.x, e.y, dmg, 'enemy');
    if (attacker) {
      e.targetSid = attacker.sid;
      e.enraged = true; // neutral animals fight back (or bolt further) once hurt
      if (ranged) this.addXp(attacker, 'shooting', dmg);
    }
    if (e.hp > 0) return;
    inst.enemies.delete(e.id);
    if (attacker) {
      attacker.kills++;
      this.toast(attacker.sid, `☠ ${ENEMY_DEFS[e.kind].name} down`);
      // kill-quest progress
      for (const def of this.quests) {
        if (def.kind !== 'kill' || def.target !== e.kind) continue;
        const prog = attacker.quests[def.id] ?? { kills: 0, claimed: false };
        if (!prog.claimed && prog.kills < def.count) {
          prog.kills++;
          attacker.quests[def.id] = prog;
          if (prog.kills === def.count) this.toast(attacker.sid, `Job done: ${def.name} — see the trader`);
        }
      }
      this.pushInventory(attacker);
    }
    const drops = rollEnemyDrop(this.rnd, e.kind);
    if (drops.length > 0) {
      const id = `b${this.nextId++}`;
      inst.containers.set(id, { id, x: e.x, y: e.y, kind: 'bag', tier: 'normal', slots: drops, restockAt: null });
    }
    inst.enemyRespawns.push({ x: e.homeX, y: e.homeY, kind: e.kind, at: Date.now() + ENEMY_RESPAWN_MS + this.rnd() * 30_000 });
  }

  // ── survivor NPCs ─────────────────────────────────────────────────────────

  private static readonly NPC_NAMES = ['Marek', 'Ivo', 'Sasha', 'Yuri', 'Petra', 'Dain', 'Olek', 'Vera'];
  private static readonly NPC_SPEED = 150;

  private spawnNpc(inst: Instance, hostile: boolean) {
    const spawn = inst.spawns[Math.floor(this.rnd() * inst.spawns.length)];
    if (!spawn) return;
    const id = `npc${this.nextId++}`;
    inst.npcs.set(id, {
      id,
      name: GameService.NPC_NAMES[Math.floor(this.rnd() * GameService.NPC_NAMES.length)],
      x: spawn.x,
      y: spawn.y,
      angle: this.rnd() * Math.PI * 2,
      hp: 100,
      hostile,
      weapon: hostile ? 'pistol' : 'axe',
      targetSid: null,
      targetI: -1,
      nextSwingAt: 0,
      lastSwingAt: 0,
      nextShotAt: 0,
      nextThinkAt: 0,
      wanderAngle: this.rnd() * Math.PI * 2,
      wandering: false,
      moving: false,
      detourUntil: 0,
      detourAngle: 0,
    });
  }

  private updateNpcs(inst: Instance, dt: number, now: number) {
    for (const n of inst.npcs.values()) {
      n.moving = false;
      const steer = (speed: number, dirX: number, dirY: number) => {
        if (now < n.detourUntil) {
          this.moveEntity(inst, n, Math.cos(n.detourAngle) * speed * dt, Math.sin(n.detourAngle) * speed * dt, PLAYER_RADIUS, BLOCKS_ENEMY);
          n.moving = true;
          return;
        }
        const bx = n.x;
        const by = n.y;
        this.moveEntity(inst, n, dirX * speed * dt, dirY * speed * dt, PLAYER_RADIUS, BLOCKS_ENEMY);
        n.moving = true;
        if (Math.hypot(n.x - bx, n.y - by) < speed * dt * 0.35) {
          n.detourAngle = Math.atan2(dirY, dirX) + (this.rnd() < 0.5 ? 1 : -1) * (Math.PI / 2 + this.rnd() * 0.6);
          n.detourUntil = now + 450 + this.rnd() * 350;
        }
      };

      // target upkeep: drop dead / distant / safe / wall-hidden marks
      let target = n.targetSid ? this.players.get(n.targetSid) : undefined;
      if (
        !target ||
        target.dead ||
        target.instanceId !== inst.id ||
        this.isSafeAt(inst, target.x, target.y) ||
        Math.hypot(target.x - n.x, target.y - n.y) > 460
      ) {
        target = undefined;
        n.targetSid = null;
      }
      // raiders acquire targets on sight (never through walls)
      if (!target && n.hostile) {
        let bestD = 300;
        for (const p of this.players.values()) {
          if (p.dead || p.instanceId !== inst.id || this.isSafeAt(inst, p.x, p.y)) continue;
          const d = Math.hypot(p.x - n.x, p.y - n.y);
          if (d < bestD && this.losClear(inst, n.x, n.y, p.x, p.y)) { target = p; bestD = d; }
        }
        if (target) n.targetSid = target.sid;
      }

      if (target) {
        const dx = target.x - n.x;
        const dy = target.y - n.y;
        const dist = Math.hypot(dx, dy) || 1;
        n.angle = Math.atan2(dy, dx);
        const seen = this.losClear(inst, n.x, n.y, target.x, target.y);
        if (n.weapon === 'pistol') {
          if (dist > 200 || !seen) steer(GameService.NPC_SPEED, dx / dist, dy / dist);
          if (seen && dist <= 280 && now >= n.nextShotAt) {
            n.nextShotAt = now + 900 + this.rnd() * 500;
            const a = n.angle + (this.rnd() - 0.5) * 0.14;
            inst.projectiles.push({
              id: this.nextId++,
              x: n.x + Math.cos(n.angle) * (PLAYER_RADIUS + 6),
              y: n.y + Math.sin(n.angle) * (PLAYER_RADIUS + 6),
              vx: Math.cos(a) * 700,
              vy: Math.sin(a) * 700,
              angle: a,
              traveled: 0,
              range: 460,
              damage: 11,
              owner: n.id,
              ownerKind: null,
              weapon: 'pistol',
            });
          }
        } else {
          // provoked harvester: axe to the face
          if (dist > 34) steer(GameService.NPC_SPEED * 1.05, dx / dist, dy / dist);
          else if (now >= n.nextSwingAt) {
            n.nextSwingAt = now + 700;
            n.lastSwingAt = now;
            this.damagePlayer(target, 13, n.name, 'axe', null);
            this.hitFx(inst, target.x, target.y, 13, 'player');
          }
        }
        continue;
      }

      // peaceful loop: find a tree, chop it, wander on
      if (n.targetI >= 0 && inst.tiles[n.targetI] !== Tile.Tree) n.targetI = -1;
      if (n.targetI >= 0) {
        const tx = n.targetI % inst.w;
        const ty = Math.floor(n.targetI / inst.w);
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE + TILE; // stand just south of the trunk
        const dx = cx - n.x;
        const dy = cy - n.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 20) {
          n.angle = Math.atan2(dy, dx);
          steer(GameService.NPC_SPEED * 0.8, dx / dist, dy / dist);
        } else {
          n.angle = Math.atan2((ty + 0.5) * TILE - n.y, (tx + 0.5) * TILE - n.x);
          if (now >= n.nextSwingAt) {
            n.nextSwingAt = now + 900;
            n.lastSwingAt = now;
            this.npcChop(inst, n.targetI, now);
          }
        }
        continue;
      }
      if (now >= n.nextThinkAt) {
        n.nextThinkAt = now + 2500 + this.rnd() * 4000;
        if (!n.hostile && this.rnd() < 0.65) {
          // look for a tree within ~9 tiles
          const ntx = Math.floor(n.x / TILE);
          const nty = Math.floor(n.y / TILE);
          let best = -1;
          let bd = Infinity;
          for (let ty = Math.max(1, nty - 9); ty <= Math.min(inst.h - 2, nty + 9); ty++)
            for (let tx = Math.max(1, ntx - 9); tx <= Math.min(inst.w - 2, ntx + 9); tx++) {
              if (inst.tiles[ty * inst.w + tx] !== Tile.Tree) continue;
              const d = (tx - ntx) ** 2 + (ty - nty) ** 2;
              if (d < bd) { bd = d; best = ty * inst.w + tx; }
            }
          if (best >= 0) { n.targetI = best; continue; }
        }
        n.wandering = this.rnd() < 0.7;
        n.wanderAngle = this.rnd() * Math.PI * 2;
      }
      if (n.wandering) {
        n.angle = n.wanderAngle;
        steer(GameService.NPC_SPEED * 0.45, Math.cos(n.wanderAngle), Math.sin(n.wanderAngle));
      }
    }

    // fallen survivors are replaced eventually
    for (let i = inst.npcRespawns.length - 1; i >= 0; i--) {
      if (now < inst.npcRespawns[i].at) continue;
      this.spawnNpc(inst, inst.npcRespawns[i].hostile);
      inst.npcRespawns.splice(i, 1);
    }
  }

  /** NPC tree chopping: same depletion pipeline as players, no inventory. */
  private npcChop(inst: Instance, i: number, now: number) {
    this.hitFx(inst, (i % inst.w) * TILE + TILE / 2, Math.floor(i / inst.w) * TILE + TILE / 2, 1, 'node', 'wood');
    const left = (inst.nodeHits.get(i) ?? NODE_HITS[Tile.Tree]!) - 1;
    if (left <= 0) {
      inst.nodeHits.delete(i);
      inst.tiles[i] = Tile.Stump;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: Tile.Stump });
      inst.nodeRespawns.push({ i, tile: Tile.Tree, at: now + NODE_RESPAWN_MS });
    } else {
      inst.nodeHits.set(i, left);
    }
  }

  private damageNpc(inst: Instance, n: Npc, dmg: number, attacker: ServerPlayer | null, weapon: ItemId | null, ranged = false) {
    n.hp -= dmg;
    this.hitFx(inst, n.x, n.y, dmg, 'player');
    if (attacker) {
      n.targetSid = attacker.sid; // even the peaceful ones fight back
      n.targetI = -1;
      if (ranged) this.addXp(attacker, 'shooting', dmg);
    }
    if (n.hp > 0) return;
    inst.npcs.delete(n.id);
    const drops: InvSlot[] = n.hostile
      ? [{ id: 'pistol', qty: 1 }, { id: 'ammo_9mm', qty: 6 + Math.floor(this.rnd() * 8) }]
      : [{ id: 'wood', qty: 5 + Math.floor(this.rnd() * 8) }, { id: 'cloth', qty: 1 + Math.floor(this.rnd() * 3) }];
    const bagId = `b${this.nextId++}`;
    inst.containers.set(bagId, { id: bagId, x: n.x, y: n.y, kind: 'bag', tier: 'normal', slots: drops, restockAt: null });
    if (attacker) {
      attacker.kills++;
      this.toast(attacker.sid, `☠ ${n.name} down`);
      this.pushInventory(attacker);
    }
    this.io?.emit(EV.killfeed, { killer: attacker?.name ?? '?', victim: n.name, weapon });
    inst.npcRespawns.push({ at: Date.now() + 150_000 + this.rnd() * 60_000, hostile: n.hostile });
  }

  /** Straight-line sight check — walls, trees and rock block vision. */
  private losClear(inst: Instance, x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 12);
    const sx = (x2 - x1) / steps;
    const sy = (y2 - y1) / steps;
    // skip the endpoints' own tiles so hugging a wall doesn't blind you
    for (let s = 1; s < steps; s++) {
      const tx = Math.floor((x1 + sx * s) / TILE);
      const ty = Math.floor((y1 + sy * s) / TILE);
      if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return false;
      if (BLOCKS_BULLET[inst.tiles[ty * inst.w + tx]]) return false;
    }
    return true;
  }

  // ── projectiles & player damage ───────────────────────────────────────────

  private updateProjectiles(inst: Instance, dt: number, now: number) {
    if (inst.projectiles.length === 0) return;
    const survivors: Projectile[] = [];
    for (const pr of inst.projectiles) {
      const dist = Math.hypot(pr.vx, pr.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 8));
      const sx = (pr.vx * dt) / steps;
      const sy = (pr.vy * dt) / steps;
      let alive = true;
      for (let s = 0; s < steps && alive; s++) {
        pr.x += sx;
        pr.y += sy;
        pr.traveled += Math.hypot(sx, sy);
        if (pr.traveled >= pr.range) { alive = false; break; }
        const tx = Math.floor(pr.x / TILE);
        const ty = Math.floor(pr.y / TILE);
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) { alive = false; break; }
        if (BLOCKS_BULLET[inst.tiles[ty * inst.w + tx]]) {
          this.damageStructure(inst, ty * inst.w + tx, pr.damage); // player-built cover soaks bullets
          alive = false;
          break;
        }
        for (const target of this.players.values()) {
          if (target.sid === pr.owner || target.dead || target.instanceId !== inst.id) continue;
          if (Math.hypot(target.x - pr.x, target.y - pr.y) <= PLAYER_RADIUS + 3) {
            alive = false;
            if (!this.isSafeAt(inst, target.x, target.y)) {
              const shooter = pr.ownerKind === null ? this.players.get(pr.owner) : undefined;
              const killerName = pr.ownerKind
                ? `a ${ENEMY_DEFS[pr.ownerKind].name}`
                : shooter?.name ?? inst.npcs.get(pr.owner)?.name ?? '?';
              this.hitFx(inst, pr.x, pr.y, pr.damage, 'player');
              this.damagePlayer(target, pr.damage, killerName, pr.weapon, shooter ?? null);
            }
            break;
          }
        }
        if (!alive) break;
        for (const n of inst.npcs.values()) {
          if (n.id === pr.owner) continue;
          if (Math.hypot(n.x - pr.x, n.y - pr.y) <= PLAYER_RADIUS + 3) {
            alive = false;
            const shooter = pr.ownerKind === null ? this.players.get(pr.owner) : undefined;
            this.damageNpc(inst, n, pr.damage, shooter ?? null, pr.weapon, true);
            break;
          }
        }
        if (!alive) break;
        for (const e of inst.enemies.values()) {
          if (e.id === pr.owner || e.kind === pr.ownerKind) continue;
          if (Math.hypot(e.x - pr.x, e.y - pr.y) <= ENEMY_RADIUS + 3) {
            alive = false;
            const shooter = pr.ownerKind === null ? this.players.get(pr.owner) : undefined;
            this.damageEnemy(inst, e, pr.damage, shooter ?? null, true);
            break;
          }
        }
      }
      if (alive) survivors.push(pr);
    }
    inst.projectiles = survivors;
  }

  private damagePlayer(
    target: ServerPlayer,
    dmg: number,
    killerName: string,
    weapon: ItemId | null,
    killer: ServerPlayer | null,
  ) {
    if (target.dead) return;
    const mitigated = Math.max(1, Math.round(dmg * armorMultiplier(target.equipment)));
    target.hp -= mitigated;
    if (target.hp > 0) {
      this.pushInventory(target);
      return;
    }
    target.hp = 0;
    target.dead = true;
    target.deaths++;
    if (killer) {
      killer.kills++;
      this.pushInventory(killer);
    }

    const inst = this.inst(target);
    const dropped = target.inv.slots.filter((s): s is NonNullable<InvSlot> => !!s);
    if (target.equipment.helmet) dropped.push({ id: target.equipment.helmet, qty: 1 });
    if (target.equipment.vest) dropped.push({ id: target.equipment.vest, qty: 1 });
    if (target.equipment.mod) dropped.push({ id: target.equipment.mod, qty: 1 });
    if (dropped.length > 0) {
      const id = `b${this.nextId++}`;
      inst.containers.set(id, { id, x: target.x, y: target.y, kind: 'bag', tier: 'normal', slots: dropped, restockAt: null });
    }
    target.inv = this.starterInventory();
    target.equipment = { helmet: null, vest: null, mod: null };
    target.equipped = null;
    target.mags = {};
    this.pushInventory(target);
    this.emitTo(target.sid, EV.death, { by: killerName });
    this.io?.emit(EV.killfeed, { killer: killerName, victim: target.name, weapon });
    void this.saveProfileOf(target);
  }

  // ── output ────────────────────────────────────────────────────────────────

  private hitFx(inst: Instance, x: number, y: number, amount: number, kind: HitSnap['kind'], material?: 'wood' | 'stone') {
    const payload: HitSnap = { x: Math.round(x), y: Math.round(y), amount, kind };
    if (material) payload.material = material;
    this.io?.to(inst.id).emit(EV.hit, payload);
  }

  /** How far you can sense entities even without direct sight (footsteps, rustling). */
  private static readonly SENSE_RANGE = 130;

  private broadcast(inst: Instance, now: number) {
    if (!this.io) return;
    if (inst.players <= 0) return;
    const allPlayers: StateSnap['players'] = [];
    for (const p of this.players.values()) {
      if (p.instanceId !== inst.id) continue;
      allPlayers.push({
        id: p.sid,
        name: p.name,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 100) / 100,
        hp: p.hp,
        maxHp: PLAYER_MAX_HP,
        weapon: p.equipped !== null && p.inv.slots[p.equipped] ? p.inv.slots[p.equipped]!.id : null,
        helmet: p.equipment.helmet,
        vest: p.equipment.vest,
        dead: p.dead,
        moving: p.moving,
        swing: now - p.lastSwingAt < 400 ? p.lastSwingAt : 0,
      });
    }
    for (const n of inst.npcs.values()) {
      allPlayers.push({
        id: n.id,
        name: n.name,
        x: Math.round(n.x * 10) / 10,
        y: Math.round(n.y * 10) / 10,
        angle: Math.round(n.angle * 100) / 100,
        hp: n.hp,
        maxHp: PLAYER_MAX_HP,
        weapon: n.weapon,
        helmet: null,
        vest: null,
        dead: false,
        moving: n.moving,
        swing: now - n.lastSwingAt < 400 ? n.lastSwingAt : 0,
      });
    }
    const allEnemies: StateSnap['enemies'] = [...inst.enemies.values()].map((e) => ({
      id: e.id,
      kind: e.kind,
      x: Math.round(e.x * 10) / 10,
      y: Math.round(e.y * 10) / 10,
      angle: Math.round(e.angle * 100) / 100,
      hp: e.hp,
      maxHp: e.maxHp,
      moving: e.moving,
    }));
    const base = {
      t: now,
      day: (now % DAY_LENGTH_MS) / DAY_LENGTH_MS,
      projectiles: inst.projectiles.map((pr) => ({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), angle: pr.angle })),
      containers: [...inst.containers.values()].map(
        (c): ContainerSnap => ({ id: c.id, x: c.x, y: c.y, kind: c.kind, looted: c.slots.every((s) => !s) }),
      ),
      ground: [...inst.ground.values()].map(
        (g): GroundItemSnap => ({ id: g.id, x: Math.round(g.x), y: Math.round(g.y), item: g.item, qty: g.qty }),
      ),
    };
    if (inst.kind === 'hideout') {
      // your own camp: nothing to hide
      this.io.to(inst.id).emit(EV.state, { ...base, players: allPlayers, enemies: allEnemies } satisfies StateSnap);
      return;
    }
    // per-viewer snapshots: walls (and forest) hide other players, NPCs and enemies
    for (const viewer of this.players.values()) {
      if (viewer.instanceId !== inst.id) continue;
      const sees = (x: number, y: number) =>
        viewer.dead ||
        Math.hypot(x - viewer.x, y - viewer.y) < GameService.SENSE_RANGE ||
        this.losClear(inst, viewer.x, viewer.y, x, y);
      const snap: StateSnap = {
        ...base,
        players: allPlayers.filter((s) => s.id === viewer.sid || sees(s.x, s.y)),
        enemies: allEnemies.filter((s) => sees(s.x, s.y)),
      };
      this.emitTo(viewer.sid, EV.state, snap);
    }
  }

  private pushInventory(p: ServerPlayer) {
    // never hold an empty slot (e.g. after finishing a stack of food in hand)
    if (p.equipped !== null && !p.inv.slots[p.equipped]) p.equipped = null;
    const eqSlot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const mag = eqSlot && ITEMS[eqSlot.id].weapon ? p.mags[eqSlot.id] ?? 0 : 0;
    this.emitTo(p.sid, EV.inventory, {
      inv: p.inv,
      equipped: p.equipped,
      equipment: p.equipment,
      hp: p.hp,
      kills: p.kills,
      deaths: p.deaths,
      money: p.money,
      skills: p.skills,
      mag,
      reloading: !!p.reloadTarget,
      nearWorkbench: this.nearTile(p, Tile.Workbench),
      nearFirepit: this.nearTile(p, Tile.Firepit),
      nearFurnace: this.nearTile(p, Tile.Furnace),
      nearWater: this.nearTile(p, Tile.Water),
      hunger: Math.round(p.hunger),
      thirst: Math.round(p.thirst),
    });
  }

  private toast(sid: string, msg: string) {
    this.emitTo(sid, EV.toast, msg);
  }

  private emitTo(sid: string, ev: string, payload: unknown) {
    this.io?.to(sid).emit(ev, payload);
  }

  private async saveAll() {
    await Promise.all([...this.players.values()].map((p) => this.saveProfileOf(p)));
  }
}
