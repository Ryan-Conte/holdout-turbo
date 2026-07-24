import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Server } from "socket.io";
import {
  ActionSnap,
  AdminActionPayload,
  AdminPanelState,
  BACKPACKS,
  BLOCKS_ENEMY,
  BUILDABLES,
  BuildType,
  CHARACTER_ACCENT_COLORS,
  CHARACTER_BODY_NAMES,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_NAMES,
  CHARACTER_OUTFIT_COLORS,
  CHARACTER_SKIN_COLORS,
  CharacterAppearance,
  COOK_TIME_MS,
  CLAN_HOLDOUT_H,
  CLAN_HOLDOUT_STORAGE_SLOTS,
  CLAN_HOLDOUT_W,
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
  COPPER_CHANCE,
  DAY_LENGTH_MS,
  EMPTY_SKILLS,
  EV,
  EXTRACT_TIME_MS,
  IRON_CHANCE,
  HOME_REST_HP_PER_S,
  NIGHT_AGGRO_MULT,
  NIGHT_SPEED_MULT,
  isNight,
  EnemyKind,
  Equipment,
  FATIGUE_SPEED_MULT,
  FISTS,
  FLOOR_TILES,
  GroundItemSnap,
  HIDEOUT_H,
  HIDEOUT_STORAGE_SLOTS,
  HIDEOUT_W,
  HitSnap,
  MOD_SPREAD_MULT,
  INTERACT_RANGE,
  InputPayload,
  InstanceKind,
  InvSlot,
  Inventory,
  ItemId,
  MeleeStats,
  NODE_HITS,
  NODE_RESPAWN_MS,
  ORE_YIELD,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PoiSnap,
  QuestDef,
  QuestStatus,
  RuntimeRecipe,
  RuntimeWeaponStats,
  repairInfo,
  REGEN_HP_PER_S,
  REGEN_THRESHOLD,
  STARTING_MONEY,
  SPRINT_DRAIN_PER_S,
  SPRINT_SPEED_MULT,
  STAMINA_EXHAUSTED_RECOVERY,
  STAMINA_EXHAUSTED_REGEN_DELAY_MS,
  STAMINA_MAX,
  STAMINA_REGEN_DELAY_MS,
  STAMINA_REGEN_PER_S,
  STATION_FUEL_MAX,
  STATION_FUEL_PER_ACTION,
  STATION_FUEL_PER_WOOD,
  MINE_STAMINA_COST,
  SUPPRESSED_AGGRO_RANGE,
  Skills,
  StateSnap,
  StationOpen,
  TICK_MS,
  TILE,
  TraderTier,
  Tile,
  WorldInit,
  armorMultiplier,
  encodeByteRuns,
  encodeTerrainRuns,
  invCapacity,
  invWeight,
  skillLevel,
} from "@holdout/shared";
import { DbService, PersistedWorldState, QuestProg } from "../db/db.service";
import { ContentService } from "./content.service";
import {
  ChestTier,
  GeneratedMap,
  TERRAIN_ID_BY_TILE,
  fromAuthored,
  generateMap,
  mulberry32,
  resourceKindsFromTiles,
  terrainKindsFromTiles,
} from "./mapgen";
import { rollChest, rollEnemyDrop, rollGround, rollNamed } from "./loot";
import {
  addInventoryItem,
  canPayRecipe,
  collectCarriedDrops,
  countInventoryItem,
  removeInventoryItem,
} from "./rules/inventory.rules";
import {
  actionInterruptedByDamage,
  actionInterruptedByMovement,
  clanHideoutExitTarget,
  combatAttackAllowed,
  elevationStepAllowed,
  fatigueMoveMultiplier,
  harvestResourceTileMatches,
  questCanClaim,
  questUnlocked as questRuleUnlocked,
  restoredStructureTile,
} from "./rules/simulation.rules";
import { consumeFuel, planFuelAddition } from "./rules/station.rules";
import {
  canBuildClanHideout,
  canDemolishClanHideout,
} from "./rules/clan.rules";
import {
  adminItemQuantity,
  adminSanctionMinutes,
  adminText,
  adminTileCoordinate,
} from "./rules/admin.rules";
import {
  randomEventDelay,
  randomEventType,
} from "./rules/random-event.rules";
import {
  chestRestockAtAfterOpen,
  droppedLootExpiresAt,
  purgeExpiredLoot,
} from "./rules/loot-lifecycle.rules";
import { TelemetryService } from "./telemetry.service";
import type {
  Enemy,
  GameContainer as Container,
  GameInstance as Instance,
  GroundItem,
  NodeRespawnState,
  Projectile,
  RandomWorldEvent,
  ResourceFamily,
  ServerBotState,
  ServerPlayer,
} from "./game.types";

const ENEMY_RADIUS = 12;
const WORLD = "world";
const LOS_MEMORY_MS = 12_000; // how long an enemy keeps hunting a target it can't see
const LOS_GIVE_UP_MS = 2500; // …but once it reaches your last-seen spot, it gives up fast
const BOT_SYNC_MS = 2000;
const BOT_SELF_CARE_MS = 700;
const BOT_BUILD_COOLDOWN_MS = 12_000;
const BOT_TRADE_COOLDOWN_MS = 1800;
const SNAPSHOT_VIEW_RANGE = 1100;
const PLAYER_LEASE_TTL_SECONDS = 45;
const PLAYER_LEASE_HEARTBEAT_MS = 15_000;
const MAX_RANDOM_EVENTS = 2;
const SUPPLY_DROP_TTL_MS = 12 * 60_000;
const BOSS_EVENT_TTL_MS = 18 * 60_000;
const configuredPlayerCapacity = Number(
  process.env.MAX_PLAYERS_PER_SERVER ?? 200,
);
const MAX_PLAYERS_PER_SERVER = Number.isFinite(configuredPlayerCapacity)
  ? Math.max(10, Math.min(500, Math.floor(configuredPlayerCapacity)))
  : 200;
type CraftingStation = "workbench" | "firepit" | "furnace" | "anvil";
const BOT_NAME_PREFIXES = [
  "Ash",
  "Badger",
  "Brick",
  "Copper",
  "Crow",
  "Dust",
  "Echo",
  "Flint",
  "Ghost",
  "Hollow",
  "Kodiak",
  "Mako",
  "Nova",
  "Rook",
  "Sable",
  "Slate",
  "Vandal",
  "Warden",
];
const BOT_NAME_SUFFIXES = [
  "Bandit",
  "Coyote",
  "Drifter",
  "Fox",
  "Hawk",
  "Jackal",
  "Nomad",
  "Otter",
  "Pioneer",
  "Ranger",
  "Runner",
  "Scout",
  "Shade",
  "Stalker",
  "Viper",
  "Walker",
  "Wolf",
];

@Injectable()
export class GameService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Game");
  private io: Server;
  private rnd = mulberry32((Math.random() * 2 ** 31) | 0);

  private instances = new Map<string, Instance>();
  private players = new Map<string, ServerPlayer>();

  private nextId = 1;
  private tickTimer: NodeJS.Timeout;
  private saveTimer: NodeJS.Timeout;
  private questTimer: NodeJS.Timeout;
  private mapTimer: NodeJS.Timeout;
  private socialTimer: NodeJS.Timeout;
  private playerLeaseTimer: NodeJS.Timeout;
  private activeMapId: number | null = null;
  private activeMapVersion = "";
  private rejectedMapVersion = "";
  private lastVisualsVersion = 0;
  private lastGameplayVersion = 0;
  private lastTick = Date.now();
  private quests: QuestDef[] = [];
  private nextBotSyncAt = 0;
  private worldSave = Promise.resolve();
  private exitingPlayers = new Set<string>();
  private playerExitPromises = new Map<string, Promise<void>>();
  private profileSaveQueues = new Map<string, Promise<void>>();
  private guestBans = new Map<string, number>();
  private lastNightHordeCycle = -1;
  private nightHordeIds = new Set<string>();
  private wasNight = isNight((Date.now() % DAY_LENGTH_MS) / DAY_LENGTH_MS);

  constructor(
    private readonly db: DbService,
    private readonly content: ContentService,
    private readonly telemetry: TelemetryService,
  ) {}

  async onModuleInit() {
    this.quests = await this.db.loadQuests().catch(() => []);
    // hot-reload quests so admin edits apply without a restart
    this.questTimer = setInterval(() => {
      void this.db
        .loadQuests()
        .then((quests) => {
          this.quests = quests;
          for (const player of this.players.values())
            if (!this.isBot(player)) this.pushInventory(player);
        })
        .catch(() => undefined);
    }, 60_000);
    const mapRevision = await this.db.loadActiveMapRevision().catch(() => null);
    const authored = mapRevision?.data ?? null;
    this.activeMapId = mapRevision?.id ?? null;
    this.activeMapVersion =
      this.activeMapId === null ? "" : String(this.activeMapId);
    const savedWorld = this.db.stagingContent
      ? null
      : await this.db.loadWorldState(this.activeMapId).catch(() => null);
    const gen = authored
      ? fromAuthored(authored)
      : generateMap(savedWorld?.seed);
    const world = this.makeInstance(
      WORLD,
      "world",
      authored ? "Authored Zone" : "The Exclusion Zone",
      null,
      gen,
    );
    this.restoreWorldState(world, savedWorld);
    this.instances.set(WORLD, world);
    await this.persistWorldState(world);
    this.syncBotPopulation();
    this.nextBotSyncAt = Date.now() + BOT_SYNC_MS;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.saveTimer = setInterval(() => this.saveAll(), 10_000);
    this.playerLeaseTimer = setInterval(
      () => void this.renewPlayerLeases(),
      PLAYER_LEASE_HEARTBEAT_MS,
    );
    this.socialTimer = setInterval(() => {
      for (const player of this.players.values())
        if (!this.isBot(player) && !player.guest)
          void this.refreshSocial(player.sid);
    }, 30_000);
    this.lastVisualsVersion = this.content.visualsVersion;
    this.lastGameplayVersion = this.content.gameplayVersionNumber;
    this.mapTimer = setInterval(() => {
      void this.refreshPublishedMap();
      this.refreshPublishedContent();
    }, 10_000);
    this.log.log(
      `World ready (${authored ? "authored map" : `procedural seed ${gen.seed}`}) — ${world.containers.size} containers, ${world.enemies.size} enemies, POIs: ${gen.pois.map((p) => p.name).join(", ") || "none"}`,
    );
  }

  async onModuleDestroy() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    clearInterval(this.questTimer);
    clearInterval(this.mapTimer);
    clearInterval(this.socialTimer);
    clearInterval(this.playerLeaseTimer);
    await this.saveAll();
    await Promise.all(
      [...this.players.values()].flatMap((player) =>
        this.isBot(player) || player.guest
          ? []
          : [this.db.releasePlayerWorldLease(player.userId, player.sid)],
      ),
    );
    await Promise.all(
      [...this.instances.values()].flatMap((instance) =>
        instance.clanId
          ? [this.db.releaseClanHideoutLease(instance.clanId)]
          : [],
      ),
    );
  }

  private async refreshPublishedMap() {
    // Poll only the tiny row ID. The multi-megabyte authored document stays in
    // this process and is fetched again only after an actual publication.
    const marker = await this.db.loadActiveMapRevisionId();
    if (
      marker === null ||
      marker.version === this.activeMapVersion ||
      marker.version === this.rejectedMapVersion
    )
      return;
    const revisionId = marker.id;
    const current = this.instances.get(WORLD);
    if (current && current.players > 0) return;
    const revision = await this.db.loadMapRevision(revisionId);
    if (!revision) {
      this.rejectedMapVersion = marker.version;
      this.log.error(
        `Published map #${revisionId} was rejected; retaining map #${this.activeMapId ?? "procedural"}`,
      );
      return;
    }
    const gen = fromAuthored(revision.data);
    const world = this.makeInstance(WORLD, "world", "Authored Zone", null, gen);
    const savedWorld = this.db.stagingContent
      ? null
      : await this.db.loadWorldState(revision.id).catch(() => null);
    this.restoreWorldState(world, savedWorld);
    this.instances.set(WORLD, world);
    for (const player of this.players.values())
      if (this.isBot(player)) this.resetBotWorldPosition(player, world);
    this.activeMapId = revision.id;
    this.activeMapVersion = marker.version;
    void this.persistWorldState(world);
    this.rejectedMapVersion = "";
    this.log.log(
      `Published map #${revision.id} loaded (${world.w}x${world.h})`,
    );
  }

  private refreshPublishedContent() {
    if (!this.io) return;
    if (this.content.visualsVersion !== this.lastVisualsVersion) {
      this.lastVisualsVersion = this.content.visualsVersion;
      this.io.emit(EV.visuals, this.content.visuals);
      this.log.log(
        `Published visuals r${this.lastVisualsVersion} pushed to connected clients`,
      );
    }
    if (this.content.gameplayVersionNumber !== this.lastGameplayVersion) {
      this.lastGameplayVersion = this.content.gameplayVersionNumber;
      this.io.emit(EV.gameplay, this.content.gameplay);
      this.log.log(
        `Published gameplay catalog r${this.lastGameplayVersion} pushed to connected clients`,
      );
    }
  }

  private enqueueProfileWork<T>(
    userId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.profileSaveQueues.get(userId) ?? Promise.resolve();
    const task = previous.then(work);
    const barrier = task.then(
      () => undefined,
      () => undefined,
    );
    this.profileSaveQueues.set(userId, barrier);
    void barrier.finally(() => {
      if (this.profileSaveQueues.get(userId) === barrier)
        this.profileSaveQueues.delete(userId);
    });
    return task;
  }

  private async persistProfileOf(
    p: ServerPlayer,
    connectionId: string,
  ): Promise<boolean> {
    if (p.guest) return true;
    const saved = await this.db.saveProfile(
      p.userId,
      connectionId,
      p.inv,
      p.equipment,
      p.skills,
      p.quests,
      p.money,
      p.kills,
      p.deaths,
      Math.round(p.hunger),
      Math.round(p.thirst),
      p.armorDur,
      p.appearance,
      p.mags,
    );
    if (!saved)
      this.telemetry.record({
        kind: "profile_save_failed",
        userId: p.userId,
        source: "game_service",
      });
    return saved;
  }

  private saveProfileOf(p: ServerPlayer, connectionId = p.sid): Promise<void> {
    if (this.isBot(p) || p.guest) return Promise.resolve();
    return this.enqueueProfileWork(p.userId, async () => {
      await this.persistProfileOf(p, connectionId);
    });
  }

  private inventoryValue(inv: Inventory): number {
    return inv.slots.reduce(
      (value, slot) =>
        value +
        (slot ? this.content.estimatedItemValue(slot.id) * slot.qty : 0),
      0,
    );
  }

  private addXp(p: ServerPlayer, skill: keyof Skills, amount: number) {
    p.skills[skill] = (p.skills[skill] ?? 0) + Math.max(0, Math.round(amount));
  }

  private isBot(
    p: ServerPlayer | undefined | null,
  ): p is ServerPlayer & { bot: ServerBotState } {
    return Boolean(p?.bot);
  }

  private choose<T>(values: readonly T[]): T {
    return values[Math.floor(this.rnd() * values.length)]!;
  }

  private randomAppearance(): CharacterAppearance {
    return {
      body: Math.floor(this.rnd() * CHARACTER_BODY_NAMES.length),
      skinTone: Math.floor(this.rnd() * CHARACTER_SKIN_COLORS.length),
      hairStyle: Math.floor(this.rnd() * CHARACTER_HAIR_NAMES.length),
      hairColor: Math.floor(this.rnd() * CHARACTER_HAIR_COLORS.length),
      outfit: Math.floor(this.rnd() * CHARACTER_OUTFIT_COLORS.length),
      accent: Math.floor(this.rnd() * CHARACTER_ACCENT_COLORS.length),
      cosmetics: { head: null, face: null, back: null, badge: null },
    };
  }

  private findClearPointNear(
    inst: Instance,
    x: number,
    y: number,
    radiusTiles = 8,
  ): { x: number; y: number } {
    const baseTx = Math.max(1, Math.min(inst.w - 2, Math.floor(x / TILE)));
    const baseTy = Math.max(1, Math.min(inst.h - 2, Math.floor(y / TILE)));
    for (let attempt = 0; attempt < 80; attempt++) {
      const tx = Math.max(
        1,
        Math.min(
          inst.w - 2,
          baseTx + Math.floor((this.rnd() * 2 - 1) * radiusTiles),
        ),
      );
      const ty = Math.max(
        1,
        Math.min(
          inst.h - 2,
          baseTy + Math.floor((this.rnd() * 2 - 1) * radiusTiles),
        ),
      );
      const px = (tx + 0.5) * TILE;
      const py = (ty + 0.5) * TILE;
      if (this.isSafeAt(inst, px, py)) continue;
      if (this.isBlocked(inst, px, py, PLAYER_RADIUS)) continue;
      return { x: px, y: py };
    }
    return { x: (baseTx + 0.5) * TILE, y: (baseTy + 0.5) * TILE };
  }

  private nextBotName(): string {
    const taken = new Set(
      [...this.players.values()]
        .filter((player) => this.isBot(player))
        .map((player) => player.name.toLowerCase()),
    );
    for (const rawName of this.content.settings.bots.names) {
      const name = rawName.trim();
      if (name && !taken.has(name.toLowerCase())) return name;
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      const prefix = this.choose(BOT_NAME_PREFIXES);
      const suffix = this.choose(BOT_NAME_SUFFIXES);
      const numeric =
        this.rnd() < 0.25 ? String(10 + Math.floor(this.rnd() * 90)) : "";
      const name = `${prefix}${suffix}${numeric}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
    return `Ranger${this.nextId}`;
  }

  private botStarterInventory(): Inventory {
    const inv = this.starterInventory();
    const bagTier = this.rnd() < 0.2 ? 2 : this.rnd() < 0.45 ? 1 : 0;
    inv.backpack = bagTier;
    while (inv.slots.length < BACKPACKS[bagTier].slots) inv.slots.push(null);
    inv.slots.length = BACKPACKS[bagTier].slots;

    const loadout = this.rnd();
    if (loadout < 0.2) this.addItem(inv, "axe", 1);
    else if (loadout < 0.4) this.addItem(inv, "pickaxe", 1);
    else if (loadout < 0.58) this.addItem(inv, "spear", 1);
    else if (loadout < 0.74) {
      this.addItem(inv, "bow", 1);
      this.addItem(inv, "arrow", 12 + Math.floor(this.rnd() * 18));
    } else if (loadout < 0.87) {
      this.addItem(inv, "pistol", 1);
      this.addItem(inv, "ammo_9mm", 18 + Math.floor(this.rnd() * 28));
    } else {
      this.addItem(inv, "revolver", 1);
      this.addItem(inv, "ammo_44", 10 + Math.floor(this.rnd() * 12));
    }

    if (this.rnd() < 0.55)
      this.addItem(inv, "bandage", 1 + Math.floor(this.rnd() * 2));
    if (this.rnd() < 0.3) this.addItem(inv, "medkit", 1);
    if (this.rnd() < 0.75)
      this.addItem(
        inv,
        this.rnd() < 0.5 ? "cooked_meat" : "cooked_fish",
        1 + Math.floor(this.rnd() * 2),
      );
    if (this.rnd() < 0.55) this.addItem(inv, "canteen_full", 1);
    if (this.rnd() < 0.45)
      this.addItem(inv, "cloth", 2 + Math.floor(this.rnd() * 3));
    if (this.rnd() < 0.5)
      this.addItem(inv, "scrap", 2 + Math.floor(this.rnd() * 4));
    if (this.rnd() < 0.35)
      this.addItem(inv, "wood", 4 + Math.floor(this.rnd() * 6));
    if (this.rnd() < 0.35)
      this.addItem(inv, "stone", 3 + Math.floor(this.rnd() * 5));
    return inv;
  }

  private spawnBot(world = this.instances.get(WORLD)!): ServerPlayer | null {
    if (!world || world.spawns.length === 0) return null;
    const spawn = world.spawns[Math.floor(this.rnd() * world.spawns.length)];
    const start = this.findClearPointNear(world, spawn.x, spawn.y, 10);
    const camp = this.findClearPointNear(world, start.x, start.y, 6);
    const sid = `bot:${this.nextId++}`;
    const inv = this.botStarterInventory();
    const helmet = this.rnd() < 0.18 ? "helmet_scrap" : null;
    const vest = this.rnd() < 0.12 ? "vest_light" : null;
    const p: ServerPlayer = {
      sid,
      userId: sid,
      name: this.nextBotName(),
      guest: false,
      instanceId: world.id,
      x: start.x,
      y: start.y,
      angle: 0,
      facing: 0,
      hp: PLAYER_MAX_HP,
      dead: false,
      moving: false,
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: 0,
        shoot: false,
        sprint: false,
      },
      inv,
      equipment: { helmet, vest, mod: null },
      equipped: this.firstWeaponSlot(inv),
      money: 30 + Math.floor(this.rnd() * 180),
      skills: {
        woodcutting: Math.floor(this.rnd() * 220),
        mining: Math.floor(this.rnd() * 220),
        shooting: Math.floor(this.rnd() * 220),
        melee: Math.floor(this.rnd() * 220),
        crafting: Math.floor(this.rnd() * 220),
      },
      quests: {},
      hunger: 70 + Math.floor(this.rnd() * 30),
      thirst: 70 + Math.floor(this.rnd() * 30),
      stamina: STAMINA_MAX,
      staminaExhausted: false,
      lastExertAt: 0,
      starveAcc: 0,
      regenAcc: 0,
      lastPushedSurvival: -1,
      lastStaminaBucket: -1,
      lastPushedStaminaExhausted: false,
      action: null,
      actionStart: { x: start.x, y: start.y },
      mags: {},
      reloadUntil: 0,
      reloadTarget: null,
      lastInputSeq: 0,
      lastAttackAt: 0,
      lastExhaustedAttackToastAt: 0,
      lastHitAt: 0,
      lastSwingAt: 0,
      kills: 0,
      deaths: 0,
      openContainer: null,
      returnPos: null,
      ignoreInteractUntil: 0,
      loggedOutAt: null,
      lastStationMask: -1,
      armorDur: {},
      appearance: this.randomAppearance(),
      friendUserIds: new Set(),
      clanId: null,
      clanName: null,
      clanTag: null,
      clanRank: null,
      clanMateIds: new Set(),
      admin: false,
      adminMode: false,
      mutedUntil: 0,
      bot: {
        id: sid,
        aggression: Math.max(
          0.08,
          Math.min(
            0.95,
            this.content.settings.bots.playerAggroChance +
              (this.rnd() * 0.5 - 0.25),
          ),
        ),
        buildDrive: Math.max(
          0.05,
          Math.min(
            0.95,
            this.content.settings.bots.buildChance + (this.rnd() * 0.5 - 0.25),
          ),
        ),
        greed: 0.2 + this.rnd() * 0.7,
        campX: camp.x,
        campY: camp.y,
        roamX: camp.x,
        roamY: camp.y,
        roamUntil: 0,
        respawnAt: 0,
        nextUtilityAt: 0,
        nextBuildAt: 0,
        nextTradeAt: 0,
      },
    };
    this.players.set(sid, p);
    const botValue =
      this.inventoryValue(inv) +
      (helmet ? this.content.estimatedItemValue(helmet) : 0) +
      (vest ? this.content.estimatedItemValue(vest) : 0);
    this.telemetry.record({
      kind: "bot_contribution",
      value: botValue,
      credits: p.money,
      source: "bot_spawn",
      metadata: { bot: p.name },
    });
    return p;
  }

  private despawnBot(p: ServerPlayer) {
    if (!this.isBot(p)) return;
    this.players.delete(p.sid);
    for (const inst of this.instances.values())
      for (const enemy of inst.enemies.values())
        if (enemy.targetSid === p.sid) enemy.targetSid = null;
  }

  private resetBotWorldPosition(
    p: ServerPlayer,
    world = this.instances.get(WORLD)!,
  ) {
    if (!this.isBot(p) || !world || world.spawns.length === 0) return;
    const spawn = world.spawns[Math.floor(this.rnd() * world.spawns.length)];
    const start = this.findClearPointNear(world, spawn.x, spawn.y, 10);
    const camp = this.findClearPointNear(world, start.x, start.y, 6);
    p.instanceId = world.id;
    p.x = start.x;
    p.y = start.y;
    p.angle = 0;
    p.facing = 0;
    p.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      angle: 0,
      shoot: false,
      sprint: false,
    };
    p.action = null;
    p.actionStart = { x: start.x, y: start.y };
    p.openContainer = null;
    p.ignoreInteractUntil = 0;
    p.bot.campX = camp.x;
    p.bot.campY = camp.y;
    p.bot.roamX = camp.x;
    p.bot.roamY = camp.y;
    p.bot.roamUntil = 0;
  }

  private syncBotPopulation() {
    const desired = Math.max(0, this.content.settings.bots.count | 0);
    const bots = [...this.players.values()].filter((player) =>
      this.isBot(player),
    );
    if (bots.length < desired) {
      for (let i = bots.length; i < desired; i++) this.spawnBot();
      return;
    }
    if (bots.length > desired) {
      for (const bot of bots.slice(desired)) this.despawnBot(bot);
    }
  }

  /** Wear down an inventory slot; break it (destroy) at 0. Returns true if it broke. */
  private wearSlot(p: ServerPlayer, slot: number, amount = 1): boolean {
    const item = p.inv.slots[slot];
    if (!item) return false;
    const max = this.content.item(item.id).durability;
    if (max === undefined) return false;
    const dur = (item.dur ?? max) - amount;
    if (dur <= 0) {
      this.toast(p.sid, `Your ${this.content.item(item.id).name} broke!`);
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
      return true;
    }
    item.dur = dur;
    if (dur === Math.ceil(max * 0.2))
      this.toast(
        p.sid,
        `${this.content.item(item.id).name} is badly worn — repair it at a ${repairInfo(this.content.item(item.id))?.station}`,
      );
    return false;
  }

  /** Wear down an equipped armor piece; break it at 0. */
  private wearArmor(p: ServerPlayer, piece: "helmet" | "vest"): void {
    const id = p.equipment[piece];
    if (!id) return;
    const max = this.content.item(id).durability;
    if (max === undefined) return;
    const cur = p.armorDur[piece] ?? max;
    const dur = cur - 1;
    if (dur <= 0) {
      this.toast(p.sid, `Your ${this.content.item(id).name} was destroyed!`);
      p.equipment[piece] = null;
      delete p.armorDur[piece];
    } else {
      p.armorDur[piece] = dur;
    }
  }

  setServer(io: Server) {
    this.io = io;
  }

  // ── instance construction ─────────────────────────────────────────────────

  private makeInstance(
    id: string,
    kind: InstanceKind,
    name: string,
    ownerId: string | null,
    gen: GeneratedMap,
  ): Instance {
    const inst: Instance = {
      id,
      kind,
      name,
      ownerId,
      seed: gen.seed,
      w: gen.w,
      h: gen.h,
      tiles: gen.tiles,
      elevations: gen.elevations,
      terrainKinds: gen.terrainKinds,
      resourceKinds: gen.resourceKinds,
      blockKinds: gen.blockKinds,
      blockRotations: gen.blockRotations,
      openDoors: new Set(),
      stationFuel: new Map(),
      pois: gen.pois,
      traders: gen.traders,
      extracts: gen.extracts,
      exit: null,
      spawns: gen.spawns,
      lootSpots: gen.lootSpots,
      containers: new Map(),
      ground: new Map(),
      enemies: new Map(),
      unders: new Map(),
      projectiles: [],
      nodeHits: new Map(),
      nodeVariants: new Map(),
      blockHp: new Map(),
      nodeRespawns: [],
      enemyRespawns: [],
      lastGroundSpawn: 0,
      randomEvents: new Map(),
      nextRandomEventAt:
        kind === "world"
          ? Date.now() + randomEventDelay(this.rnd, true)
          : Number.POSITIVE_INFINITY,
      players: 0,
      structures: new Map(),
    };
    for (const spot of gen.chestSpots) {
      const cid = `c${this.nextId++}`;
      const tx = Math.floor(spot.x / TILE);
      const ty = Math.floor(spot.y / TILE);
      const onTarmac = gen.tiles[ty * gen.w + tx] === Tile.Asphalt;
      // chests inside a high-loot zone roll the RARE table
      const inHot = gen.pois.some(
        (poi) => poi.hot && Math.hypot(poi.x - spot.x, poi.y - spot.y) < poi.r,
      );
      const tier: ChestTier = inHot ? "rare" : spot.tier;
      inst.containers.set(cid, {
        id: cid,
        x: spot.x,
        y: spot.y,
        kind: onTarmac ? "crate" : "chest",
        tier,
        slots: spot.lootTable
          ? rollNamed(this.rnd, spot.lootTable, this.content.lootTables)
          : rollChest(this.rnd, tier, this.content.lootTables),
        restockAt: null,
        lootTable: spot.lootTable,
      });
    }
    for (const spot of gen.lootSpots) this.spawnGroundAt(inst, spot.x, spot.y);
    for (const s of gen.enemySpawns)
      this.spawnEnemy(inst, s.x, s.y, s.kind, s.respawnMs);
    return inst;
  }

  /** Reapply sparse node mutations only when their authored/procedural base still matches. */
  private restoreWorldState(inst: Instance, saved: PersistedWorldState | null) {
    if (!saved) return;
    let restoredVariants = 0;
    for (const variant of saved.nodeVariants) {
      if (variant.i < 0 || variant.i >= inst.tiles.length) continue;
      const baseResourceId = inst.resourceKinds[String(variant.i)] ?? "";
      if (
        inst.tiles[variant.i] !== variant.baseTile ||
        baseResourceId !== variant.baseResourceId
      )
        continue;
      inst.tiles[variant.i] = variant.tile;
      inst.resourceKinds[String(variant.i)] = variant.resourceId;
      inst.nodeVariants.set(variant.i, variant);
      restoredVariants++;
    }
    for (const [i, left] of saved.nodeHits) {
      if (i < 0 || i >= inst.tiles.length) continue;
      const tile = inst.tiles[i] as Tile;
      const attachedResource = this.content.resource(
        inst.resourceKinds[String(i)],
      );
      const resource =
        attachedResource && harvestResourceTileMatches(attachedResource.tile, tile)
          ? attachedResource
          : undefined;
      const total = resource?.maxHits ?? NODE_HITS[tile];
      if (total && left > 0) inst.nodeHits.set(i, Math.min(left, total));
    }
    let restoredCooldowns = 0;
    const seen = new Set<number>();
    for (const respawn of saved.nodeRespawns) {
      if (
        respawn.i < 0 ||
        respawn.i >= inst.tiles.length ||
        seen.has(respawn.i)
      )
        continue;
      const variant = inst.nodeVariants.get(respawn.i);
      const baseTile = variant?.baseTile ?? inst.tiles[respawn.i];
      const baseResourceId =
        variant?.baseResourceId ?? inst.resourceKinds[String(respawn.i)] ?? "";
      const resource = this.content.resource(
        inst.resourceKinds[String(respawn.i)],
      );
      const family = this.content.resourceFamily(
        resource,
        inst.tiles[respawn.i],
      );
      if (
        baseTile !== respawn.baseTile ||
        baseResourceId !== respawn.baseResourceId ||
        family !== respawn.family
      )
        continue;
      inst.tiles[respawn.i] = respawn.depletedTile;
      delete inst.resourceKinds[String(respawn.i)];
      inst.nodeHits.delete(respawn.i);
      inst.nodeRespawns.push(respawn);
      seen.add(respawn.i);
      restoredCooldowns++;
    }
    if (restoredVariants || restoredCooldowns || inst.nodeHits.size) {
      this.log.log(
        `Restored ${restoredCooldowns} depleted nodes, ${restoredVariants} node variants and ${inst.nodeHits.size} damaged nodes`,
      );
    }
  }

  private snapshotWorldState(inst: Instance): PersistedWorldState {
    return {
      mapId: this.activeMapId,
      seed: inst.seed,
      nodeHits: [...inst.nodeHits.entries()],
      nodeRespawns: inst.nodeRespawns.map((node) => ({ ...node })),
      nodeVariants: [...inst.nodeVariants.values()].map((node) => ({
        ...node,
      })),
    };
  }

  private persistWorldState(inst: Instance) {
    const snapshot = this.snapshotWorldState(inst);
    this.worldSave = this.worldSave
      .catch(() => undefined)
      .then(() => this.db.saveWorldState(snapshot));
    return this.worldSave;
  }

  private rollResourceVariant(family: ResourceFamily) {
    const variants = this.content.resourceVariants(family);
    const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
    if (total <= 0) return undefined;
    let roll = this.rnd() * total;
    for (const variant of variants) {
      roll -= variant.weight;
      if (roll <= 0) return variant.resource;
    }
    return variants[variants.length - 1]?.resource;
  }

  private regrowResourceNode(inst: Instance, node: NodeRespawnState) {
    const resourceDef = this.rollResourceVariant(node.family);
    const resourceId =
      resourceDef?.id ?? (node.family === "tree" ? "tree" : "rock");
    let tile =
      resourceDef?.tile ?? (node.family === "tree" ? Tile.Tree : Tile.Rock);
    if (node.family === "rock") {
      const roll = this.rnd();
      tile =
        roll < IRON_CHANCE
          ? Tile.IronOre
          : roll < IRON_CHANCE + COPPER_CHANCE
            ? Tile.CopperOre
            : Tile.Rock;
    }
    inst.tiles[node.i] = tile;
    inst.resourceKinds[String(node.i)] = resourceId;
    if (tile === node.baseTile && resourceId === node.baseResourceId)
      inst.nodeVariants.delete(node.i);
    else
      inst.nodeVariants.set(node.i, {
        i: node.i,
        tile,
        resourceId,
        baseTile: node.baseTile,
        baseResourceId: node.baseResourceId,
      });
    this.io?.to(inst.id).emit(EV.tile, { i: node.i, tile, resourceId });
  }

  private createHideoutInstance(
    id: string,
    kind: "hideout" | "clan_hideout",
    name: string,
    ownerId: string | null,
    clanId: string | undefined,
    width: number,
    height: number,
    storageSlots: number,
    hideout: Awaited<ReturnType<DbService["loadHideout"]>>,
  ): Instance {
    const W = width;
    const H = height;
    while (hideout.storage.length < storageSlots) hideout.storage.push(null);
    hideout.storage.length = storageSlots;
    if (!hideout.objects.some((object) => object.type === "bed"))
      hideout.objects.unshift({ type: "bed", tx: 3, ty: 3 });

    const tiles = new Uint8Array(W * H).fill(Tile.Grass);
    for (let x = 0; x < W; x++) {
      tiles[x] = Tile.Cliff;
      tiles[(H - 1) * W + x] = Tile.Cliff;
    }
    for (let y = 0; y < H; y++) {
      tiles[y * W] = Tile.Cliff;
      tiles[y * W + W - 1] = Tile.Cliff;
    }
    const exitTx = Math.floor(W / 2);
    tiles[(H - 2) * W + exitTx] = Tile.DoorMat;

    const inst: Instance = {
      id,
      kind,
      name,
      ownerId,
      ...(clanId ? { clanId } : {}),
      seed: 0,
      w: W,
      h: H,
      tiles,
      elevations: new Uint8Array(W * H),
      resourceKinds: resourceKindsFromTiles(tiles),
      terrainKinds: terrainKindsFromTiles(tiles),
      blockKinds: {},
      blockRotations: {},
      openDoors: new Set(),
      stationFuel: new Map(),
      pois: [],
      traders: [],
      extracts: [],
      exit: { x: (exitTx + 0.5) * TILE, y: (H - 2 + 0.5) * TILE },
      spawns: [{ x: 4.5 * TILE, y: 4.5 * TILE }],
      lootSpots: [],
      containers: new Map(),
      ground: new Map(),
      enemies: new Map(),
      unders: new Map(),
      projectiles: [],
      nodeHits: new Map(),
      nodeVariants: new Map(),
      blockHp: new Map(),
      nodeRespawns: [],
      enemyRespawns: [],
      lastGroundSpawn: 0,
      randomEvents: new Map(),
      nextRandomEventAt: Number.POSITIVE_INFINITY,
      players: 0,
      hideout,
      structures: new Map(),
    };
    inst.containers.set(`hs:${id}`, {
      id: `hs:${id}`,
      x: 5.5 * TILE,
      y: 3.5 * TILE,
      kind: "storage",
      tier: "normal",
      slots: hideout.storage,
      restockAt: null,
    });
    for (const object of hideout.objects) {
      if (
        object.tx < 1 ||
        object.ty < 1 ||
        object.tx >= W - 1 ||
        object.ty >= H - 1
      )
        continue;
      const buildable = BUILDABLES[object.type];
      const index = object.ty * W + object.tx;
      const engineBlock = this.content.playerBlock(object.type);
      if (engineBlock) {
        inst.blockKinds[String(index)] = engineBlock.id;
        const rotation = (((Number(object.rotation) | 0) % 4) + 4) % 4;
        if (rotation) inst.blockRotations[String(index)] = rotation;
      }
      if (buildable?.tile) {
        if (FLOOR_TILES[tiles[index]]) inst.unders.set(index, tiles[index]);
        tiles[index] = buildable.tile;
      }
      if (
        (object.type === "firepit" || object.type === "furnace") &&
        Number.isFinite(object.fuel) &&
        Number(object.fuel) > 0
      ) {
        inst.stationFuel.set(
          index,
          Math.min(
            STATION_FUEL_MAX,
            Math.max(0, Math.floor(Number(object.fuel))),
          ),
        );
      }
    }
    this.syncHideoutContainers(inst);
    this.syncHideoutSpawn(inst);
    this.instances.set(id, inst);
    return inst;
  }

  /** Personal hideout: a private grass camp with permanent construction. */
  private async hideoutInstance(ownerId: string): Promise<Instance> {
    const id = `h:${ownerId}`;
    const existing = this.instances.get(id);
    if (existing) return existing;
    const hideout = await this.db.loadHideout(ownerId);
    return this.createHideoutInstance(
      id,
      "hideout",
      "Home Base",
      ownerId,
      undefined,
      HIDEOUT_W,
      HIDEOUT_H,
      HIDEOUT_STORAGE_SLOTS,
      hideout,
    );
  }

  private async clanHideoutInstance(clan: {
    id: string;
    name: string;
    tag: string;
  }): Promise<Instance> {
    const id = `clan:${clan.id}`;
    const existing = this.instances.get(id);
    if (existing) return existing;
    const hideout = await this.db.loadClanHideout(clan.id);
    return this.createHideoutInstance(
      id,
      "clan_hideout",
      `[${clan.tag}] ${clan.name} Holdout`,
      null,
      clan.id,
      CLAN_HOLDOUT_W,
      CLAN_HOLDOUT_H,
      CLAN_HOLDOUT_STORAGE_SLOTS,
      hideout,
    );
  }

  /** Home spawn = a walkable tile next to your bed (the bed is movable). */
  private syncHideoutSpawn(inst: Instance) {
    if (inst.kind === "world" || !inst.hideout) return;
    const bed = inst.hideout.objects.find((o) => o.type === "bed");
    if (!bed) return; // no bed? keep the previous spawn
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
    ]) {
      const tx = bed.tx + dx;
      const ty = bed.ty + dy;
      if (tx < 1 || ty < 1 || tx >= inst.w - 1 || ty >= inst.h - 1) continue;
      if (!BLOCKS_MOVE[inst.tiles[ty * inst.w + tx]]) {
        inst.spawns = [{ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }];
        return;
      }
    }
  }

  /** Rebuild the hideout's built-chest containers from hideout.objects (slot arrays shared by reference). */
  private syncHideoutContainers(inst: Instance) {
    if (!inst.hideout) return;
    for (const id of [...inst.containers.keys()])
      if (id.startsWith("hc:")) inst.containers.delete(id);
    inst.hideout.objects.forEach((o, i) => {
      if (o.type !== "chest") return;
      const slots = Array.isArray(o.slots)
        ? o.slots
        : new Array<InvSlot>(HIDEOUT_STORAGE_SLOTS).fill(null);
      while (slots.length < HIDEOUT_STORAGE_SLOTS) slots.push(null);
      slots.length = HIDEOUT_STORAGE_SLOTS;
      o.slots = slots;
      inst.containers.set(`hc:${inst.id}:${i}`, {
        id: `hc:${inst.id}:${i}`,
        x: (o.tx + 0.5) * TILE,
        y: (o.ty + 0.5) * TILE,
        kind: "storage",
        tier: "normal",
        slots,
        restockAt: null,
      });
    });
  }

  private persistHideout(inst: Instance) {
    if (inst.kind === "world" || !inst.hideout) return;
    // chest slot arrays are shared by reference with containers — just save
    if (inst.clanId) void this.db.saveClanHideout(inst.clanId, inst.hideout);
    else if (inst.ownerId) {
      const owner = [...this.players.values()].find(
        (player) => !this.isBot(player) && player.userId === inst.ownerId,
      );
      if (owner)
        void this.db.saveHideout(inst.ownerId, owner.sid, inst.hideout);
    }
  }

  private inst(p: ServerPlayer): Instance {
    return this.instances.get(p.instanceId) ?? this.instances.get(WORLD)!;
  }

  private initFor(inst: Instance, sid: string): WorldInit {
    const player = this.players.get(sid);
    const canBuild =
      inst.kind === "hideout"
        ? inst.ownerId === player?.userId
        : inst.kind === "clan_hideout" &&
          Boolean(
            inst.clanId &&
            inst.clanId === player?.clanId &&
            canBuildClanHideout(player?.clanRank),
          );
    const canDemolish =
      inst.kind === "hideout"
        ? inst.ownerId === player?.userId
        : inst.kind === "clan_hideout" &&
          inst.clanId === player?.clanId &&
          canDemolishClanHideout(player?.clanRank);
    return {
      kind: inst.kind,
      name: inst.name,
      seed: inst.seed,
      width: inst.w,
      height: inst.h,
      tiles: [],
      tileRuns: encodeByteRuns(inst.tiles),
      pois: inst.pois,
      traders: inst.traders,
      extracts: inst.extracts,
      exit: inst.exit,
      ownHideout: canBuild,
      canDemolish,
      unders: Object.fromEntries(inst.unders),
      elevations: [],
      elevationRuns: encodeByteRuns(inst.elevations),
      terrainKinds: {},
      terrainRuns: encodeTerrainRuns(inst.terrainKinds),
      resourceKinds: inst.resourceKinds,
      blockKinds: inst.blockKinds,
      blockRotations: inst.blockRotations,
      openDoors: [...inst.openDoors],
      stationFuel: Object.fromEntries(inst.stationFuel),
      gameplay: this.content.gameplay,
      visuals: this.content.visuals,
      you: sid,
      guest: player?.guest === true,
      admin: player?.admin === true,
    };
  }

  private switchInstance(
    p: ServerPlayer,
    inst: Instance,
    x: number,
    y: number,
  ) {
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
    if (old && old.kind !== "world" && old.players === 0) {
      this.instances.delete(old.id);
      if (old.clanId) void this.db.releaseClanHideoutLease(old.clanId);
    }
  }

  private isSafeAt(inst: Instance, x: number, y: number): boolean {
    if (inst.kind !== "world") return true;
    return inst.pois.some((p) => p.safe && Math.hypot(p.x - x, p.y - y) < p.r);
  }

  private async refreshPlayerSocial(player: ServerPlayer) {
    if (this.isBot(player) || player.guest) return;
    const social = await this.db.loadPlayerSocialAccess(player.userId);
    player.friendUserIds = new Set(social.friendIds);
    player.clanId = social.clan?.id ?? null;
    player.clanName = social.clan?.name ?? null;
    player.clanTag = social.clan?.tag ?? null;
    player.clanRank = social.clan?.rank ?? null;
    player.clanMateIds = new Set(social.clanMateIds);
  }

  async refreshSocial(sid: string) {
    const player = this.players.get(sid);
    if (!player || this.isBot(player)) return;
    if (player.guest) {
      this.toast(sid, "Community features require a registered survivor");
      return;
    }
    const previousClanId = player.clanId;
    const previousRank = player.clanRank;
    await this.refreshPlayerSocial(player);
    const current = this.inst(player);
    if (current.kind === "clan_hideout" && current.clanId !== player.clanId) {
      const home = await this.hideoutInstance(player.userId);
      this.switchInstance(player, home, home.spawns[0].x, home.spawns[0].y);
      this.toast(sid, "Your clan access changed — returned home");
    } else if (
      current.kind === "clan_hideout" &&
      (previousClanId !== player.clanId || previousRank !== player.clanRank)
    ) {
      this.emitTo(sid, EV.init, this.initFor(current, sid));
    }
  }

  // ── join / leave ──────────────────────────────────────────────────────────

  private async addGuestPlayer(
    sid: string,
    userId: string,
    name: string,
  ): Promise<WorldInit> {
    const bannedUntil = this.guestBans.get(userId) ?? 0;
    if (bannedUntil > Date.now()) throw new Error("PLAYER_BANNED");
    if (bannedUntil) this.guestBans.delete(userId);

    const existingEntry = [...this.players.entries()].find(
      ([, player]) => player.guest && player.userId === userId,
    );
    const humanPlayers = [...this.players.values()].filter(
      (player) => !this.isBot(player),
    ).length;
    if (!existingEntry && humanPlayers >= MAX_PLAYERS_PER_SERVER)
      throw new Error("WORLD_FULL");

    if (existingEntry) {
      const [oldSid, existing] = existingEntry;
      this.players.delete(oldSid);
      for (const instance of this.instances.values()) {
        for (const enemy of instance.enemies.values())
          if (enemy.targetSid === oldSid) enemy.targetSid = sid;
      }
      existing.sid = sid;
      existing.input = {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: existing.angle,
        shoot: false,
      };
      existing.loggedOutAt = null;
      this.players.set(sid, existing);
      const instance = this.inst(existing);
      void this.io?.sockets.sockets.get(sid)?.join(instance.id);
      this.io?.sockets.sockets.get(oldSid)?.disconnect(true);
      this.pushInventory(existing);
      this.toast(sid, "Guest raid restored — progress remains temporary");
      return this.initFor(instance, sid);
    }

    const world = this.instances.get(WORLD)!;
    const origin = this.choose(world.spawns);
    const spawn = this.findClearPointNear(world, origin.x, origin.y, 10);
    const inv = this.starterInventory();
    const player: ServerPlayer = {
      sid,
      userId,
      name,
      guest: true,
      instanceId: world.id,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      facing: 0,
      hp: PLAYER_MAX_HP,
      dead: false,
      moving: false,
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: 0,
        shoot: false,
      },
      inv,
      equipment: { helmet: null, vest: null, mod: null },
      equipped: null,
      money: 0,
      skills: { ...EMPTY_SKILLS },
      quests: {},
      hunger: 100,
      thirst: 100,
      stamina: STAMINA_MAX,
      staminaExhausted: false,
      lastExertAt: 0,
      starveAcc: 0,
      regenAcc: 0,
      lastPushedSurvival: -1,
      lastStaminaBucket: -1,
      lastPushedStaminaExhausted: false,
      action: null,
      actionStart: { x: spawn.x, y: spawn.y },
      mags: {},
      reloadUntil: 0,
      reloadTarget: null,
      lastInputSeq: 0,
      lastAttackAt: 0,
      lastExhaustedAttackToastAt: 0,
      lastHitAt: 0,
      lastSwingAt: 0,
      kills: 0,
      deaths: 0,
      openContainer: null,
      returnPos: null,
      ignoreInteractUntil: Date.now() + 900,
      loggedOutAt: null,
      lastStationMask: -1,
      armorDur: {},
      appearance: this.randomAppearance(),
      friendUserIds: new Set(),
      clanId: null,
      clanName: null,
      clanTag: null,
      clanRank: null,
      clanMateIds: new Set(),
      admin: false,
      adminMode: false,
      mutedUntil: 0,
    };
    this.players.set(sid, player);
    world.players++;
    void this.io?.sockets.sockets.get(sid)?.join(world.id);
    this.pushInventory(player);
    this.toast(
      sid,
      "Guest raid — progress is temporary; community, chat and extraction are locked",
    );
    this.log.log(`${name} joined as guest (${this.players.size} online)`);
    return this.initFor(world, sid);
  }

  async addPlayer(
    sid: string,
    userId: string,
    name: string,
    guest = false,
  ): Promise<WorldInit> {
    if (guest) return this.addGuestPlayer(sid, userId, name);
    // A clean disconnect saves before releasing ownership. Let that short
    // critical section finish so a rapid reconnect cannot load the prior row
    // or be removed by the older socket's finalizer.
    await this.playerExitPromises.get(userId);
    const access = await this.db.loadPlayerAccess(userId);
    if (access.bannedUntil > Date.now()) throw new Error("PLAYER_BANNED");
    const reconnecting = [...this.players.values()].some(
      (player) => !this.isBot(player) && player.userId === userId,
    );
    const humanPlayers = [...this.players.values()].filter(
      (player) => !this.isBot(player),
    ).length;
    if (!reconnecting && humanPlayers >= MAX_PLAYERS_PER_SERVER)
      throw new Error("WORLD_FULL");
    const ownsProfile = await this.db.acquirePlayerWorldLease(
      userId,
      sid,
      PLAYER_LEASE_TTL_SECONDS,
    );
    if (!ownsProfile) {
      this.telemetry.record({
        kind: "profile_lease_conflict",
        userId,
        source: "socket_admission",
        metadata: { serverKey: this.db.serverStateKey },
      });
      throw new Error("PROFILE_LEASE_CONFLICT");
    }
    // reconnect handover: keep live state, kick the old socket
    for (const [oldSid, existing] of this.players) {
      if (existing.userId !== userId) continue;
      this.players.delete(oldSid);
      for (const i of this.instances.values())
        for (const e of i.enemies.values())
          if (e.targetSid === oldSid) e.targetSid = sid;
      existing.sid = sid;
      existing.input = {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: existing.angle,
        shoot: false,
      };
      existing.loggedOutAt = null; // reconnected before the combat-log body expired
      existing.appearance = await this.db
        .loadAppearance(userId)
        .catch(() => existing.appearance);
      existing.admin = access.admin;
      existing.mutedUntil = access.mutedUntil;
      if (!existing.admin) existing.adminMode = false;
      await this.refreshPlayerSocial(existing).catch(() => undefined);
      this.players.set(sid, existing);
      const inst = this.inst(existing);
      void this.io?.sockets.sockets.get(sid)?.join(inst.id);
      this.io?.sockets.sockets.get(oldSid)?.disconnect(true);
      this.pushInventory(existing);
      return this.initFor(inst, sid);
    }

    const [row, appearance, social] = await Promise.all([
      this.db.loadProfile(userId),
      this.db.loadAppearance(userId),
      this.db.loadPlayerSocialAccess(userId),
    ]);
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
      guest: false,
      instanceId: home.id,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      facing: 0,
      hp: PLAYER_MAX_HP,
      dead: false,
      moving: false,
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: 0,
        shoot: false,
      },
      inv,
      equipment,
      equipped: this.firstWeaponSlot(inv),
      money,
      skills,
      quests,
      hunger,
      thirst,
      stamina: STAMINA_MAX,
      staminaExhausted: false,
      lastExertAt: 0,
      starveAcc: 0,
      regenAcc: 0,
      lastPushedSurvival: -1,
      lastStaminaBucket: -1,
      lastPushedStaminaExhausted: false,
      action: null,
      actionStart: { x: spawn.x, y: spawn.y },
      mags: Object.fromEntries(
        Object.entries(row?.mags ?? {}).flatMap(([id, rounds]) => {
          const weapon = this.content.item(id).weapon;
          return weapon && Number.isFinite(rounds)
            ? [[id, Math.max(0, Math.min(weapon.magSize, Math.floor(rounds!)))]]
            : [];
        }),
      ) as Partial<Record<ItemId, number>>,
      reloadUntil: 0,
      reloadTarget: null,
      lastInputSeq: 0,
      lastAttackAt: 0,
      lastExhaustedAttackToastAt: 0,
      lastHitAt: 0,
      lastSwingAt: 0,
      kills,
      deaths,
      openContainer: null,
      returnPos: null,
      ignoreInteractUntil: Date.now() + 900, // a key held through the login screen opens nothing
      loggedOutAt: null,
      lastStationMask: -1,
      armorDur: (row?.armorDur as ServerPlayer["armorDur"]) ?? {},
      appearance: row?.appearance ?? appearance,
      friendUserIds: new Set(social.friendIds),
      clanId: social.clan?.id ?? null,
      clanName: social.clan?.name ?? null,
      clanTag: social.clan?.tag ?? null,
      clanRank: social.clan?.rank ?? null,
      clanMateIds: new Set(social.clanMateIds),
      admin: access.admin,
      adminMode: false,
      mutedUntil: access.mutedUntil,
    };
    this.players.set(sid, p);
    if (!row && money > 0)
      this.telemetry.record({
        kind: "currency_spawned",
        userId,
        credits: money,
        source: "starter_profile",
      });
    home.players++;
    void this.io?.sockets.sockets.get(sid)?.join(home.id);
    this.pushInventory(p);
    this.toast(
      sid,
      "Welcome home — press E at the door mat when you are ready to deploy",
    );
    this.log.log(`${name} joined (${this.players.size} online)`);
    return this.initFor(home, sid);
  }

  async removePlayer(sid: string) {
    const p = this.players.get(sid);
    if (!p) return;
    const inst = this.instances.get(p.instanceId);
    // combat-log guard: a live body in the open world lingers 60s so you can't
    // alt-F4 to save your loot — anyone can still kill it and take the drops.
    const inDanger =
      !!inst &&
      inst.kind === "world" &&
      !p.dead &&
      !this.isSafeAt(inst, p.x, p.y);
    if (inDanger && p.loggedOutAt === null) {
      p.loggedOutAt = Date.now();
      p.input = {
        up: false,
        down: false,
        left: false,
        right: false,
        angle: p.angle,
        shoot: false,
      };
      p.action = null;
      this.log.log(
        `${p.name} disconnected in the open — body lingers 60s (${this.players.size} online)`,
      );
      await this.saveProfileOf(p);
      return; // stays in this.players; the tick finalizes it later
    }
    p.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      angle: p.angle,
      shoot: false,
    };
    p.action = null;
    await this.finalizePlayerExitWithLease(p);
  }

  /** Release a lease claimed during admission if loading the player failed. */
  async abandonPlayerAdmission(userId: string, sid: string, guest = false) {
    if (!guest && !this.players.has(sid))
      await this.db.releasePlayerWorldLease(userId, sid);
  }

  private async finalizePlayerExitWithLease(p: ServerPlayer) {
    if (this.isBot(p) || p.guest) {
      this.finalizePlayerExit(p);
      return;
    }
    const pending = this.playerExitPromises.get(p.userId);
    if (pending) return pending;
    const connectionId = p.sid;
    this.exitingPlayers.add(connectionId);
    const exit = (async () => {
      try {
        await this.saveProfileOf(p, connectionId);
        await this.evictPersonalHideoutVisitors(p.userId);
        this.finalizePlayerExit(p);
        await this.db.releasePlayerWorldLease(p.userId, connectionId);
      } finally {
        this.exitingPlayers.delete(connectionId);
      }
    })();
    this.playerExitPromises.set(p.userId, exit);
    try {
      await exit;
    } finally {
      if (this.playerExitPromises.get(p.userId) === exit)
        this.playerExitPromises.delete(p.userId);
    }
  }

  private async evictPersonalHideoutVisitors(ownerId: string) {
    const hideoutId = `h:${ownerId}`;
    const visitors = [...this.players.values()].filter(
      (visitor) =>
        !this.isBot(visitor) &&
        visitor.userId !== ownerId &&
        visitor.instanceId === hideoutId,
    );
    for (const visitor of visitors) {
      if (visitor.returnPos) {
        const world = this.instances.get(WORLD)!;
        const position = visitor.returnPos;
        visitor.returnPos = null;
        this.switchInstance(visitor, world, position.x, position.y);
      } else {
        const home = await this.hideoutInstance(visitor.userId);
        this.switchInstance(visitor, home, home.spawns[0].x, home.spawns[0].y);
      }
      this.toast(
        visitor.sid,
        "Camp visit ended because the owner went offline",
      );
    }
  }

  /** Fully remove a player from the sim after a safe exit or body resolution. */
  private finalizePlayerExit(p: ServerPlayer) {
    if (!this.players.has(p.sid)) return;
    this.players.delete(p.sid);
    const inst = this.instances.get(p.instanceId);
    if (inst) {
      inst.players = Math.max(0, inst.players - 1);
      if (inst.kind !== "world" && inst.players === 0) {
        this.instances.delete(inst.id);
        if (inst.clanId) void this.db.releaseClanHideoutLease(inst.clanId);
      }
      for (const e of inst.enemies.values())
        if (e.targetSid === p.sid) e.targetSid = null;
    }
    this.log.log(`${p.name} left (${this.players.size} online)`);
  }

  /** You wake up with nothing but your fists. */
  private starterInventory(): Inventory {
    return { backpack: 0, slots: new Array(BACKPACKS[0].slots).fill(null) };
  }

  private firstWeaponSlot(inv: Inventory): number | null {
    const i = inv.slots.findIndex(
      (s) =>
        s &&
        (this.content.item(s.id).kind === "weapon" ||
          this.content.item(s.id).kind === "tool"),
    );
    return i >= 0 ? i : null;
  }

  private botHasCampBuild(
    inst: Instance,
    bot: ServerBotState,
    type: BuildType,
    radiusTiles = 4,
  ): boolean {
    const centerX = Math.floor(bot.campX / TILE);
    const centerY = Math.floor(bot.campY / TILE);
    const targetTile = BUILDABLES[type]?.tile ?? null;
    const targetBlockId = this.content.playerBlock(type)?.id;
    for (let ty = centerY - radiusTiles; ty <= centerY + radiusTiles; ty++)
      for (let tx = centerX - radiusTiles; tx <= centerX + radiusTiles; tx++) {
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) continue;
        const index = ty * inst.w + tx;
        if (targetTile !== null && inst.tiles[index] === targetTile)
          return true;
        if (targetBlockId && inst.blockKinds[String(index)] === targetBlockId)
          return true;
      }
    return false;
  }

  private botFindBuildTile(
    inst: Instance,
    bot: ServerBotState,
    type: BuildType,
  ): { tx: number; ty: number } | null {
    const centerX = Math.floor(bot.campX / TILE);
    const centerY = Math.floor(bot.campY / TILE);
    const offsets: readonly [number, number][] =
      type === "workbench"
        ? [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [-1, -1],
          ]
        : type === "firepit"
          ? [
              [1, 1],
              [-1, 1],
              [1, -1],
              [-1, -1],
              [2, 0],
              [0, 2],
              [-2, 0],
              [0, -2],
            ]
          : [
              [2, 0],
              [-2, 0],
              [0, 2],
              [0, -2],
              [2, 1],
              [-2, -1],
              [1, 2],
              [-1, -2],
              [2, 2],
              [-2, 2],
              [2, -2],
              [-2, -2],
            ];
    for (const [dx, dy] of offsets) {
      const tx = centerX + dx;
      const ty = centerY + dy;
      if (tx < 1 || ty < 1 || tx >= inst.w - 1 || ty >= inst.h - 1) continue;
      const index = ty * inst.w + tx;
      const tile = inst.tiles[index];
      if (tile !== Tile.Grass && !FLOOR_TILES[tile]) continue;
      if (this.isSafeAt(inst, (tx + 0.5) * TILE, (ty + 0.5) * TILE)) continue;
      let occupied = false;
      for (const container of inst.containers.values()) {
        if (
          Math.floor(container.x / TILE) === tx &&
          Math.floor(container.y / TILE) === ty
        ) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;
      return { tx, ty };
    }
    return null;
  }

  private botInventoryCount(p: ServerPlayer, id: string): number {
    return this.countItem(p.inv, id);
  }

  private botFindSlot(
    p: ServerPlayer,
    predicate: (slot: NonNullable<InvSlot>, index: number) => boolean,
  ): number {
    for (let index = 0; index < p.inv.slots.length; index++) {
      const slot = p.inv.slots[index];
      if (slot && predicate(slot, index)) return index;
    }
    return -1;
  }

  private botHasRangedAmmo(p: ServerPlayer, weaponId: ItemId): boolean {
    const def = this.content.item(weaponId);
    if (!def.weapon) return false;
    return (
      (p.mags[weaponId] ?? 0) > 0 || this.countItem(p.inv, def.weapon.ammo) > 0
    );
  }

  private botBestCombatSlot(p: ServerPlayer, dist: number): number | null {
    let bestRanged: { slot: number; score: number } | null = null;
    let bestMelee: { slot: number; score: number } | null = null;
    for (let index = 0; index < p.inv.slots.length; index++) {
      const slot = p.inv.slots[index];
      if (!slot) continue;
      const def = this.content.item(slot.id);
      if (def.weapon && this.botHasRangedAmmo(p, slot.id)) {
        const score =
          def.weapon.damage * Math.max(1, def.weapon.pellets) +
          def.weapon.range / 18;
        if (!bestRanged || score > bestRanged.score)
          bestRanged = { slot: index, score };
      }
      if (def.melee) {
        const score =
          def.melee.damage * 2 +
          def.melee.range +
          def.melee.wood +
          def.melee.stone;
        if (!bestMelee || score > bestMelee.score)
          bestMelee = { slot: index, score };
      }
    }
    if (dist > 92) return bestRanged?.slot ?? bestMelee?.slot ?? null;
    if (bestMelee && (!bestRanged || bestMelee.score >= bestRanged.score * 0.7))
      return bestMelee.slot;
    return bestRanged?.slot ?? bestMelee?.slot ?? null;
  }

  private botBestHarvestSlot(
    p: ServerPlayer,
    skill: "woodcutting" | "mining",
  ): number | null {
    let best: { slot: number; score: number } | null = null;
    for (let index = 0; index < p.inv.slots.length; index++) {
      const slot = p.inv.slots[index];
      if (!slot) continue;
      const melee = this.content.item(slot.id).melee;
      if (!melee) continue;
      const score = skill === "woodcutting" ? melee.wood : melee.stone;
      if (score <= 0) continue;
      if (!best || score > best.score) best = { slot: index, score };
    }
    return best?.slot ?? null;
  }

  private botStop(p: ServerPlayer) {
    p.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      angle: p.angle,
      shoot: false,
      sprint: false,
    };
  }

  private botMoveToward(p: ServerPlayer, x: number, y: number, sprint = true) {
    const dx = x - p.x;
    const dy = y - p.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    if (dist < 10) {
      this.botStop(p);
      p.input.angle = angle;
      return;
    }
    p.input = {
      up: dy < -6,
      down: dy > 6,
      left: dx < -6,
      right: dx > 6,
      angle,
      shoot: false,
      sprint: sprint && dist > 220 && p.stamina > 35,
    };
  }

  private botMoveAway(p: ServerPlayer, x: number, y: number) {
    const away = Math.atan2(p.y - y, p.x - x);
    p.input = {
      up: Math.sin(away) < -0.2,
      down: Math.sin(away) > 0.2,
      left: Math.cos(away) < -0.2,
      right: Math.cos(away) > 0.2,
      angle: Math.atan2(y - p.y, x - p.x),
      shoot: false,
      sprint: p.stamina > 20,
    };
  }

  private botPickupGround(
    p: ServerPlayer,
    inst: Instance,
    ground: GroundItem,
  ): boolean {
    const leftover = this.addItem(p.inv, ground.item, ground.qty, ground.dur);
    if (leftover === ground.qty) return false;
    if (leftover > 0) ground.qty = leftover;
    else inst.ground.delete(ground.id);
    this.pushInventory(p);
    return true;
  }

  private botManageEquipment(p: ServerPlayer) {
    const backpackSlot = this.botFindSlot(
      p,
      (slot) =>
        this.content.item(slot.id).kind === "backpack" &&
        (this.content.item(slot.id).backpackTier ?? -1) > p.inv.backpack,
    );
    if (backpackSlot >= 0) {
      this.invUse(p.sid, backpackSlot);
      return;
    }
    for (const piece of ["helmet", "vest"] as const) {
      const current = p.equipment[piece]
        ? (this.content.item(p.equipment[piece]!).armor?.reduction ?? 0)
        : 0;
      const slot = this.botFindSlot(p, (entry) =>
        Boolean(
          this.content.item(entry.id).armor &&
          this.content.item(entry.id).armor!.piece === piece &&
          this.content.item(entry.id).armor!.reduction > current,
        ),
      );
      if (slot >= 0) {
        this.invUse(p.sid, slot);
        return;
      }
    }
    if (!p.equipment.mod) {
      const slot = this.botFindSlot(
        p,
        (entry) =>
          entry.id === "attach_reddot" || entry.id === "attach_suppressor",
      );
      if (slot >= 0) this.invUse(p.sid, slot);
    }
  }

  private botTrySelfCare(
    p: ServerPlayer,
    inst: Instance,
    now: number,
  ): boolean {
    if (!this.isBot(p) || now < p.bot.nextUtilityAt) return false;
    this.botManageEquipment(p);
    const healSlot = this.botFindSlot(p, (slot) =>
      Boolean(this.content.item(slot.id).heal),
    );
    if (p.hp <= 55 && healSlot >= 0) {
      this.invUse(p.sid, healSlot);
      p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
      return true;
    }
    const thirstSlot = this.botFindSlot(p, (slot) =>
      Boolean(this.content.item(slot.id).drink),
    );
    if (p.thirst <= 45 && thirstSlot >= 0) {
      this.invUse(p.sid, thirstSlot);
      p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
      return true;
    }
    const foodSlot = this.botFindSlot(
      p,
      (slot) =>
        Boolean(this.content.item(slot.id).food) &&
        !this.content.item(slot.id).raw,
    );
    if (p.hunger <= 55 && foodSlot >= 0) {
      this.invUse(p.sid, foodSlot);
      p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
      return true;
    }
    const cookSlot = this.botFindSlot(p, (slot) =>
      Boolean(this.content.item(slot.id).raw),
    );
    if (cookSlot >= 0 && p.hunger <= 80) {
      const firepit = this.nearestStationIndex(p, "firepit");
      if (firepit !== null) {
        if (
          (inst.stationFuel.get(firepit) ?? 0) < STATION_FUEL_PER_ACTION &&
          this.botInventoryCount(p, "wood") > 0
        ) {
          this.addStationFuel(p.sid, firepit, 1);
        }
        if ((inst.stationFuel.get(firepit) ?? 0) >= STATION_FUEL_PER_ACTION)
          this.invUse(p.sid, cookSlot);
        p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
        return true;
      }
    }
    if (p.thirst <= 38 && this.nearTile(p, Tile.Water, 2) && !p.action) {
      this.startAction(p, "drink", "Drinking…", DRINK_TIME_MS);
      p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
      return true;
    }
    return false;
  }

  private botTryTrade(p: ServerPlayer, now: number): boolean {
    if (!this.isBot(p) || now < p.bot.nextTradeAt) return false;
    const trader = this.traderAt(p);
    if (!trader) return false;
    const stock = this.content.traderStock(trader.tier ?? 1);
    const sellSlot = this.botFindSlot(p, (slot) => {
      const entry = stock.find((row) => row.id === slot.id && row.sell > 0);
      if (!entry) return false;
      return (
        ["gold_bar", "diamond", "rolex", "data_drive", "artifact"].includes(
          slot.id,
        ) ||
        slot.qty >=
          Math.max(4, Math.ceil((this.content.item(slot.id).stack ?? 1) * 0.5))
      );
    });
    if (sellSlot >= 0) {
      const stack = p.inv.slots[sellSlot];
      if (stack) this.tradeSell(p.sid, sellSlot, stack.qty);
      p.bot.nextTradeAt = now + BOT_TRADE_COOLDOWN_MS;
      return true;
    }
    if (
      this.botInventoryCount(p, "bandage") === 0 &&
      p.money >= 15 &&
      stock.some((row) => row.id === "bandage" && row.buy > 0)
    ) {
      this.tradeBuy(p.sid, "bandage", 1);
      p.bot.nextTradeAt = now + BOT_TRADE_COOLDOWN_MS;
      return true;
    }
    const equipped = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const ammo =
      equipped?.id && this.content.item(equipped.id).weapon
        ? this.content.item(equipped.id).weapon!.ammo
        : null;
    if (ammo && this.botInventoryCount(p, ammo) < 18) {
      const ammoEntry = stock.find((row) => row.id === ammo && row.buy > 0);
      if (ammoEntry && p.money >= ammoEntry.buy * 6) {
        this.tradeBuy(p.sid, ammo, 6);
        p.bot.nextTradeAt = now + BOT_TRADE_COOLDOWN_MS;
        return true;
      }
    }
    return false;
  }

  private botTryCraft(p: ServerPlayer, inst: Instance, now: number): boolean {
    if (!this.isBot(p) || p.action) return false;
    const weaponSlot = this.botFindSlot(
      p,
      (slot) =>
        this.content.item(slot.id).kind === "weapon" ||
        this.content.item(slot.id).kind === "tool",
    );
    const hasWorkbench = this.botHasCampBuild(inst, p.bot, "workbench");
    const hasFirepit = this.botHasCampBuild(inst, p.bot, "firepit");
    const craftIfPossible = (recipeId: string) => {
      this.craft(p.sid, recipeId);
      p.bot.nextUtilityAt = now + BOT_SELF_CARE_MS;
    };

    if (
      this.botInventoryCount(p, "bandage") === 0 &&
      this.botInventoryCount(p, "cloth") >= 2
    ) {
      craftIfPossible("craft_bandage");
      return true;
    }
    if (
      weaponSlot < 0 &&
      this.botInventoryCount(p, "wood") >= 4 &&
      this.botInventoryCount(p, "stone") >= 1
    ) {
      craftIfPossible("craft_spear");
      return true;
    }
    if (
      !hasWorkbench &&
      this.botInventoryCount(p, "kit_workbench") === 0 &&
      this.botInventoryCount(p, "wood") >= 8 &&
      this.botInventoryCount(p, "scrap") >= 4
    ) {
      craftIfPossible("craft_workbench");
      return true;
    }
    if (
      !hasFirepit &&
      this.botInventoryCount(p, "kit_firepit") === 0 &&
      this.botInventoryCount(p, "wood") >= 6 &&
      this.botInventoryCount(p, "stone") >= 4
    ) {
      craftIfPossible("craft_firepit");
      return true;
    }
    if (this.nearStation(p, "workbench")) {
      if (
        this.botFindSlot(
          p,
          (slot) => slot.id === "axe" || slot.id === "steel_axe",
        ) < 0 &&
        this.botInventoryCount(p, "wood") >= 5 &&
        this.botInventoryCount(p, "stone") >= 3
      ) {
        craftIfPossible("craft_axe");
        return true;
      }
      if (
        this.botFindSlot(
          p,
          (slot) => slot.id === "pickaxe" || slot.id === "steel_pickaxe",
        ) < 0 &&
        this.botInventoryCount(p, "wood") >= 5 &&
        this.botInventoryCount(p, "stone") >= 3
      ) {
        craftIfPossible("craft_pickaxe");
        return true;
      }
    }
    if (p.bot.buildDrive > 0.45 && now >= p.bot.nextBuildAt) {
      if (
        this.botInventoryCount(p, "kit_fence") < 2 &&
        this.botInventoryCount(p, "wood") >= 6
      ) {
        craftIfPossible("craft_fence");
        return true;
      }
      if (
        this.botInventoryCount(p, "kit_torch") === 0 &&
        this.botInventoryCount(p, "wood") >= 2 &&
        this.botInventoryCount(p, "cloth") >= 1
      ) {
        craftIfPossible("craft_torch");
        return true;
      }
      if (
        this.botInventoryCount(p, "kit_wall") === 0 &&
        this.botInventoryCount(p, "wood") >= 6 &&
        this.botInventoryCount(p, "stone") >= 2
      ) {
        craftIfPossible("craft_wall");
        return true;
      }
    }
    return false;
  }

  private botTryBuild(p: ServerPlayer, inst: Instance, now: number): boolean {
    if (!this.isBot(p) || now < p.bot.nextBuildAt) return false;
    const priorities = [
      ...(this.botHasCampBuild(inst, p.bot, "workbench") ? [] : ["workbench"]),
      ...(this.botHasCampBuild(inst, p.bot, "firepit") ? [] : ["firepit"]),
      ...(p.bot.buildDrive > 0.6 ? ["fence", "torch", "wall"] : []),
    ] as BuildType[];
    for (const type of priorities) {
      const slot = this.botFindSlot(
        p,
        (entry) => this.content.item(entry.id).place === type,
      );
      if (slot < 0) continue;
      const tile = this.botFindBuildTile(inst, p.bot, type);
      if (!tile) continue;
      const targetX = (tile.tx + 0.5) * TILE;
      const targetY = (tile.ty + 0.5) * TILE;
      if (Math.hypot(targetX - p.x, targetY - p.y) > TILE * 3.5) {
        this.botMoveToward(p, targetX, targetY);
        return true;
      }
      this.build(p.sid, slot, tile.tx, tile.ty, Math.floor(this.rnd() * 4));
      p.bot.nextBuildAt =
        now + BOT_BUILD_COOLDOWN_MS + Math.floor(this.rnd() * 6000);
      return true;
    }
    return false;
  }

  private botChoosePlayerTarget(
    p: ServerPlayer,
    inst: Instance,
    now: number,
  ): ServerPlayer | null {
    if (!this.isBot(p)) return null;
    if (p.hp < 25 && now - p.lastHitAt > 2500) return null;
    const willing = p.bot.aggression > 0.58 || now - p.lastHitAt < 4000;
    if (!willing) return null;
    let best: ServerPlayer | null = null;
    let bestDist = 360 + p.bot.aggression * 140;
    for (const other of this.players.values()) {
      if (other.sid === p.sid || other.dead || other.instanceId !== inst.id)
        continue;
      if (this.isSafeAt(inst, other.x, other.y)) continue;
      const dist = Math.hypot(other.x - p.x, other.y - p.y);
      if (dist >= bestDist) continue;
      if (
        dist > GameService.SENSE_RANGE &&
        !this.losClear(inst, p.x, p.y, other.x, other.y)
      )
        continue;
      best = other;
      bestDist = dist;
    }
    return best;
  }

  private botChooseEnemyTarget(p: ServerPlayer, inst: Instance): Enemy | null {
    if (!this.isBot(p)) return null;
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const enemy of inst.enemies.values()) {
      const dist = Math.hypot(enemy.x - p.x, enemy.y - p.y);
      const def = this.content.enemy(enemy.kind);
      const urgent =
        enemy.targetSid === p.sid || (def.behavior !== "flee" && dist < 120);
      const hunt =
        def.behavior === "flee"
          ? p.hunger < 78 || p.bot.greed > 0.6
          : p.hp > 55 && p.bot.aggression > 0.3;
      if (!urgent && !hunt) continue;
      if (dist > (def.behavior === "flee" ? 260 : 180)) continue;
      if (
        dist > GameService.SENSE_RANGE &&
        !this.losClear(inst, p.x, p.y, enemy.x, enemy.y)
      )
        continue;
      if (dist < bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best;
  }

  private botFindLootTarget(
    inst: Instance,
    p: ServerPlayer,
  ): GroundItem | Container | null {
    const packed =
      p.inv.slots.every(Boolean) ||
      invWeight(p.inv, this.content.items) >= invCapacity(p.inv).maxKg * 0.95;
    if (packed && !this.traderAt(p)) return null;
    let bestGround: GroundItem | null = null;
    let bestGroundDist = 220;
    for (const ground of inst.ground.values()) {
      const dist = Math.hypot(ground.x - p.x, ground.y - p.y);
      if (dist < bestGroundDist) {
        bestGround = ground;
        bestGroundDist = dist;
      }
    }
    if (bestGround) return bestGround;
    let bestContainer: Container | null = null;
    let bestContainerDist = 260;
    for (const container of inst.containers.values()) {
      if (
        container.kind === "storage" ||
        container.slots.every((slot) => !slot)
      )
        continue;
      const dist = Math.hypot(container.x - p.x, container.y - p.y);
      if (dist < bestContainerDist) {
        bestContainer = container;
        bestContainerDist = dist;
      }
    }
    return bestContainer;
  }

  private botFindHarvestNode(
    inst: Instance,
    p: ServerPlayer,
  ): { x: number; y: number; skill: "woodcutting" | "mining" } | null {
    const wantWood =
      this.botInventoryCount(p, "wood") < 14 ||
      this.botInventoryCount(p, "kit_workbench") > 0 ||
      this.botInventoryCount(p, "kit_firepit") > 0;
    const wantStone =
      this.botInventoryCount(p, "stone") < 12 ||
      this.botInventoryCount(p, "kit_firepit") > 0 ||
      this.botInventoryCount(p, "kit_wall") > 0;
    const preferred: ("woodcutting" | "mining")[] =
      wantWood &&
      (!wantStone ||
        this.botInventoryCount(p, "wood") <= this.botInventoryCount(p, "stone"))
        ? ["woodcutting", "mining"]
        : ["mining", "woodcutting"];
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (const skill of preferred) {
      let best: {
        x: number;
        y: number;
        skill: "woodcutting" | "mining";
      } | null = null;
      let bestDist = 9999;
      for (let y = ty - 18; y <= ty + 18; y++)
        for (let x = tx - 18; x <= tx + 18; x++) {
          if (x < 0 || y < 0 || x >= inst.w || y >= inst.h) continue;
          const index = y * inst.w + x;
          const tile = inst.tiles[index] as Tile;
          const attachedResource = this.content.resource(
            inst.resourceKinds[String(index)],
          );
          const resource =
            attachedResource &&
            harvestResourceTileMatches(attachedResource.tile, tile)
              ? attachedResource
              : undefined;
          const nodeSkill =
            resource?.skill ??
            (tile === Tile.Tree
              ? "woodcutting"
              : tile === Tile.Rock ||
                  tile === Tile.CopperOre ||
                  tile === Tile.IronOre
                ? "mining"
                : null);
          if (nodeSkill !== skill) continue;
          const hits = resource?.maxHits ?? NODE_HITS[tile];
          if (!hits) continue;
          const px = (x + 0.5) * TILE;
          const py = (y + 0.5) * TILE;
          const dist = Math.hypot(px - p.x, py - p.y);
          if (dist < bestDist) {
            best = { x: px, y: py, skill };
            bestDist = dist;
          }
        }
      if (best) return best;
    }
    return null;
  }

  private botFightTarget(p: ServerPlayer, x: number, y: number) {
    const dist = Math.hypot(x - p.x, y - p.y);
    const slot = this.botBestCombatSlot(p, dist);
    if (slot !== null && p.equipped !== slot) this.invEquip(p.sid, slot);
    const held = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const weapon = held ? this.content.item(held.id) : null;
    const isRanged = Boolean(
      held && weapon?.weapon && this.botHasRangedAmmo(p, held.id),
    );
    const range =
      weapon?.weapon?.range ??
      (weapon?.melee?.range ?? FISTS.range) + PLAYER_RADIUS + 6;
    if (isRanged && dist < 86) this.botMoveAway(p, x, y);
    else if (dist > Math.min(range * 0.75, 240))
      this.botMoveToward(p, x, y, true);
    else this.botStop(p);
    p.input.angle = Math.atan2(y - p.y, x - p.x);
    p.input.shoot = true;
  }

  private botRespawn(p: ServerPlayer) {
    if (!this.isBot(p)) return;
    const world = this.instances.get(WORLD)!;
    p.hp = PLAYER_MAX_HP;
    p.dead = false;
    p.inv = this.botStarterInventory();
    p.equipment = { helmet: null, vest: null, mod: null };
    p.equipped = this.firstWeaponSlot(p.inv);
    p.mags = {};
    p.hunger = 75 + Math.floor(this.rnd() * 25);
    p.thirst = 75 + Math.floor(this.rnd() * 25);
    p.stamina = STAMINA_MAX;
    p.staminaExhausted = false;
    p.action = null;
    p.reloadTarget = null;
    p.reloadUntil = 0;
    p.loggedOutAt = null;
    p.bot.respawnAt = 0;
    this.resetBotWorldPosition(p, world);
  }

  private updateBot(p: ServerPlayer, inst: Instance, now: number) {
    if (!this.isBot(p) || inst.kind !== "world") return;
    this.botStop(p);
    if (p.action) return;
    if (this.botTrySelfCare(p, inst, now)) return;
    const playerTarget = this.botChoosePlayerTarget(p, inst, now);
    if (playerTarget) {
      this.botFightTarget(p, playerTarget.x, playerTarget.y);
      return;
    }
    const enemyTarget = this.botChooseEnemyTarget(p, inst);
    if (enemyTarget) {
      this.botFightTarget(p, enemyTarget.x, enemyTarget.y);
      return;
    }
    const lootTarget = this.botFindLootTarget(inst, p);
    if (lootTarget) {
      if ("item" in lootTarget) {
        if (
          Math.hypot(lootTarget.x - p.x, lootTarget.y - p.y) <= INTERACT_RANGE
        ) {
          if (this.botPickupGround(p, inst, lootTarget))
            p.bot.nextUtilityAt = now + 250;
          return;
        }
        this.botMoveToward(p, lootTarget.x, lootTarget.y);
        return;
      }
      if (
        Math.hypot(lootTarget.x - p.x, lootTarget.y - p.y) <=
        INTERACT_RANGE * 1.25
      ) {
        const slot = lootTarget.slots.findIndex((entry) => !!entry);
        if (slot >= 0) {
          this.containerTake(p.sid, lootTarget.id, slot);
          p.bot.nextUtilityAt = now + 250;
          return;
        }
      }
      this.botMoveToward(p, lootTarget.x, lootTarget.y);
      return;
    }
    if (this.botTryTrade(p, now)) return;
    if (this.botTryBuild(p, inst, now)) return;
    if (this.botTryCraft(p, inst, now)) return;
    const harvest = this.botFindHarvestNode(inst, p);
    if (harvest) {
      const harvestSlot = this.botBestHarvestSlot(p, harvest.skill);
      if (harvestSlot !== null && p.equipped !== harvestSlot)
        this.invEquip(p.sid, harvestSlot);
      else if (
        harvestSlot === null &&
        p.equipped !== null &&
        (!p.inv.slots[p.equipped] ||
          !this.content.item(p.inv.slots[p.equipped]!.id).melee)
      )
        p.equipped = null;
      const dist = Math.hypot(harvest.x - p.x, harvest.y - p.y);
      if (dist > 52) this.botMoveToward(p, harvest.x, harvest.y, false);
      else this.botStop(p);
      p.input.angle = Math.atan2(harvest.y - p.y, harvest.x - p.x);
      p.input.shoot = true;
      return;
    }
    if (p.thirst < 45 && this.nearTile(p, Tile.Water, 8)) {
      for (
        let ty = Math.max(0, Math.floor(p.y / TILE) - 8);
        ty <= Math.min(inst.h - 1, Math.floor(p.y / TILE) + 8);
        ty++
      )
        for (
          let tx = Math.max(0, Math.floor(p.x / TILE) - 8);
          tx <= Math.min(inst.w - 1, Math.floor(p.x / TILE) + 8);
          tx++
        )
          if (inst.tiles[ty * inst.w + tx] === Tile.Water) {
            this.botMoveToward(p, (tx + 0.5) * TILE, (ty + 0.5) * TILE, false);
            return;
          }
    }
    if (
      now >= p.bot.roamUntil ||
      Math.hypot(p.bot.roamX - p.x, p.bot.roamY - p.y) < TILE * 1.2
    ) {
      const choices = [
        ...inst.lootSpots.map((spot) => ({ x: spot.x, y: spot.y })),
        ...inst.spawns.map((spot) => ({ x: spot.x, y: spot.y })),
        ...inst.traders.map((spot) => ({ x: spot.x, y: spot.y })),
        ...inst.pois.map((poi) => ({ x: poi.x, y: poi.y })),
        { x: p.bot.campX, y: p.bot.campY },
      ];
      const next = choices[Math.floor(this.rnd() * choices.length)] ?? {
        x: p.bot.campX,
        y: p.bot.campY,
      };
      p.bot.roamX = next.x + (this.rnd() - 0.5) * TILE * 3;
      p.bot.roamY = next.y + (this.rnd() - 0.5) * TILE * 3;
      p.bot.roamUntil = now + 5000 + Math.floor(this.rnd() * 9000);
    }
    this.botMoveToward(p, p.bot.roamX, p.bot.roamY);
  }

  // ── input & interactions ──────────────────────────────────────────────────

  setInput(sid: string, input: InputPayload) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.loggedOutAt !== null) return;
    const angle = Number(input.angle);
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      angle: Number.isFinite(angle) ? angle : p.angle,
      shoot: !!input.shoot,
      sprint: !!input.sprint,
    };
    const seq = Number(input.seq);
    if (Number.isSafeInteger(seq) && seq >= 0)
      p.lastInputSeq = Math.min(seq, 0x7fffffff);
  }

  interact(sid: string) {
    const p = this.players.get(sid);
    if (!p || p.dead || Date.now() < p.ignoreInteractUntil) return;
    p.angle = p.input.angle;
    p.facing = p.input.angle;
    const inst = this.inst(p);

    // hideout exit mat
    if (
      inst.kind !== "world" &&
      inst.exit &&
      Math.hypot(inst.exit.x - p.x, inst.exit.y - p.y) < INTERACT_RANGE
    ) {
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
        if (p.guest) {
          this.toast(
            sid,
            "Guest raids cannot extract — register to secure loot and unlock a hideout",
          );
          return;
        }
        if (this.isSafeAt(inst, p.x, p.y)) {
          this.toast(sid, "You cannot extract from inside a safe zone");
          return;
        }
        this.startAction(p, "extract", "Extracting…", EXTRACT_TIME_MS);
        return;
      }
    }
    // containers vs stations — open whichever is closer
    let best: Container | null = null;
    let bestD = INTERACT_RANGE;
    for (const c of inst.containers.values()) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    // nearest placed station tile (firepit / furnace / workbench)
    let station: CraftingStation | null = null;
    let stationIndex = -1;
    let stationD = INTERACT_RANGE;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor(p.y / TILE);
    for (let ty = pty - 2; ty <= pty + 2; ty++)
      for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) continue;
        const st = this.stationAtIndex(inst, ty * inst.w + tx);
        if (!st) continue;
        const d = Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y);
        if (d < stationD) {
          station = st;
          stationIndex = ty * inst.w + tx;
          stationD = d;
        }
      }
    if (station && stationD < bestD) {
      this.emitTo(
        sid,
        EV.station,
        this.stationPayload(inst, station, stationIndex),
      );
      return;
    }
    if (best) {
      this.startChestRestock(best);
      p.openContainer = best.id;
      this.emitTo(sid, EV.container, {
        id: best.id,
        slots: best.slots,
        storage: best.kind === "storage",
        readOnly: Boolean(best.eventId),
      } satisfies ContainerContents);
      return;
    }
    // ground items
    let bestG: GroundItem | null = null;
    bestD = INTERACT_RANGE;
    for (const g of inst.ground.values()) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bestD) {
        bestG = g;
        bestD = d;
      }
    }
    if (bestG) {
      const leftover = this.addItem(p.inv, bestG.item, bestG.qty, bestG.dur);
      if (leftover === bestG.qty) {
        this.toast(sid, "Inventory full");
        return;
      }
      if (leftover > 0) {
        bestG.qty = leftover;
        this.toast(
          sid,
          `Picked up some ${this.content.item(bestG.item).name} (bag full)`,
        );
      } else {
        inst.ground.delete(bestG.id);
        this.toast(
          sid,
          `Picked up ${this.content.item(bestG.item).name} x${bestG.qty}`,
        );
      }
      this.pushInventory(p);
      return;
    }
    // nothing else nearby: drink straight from adjacent water
    if (this.nearTile(p, Tile.Water, 2) && p.thirst < 100) {
      this.startAction(p, "drink", "Drinking…", DRINK_TIME_MS);
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

  /** Resolve station behavior from either the compatibility tile or a published player block. */
  private stationAtIndex(
    inst: Instance,
    index: number,
  ): CraftingStation | null {
    const blockType = this.content.block(inst.blockKinds[String(index)])
      ?.playerPlacement?.buildType;
    if (
      blockType === "workbench" ||
      blockType === "firepit" ||
      blockType === "furnace" ||
      blockType === "anvil"
    )
      return blockType;
    const tile = inst.tiles[index];
    if (tile === Tile.Workbench) return "workbench";
    if (tile === Tile.Firepit) return "firepit";
    if (tile === Tile.Furnace) return "furnace";
    if (tile === Tile.Anvil) return "anvil";
    return null;
  }

  private nearestStationIndex(
    p: ServerPlayer,
    station: CraftingStation,
    r = 2,
  ): number | null {
    const inst = this.inst(p);
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    let best: number | null = null;
    let bestDistance = (r + 0.5) * TILE;
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || y < 0 || x >= inst.w || y >= inst.h) continue;
        const index = y * inst.w + x;
        if (this.stationAtIndex(inst, index) !== station) continue;
        const distance = Math.hypot(
          (x + 0.5) * TILE - p.x,
          (y + 0.5) * TILE - p.y,
        );
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
    return best;
  }

  private stationPayload(
    inst: Instance,
    type: CraftingStation,
    index: number,
  ): StationOpen {
    if (type !== "firepit" && type !== "furnace") return { type, index };
    return {
      type,
      index,
      fuel: inst.stationFuel.get(index) ?? 0,
      maxFuel: STATION_FUEL_MAX,
      fuelPerWood: STATION_FUEL_PER_WOOD,
    };
  }

  private persistStationFuel(inst: Instance, index: number) {
    if (inst.kind === "world" || !inst.hideout) return;
    const tx = index % inst.w;
    const ty = Math.floor(index / inst.w);
    const object = inst.hideout.objects.find(
      (entry) =>
        entry.tx === tx &&
        entry.ty === ty &&
        (entry.type === "firepit" || entry.type === "furnace"),
    );
    if (!object) return;
    object.fuel = inst.stationFuel.get(index) ?? 0;
    this.persistHideout(inst);
  }

  private consumeStationFuel(
    inst: Instance,
    index: number,
    amount = STATION_FUEL_PER_ACTION,
  ): boolean {
    const current = inst.stationFuel.get(index) ?? 0;
    const result = consumeFuel(current, amount);
    if (!result.consumed) return false;
    const next = result.fuel;
    if (next > 0) inst.stationFuel.set(index, next);
    else inst.stationFuel.delete(index);
    this.io?.to(inst.id).emit(EV.stationFuelUpdate, { i: index, fuel: next });
    this.persistStationFuel(inst, index);
    return true;
  }

  addStationFuel(sid: string, index: number, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    if (index < 0 || index >= inst.w * inst.h) return;
    const station = this.stationAtIndex(inst, index);
    if (station !== "firepit" && station !== "furnace") return;
    const x = ((index % inst.w) + 0.5) * TILE;
    const y = (Math.floor(index / inst.w) + 0.5) * TILE;
    if (Math.hypot(x - p.x, y - p.y) > INTERACT_RANGE * 1.5) return;
    const current = inst.stationFuel.get(index) ?? 0;
    const addition = planFuelAddition(
      current,
      qty,
      this.countItem(p.inv, "wood"),
      STATION_FUEL_MAX,
      STATION_FUEL_PER_WOOD,
    );
    if (current >= STATION_FUEL_MAX) {
      this.toast(sid, "That station is already full of fuel");
      return;
    }
    const wood = addition.wood;
    if (wood <= 0) {
      this.toast(sid, "You need wood to fuel that station");
      return;
    }
    this.removeItem(p.inv, "wood", wood);
    inst.stationFuel.set(index, addition.fuel);
    this.io
      ?.to(inst.id)
      .emit(EV.stationFuelUpdate, { i: index, fuel: addition.fuel });
    this.persistStationFuel(inst, index);
    this.pushInventory(p);
    this.emitTo(sid, EV.station, this.stationPayload(inst, station, index));
    this.toast(sid, `Added ${wood} wood to the ${station}`);
  }

  private nearStation(
    p: ServerPlayer,
    station: CraftingStation,
    r = 2,
  ): boolean {
    return this.nearestStationIndex(p, station, r) !== null;
  }

  private startAction(
    p: ServerPlayer,
    kind: NonNullable<ServerPlayer["action"]>["kind"],
    label: string,
    ms: number,
    data?: { id?: string; slot?: number; station?: number },
  ) {
    if (p.action) return false;
    p.action = { kind, until: Date.now() + ms, data };
    p.actionStart = { x: p.x, y: p.y };
    this.emitTo(p.sid, EV.action, {
      label,
      ms,
      kind,
      container: data?.id,
      slot: data?.slot,
    } satisfies ActionSnap);
    return true;
  }

  private completeAction(
    p: ServerPlayer,
    inst: Instance,
    act: NonNullable<ServerPlayer["action"]>,
  ) {
    this.emitTo(p.sid, EV.action, { label: "", ms: 0 } satisfies ActionSnap);
    switch (act.kind) {
      case "loot":
        if (act.data?.id !== undefined && act.data.slot !== undefined)
          this.takeNow(p, inst, act.data.id, act.data.slot);
        break;
      case "fish": {
        if (this.rnd() < 0.7) {
          const leftover = this.addItem(p.inv, "raw_fish", 1);
          if (leftover > 0) this.dropAt(inst, p.x, p.y + 20, "raw_fish", 1);
          this.toast(p.sid, "You caught a fish!");
          this.addXp(p, "crafting", 4);
        } else {
          this.toast(p.sid, "It got away…");
        }
        this.pushInventory(p);
        break;
      }
      case "drink":
        p.thirst = Math.min(100, p.thirst + 40);
        this.toast(p.sid, "You drink from the water (+40 thirst)");
        this.pushInventory(p);
        break;
      case "fill": {
        const slot = act.data?.slot ?? -1;
        const item = p.inv.slots[slot];
        const fillDef = item ? this.content.item(item.id) : null;
        if (item && fillDef?.fillFrom) {
          const filled = this.content.item(fillDef.fillFrom);
          p.inv.slots[slot] = {
            id: fillDef.fillFrom as ItemId,
            qty: filled.stack,
          };
          this.toast(p.sid, `${filled.name} filled (${filled.stack} drinks)`);
          this.pushInventory(p);
        }
        break;
      }
      case "cook": {
        const slot = act.data?.slot ?? -1;
        const station = act.data?.station ?? -1;
        const item = p.inv.slots[slot];
        const def = item ? this.content.item(item.id) : null;
        const stationX = ((station % inst.w) + 0.5) * TILE;
        const stationY = (Math.floor(station / inst.w) + 0.5) * TILE;
        const usable =
          station >= 0 &&
          this.stationAtIndex(inst, station) === "firepit" &&
          Math.hypot(stationX - p.x, stationY - p.y) <= INTERACT_RANGE * 1.5;
        if (
          item &&
          def?.raw &&
          usable &&
          this.consumeStationFuel(inst, station)
        ) {
          item.qty -= 1;
          if (item.qty <= 0) p.inv.slots[slot] = null;
          const leftover = this.addItem(p.inv, def.raw, 1);
          if (leftover > 0) this.dropAt(inst, p.x, p.y + 20, def.raw, 1);
          this.toast(p.sid, `Meal ready: ${this.content.item(def.raw).name}`);
          this.addXp(p, "crafting", 3);
          this.pushInventory(p);
          this.emitTo(
            p.sid,
            EV.station,
            this.stationPayload(inst, "firepit", station),
          );
        } else if (item && def?.raw && usable) {
          this.toast(p.sid, "The fire has gone out — add wood");
        }
        break;
      }
      case "extract":
        void this.extractHome(p);
        break;
      case "craft": {
        const recipe = this.content.recipes.find((r) => r.id === act.data?.id);
        // re-validate — materials may have moved while the bar filled
        if (recipe && this.craftChecks(p, recipe))
          this.doCraft(p, inst, recipe);
        break;
      }
    }
  }

  /** Extraction beacon success: back to your base, loot intact. */
  private async extractHome(p: ServerPlayer) {
    if (p.dead) return;
    if (p.guest) {
      this.toast(
        p.sid,
        "Guest raids cannot extract — register to keep progression and build a hideout",
      );
      return;
    }
    const value = this.inventoryValue(p.inv);
    this.telemetry.record({
      kind: "extraction",
      userId: p.userId,
      value,
      source: "beacon",
      metadata: {
        items: p.inv.slots.reduce((count, slot) => count + (slot?.qty ?? 0), 0),
      },
    });
    const home = await this.hideoutInstance(p.userId);
    p.returnPos = null;
    this.switchInstance(p, home, home.spawns[0].x, home.spawns[0].y);
    this.toast(p.sid, "Extraction successful — loot secured at home");
    void this.saveProfileOf(p);
  }

  containerTake(sid: string, containerId: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.action) return;
    const inst = this.inst(p);
    const c = inst.containers.get(containerId);
    if (!c || Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return;
    this.startChestRestock(c);
    const item = c.slots[slot];
    if (!item) return;
    // Tarkov-style: taking loot costs time (heavier = slower); your own stash is instant
    if (c.kind === "storage") {
      this.takeNow(p, inst, containerId, slot);
      return;
    }
    const ms = Math.min(
      3000,
      LOOT_TIME_BASE_MS +
        this.content.item(item.id).kg * item.qty * LOOT_TIME_PER_KG_MS,
    );
    this.startAction(
      p,
      "loot",
      `Taking ${this.content.item(item.id).name}…`,
      ms,
      { id: containerId, slot },
    );
  }

  private takeNow(
    p: ServerPlayer,
    inst: Instance,
    containerId: string,
    slot: number,
  ) {
    const c = inst.containers.get(containerId);
    if (!c || Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return;
    const item = c.slots[slot];
    if (!item) return;
    const leftover = this.addItem(p.inv, item.id, item.qty, item.dur);
    if (leftover === item.qty) {
      this.toast(p.sid, "Not enough space or weight");
      return;
    }
    c.slots[slot] =
      leftover > 0
        ? {
            id: item.id,
            qty: leftover,
            ...(item.dur !== undefined ? { dur: item.dur } : {}),
          }
        : null;

    if (c.kind === "storage") this.persistHideout(inst);
    if (c.slots.every((s) => !s)) {
      if (c.eventId && c.eventKind === "supply_drop") {
        inst.containers.delete(c.id);
        inst.randomEvents.delete(c.eventId);
        this.io?.to(inst.id).emit(EV.containerGone, c.id);
        this.io
          ?.to(inst.id)
          .emit(EV.toast, `SUPPLY DROP secured by ${p.name}`);
      } else if (c.kind === "bag") {
        inst.containers.delete(c.id);
        this.io?.to(inst.id).emit(EV.containerGone, c.id);
      }
    }
    this.pushInventory(p);
    this.emitTo(p.sid, EV.container, {
      id: c.id,
      slots: inst.containers.has(c.id) ? c.slots : [],
      storage: c.kind === "storage",
      readOnly: Boolean(c.eventId),
    });
  }

  private reachableContainer(
    p: ServerPlayer,
    containerId: string,
  ): Container | null {
    const c = this.inst(p).containers.get(containerId);
    if (!c || c.kind === "bag" || c.eventId) return null;
    if (Math.hypot(c.x - p.x, c.y - p.y) > INTERACT_RANGE * 1.5) return null;
    return c;
  }

  private startChestRestock(c: Container, now = Date.now()) {
    if (
      (c.kind !== "chest" && c.kind !== "crate") ||
      c.eventId
    )
      return;
    c.restockAt = chestRestockAtAfterOpen(c.restockAt, now);
  }

  /** Deposit a backpack slot into a container. `target` (optional) = a specific slot to drop onto. */
  containerPut(sid: string, containerId: string, slot: number, target = -1) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const c = this.reachableContainer(p, containerId);
    if (!c) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = this.content.item(item.id);

    // dropped onto a specific slot: stack if same item, else swap the two stacks
    if (target >= 0 && target < c.slots.length) {
      const dest = c.slots[target];
      if (dest && dest.id === item.id) {
        const add = Math.min(def.stack - dest.qty, item.qty);
        dest.qty += add;
        item.qty -= add;
        if (item.qty <= 0) {
          p.inv.slots[slot] = null;
          if (p.equipped === slot) p.equipped = null;
        }
      } else {
        c.slots[target] = {
          id: item.id,
          qty: item.qty,
          ...(item.dur !== undefined ? { dur: item.dur } : {}),
        };
        p.inv.slots[slot] = dest ?? null;
        if (p.equipped === slot && !p.inv.slots[slot]) p.equipped = null;
      }
      if (c.kind === "storage") this.persistHideout(inst);
      this.pushInventory(p);
      this.emitTo(sid, EV.container, {
        id: c.id,
        slots: c.slots,
        storage: c.kind === "storage",
      });
      return;
    }

    // no target: stack into matching slots, then first free
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
        c.slots[i] = {
          id: item.id,
          qty: add,
          ...(item.dur !== undefined ? { dur: item.dur } : {}),
        };
        qty -= add;
      }
    }
    if (qty === item.qty) {
      this.toast(sid, "No room in there");
      return;
    }
    if (qty > 0) p.inv.slots[slot] = { id: item.id, qty };
    else {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    if (c.kind === "storage") this.persistHideout(inst);
    this.pushInventory(p);
    this.emitTo(sid, EV.container, {
      id: c.id,
      slots: c.slots,
      storage: c.kind === "storage",
    });
  }

  /** Reorder / stack items within one container (drag a chest slot onto another). */
  containerMove(sid: string, containerId: string, from: number, to: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const c = this.reachableContainer(p, containerId);
    if (!c) return;
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= c.slots.length ||
      to >= c.slots.length
    )
      return;
    const a = c.slots[from];
    if (!a) return;
    const b = c.slots[to];
    if (b && b.id === a.id && this.content.item(a.id).stack > 1) {
      const moved = Math.min(this.content.item(a.id).stack - b.qty, a.qty);
      b.qty += moved;
      a.qty -= moved;
      if (a.qty <= 0) c.slots[from] = null;
    } else {
      c.slots[from] = b;
      c.slots[to] = a;
    }
    if (c.kind === "storage") this.persistHideout(inst);
    this.emitTo(sid, EV.container, {
      id: c.id,
      slots: c.slots,
      storage: c.kind === "storage",
    });
  }

  closeContainer(sid: string) {
    const p = this.players.get(sid);
    if (p) p.openContainer = null;
  }

  invMove(sid: string, from: number, to: number) {
    const p = this.players.get(sid);
    if (!p) return;
    const s = p.inv.slots;
    if (from === to || from < 0 || to < 0 || from >= s.length || to >= s.length)
      return;
    const a = s[from];
    const b = s[to];
    if (!a) return;
    if (b && b.id === a.id && this.content.item(a.id).stack > 1) {
      const room = this.content.item(a.id).stack - b.qty;
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
    const droppedDur = item.dur;
    const n = Math.max(1, Math.min(Math.floor(qty) || item.qty, item.qty));
    item.qty -= n;
    if (item.qty <= 0) {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    this.dropAt(
      inst,
      p.x + (this.rnd() - 0.5) * 24,
      p.y + 20 + this.rnd() * 10,
      droppedId,
      n,
      droppedDur,
    );
    this.pushInventory(p);
  }

  invUse(sid: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = this.content.item(item.id);
    if (def.kind === "placeable") {
      // placement is a client-driven flow; nothing to do here
      this.toast(sid, `Hold ${def.name} and click the ground to place it`);
      return;
    }
    if (def.kind === "consumable") {
      // fillable container (empty canteen) — fill at water
      if (def.fillFrom) {
        if (!this.nearTile(p, Tile.Water, 2)) {
          this.toast(sid, "Find water to fill that");
          return;
        }
        this.startAction(p, "fill", `Filling ${def.name}…`, DRINK_TIME_MS, {
          slot,
        });
      } else if (def.drink) {
        if (p.thirst >= 100) {
          this.toast(sid, "You are not thirsty");
          return;
        }
        p.thirst = Math.min(100, p.thirst + def.drink);
        item.qty -= 1;
        if (item.qty <= 0)
          p.inv.slots[slot] = def.emptyTo
            ? { id: def.emptyTo as ItemId, qty: 1 }
            : null;
        this.toast(sid, `Drank ${def.name} (+${def.drink} thirst)`);
        this.pushInventory(p);
      } else if (def.raw) {
        const firepit = this.nearestStationIndex(p, "firepit");
        if (firepit !== null) {
          const inst = this.inst(p);
          if ((inst.stationFuel.get(firepit) ?? 0) < STATION_FUEL_PER_ACTION) {
            this.toast(sid, "The firepit needs wood before it can cook");
            this.emitTo(
              sid,
              EV.station,
              this.stationPayload(inst, "firepit", firepit),
            );
            return;
          }
          this.startAction(p, "cook", `Cooking ${def.name}…`, COOK_TIME_MS, {
            slot,
            station: firepit,
          });
        } else if (def.food) {
          if (p.hunger >= 100) {
            this.toast(sid, "You are not hungry");
            return;
          }
          p.hunger = Math.min(100, p.hunger + def.food);
          item.qty -= 1;
          if (item.qty <= 0) p.inv.slots[slot] = null;
          this.toast(
            sid,
            `Ate ${def.name} (+${def.food} hunger) — cook it at a fueled firepit for more`,
          );
          this.pushInventory(p);
        }
      } else if (def.food) {
        if (p.hunger >= 100) {
          this.toast(sid, "You are not hungry");
          return;
        }
        p.hunger = Math.min(100, p.hunger + def.food);
        item.qty -= 1;
        if (item.qty <= 0) p.inv.slots[slot] = null;
        this.toast(
          sid,
          `Ate ${def.name} (+${def.food} hunger)${def.raw ? " — cook it at a firepit for more" : ""}`,
        );
        this.pushInventory(p);
      } else if (def.heal) {
        if (p.hp >= PLAYER_MAX_HP) {
          this.toast(sid, "Already at full health");
          return;
        }
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + def.heal);
        item.qty -= 1;
        if (item.qty <= 0) p.inv.slots[slot] = null;
        this.toast(sid, `Used ${def.name} (+${def.heal} HP)`);
        this.pushInventory(p);
      }
    } else if (def.kind === "backpack" && def.backpackTier !== undefined) {
      if (def.backpackTier <= p.inv.backpack) {
        this.toast(sid, "You already have an equal or better backpack");
        return;
      }
      p.inv.slots[slot] = null;
      p.inv.backpack = def.backpackTier;
      const cap = BACKPACKS[def.backpackTier].slots;
      while (p.inv.slots.length < cap) p.inv.slots.push(null);
      this.toast(sid, `Equipped ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === "armor" && def.armor) {
      const piece = def.armor.piece;
      const old = p.equipment[piece];
      const oldMax = old ? this.content.item(old).durability : undefined;
      const oldDur =
        old && oldMax !== undefined
          ? Math.max(1, Math.min(oldMax, p.armorDur[piece] ?? oldMax))
          : undefined;
      const incomingDur =
        def.durability !== undefined
          ? Math.max(1, Math.min(def.durability, item.dur ?? def.durability))
          : undefined;
      p.equipment[piece] = item.id;
      p.inv.slots[slot] = old
        ? { id: old, qty: 1, ...(oldDur !== undefined ? { dur: oldDur } : {}) }
        : null;
      if (incomingDur !== undefined) p.armorDur[piece] = incomingDur;
      else delete p.armorDur[piece];
      if (p.equipped === slot) p.equipped = null;
      this.toast(sid, `Equipped ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === "mod") {
      const old = p.equipment.mod;
      p.equipment.mod = item.id;
      p.inv.slots[slot] = old ? { id: old, qty: 1 } : null;
      if (p.equipped === slot) p.equipped = null;
      this.toast(sid, `Fitted ${def.name}`);
      this.pushInventory(p);
    } else if (def.kind === "weapon" || def.kind === "tool") {
      this.invEquip(sid, slot);
    }
  }

  unequipArmor(sid: string, piece: "helmet" | "vest" | "mod") {
    const p = this.players.get(sid);
    if (!p || (piece !== "helmet" && piece !== "vest" && piece !== "mod"))
      return;
    const id = p.equipment[piece];
    if (!id) return;
    const maxDur = this.content.item(id).durability;
    const dur =
      piece !== "mod" && maxDur !== undefined
        ? Math.max(1, Math.min(maxDur, p.armorDur[piece] ?? maxDur))
        : undefined;
    if (this.addItem(p.inv, id, 1, dur) > 0) {
      this.toast(sid, "No space in backpack");
      return;
    }
    p.equipment[piece] = null;
    if (piece !== "mod") delete p.armorDur[piece];
    this.pushInventory(p);
  }

  invEquip(sid: string, slot: number) {
    const p = this.players.get(sid);
    if (!p) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const kind = this.content.item(item.id).kind;
    // weapons, tools, consumables and build kits can be held in hand (click to use/attack/place)
    if (
      kind !== "weapon" &&
      kind !== "tool" &&
      kind !== "consumable" &&
      kind !== "placeable"
    )
      return;
    p.equipped = p.equipped === slot ? null : slot;
    this.pushInventory(p);
  }

  /** Crafting is a short timed action — the client queues repeat crafts. */
  craft(sid: string, recipeId: string) {
    const p = this.players.get(sid);
    if (!p || p.dead || p.action) return;
    const recipe = this.content.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    if (!this.craftChecks(p, recipe)) return;
    this.startAction(
      p,
      "craft",
      `Crafting ${this.content.item(recipe.out.id).name}…`,
      CRAFT_TIME_MS,
      { id: recipeId },
    );
  }

  /** Station / material / weight validation, with feedback toasts. */
  private craftChecks(p: ServerPlayer, recipe: RuntimeRecipe): boolean {
    if (recipe.station) {
      const station = this.nearestStationIndex(p, recipe.station);
      if (station === null) {
        this.toast(p.sid, `You need to be at a ${recipe.station}`);
        return false;
      }
      if (
        recipe.station === "furnace" &&
        (this.inst(p).stationFuel.get(station) ?? 0) < STATION_FUEL_PER_ACTION
      ) {
        this.toast(p.sid, "The furnace needs wood before it can smelt");
        this.emitTo(
          p.sid,
          EV.station,
          this.stationPayload(this.inst(p), "furnace", station),
        );
        return false;
      }
    }
    if (!canPayRecipe(p.inv, recipe.cost)) {
      const missing = recipe.cost.find(
        (cost) => this.countItem(p.inv, cost.id) < cost.qty,
      );
      if (missing)
        this.toast(p.sid, `Missing ${this.content.item(missing.id).name}`);
      return false;
    }
    return true;
  }

  private doCraft(p: ServerPlayer, inst: Instance, recipe: RuntimeRecipe) {
    if (recipe.station === "furnace") {
      const furnace = this.nearestStationIndex(p, "furnace");
      if (furnace === null || !this.consumeStationFuel(inst, furnace)) return;
      this.emitTo(
        p.sid,
        EV.station,
        this.stationPayload(inst, "furnace", furnace),
      );
    }
    for (const cost of recipe.cost) {
      this.removeItem(p.inv, cost.id, cost.qty);
      this.telemetry.record({
        kind: "item_destroyed",
        userId: p.userId,
        itemId: cost.id,
        quantity: cost.qty,
        value: this.content.estimatedItemValue(cost.id) * cost.qty,
        source: "craft",
      });
    }
    const leftover = this.addItem(p.inv, recipe.out.id, recipe.out.qty);
    if (leftover > 0) {
      this.dropAt(inst, p.x, p.y + 20, recipe.out.id, leftover);
      this.toast(
        p.sid,
        `Crafted ${this.content.item(recipe.out.id).name} (no slot — dropped at feet)`,
      );
    } else {
      this.toast(
        p.sid,
        `Crafted ${this.content.item(recipe.out.id).name}${recipe.out.qty > 1 ? ` x${recipe.out.qty}` : ""}`,
      );
    }
    this.addXp(p, "crafting", 8);
    this.telemetry.record({
      kind: "item_spawned",
      userId: p.userId,
      itemId: recipe.out.id,
      quantity: recipe.out.qty,
      value: this.content.estimatedItemValue(recipe.out.id) * recipe.out.qty,
      source: "craft",
    });
    void this.saveProfileOf(p);
    this.pushInventory(p);
  }

  /** Place a placeable KIT item from an inventory slot at a tile. */
  build(sid: string, slot: number, tx: number, ty: number, rotation = 0) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const held = p.inv.slots[slot];
    const heldDef = held ? this.content.item(held.id) : null;
    if (!held || !heldDef?.place) {
      this.toast(sid, "That is not a placeable item");
      return;
    }
    const type: BuildType = heldDef.place;
    const inst = this.inst(p);
    const inHideout = inst.kind !== "world";
    const mayBuildHere =
      inst.kind === "hideout"
        ? inst.ownerId === p.userId
        : Boolean(
            inst.clanId &&
            inst.clanId === p.clanId &&
            canBuildClanHideout(p.clanRank),
          );
    if (inHideout && (!mayBuildHere || !inst.hideout)) {
      this.toast(sid, "This is not your camp");
      return;
    }
    const buildable = BUILDABLES[type];
    if (!buildable) return;
    const engineBlock = this.content.playerBlock(type);
    const hideoutOnly =
      engineBlock?.playerPlacement?.hideoutOnly ??
      Boolean(buildable.hideoutOnly);
    if (!inHideout && hideoutOnly) {
      this.toast(sid, `${buildable.name} can only be placed in your camp`);
      return;
    }
    tx = tx | 0;
    ty = ty | 0;
    if (tx < 1 || ty < 1 || tx >= inst.w - 1 || ty >= inst.h - 1) return;
    if (
      Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) >
      TILE * 4
    ) {
      this.toast(sid, "Too far away to place that");
      return;
    }
    if (
      !inHideout &&
      this.isSafeAt(inst, (tx + 0.5) * TILE, (ty + 0.5) * TILE)
    ) {
      this.toast(sid, "No building inside the safe zone");
      return;
    }
    const i = ty * inst.w + tx;
    rotation = (((rotation | 0) % 4) + 4) % 4;
    const targetTile = inst.tiles[i];
    const isFloorPiece = type === "wood_floor" || type === "stone_floor";
    const existingBlockId = inst.blockKinds[String(i)];
    const existingBlock = this.content.block(existingBlockId);
    const canReplaceFoundation =
      !isFloorPiece && existingBlock?.playerPlacement?.foundation;
    if (existingBlockId && !canReplaceFoundation) {
      this.toast(sid, "Something is already built there");
      return;
    }
    // floors go on grass; everything else can also sit ON a floor (Minecraft-style layering)
    const ok = isFloorPiece
      ? targetTile === Tile.Grass
      : targetTile === Tile.Grass || FLOOR_TILES[targetTile];
    if (!ok) {
      this.toast(
        sid,
        isFloorPiece
          ? "Flooring needs clear grass"
          : "Needs clear grass or flooring",
      );
      return;
    }
    for (const c of inst.containers.values())
      if (Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty) {
        this.toast(sid, "Something is already there");
        return;
      }
    if (
      inst.exit &&
      Math.hypot(
        inst.exit.x - (tx + 0.5) * TILE,
        inst.exit.y - (ty + 0.5) * TILE,
      ) <
        TILE * 1.5
    ) {
      this.toast(sid, "Keep the exit clear");
      return;
    }
    // don't wall yourself in on the tile you're standing on
    if (
      buildable.tile &&
      BLOCKS_MOVE[buildable.tile] &&
      Math.floor(p.x / TILE) === tx &&
      Math.floor(p.y / TILE) === ty
    ) {
      this.toast(sid, "You are standing there");
      return;
    }

    // consume one kit item
    this.removeItem(p.inv, held.id, 1);

    if (buildable.tile) {
      // building on a floor keeps the floor UNDER the piece — it shows through
      // visually and comes back when the piece is demolished or destroyed
      const under = FLOOR_TILES[targetTile] ? targetTile : undefined;
      if (under !== undefined) inst.unders.set(i, under);
      inst.tiles[i] = buildable.tile;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: buildable.tile, under });
      if (engineBlock) {
        inst.blockKinds[String(i)] = engineBlock.id;
        if (rotation) inst.blockRotations[String(i)] = rotation;
        else delete inst.blockRotations[String(i)];
        this.io
          ?.to(inst.id)
          .emit(EV.block, {
            i,
            blockId: engineBlock.id,
            rotation,
            open: false,
          });
      }
      if (inHideout && inst.hideout) {
        inst.hideout.objects.push({
          type,
          tx,
          ty,
          ...(rotation ? { rotation } : {}),
        });
        if (type === "bed") this.syncHideoutSpawn(inst); // your spawn follows your bed
        this.persistHideout(inst);
      } else {
        inst.structures.set(i, {
          type,
          hp: engineBlock?.maxHp ?? buildable.hp,
          expiresAt: Date.now() + WORLD_STRUCTURE_TTL_MS,
          under,
        });
      }
    } else if (inHideout && inst.hideout) {
      inst.hideout.objects.push({
        type,
        tx,
        ty,
        ...(rotation ? { rotation } : {}),
        slots: new Array<InvSlot>(HIDEOUT_STORAGE_SLOTS).fill(null),
      });
      if (engineBlock) {
        inst.blockKinds[String(i)] = engineBlock.id;
        if (rotation) inst.blockRotations[String(i)] = rotation;
        else delete inst.blockRotations[String(i)];
        this.io
          ?.to(inst.id)
          .emit(EV.block, {
            i,
            blockId: engineBlock.id,
            rotation,
            open: false,
          });
      }
      this.syncHideoutContainers(inst);
      this.persistHideout(inst);
    }
    if (p.equipped === slot && !p.inv.slots[slot]) p.equipped = null;
    this.addXp(p, "crafting", 6);
    this.toast(
      sid,
      `Placed ${buildable.name}${inHideout ? "" : " (wears out out here)"}`,
    );
    this.pushInventory(p);
  }

  /** Mend a worn weapon/tool/armor at the right station, paying scrap (+ bars for steel). */
  repair(sid: string, slot: number) {
    const p = this.players.get(sid);
    if (!p || p.dead || slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = this.content.item(item.id);
    const info = repairInfo(def);
    if (!info || def.durability === undefined) {
      this.toast(sid, "That cannot be repaired");
      return;
    }
    if (!this.nearStation(p, info.station)) {
      this.toast(sid, `Repair it at a ${info.station}`);
      return;
    }
    const cur = item.dur ?? def.durability;
    const missing = def.durability - cur;
    if (missing <= 0) {
      this.toast(sid, "That is already in good shape");
      return;
    }
    const frac = missing / def.durability;
    const scrapCost = Math.max(1, Math.ceil(info.scrap * frac));
    const barCost = info.bar ? Math.max(1, Math.round(2 * frac)) : 0;
    if (
      this.countItem(p.inv, "scrap") < scrapCost ||
      (info.bar && this.countItem(p.inv, info.bar) < barCost)
    ) {
      this.toast(
        sid,
        `Need ${scrapCost} scrap${info.bar ? ` + ${barCost} ${this.content.item(info.bar).name}` : ""} to repair`,
      );
      return;
    }
    this.removeItem(p.inv, "scrap", scrapCost);
    if (info.bar) this.removeItem(p.inv, info.bar, barCost);
    item.dur = def.durability;
    this.toast(sid, `Repaired ${def.name}`);
    this.pushInventory(p);
  }

  /** Change your character's look (sprite row); persisted with your profile. */
  setLook(sid: string, look: number) {
    const p = this.players.get(sid);
    if (!p) return;
    p.appearance = { ...p.appearance, outfit: (((look | 0) % 8) + 8) % 8 };
    this.pushInventory(p);
    void this.db.saveAppearance(p.userId, p.appearance);
  }

  /** Reclaim a piece you built in your own camp — returns the kit item. */
  demolish(sid: string, tx: number, ty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    const mayDemolish =
      inst.kind === "hideout"
        ? inst.ownerId === p.userId
        : inst.kind === "clan_hideout" &&
          inst.clanId === p.clanId &&
          canDemolishClanHideout(p.clanRank);
    if (!mayDemolish || !inst.hideout) {
      this.toast(
        sid,
        inst.kind === "clan_hideout"
          ? "Only clan officers and the owner can demolish here"
          : "You can only demolish in your own camp",
      );
      return;
    }
    tx = tx | 0;
    ty = ty | 0;
    if (
      Math.hypot((tx + 0.5) * TILE - p.x, (ty + 0.5) * TILE - p.y) >
      TILE * 4
    ) {
      this.toast(sid, "Too far away");
      return;
    }
    // take the TOP piece at this tile (a station may be standing on a floor)
    let oi = -1;
    for (let k = inst.hideout.objects.length - 1; k >= 0; k--) {
      if (
        inst.hideout.objects[k].tx === tx &&
        inst.hideout.objects[k].ty === ty
      ) {
        oi = k;
        break;
      }
    }
    if (oi < 0) {
      this.toast(sid, "Nothing you built there");
      return;
    }
    const obj = inst.hideout.objects[oi];
    if (obj.type === "chest" && obj.slots?.some((s) => !!s)) {
      this.toast(sid, "Empty the chest first");
      return;
    }
    const kit = Object.values(this.content.items).find(
      (d) => d.place === obj.type,
    );
    if (kit && this.addItem(p.inv, kit.id, 1) > 0) {
      this.toast(sid, "No space to carry the kit");
      return;
    }
    inst.hideout.objects.splice(oi, 1);
    const buildable = BUILDABLES[obj.type];
    if (buildable.tile) {
      const i = ty * inst.w + tx;
      inst.stationFuel.delete(i);
      const restore = restoredStructureTile(inst.unders.get(i), Tile.Grass); // the floor beneath survives
      inst.unders.delete(i);
      inst.tiles[i] = restore;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: restore });
      this.restorePlayerBlockVisual(inst, i, restore);
    } else
      this.restorePlayerBlockVisual(
        inst,
        ty * inst.w + tx,
        this.tileUnder(inst, (tx + 0.5) * TILE, (ty + 0.5) * TILE),
      );
    this.syncHideoutContainers(inst);
    if (obj.type === "bed") this.syncHideoutSpawn(inst);
    this.persistHideout(inst);
    this.toast(
      sid,
      `Demolished ${buildable.name}${kit ? ` — ${this.content.item(kit.id).name} returned` : ""}`,
    );
    this.pushInventory(p);
  }

  /** Damage a world-placed structure (melee or bullets). Returns true if it was one. */
  private damageStructure(inst: Instance, i: number, dmg: number): boolean {
    const s = inst.structures.get(i);
    if (!s) return false;
    s.hp -= dmg;
    this.hitFx(
      inst,
      (i % inst.w) * TILE + 16,
      Math.floor(i / inst.w) * TILE + 16,
      dmg,
      "node",
      "stone",
    );
    if (s.hp <= 0) {
      inst.structures.delete(i);
      inst.stationFuel.delete(i);
      const restore = s.under ?? Tile.Grass;
      inst.unders.delete(i);
      inst.tiles[i] = restore;
      this.io?.to(inst.id).emit(EV.tile, { i, tile: restore });
      this.restorePlayerBlockVisual(inst, i, restore);
    }
    return true;
  }

  private damageWorldBlock(inst: Instance, i: number, dmg: number): boolean {
    const blockId = inst.blockKinds[String(i)];
    const block = this.content.block(blockId);
    if (!block) return false;
    const x = (i % inst.w) * TILE + TILE / 2;
    const y = Math.floor(i / inst.w) * TILE + TILE / 2;
    // Main-world map geometry is protected. Player-built structures are
    // registered in inst.structures and are handled by damageStructure first.
    if (inst.kind === "world" && !inst.structures.has(i)) {
      inst.blockHp.delete(i);
      this.hitFx(inst, x, y, 0, "node", "stone", block.hitSound);
      return true;
    }
    if (!block.destructible) {
      this.hitFx(inst, x, y, 0, "node", "stone", block.hitSound);
      return true;
    }
    const hp = (inst.blockHp.get(i) ?? block.maxHp) - dmg;
    this.hitFx(
      inst,
      x,
      y,
      dmg,
      "node",
      "stone",
      hp <= 0 ? block.breakSound : block.hitSound,
    );
    if (hp > 0) {
      inst.blockHp.set(i, hp);
      return true;
    }
    inst.blockHp.delete(i);
    inst.stationFuel.delete(i);
    delete inst.blockKinds[String(i)];
    delete inst.blockRotations[String(i)];
    inst.openDoors.delete(i);
    for (const drop of block.drops) {
      if (this.rnd() > drop.chance || !this.content.hasItem(drop.itemId))
        continue;
      const quantity =
        drop.min + Math.floor(this.rnd() * (drop.max - drop.min + 1));
      this.dropAt(
        inst,
        x + (this.rnd() - 0.5) * 12,
        y + (this.rnd() - 0.5) * 12,
        drop.itemId as ItemId,
        quantity,
      );
    }
    this.io?.to(inst.id).emit(EV.block, { i });
    return true;
  }

  private restorePlayerBlockVisual(inst: Instance, i: number, restore: Tile) {
    const buildType: BuildType | null =
      restore === Tile.WoodFloor
        ? "wood_floor"
        : restore === Tile.StoneFloor
          ? "stone_floor"
          : null;
    const blockId = buildType
      ? this.content.playerBlock(buildType)?.id
      : undefined;
    if (blockId) inst.blockKinds[String(i)] = blockId;
    else delete inst.blockKinds[String(i)];
    delete inst.blockRotations[String(i)];
    inst.openDoors.delete(i);
    this.io
      ?.to(inst.id)
      .emit(EV.block, { i, ...(blockId ? { blockId } : {}), open: false });
  }

  /** Instance-wide local chat plus a relay-wide private clan radio channel. */
  chat(sid: string, text: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (p.guest) {
      this.toast(
        sid,
        "Guest chat is disabled — register to join the community",
      );
      return;
    }
    if (p.mutedUntil > Date.now()) {
      const minutes = Math.max(
        1,
        Math.ceil((p.mutedUntil - Date.now()) / 60_000),
      );
      this.toast(
        sid,
        `Chat muted for ${minutes} more minute${minutes === 1 ? "" : "s"}`,
      );
      return;
    }
    const inst = this.inst(p);
    const clean = String(text ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 120);
    if (!clean) return;
    const clanMatch = /^\/(?:c|clan)\s+(.+)$/i.exec(clean);
    if (clanMatch) {
      const message = clanMatch[1].trim().slice(0, 110);
      if (!p.clanId || !p.clanTag) {
        this.toast(sid, "Join a clan before using /c clan radio");
        return;
      }
      if (!message) return;
      for (const member of this.players.values()) {
        if (this.isBot(member) || member.clanId !== p.clanId) continue;
        this.emitTo(member.sid, EV.chatMsg, {
          id: p.sid,
          name: `[${p.clanTag}] ${p.name}`,
          text: message,
          channel: "clan",
          admin: p.admin,
        });
      }
      return;
    }
    this.io
      ?.to(inst.id)
      .emit(EV.chatMsg, {
        id: p.sid,
        name: p.name,
        text: clean,
        channel: "local",
        admin: p.admin,
      });
  }

  // ── quests ────────────────────────────────────────────────────────────────

  private async liveAdmin(sid: string): Promise<ServerPlayer | null> {
    const player = this.players.get(sid);
    if (!player || this.isBot(player)) return null;
    const access = await this.db.loadPlayerAccess(player.userId);
    player.admin = access.admin;
    player.mutedUntil = access.mutedUntil;
    if (player.admin) return player;
    player.adminMode = false;
    this.toast(sid, "Administrator access is no longer active");
    return null;
  }

  private adminTarget(targetId: unknown): ServerPlayer | null {
    if (
      typeof targetId !== "string" ||
      targetId.length === 0 ||
      targetId.length > 160
    )
      return null;
    const target = this.players.get(targetId);
    return target && !this.isBot(target) ? target : null;
  }

  private adminAudit(
    actor: ServerPlayer,
    action: string,
    target?: ServerPlayer,
    metadata?: Record<string, unknown>,
  ) {
    this.telemetry.record({
      kind: "admin_action",
      userId: actor.userId,
      source: action,
      metadata: {
        actor: actor.name,
        targetUserId: target?.userId,
        target: target?.name,
        instanceId: actor.instanceId,
        ...metadata,
      },
    });
    this.log.log(
      `ADMIN ${actor.name}: ${action}${target ? ` -> ${target.name}` : ""}`,
    );
  }

  private clearPlayerActivity(player: ServerPlayer) {
    player.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      angle: player.angle,
      shoot: false,
    };
    player.moving = false;
    player.action = null;
    player.reloadTarget = null;
    player.reloadUntil = 0;
    player.openContainer = null;
    this.emitTo(player.sid, EV.action, {
      label: "",
      ms: 0,
    } satisfies ActionSnap);
  }

  private adminTeleportPoint(
    inst: Instance,
    rawTileX: unknown,
    rawTileY: unknown,
  ): { x: number; y: number } | null {
    const tileX = adminTileCoordinate(rawTileX, inst.w);
    const tileY = adminTileCoordinate(rawTileY, inst.h);
    if (tileX === null || tileY === null) return null;
    for (let radius = 0; radius <= 8; radius++)
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius)
            continue;
          const tx = tileX + dx;
          const ty = tileY + dy;
          if (tx < 1 || ty < 1 || tx >= inst.w - 1 || ty >= inst.h - 1)
            continue;
          const x = (tx + 0.5) * TILE;
          const y = (ty + 0.5) * TILE;
          if (!this.isBlocked(inst, x, y, PLAYER_RADIUS)) return { x, y };
        }
    return null;
  }

  private relocateByAdmin(
    player: ServerPlayer,
    inst: Instance,
    x: number,
    y: number,
  ) {
    this.clearPlayerActivity(player);
    if (player.instanceId === inst.id) {
      player.x = x;
      player.y = y;
      player.ignoreInteractUntil = Date.now() + 900;
      this.pushInventory(player);
    } else {
      this.switchInstance(player, inst, x, y);
    }
  }

  async adminState(sid: string) {
    const actor = await this.liveAdmin(sid);
    if (!actor) return;
    const sanctions = await this.db.listActiveModeration().catch(() => []);
    const state: AdminPanelState = {
      server: this.db.serverStateKey,
      protected: actor.adminMode,
      players: [...this.players.values()]
        .flatMap((player) => {
          if (this.isBot(player)) return [];
          const inst = this.inst(player);
          return [
            {
              id: player.sid,
              name: player.name,
              instanceId: inst.id,
              instanceName: inst.name,
              instanceKind: inst.kind,
              tileX: Math.floor(player.x / TILE),
              tileY: Math.floor(player.y / TILE),
              hp: player.hp,
              maxHp: PLAYER_MAX_HP,
              dead: player.dead,
              connected: Boolean(this.io?.sockets.sockets.has(player.sid)),
              admin: player.admin,
              guest: player.guest,
              protected: player.adminMode,
              mutedUntil: player.mutedUntil,
            },
          ];
        })
        .sort(
          (a, b) =>
            Number(b.connected) - Number(a.connected) ||
            a.name.localeCompare(b.name),
        ),
      sanctions,
    };
    this.emitTo(sid, EV.adminState, state);
  }

  async adminAction(sid: string, action: AdminActionPayload) {
    const actor = await this.liveAdmin(sid);
    if (
      !actor ||
      !action ||
      typeof action !== "object" ||
      typeof action.type !== "string"
    )
      return;

    if (action.type === "protection") {
      actor.adminMode = action.enabled === true;
      if (actor.adminMode) {
        actor.hp = PLAYER_MAX_HP;
        actor.hunger = 100;
        actor.thirst = 100;
        actor.stamina = STAMINA_MAX;
        actor.staminaExhausted = false;
        this.pushInventory(actor);
      }
      this.adminAudit(
        actor,
        actor.adminMode ? "protection_enabled" : "protection_disabled",
      );
      this.toast(
        sid,
        `Admin protection ${actor.adminMode ? "enabled" : "disabled"}`,
      );
      await this.adminState(sid);
      return;
    }

    if (action.type === "announce") {
      const message = adminText(action.message, 160);
      if (!message) return this.toast(sid, "Enter an announcement first");
      this.io?.emit(EV.toast, `ADMIN BROADCAST — ${message}`);
      this.adminAudit(actor, "announcement", undefined, { message });
      await this.adminState(sid);
      return;
    }

    if (action.type === "teleport") {
      const inst = this.inst(actor);
      const point = this.adminTeleportPoint(inst, action.tileX, action.tileY);
      if (!point)
        return this.toast(sid, "No walkable tile near those coordinates");
      this.relocateByAdmin(actor, inst, point.x, point.y);
      this.adminAudit(actor, "teleport_coordinates", undefined, {
        tileX: Math.floor(point.x / TILE),
        tileY: Math.floor(point.y / TILE),
      });
      this.toast(
        sid,
        `Teleported to ${Math.floor(point.x / TILE)}, ${Math.floor(point.y / TILE)}`,
      );
      await this.adminState(sid);
      return;
    }

    if (action.type === "clear_mute" || action.type === "clear_ban") {
      const targetUserId =
        typeof action.targetUserId === "string"
          ? action.targetUserId.slice(0, 120)
          : "";
      if (!targetUserId) return;
      const kind = action.type === "clear_mute" ? "mute" : "ban";
      const cleared = await this.db.clearPlayerSanction(
        actor.userId,
        targetUserId,
        kind,
      );
      if (!cleared) return this.toast(sid, `Could not clear ${kind}`);
      const online = [...this.players.values()].find(
        (player) => !this.isBot(player) && player.userId === targetUserId,
      );
      if (online && kind === "mute") online.mutedUntil = 0;
      this.adminAudit(actor, `${kind}_cleared`, online);
      this.toast(sid, `${kind === "mute" ? "Mute" : "Ban"} cleared`);
      await this.adminState(sid);
      return;
    }

    const target = this.adminTarget(
      "targetId" in action ? action.targetId : null,
    );
    if (!target) return this.toast(sid, "That player is no longer available");

    if (action.type === "goto") {
      const targetInst = this.inst(target);
      const point = this.adminTeleportPoint(
        targetInst,
        Math.floor(target.x / TILE) + 1,
        Math.floor(target.y / TILE),
      ) ?? { x: target.x, y: target.y };
      this.relocateByAdmin(actor, targetInst, point.x, point.y);
      this.adminAudit(actor, "goto", target);
      this.toast(sid, `Teleported to ${target.name}`);
    } else if (action.type === "bring") {
      const actorInst = this.inst(actor);
      const point = this.adminTeleportPoint(
        actorInst,
        Math.floor(actor.x / TILE) + 1,
        Math.floor(actor.y / TILE),
      ) ?? { x: actor.x, y: actor.y };
      this.relocateByAdmin(target, actorInst, point.x, point.y);
      this.adminAudit(actor, "bring", target);
      this.toast(target.sid, `An administrator moved you to ${actorInst.name}`);
      this.toast(sid, `Brought ${target.name}`);
    } else if (action.type === "send_home") {
      target.returnPos = null;
      if (target.guest) {
        const world = this.instances.get(WORLD)!;
        const origin = this.choose(world.spawns);
        const spawn = this.findClearPointNear(world, origin.x, origin.y, 10);
        this.relocateByAdmin(target, world, spawn.x, spawn.y);
      } else {
        const home = await this.hideoutInstance(target.userId);
        this.relocateByAdmin(target, home, home.spawns[0].x, home.spawns[0].y);
      }
      this.adminAudit(actor, "send_home", target);
      this.toast(
        target.sid,
        target.guest
          ? "An administrator redeployed your guest raid"
          : "An administrator returned you home",
      );
      this.toast(
        sid,
        target.guest
          ? `Redeployed ${target.name}`
          : `Returned ${target.name} home`,
      );
    } else if (action.type === "heal") {
      if (target.dead)
        return this.toast(
          sid,
          "Dead survivors must respawn; healing cannot duplicate dropped gear",
        );
      target.hp = PLAYER_MAX_HP;
      target.hunger = 100;
      target.thirst = 100;
      target.stamina = STAMINA_MAX;
      target.staminaExhausted = false;
      target.starveAcc = 0;
      this.pushInventory(target);
      void this.saveProfileOf(target);
      this.adminAudit(actor, "heal", target);
      this.toast(target.sid, "An administrator restored your condition");
      this.toast(sid, `Restored ${target.name}`);
    } else if (action.type === "give_item") {
      if (target.dead)
        return this.toast(
          sid,
          "Wait for the survivor to respawn before issuing items",
        );
      const itemId = adminText(action.itemId, 60);
      if (!itemId || !this.content.hasItem(itemId))
        return this.toast(sid, "Unknown item in the active content revision");
      const quantity = adminItemQuantity(action.quantity);
      const leftover = this.addItem(target.inv, itemId, quantity);
      const issued = quantity - leftover;
      if (leftover > 0)
        this.dropAt(this.inst(target), target.x, target.y, itemId, leftover);
      this.pushInventory(target);
      void this.saveProfileOf(target);
      this.telemetry.record({
        kind: "item_spawned",
        userId: target.userId,
        itemId,
        quantity,
        value: this.content.estimatedItemValue(itemId) * quantity,
        source: "admin_console",
        metadata: { actorUserId: actor.userId, actor: actor.name },
      });
      this.adminAudit(actor, "give_item", target, {
        itemId,
        quantity,
        issued,
        dropped: leftover,
      });
      this.toast(
        target.sid,
        `Administrator issued ${quantity}× ${this.content.item(itemId).name}`,
      );
      this.toast(
        sid,
        `Issued ${quantity}× ${this.content.item(itemId).name} to ${target.name}${leftover ? ` (${leftover} dropped nearby)` : ""}`,
      );
    } else if (action.type === "kick") {
      if (target.admin || target.sid === actor.sid)
        return this.toast(
          sid,
          "Administrators cannot be kicked from the live console",
        );
      const reason = adminText(
        action.reason,
        160,
        "Removed by an administrator",
      );
      this.adminAudit(actor, "kick", target, { reason });
      this.toast(target.sid, `Kicked by administrator — ${reason}`);
      this.toast(sid, `Kicked ${target.name}`);
      setTimeout(
        () => this.io?.sockets.sockets.get(target.sid)?.disconnect(true),
        150,
      );
    } else if (action.type === "mute" || action.type === "ban") {
      if (target.admin || target.sid === actor.sid)
        return this.toast(
          sid,
          "Administrators cannot be sanctioned from the live console",
        );
      const kind = action.type;
      const minutes = adminSanctionMinutes(action.minutes);
      const reason = adminText(action.reason, 160, "No reason supplied");
      const until = new Date(Date.now() + minutes * 60_000);
      if (target.guest) {
        this.adminAudit(actor, `${kind}_guest`, target, {
          minutes,
          reason,
          until: until.toISOString(),
        });
        if (kind === "mute") {
          target.mutedUntil = until.getTime();
          this.toast(
            target.sid,
            `Guest session muted for ${minutes} minutes — ${reason}`,
          );
          this.toast(sid, `Muted ${target.name} for this guest session`);
        } else {
          this.guestBans.set(target.userId, until.getTime());
          this.toast(
            target.sid,
            `Guest access suspended on this relay for ${minutes} minutes — ${reason}`,
          );
          this.toast(
            sid,
            `Suspended ${target.name}'s guest identity for ${minutes} minutes`,
          );
          setTimeout(
            () => this.io?.sockets.sockets.get(target.sid)?.disconnect(true),
            150,
          );
        }
        await this.adminState(sid);
        return;
      }
      const applied = await this.db.setPlayerSanction(
        actor.userId,
        target.userId,
        kind,
        until,
        reason,
      );
      if (!applied)
        return this.toast(
          sid,
          `Could not ${kind} ${target.name}; their role may have changed`,
        );
      this.adminAudit(actor, kind, target, {
        minutes,
        reason,
        until: until.toISOString(),
      });
      if (kind === "mute") {
        target.mutedUntil = until.getTime();
        this.toast(target.sid, `Chat muted for ${minutes} minutes — ${reason}`);
        this.toast(sid, `Muted ${target.name} for ${minutes} minutes`);
      } else {
        this.toast(
          target.sid,
          `Access suspended for ${minutes} minutes — ${reason}`,
        );
        this.toast(sid, `Banned ${target.name} for ${minutes} minutes`);
        setTimeout(
          () => this.io?.sockets.sockets.get(target.sid)?.disconnect(true),
          150,
        );
      }
    }
    await this.adminState(sid);
  }

  /** Quest tree: a quest is unlocked once its prerequisite is claimed. */
  private questUnlocked(p: ServerPlayer, def: QuestDef): boolean {
    return questRuleUnlocked(
      Object.fromEntries(
        Object.entries(p.quests).map(([id, progress]) => [
          id,
          Boolean(progress.claimed),
        ]),
      ),
      def,
    );
  }

  /** All unlocked jobs, including completed entries, for traders and the HUD tracker. */
  private trackedQuests(p: ServerPlayer): QuestStatus[] {
    return this.quests
      .filter((def) => this.questUnlocked(p, def))
      .map((def) => {
        const prog = p.quests[def.id] ?? { kills: 0, claimed: false };
        const progress =
          def.kind === "kill"
            ? Math.min(prog.kills, def.count)
            : Math.min(this.countItem(p.inv, def.target as ItemId), def.count);
        return {
          def,
          progress,
          done: progress >= def.count,
          claimed: !!prog.claimed,
        };
      });
  }

  /** Quests this trader offers: unlocked (or already claimed) quests of its tier. */
  private questStatus(p: ServerPlayer, tier: TraderTier): QuestStatus[] {
    return this.trackedQuests(p).filter((status) => status.def.tier === tier);
  }

  private sendTrade(p: ServerPlayer) {
    const tier = this.traderAt(p)?.tier ?? 1;
    this.emitTo(p.sid, EV.trade, {
      stock: this.content.traderStock(tier),
      money: p.money,
      quests: this.questStatus(p, tier),
      tier,
    });
  }

  questClaim(sid: string, questId: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const trader = this.traderAt(p);
    if (!trader) return;
    const def = this.quests.find((q) => q.id === questId);
    if (!def || def.tier !== (trader.tier ?? 1) || !this.questUnlocked(p, def))
      return;
    const prog = p.quests[def.id] ?? { kills: 0, claimed: false };
    const progress =
      def.kind === "fetch" ? this.countItem(p.inv, def.target) : prog.kills;
    if (!questCanClaim(def, progress, prog.claimed)) {
      if (!prog.claimed)
        this.toast(
          sid,
          def.kind === "fetch"
            ? "You do not have the goods yet"
            : "The job is not done yet",
        );
      return;
    }
    if (def.kind === "fetch") {
      this.removeItem(p.inv, def.target as ItemId, def.count);
      this.telemetry.record({
        kind: "item_destroyed",
        userId: p.userId,
        itemId: def.target,
        quantity: def.count,
        value: this.content.estimatedItemValue(def.target) * def.count,
        source: "quest_claim",
      });
    }
    prog.claimed = true;
    p.quests[def.id] = prog;
    p.money += def.rewardMoney;
    if (def.rewardMoney > 0)
      this.telemetry.record({
        kind: "currency_spawned",
        userId: p.userId,
        credits: def.rewardMoney,
        source: "quest_reward",
      });
    if (def.rewardItem) {
      const leftover = this.addItem(p.inv, def.rewardItem, def.rewardQty);
      if (leftover > 0)
        this.dropAt(this.inst(p), p.x, p.y + 20, def.rewardItem, leftover);
      this.telemetry.record({
        kind: "item_spawned",
        userId: p.userId,
        itemId: def.rewardItem,
        quantity: def.rewardQty,
        value: this.content.estimatedItemValue(def.rewardItem) * def.rewardQty,
        source: "quest_reward",
      });
    }
    this.toast(
      sid,
      `Job complete: ${def.name} (+${def.rewardMoney}cr${def.rewardItem ? ` +${this.content.item(def.rewardItem).name}` : ""})`,
    );
    void this.saveProfileOf(p);
    this.pushInventory(p);
    this.sendTrade(p);
  }

  async respawn(sid: string) {
    const p = this.players.get(sid);
    if (!p || !p.dead || p.ignoreInteractUntil === Number.POSITIVE_INFINITY)
      return;
    p.ignoreInteractUntil = Number.POSITIVE_INFINITY;
    try {
      const destination = p.guest
        ? this.instances.get(WORLD)!
        : await this.hideoutInstance(p.userId);
      const origin = p.guest
        ? this.choose(destination.spawns)
        : destination.spawns[0];
      const spawn = p.guest
        ? this.findClearPointNear(destination, origin.x, origin.y, 10)
        : origin;
      if (!this.players.has(sid)) return;
      p.hp = PLAYER_MAX_HP;
      p.dead = false;
      p.inv = this.starterInventory();
      p.equipment = { helmet: null, vest: null, mod: null };
      p.armorDur = {};
      p.equipped = null;
      p.mags = {};
      p.hunger = 100;
      p.thirst = 100;
      p.stamina = STAMINA_MAX;
      p.staminaExhausted = false;
      p.action = null;
      this.switchInstance(p, destination, spawn.x, spawn.y);
      this.toast(
        sid,
        p.guest
          ? "Guest redeployed into the zone empty-handed"
          : "You wake at home empty-handed. Regear from your stash when you are ready.",
      );
      void this.saveProfileOf(p);
    } catch (error) {
      p.ignoreInteractUntil = 0;
      this.log.error(
        `Respawn failed for ${p.name}: ${(error as Error).message}`,
      );
      this.toast(sid, "Could not return you home. Try again.");
    }
  }

  // ── trading ───────────────────────────────────────────────────────────────

  /** The trader in interaction range (if any) — its tier decides stock and quests. */
  private traderAt(
    p: ServerPlayer,
  ): { x: number; y: number; tier?: TraderTier } | null {
    let best: { x: number; y: number; tier?: TraderTier } | null = null;
    let bd = INTERACT_RANGE * 1.5;
    for (const t of this.inst(p).traders) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < bd) {
        best = t;
        bd = d;
      }
    }
    return best;
  }

  tradeBuy(sid: string, id: string, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const trader = this.traderAt(p);
    if (!trader) return;
    const stock = this.content.traderStock(trader.tier ?? 1);
    const entry = stock.find((e) => e.id === id && e.buy > 0);
    if (!entry) return;
    const n = Math.max(1, Math.min(99, Math.floor(qty) || 1));
    const affordable = Math.min(n, Math.floor(p.money / entry.buy));
    if (affordable <= 0) {
      this.toast(sid, "Not enough credits");
      return;
    }
    const leftover = this.addItem(p.inv, entry.id, affordable);
    const bought = affordable - leftover;
    if (bought <= 0) {
      this.toast(sid, "Not enough space or weight");
      return;
    }
    p.money -= bought * entry.buy;
    this.telemetry.record({
      kind: "currency_destroyed",
      userId: p.userId,
      credits: bought * entry.buy,
      source: "trade_buy",
    });
    this.telemetry.record({
      kind: "item_spawned",
      userId: p.userId,
      itemId: entry.id,
      quantity: bought,
      value: this.content.estimatedItemValue(entry.id) * bought,
      source: "trade_buy",
    });
    this.toast(
      sid,
      `Bought ${this.content.item(entry.id).name} x${bought} (-${bought * entry.buy}cr)`,
    );
    this.pushInventory(p);
    this.sendTrade(p);
    void this.saveProfileOf(p);
  }

  tradeSell(sid: string, slot: number, qty: number) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const trader = this.traderAt(p);
    if (!trader) return;
    if (slot < 0 || slot >= p.inv.slots.length) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const stock = this.content.traderStock(trader.tier ?? 1);
    const entry = stock.find((e) => e.id === item.id && e.sell > 0);
    if (!entry) {
      this.toast(sid, "This trader is not interested in that");
      return;
    }
    const n = Math.max(1, Math.min(Math.floor(qty) || item.qty, item.qty));
    item.qty -= n;
    if (item.qty <= 0) {
      p.inv.slots[slot] = null;
      if (p.equipped === slot) p.equipped = null;
    }
    p.money += n * entry.sell;
    this.telemetry.record({
      kind: "item_destroyed",
      userId: p.userId,
      itemId: item.id,
      quantity: n,
      value: this.content.estimatedItemValue(item.id) * n,
      source: "trade_sell",
    });
    this.telemetry.record({
      kind: "currency_spawned",
      userId: p.userId,
      credits: n * entry.sell,
      source: "trade_sell",
    });
    this.toast(
      sid,
      `Sold ${this.content.item(item.id).name} x${n} (+${n * entry.sell}cr)`,
    );
    this.pushInventory(p);
    this.sendTrade(p);
    void this.saveProfileOf(p);
  }

  // ── hideout ───────────────────────────────────────────────────────────────

  async enterHideout(sid: string, ownerId?: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    if (p.guest) {
      this.toast(
        sid,
        "Personal and allied hideouts require a registered survivor",
      );
      return;
    }
    const inst = this.inst(p);
    const owner = ownerId && typeof ownerId === "string" ? ownerId : p.userId;
    if (owner === p.userId) {
      // no free warp home — the only way out of the zone is an extraction beacon
      this.toast(sid, "Reach an extraction beacon to get home");
      return;
    }
    const onlineOwner = [...this.players.values()].find(
      (candidate) =>
        !this.isBot(candidate) &&
        candidate.userId === owner &&
        !candidate.dead &&
        candidate.loggedOutAt === null,
    );
    if (!onlineOwner) {
      this.toast(
        sid,
        "That friend must be online on this relay before you can visit their camp",
      );
      return;
    }
    // visit friends from the comfort of your own base, or from a safe zone
    const fromHome = inst.kind === "hideout" && inst.ownerId === p.userId;
    if (
      !fromHome &&
      (inst.kind !== "world" || !this.isSafeAt(inst, p.x, p.y))
    ) {
      this.toast(sid, "Visit camps from your base or a safe zone");
      return;
    }
    const ok = await this.db.areFriends(owner, p.userId);
    if (!ok) {
      this.toast(sid, "You are not on that hideout’s access list");
      return;
    }
    p.returnPos = fromHome ? null : { x: p.x, y: p.y };
    const h = await this.hideoutInstance(owner);
    const spawn = h.spawns[0];
    this.switchInstance(p, h, spawn.x, spawn.y);
    this.toast(sid, "Entered a friend’s camp — have a look around");
    // let the owner know they have company
    for (const op of this.players.values())
      if (op.userId === owner)
        this.toast(op.sid, `👋 ${p.name} is visiting your camp`);
  }

  async enterClanHideout(sid: string) {
    const player = this.players.get(sid);
    if (!player || player.dead || this.isBot(player)) return;
    if (player.guest) {
      this.toast(sid, "Clan holdouts require a registered survivor");
      return;
    }
    await this.refreshPlayerSocial(player);
    if (
      !player.clanId ||
      !player.clanName ||
      !player.clanTag ||
      !player.clanRank
    ) {
      this.toast(sid, "Join a clan before entering a clan holdout");
      return;
    }
    const current = this.inst(player);
    if (current.kind === "clan_hideout" && current.clanId === player.clanId) {
      this.toast(sid, "You are already in your clan holdout");
      return;
    }
    const fromPersonalHome =
      current.kind === "hideout" && current.ownerId === player.userId;
    if (
      !fromPersonalHome &&
      (current.kind !== "world" || !this.isSafeAt(current, player.x, player.y))
    ) {
      this.toast(sid, "Enter the clan holdout from your home or a safe zone");
      return;
    }
    if (!(await this.db.acquireClanHideoutLease(player.clanId))) {
      this.toast(
        sid,
        "Your clan holdout is active on another relay — try again shortly",
      );
      return;
    }
    player.returnPos = fromPersonalHome ? null : { x: player.x, y: player.y };
    let clanHoldout: Instance;
    try {
      clanHoldout = await this.clanHideoutInstance({
        id: player.clanId,
        name: player.clanName,
        tag: player.clanTag,
      });
    } catch (error) {
      void this.db.releaseClanHideoutLease(player.clanId);
      throw error;
    }
    this.switchInstance(
      player,
      clanHoldout,
      clanHoldout.spawns[0].x,
      clanHoldout.spawns[0].y,
    );
    this.toast(sid, `Entered [${player.clanTag}] ${player.clanName} Holdout`);
    for (const member of this.players.values()) {
      if (
        member.sid !== sid &&
        member.clanId === player.clanId &&
        member.instanceId === clanHoldout.id
      ) {
        this.toast(member.sid, `${player.name} entered the clan holdout`);
      }
    }
  }

  async transferClanTreasury(sid: string, rawAmount: number) {
    const player = this.players.get(sid);
    if (!player || player.dead || this.isBot(player)) return;
    if (player.guest) {
      this.toast(sid, "Clan banking requires a registered survivor");
      return;
    }
    await this.refreshPlayerSocial(player).catch(() => undefined);
    if (!player.clanId || !player.clanRank) {
      this.toast(sid, "Join a clan before using a clan treasury");
      return;
    }
    const instance = this.inst(player);
    if (
      instance.kind === "world" &&
      !this.isSafeAt(instance, player.x, player.y)
    ) {
      this.toast(
        sid,
        "Clan banking is available at home, the clan holdout, or a safe trader",
      );
      return;
    }
    const amount = Math.max(
      -100_000,
      Math.min(100_000, Math.trunc(Number(rawAmount) || 0)),
    );
    if (amount === 0) {
      this.toast(sid, "Enter a credit amount");
      return;
    }
    const result = await this.enqueueProfileWork(player.userId, async () => {
      if (!(await this.persistProfileOf(player, player.sid)))
        return { ok: false as const, reason: "stale_lease" as const };
      return this.db.transferClanTreasury(
        player.userId,
        player.sid,
        player.name,
        player.clanId!,
        amount,
      );
    });
    if (!result.ok) {
      const message = {
        not_member: "Your clan membership changed",
        forbidden: "Only clan officers and the owner can withdraw credits",
        insufficient_credits: "You do not have enough credits",
        insufficient_treasury: "The clan treasury does not have enough credits",
        stale_lease: "Your survivor session is no longer authoritative",
        unavailable: "Clan treasury is temporarily unavailable",
      }[result.reason];
      this.toast(sid, message);
      return;
    }
    player.money = result.money;
    this.pushInventory(player);
    for (const member of this.players.values()) {
      if (member.clanId !== player.clanId || this.isBot(member)) continue;
      this.emitTo(member.sid, EV.clanTreasuryUpdate, {
        clanId: player.clanId,
        treasury: result.treasury,
        actor: player.name,
        amount,
      });
    }
    this.toast(
      sid,
      amount > 0
        ? `Contributed ${amount} credits to the clan`
        : `Withdrew ${Math.abs(amount)} clan credits`,
    );
  }

  async leaveHideout(sid: string) {
    const p = this.players.get(sid);
    if (!p || p.dead) return;
    const inst = this.inst(p);
    if (inst.kind === "world") return;
    if (inst.kind === "clan_hideout") {
      if (clanHideoutExitTarget(p.returnPos !== null) === "safe_zone") {
        const world = this.instances.get(WORLD)!;
        const returnPosition = p.returnPos!;
        p.returnPos = null;
        this.switchInstance(p, world, returnPosition.x, returnPosition.y);
        this.toast(sid, "Returned to the safe zone");
      } else {
        const home = await this.hideoutInstance(p.userId);
        const spawn = home.spawns[0];
        p.returnPos = null;
        this.switchInstance(p, home, spawn.x, spawn.y);
        this.toast(sid, "Returned to your personal hideout");
      }
      return;
    }
    if (inst.ownerId !== p.userId) {
      // leaving a friend's camp: back to the safe zone you came from, or home
      if (p.returnPos) {
        const world = this.instances.get(WORLD)!;
        const ret = p.returnPos;
        p.returnPos = null;
        this.switchInstance(p, world, ret.x, ret.y);
      } else {
        const home = await this.hideoutInstance(p.userId);
        this.switchInstance(p, home, home.spawns[0].x, home.spawns[0].y);
        this.toast(sid, "Back home");
      }
      return;
    }
    // leaving your own base = deploying into the zone
    const world = this.instances.get(WORLD)!;
    const ret =
      p.returnPos ?? world.spawns[Math.floor(this.rnd() * world.spawns.length)];
    p.returnPos = null;
    this.switchInstance(p, world, ret.x, ret.y);
    this.toast(sid, "Deployed into the zone — find a beacon to extract");
  }

  // ── inventory primitives ──────────────────────────────────────────────────

  private addItem(
    inv: Inventory,
    id: string,
    qty: number,
    durability?: number,
  ): number {
    // no hard weight cap — carrying too much slows you down instead (see tick)
    return addInventoryItem(inv, this.content.items, id, qty, durability);
  }

  private removeItem(inv: Inventory, id: string, qty: number): number {
    return removeInventoryItem(inv, id, qty);
  }

  private countItem(inv: Inventory, id: string): number {
    return countInventoryItem(inv, id);
  }

  private dropAt(
    inst: Instance,
    x: number,
    y: number,
    id: string,
    qty: number,
    dur?: number,
  ) {
    if (!id || qty <= 0) return;
    const gid = `g${this.nextId++}`;
    inst.ground.set(gid, {
      id: gid,
      x,
      y,
      item: id as ItemId,
      qty,
      expiresAt: droppedLootExpiresAt(Date.now()),
      ...(dur !== undefined ? { dur } : {}),
    });
  }

  private spawnGroundAt(inst: Instance, x: number, y: number) {
    const roll = rollGround(this.rnd, this.content.lootTables);
    const gid = `g${this.nextId++}`;
    inst.ground.set(gid, {
      id: gid,
      x,
      y,
      item: roll.id,
      qty: roll.qty,
      expiresAt: droppedLootExpiresAt(Date.now()),
    });
    this.telemetry.record({
      kind: "item_spawned",
      itemId: roll.id,
      quantity: roll.qty,
      value: this.content.estimatedItemValue(roll.id) * roll.qty,
      source: "ground_loot",
    });
  }

  private spawnEnemy(
    inst: Instance,
    x: number,
    y: number,
    kind: EnemyKind,
    respawnMs?: number,
  ): string | null {
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
      if (!found) return null; // nowhere sane to put it
    }
    const def = this.content.enemy(kind);
    const id = `e${this.nextId++}`;
    inst.enemies.set(id, {
      id,
      kind,
      x,
      y,
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
      lastSeenAt: 0,
      lastSeenX: x,
      lastSeenY: y,
      respawnMs: respawnMs ?? this.content.enemyRespawnMs(kind),
      lastAttackAt: 0,
      lastHitAt: 0,
    });
    return id;
  }

  private updateNightHorde(
    inst: Instance,
    now: number,
    day: number,
    night: boolean,
  ) {
    if (this.wasNight && !night) {
      for (const id of this.nightHordeIds) inst.enemies.delete(id);
      this.nightHordeIds.clear();
    }
    this.wasNight = night;
    if (!night || day < 0.82 || day > 0.9) return;
    const cycle = Math.floor(now / DAY_LENGTH_MS);
    if (this.lastNightHordeCycle === cycle) return;
    const targets = [...this.players.values()].filter(
      (player) =>
        !this.isBot(player) &&
        !player.dead &&
        player.loggedOutAt === null &&
        player.instanceId === inst.id &&
        !this.isSafeAt(inst, player.x, player.y),
    );
    if (!targets.length) return;
    this.lastNightHordeCycle = cycle;

    const desired = Math.min(36, 7 + targets.length * 3);
    let spawned = 0;
    for (let index = 0; index < desired; index++) {
      const target = targets[index % targets.length];
      let point: { x: number; y: number } | null = null;
      for (let attempt = 0; attempt < 80; attempt++) {
        const angle = this.rnd() * Math.PI * 2;
        const distance = (9 + this.rnd() * 7) * TILE;
        const x = Math.max(
          TILE * 2,
          Math.min((inst.w - 2) * TILE, target.x + Math.cos(angle) * distance),
        );
        const y = Math.max(
          TILE * 2,
          Math.min((inst.h - 2) * TILE, target.y + Math.sin(angle) * distance),
        );
        if (
          this.isSafeAt(inst, x, y) ||
          this.isBlocked(inst, x, y, ENEMY_RADIUS)
        )
          continue;
        // Prefer the treeline or structures outside the survivor's sight cone.
        if (attempt < 55 && this.losClear(inst, target.x, target.y, x, y))
          continue;
        point = { x, y };
        break;
      }
      if (!point) continue;
      const id = this.spawnEnemy(inst, point.x, point.y, "zombie", 0);
      if (id) {
        this.nightHordeIds.add(id);
        spawned++;
      }
    }
    if (spawned > 0) {
      this.io
        ?.to(inst.id)
        .emit(
          EV.toast,
          `☾ NIGHT SURGE — ${spawned} infected are moving through the dark`,
        );
      this.log.log(
        `Night surge spawned ${spawned} infected around ${targets.length} exposed survivor(s)`,
      );
    }
  }

  // ── simulation ────────────────────────────────────────────────────────────

  private findRandomEventPoint(inst: Instance): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 240; attempt++) {
      const tx = 2 + Math.floor(this.rnd() * Math.max(1, inst.w - 4));
      const ty = 2 + Math.floor(this.rnd() * Math.max(1, inst.h - 4));
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      if (
        this.isSafeAt(inst, x, y) ||
        this.inWater(inst, { x, y }) ||
        this.isBlocked(inst, x, y, 18) ||
        [...inst.randomEvents.values()].some(
          (event) => Math.hypot(event.x - x, event.y - y) < 14 * TILE,
        )
      )
        continue;
      let crowded = false;
      for (const player of this.players.values()) {
        if (
          player.instanceId === inst.id &&
          !player.dead &&
          Math.hypot(player.x - x, player.y - y) < 9 * TILE
        ) {
          crowded = true;
          break;
        }
      }
      if (!crowded) return { x, y };
    }
    return null;
  }

  private recordRandomEventLoot(
    slots: InvSlot[],
    source: string,
    eventId: string,
  ) {
    for (const slot of slots) {
      if (!slot) continue;
      this.telemetry.record({
        kind: "item_spawned",
        itemId: slot.id,
        quantity: slot.qty,
        value: this.content.estimatedItemValue(slot.id) * slot.qty,
        source,
        metadata: { eventId },
      });
    }
  }

  private startSupplyDrop(
    inst: Instance,
    eventId: string,
    point: { x: number; y: number },
    now: number,
  ): RandomWorldEvent {
    const containerId = `a${this.nextId++}`;
    const slots = [
      ...rollChest(this.rnd, "rare", this.content.lootTables),
      ...rollChest(this.rnd, "military", this.content.lootTables),
    ];
    inst.containers.set(containerId, {
      id: containerId,
      x: point.x,
      y: point.y,
      kind: "crate",
      tier: "rare",
      slots,
      restockAt: null,
      eventId,
      eventKind: "supply_drop",
    });
    this.recordRandomEventLoot(slots, "random_event_supply_drop", eventId);
    return {
      id: eventId,
      type: "supply_drop",
      name: "SUPPLY DROP",
      x: point.x,
      y: point.y,
      radius: 80,
      startedAt: now,
      expiresAt: now + SUPPLY_DROP_TTL_MS,
      containerId,
    };
  }

  private startBossHunt(
    inst: Instance,
    eventId: string,
    point: { x: number; y: number },
    now: number,
  ): RandomWorldEvent | null {
    const publishedBosses = this.content.bossKinds();
    const kind = publishedBosses.length
      ? publishedBosses[Math.floor(this.rnd() * publishedBosses.length)]
      : this.rnd() < 0.5
        ? "bear"
        : "military";
    const enemyId = this.spawnEnemy(inst, point.x, point.y, kind, 0);
    if (!enemyId) return null;
    const enemy = inst.enemies.get(enemyId)!;
    const definition = this.content.enemy(kind);
    const published = publishedBosses.includes(kind);
    enemy.maxHp = Math.max(
      published ? 360 : 480,
      Math.round(definition.maxHp * (published ? 1.5 : 3)),
    );
    enemy.hp = enemy.maxHp;
    enemy.eventId = eventId;
    enemy.bossName = definition.name.toUpperCase();
    enemy.damageMult = published ? 1.2 : 1.45;
    enemy.speedMult = 1.08;
    enemy.aggroMult = 1.5;
    return {
      id: eventId,
      type: "boss",
      name: `HUNT: ${enemy.bossName}`,
      x: point.x,
      y: point.y,
      radius: 150,
      startedAt: now,
      expiresAt: now + BOSS_EVENT_TTL_MS,
      enemyId,
    };
  }

  private updateRandomEvents(inst: Instance, now: number) {
    for (const event of [...inst.randomEvents.values()]) {
      if (event.enemyId) {
        const enemy = inst.enemies.get(event.enemyId);
        if (enemy) {
          event.x = enemy.x;
          event.y = enemy.y;
        }
      }
      if (now < event.expiresAt) continue;
      if (event.containerId) {
        inst.containers.delete(event.containerId);
        this.io?.to(inst.id).emit(EV.containerGone, event.containerId);
      }
      if (event.enemyId) inst.enemies.delete(event.enemyId);
      inst.randomEvents.delete(event.id);
      this.io
        ?.to(inst.id)
        .emit(EV.toast, `${event.name} expired - the opportunity is gone`);
    }

    const hasActiveSurvivor = [...this.players.values()].some(
      (player) =>
        player.instanceId === inst.id &&
        !this.isBot(player) &&
        player.loggedOutAt === null,
    );
    if (
      !hasActiveSurvivor ||
      inst.randomEvents.size >= MAX_RANDOM_EVENTS ||
      now < inst.nextRandomEventAt
    )
      return;

    const point = this.findRandomEventPoint(inst);
    if (!point) {
      inst.nextRandomEventAt = now + 30_000;
      return;
    }
    const eventId = `we${this.nextId++}`;
    const type = randomEventType(this.rnd);
    const event = type === "supply_drop"
      ? this.startSupplyDrop(inst, eventId, point, now)
      : this.startBossHunt(inst, eventId, point, now);
    inst.nextRandomEventAt = now + randomEventDelay(this.rnd);
    if (!event) return;
    inst.randomEvents.set(event.id, event);
    const sector = `${Math.floor(event.x / TILE)},${Math.floor(event.y / TILE)}`;
    this.io
      ?.to(inst.id)
      .emit(
        EV.toast,
        type === "supply_drop"
          ? `SUPPLY DROP landed in sector ${sector} - open the map to track it`
          : `${event.name} spotted in sector ${sector} - high-tier loot on defeat`,
      );
    this.log.log(`Random event ${event.id} started: ${event.name} at ${sector}`);
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (now >= this.nextBotSyncAt) {
      this.syncBotPopulation();
      this.nextBotSyncAt = now + BOT_SYNC_MS;
    }

    for (const p of this.players.values()) {
      // combat-log body: no owner online — expire it (or reap it once it dies)
      if (p.loggedOutAt !== null) {
        if (p.dead) {
          void this.finalizePlayerExitWithLease(p);
          continue;
        }
        if (now - p.loggedOutAt > 60_000) {
          // A disconnect must never become a free extraction. If the owner does
          // not reconnect during the grace window, the exposed body dies and
          // leaves its carried gear in the shared world.
          this.damagePlayer(p, PLAYER_MAX_HP * 10, "the zone", null, null);
          void this.finalizePlayerExitWithLease(p);
          continue;
        }
        p.moving = false;
        continue; // frozen: still a target, but takes no input, survival, or actions
      }
      const inst = this.inst(p);
      if (p.dead) {
        if (this.isBot(p)) {
          if (!p.bot.respawnAt)
            p.bot.respawnAt =
              now + Math.max(5000, this.content.settings.bots.respawnMs | 0);
          if (now >= p.bot.respawnAt) this.botRespawn(p);
        }
        continue;
      }
      if (this.isBot(p)) this.updateBot(p, inst, now);
      // near-station flags must follow you around — push the moment they change
      // (fixes "standing at the workbench but it says I need one")
      const stationMask =
        (this.nearStation(p, "workbench") ? 1 : 0) |
        (this.nearStation(p, "firepit") ? 2 : 0) |
        (this.nearStation(p, "furnace") ? 4 : 0) |
        (this.nearStation(p, "anvil") ? 8 : 0) |
        (this.nearTile(p, Tile.Water) ? 16 : 0);
      if (stationMask !== p.lastStationMask) {
        p.lastStationMask = stationMask;
        this.pushInventory(p);
      }
      if (p.admin && p.adminMode) {
        p.hunger = 100;
        p.thirst = 100;
        p.starveAcc = 0;
      }
      // survival decay (paused inside hideouts — it's a rest space)
      if (inst.kind === "world" && !(p.admin && p.adminMode)) {
        p.hunger = Math.max(0, p.hunger - HUNGER_DECAY_PER_S * dt);
        p.thirst = Math.max(0, p.thirst - THIRST_DECAY_PER_S * dt);
        if (p.hunger <= 0 || p.thirst <= 0) {
          p.starveAcc +=
            STARVE_DMG_PER_S *
            dt *
            ((p.hunger <= 0 ? 1 : 0) + (p.thirst <= 0 ? 1 : 0));
          if (p.starveAcc >= 1) {
            const dmg = Math.floor(p.starveAcc);
            p.starveAcc -= dmg;
            this.damagePlayer(
              p,
              dmg,
              p.thirst <= 0 ? "dehydration" : "starvation",
              null,
              null,
            );
          }
        }
        // well fed & hydrated → slow passive healing (reward the survival loop)
        if (
          p.hunger > REGEN_THRESHOLD &&
          p.thirst > REGEN_THRESHOLD &&
          p.hp < PLAYER_MAX_HP
        ) {
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
            this.toast(
              p.sid,
              p.thirst <= p.hunger
                ? "You are getting thirsty"
                : "You are getting hungry",
            );
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
        if (
          actionInterruptedByMovement(
            p.actionStart.x,
            p.actionStart.y,
            p.x,
            p.y,
          )
        ) {
          p.action = null;
          this.emitTo(p.sid, EV.action, {
            label: "",
            ms: 0,
          } satisfies ActionSnap);
        } else if (now >= p.action.until) {
          const act = p.action;
          p.action = null;
          this.completeAction(p, inst, act);
        }
      }
      // finish reloads
      if (p.reloadTarget && now >= p.reloadUntil) {
        const def = this.content.item(p.reloadTarget);
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
      const moving = !!(dx || dy);
      const actionFacing =
        p.input.shoot ||
        p.action !== null ||
        p.reloadTarget !== null ||
        now - Math.max(p.lastAttackAt, p.lastSwingAt) < 450;
      p.angle = p.input.angle;
      if (moving) p.facing = Math.atan2(dy, dx);
      else if (actionFacing) p.facing = p.input.angle;
      // sprint: hold to run, drains stamina; can't sprint while swimming/overweight/exhausted
      const overweight =
        invWeight(p.inv, this.content.items) > invCapacity(p.inv).maxKg;
      const wantSprint =
        !!p.input.sprint &&
        moving &&
        !this.inWater(inst, p) &&
        !overweight &&
        !p.staminaExhausted &&
        p.stamina > 0;
      if (wantSprint) {
        p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN_PER_S * dt);
        p.lastExertAt = now;
        if (p.stamina === 0) p.staminaExhausted = true;
      } else {
        const regenDelay = p.staminaExhausted
          ? STAMINA_EXHAUSTED_REGEN_DELAY_MS
          : STAMINA_REGEN_DELAY_MS;
        if (now - p.lastExertAt > regenDelay && p.stamina < STAMINA_MAX) {
          p.stamina = Math.min(
            STAMINA_MAX,
            p.stamina + STAMINA_REGEN_PER_S * dt,
          );
          if (p.staminaExhausted && p.stamina >= STAMINA_EXHAUSTED_RECOVERY)
            p.staminaExhausted = false;
        }
      }
      if (moving) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        const speed =
          PLAYER_SPEED *
          (this.inWater(inst, p) ? SWIM_SPEED_MULT : 1) *
          this.terrainMoveMultiplier(inst, p.x, p.y) *
          fatigueMoveMultiplier(
            overweight,
            p.staminaExhausted,
            FATIGUE_SPEED_MULT,
          ) *
          (wantSprint ? SPRINT_SPEED_MULT : 1);
        this.moveEntity(
          inst,
          p,
          dx * speed * dt,
          dy * speed * dt,
          PLAYER_RADIUS,
        );
        p.moving = true;
      } else {
        p.moving = false;
      }
      // push the stamina bar on coarse change (keeps broadcasts light)
      const staBucket = Math.round(p.stamina / 4);
      if (
        staBucket !== p.lastStaminaBucket ||
        p.staminaExhausted !== p.lastPushedStaminaExhausted
      ) {
        p.lastStaminaBucket = staBucket;
        p.lastPushedStaminaExhausted = p.staminaExhausted;
        this.pushInventory(p);
      }
      if (p.input.shoot) this.tryAttack(p, inst, now);
    }

    const day = (now % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    const night = isNight(day);
    for (const inst of this.instances.values()) {
      purgeExpiredLoot(inst.ground, now);
      for (const id of purgeExpiredLoot(inst.containers, now)) {
        this.io?.to(inst.id).emit(EV.containerGone, id);
      }
      if (inst.kind === "world") {
        this.updateRandomEvents(inst, now);
        this.updateNightHorde(inst, now, day, night);
        this.updateEnemies(inst, dt, now, night);
        // chest restock
        for (const c of inst.containers.values()) {
          if (
            c.kind !== "bag" &&
            c.kind !== "storage" &&
            c.restockAt &&
            now >= c.restockAt
          ) {
            c.slots = c.lootTable
              ? rollNamed(this.rnd, c.lootTable, this.content.lootTables)
              : rollChest(this.rnd, c.tier, this.content.lootTables);
            c.restockAt = null;
            for (const player of this.players.values()) {
              if (player.instanceId === inst.id && player.openContainer === c.id)
                player.openContainer = null;
            }
            this.io?.to(inst.id).emit(EV.containerGone, c.id);
          }
        }
        // Node regrowth selects a weighted published tree/rock variant. Rock
        // family nodes then reroll their ore vein, preventing fixed rare camps.
        let nodesRegrown = false;
        for (let i = inst.nodeRespawns.length - 1; i >= 0; i--) {
          const nr = inst.nodeRespawns[i];
          if (now < nr.at) continue;
          const cx = (nr.i % inst.w) * TILE + TILE / 2;
          const cy = Math.floor(nr.i / inst.w) * TILE + TILE / 2;
          let occupied = false;
          for (const p of this.players.values())
            if (
              p.instanceId === inst.id &&
              !p.dead &&
              Math.hypot(p.x - cx, p.y - cy) < TILE * 1.2
            ) {
              occupied = true;
              break;
            }
          if (occupied) {
            nr.at = now + 10_000;
            continue;
          }
          this.regrowResourceNode(inst, nr);
          inst.nodeRespawns.splice(i, 1);
          nodesRegrown = true;
        }
        if (nodesRegrown) void this.persistWorldState(inst);
        // enemy respawns
        for (let i = inst.enemyRespawns.length - 1; i >= 0; i--) {
          const er = inst.enemyRespawns[i];
          if (now < er.at) continue;
          this.spawnEnemy(inst, er.x, er.y, er.kind, er.respawnMs);
          inst.enemyRespawns.splice(i, 1);
        }
        // world structures wear out (restoring any floor beneath)
        for (const [i, s] of inst.structures) {
          if (now < s.expiresAt) continue;
          inst.structures.delete(i);
          inst.stationFuel.delete(i);
          const restore = s.under ?? Tile.Grass;
          inst.unders.delete(i);
          inst.tiles[i] = restore;
          this.io?.to(inst.id).emit(EV.tile, { i, tile: restore });
          this.restorePlayerBlockVisual(inst, i, restore);
        }
        // ground loot top-up
        if (
          inst.ground.size < 45 &&
          now - inst.lastGroundSpawn > 5000 &&
          inst.lootSpots.length > 0
        ) {
          const spot =
            inst.lootSpots[Math.floor(this.rnd() * inst.lootSpots.length)];
          this.spawnGroundAt(
            inst,
            spot.x + (this.rnd() - 0.5) * 12,
            spot.y + (this.rnd() - 0.5) * 12,
          );
          inst.lastGroundSpawn = now;
        }
      }
      this.updateDoors(inst);
      this.updateProjectiles(inst, dt, now);
      this.broadcast(inst, now);
    }
  }

  private isBlocked(
    inst: Instance,
    x: number,
    y: number,
    radius: number,
    blocks: Record<number, boolean> = BLOCKS_MOVE,
  ): boolean {
    const minX = Math.floor((x - radius) / TILE);
    const maxX = Math.floor((x + radius) / TILE);
    const minY = Math.floor((y - radius) / TILE);
    const maxY = Math.floor((y + radius) / TILE);
    for (let ty = minY; ty <= maxY; ty++)
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return true;
        const index = ty * inst.w + tx;
        const openDoor = inst.openDoors.has(index);
        if (
          blocks[inst.tiles[index]] &&
          !(openDoor && inst.tiles[index] === Tile.Door)
        )
          return true;
        const block = this.content.block(inst.blockKinds[String(index)]);
        if (
          block &&
          !(openDoor && block.playerPlacement?.buildType === "door") &&
          (blocks === BLOCKS_ENEMY
            ? block.collision.enemy
            : block.collision.move)
        )
          return true;
        const terrain = this.terrainAtIndex(inst, index);
        if (
          terrain &&
          (blocks === BLOCKS_ENEMY
            ? terrain.collision.enemy
            : terrain.collision.move)
        )
          return true;
      }
    return false;
  }

  private updateDoors(inst: Instance) {
    const shouldOpen = new Set<number>();
    for (const player of this.players.values()) {
      if (
        player.instanceId !== inst.id ||
        player.dead ||
        player.loggedOutAt !== null
      )
        continue;
      const centerX = Math.floor(player.x / TILE);
      const centerY = Math.floor(player.y / TILE);
      for (let ty = centerY - 1; ty <= centerY + 1; ty++)
        for (let tx = centerX - 1; tx <= centerX + 1; tx++) {
          if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) continue;
          const index = ty * inst.w + tx;
          const block = this.content.block(inst.blockKinds[String(index)]);
          const isDoor =
            inst.tiles[index] === Tile.Door ||
            block?.playerPlacement?.buildType === "door";
          if (
            isDoor &&
            Math.hypot(
              (tx + 0.5) * TILE - player.x,
              (ty + 0.5) * TILE - player.y,
            ) <
              TILE * 1.05
          )
            shouldOpen.add(index);
        }
    }
    for (const index of new Set([...inst.openDoors, ...shouldOpen])) {
      const open = shouldOpen.has(index);
      if (inst.openDoors.has(index) === open) continue;
      if (open) inst.openDoors.add(index);
      else inst.openDoors.delete(index);
      this.io
        ?.to(inst.id)
        .emit(EV.block, {
          i: index,
          blockId: inst.blockKinds[String(index)],
          rotation: inst.blockRotations[String(index)] ?? 0,
          open,
        });
    }
  }

  private tileUnder(inst: Instance, x: number, y: number): Tile {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return Tile.Grass;
    return inst.tiles[ty * inst.w + tx] as Tile;
  }

  private elevationUnder(inst: Instance, x: number, y: number): number {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return 0;
    return inst.elevations[ty * inst.w + tx] ?? 0;
  }

  private inWater(inst: Instance, p: { x: number; y: number }): boolean {
    if (this.tileUnder(inst, p.x, p.y) === Tile.Water) return true;
    return Boolean(this.terrainUnder(inst, p.x, p.y)?.swimmable);
  }

  private terrainUnder(inst: Instance, x: number, y: number) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return undefined;
    return this.terrainAtIndex(inst, ty * inst.w + tx);
  }

  private terrainAtIndex(inst: Instance, index: number) {
    const terrainId =
      inst.terrainKinds[String(index)] ??
      TERRAIN_ID_BY_TILE[inst.tiles[index]] ??
      "grass";
    return this.content.terrain(terrainId);
  }

  private terrainMoveMultiplier(inst: Instance, x: number, y: number): number {
    return this.terrainUnder(inst, x, y)?.moveMultiplier ?? 1;
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
    if (
      elevationStepAllowed(
        this.elevationUnder(inst, e.x, e.y),
        this.elevationUnder(inst, nx, e.y),
      ) &&
      !this.isBlocked(inst, nx, e.y, radius, blocks)
    ) {
      e.x = nx;
      moved = true;
    }
    const ny = e.y + dy;
    if (
      elevationStepAllowed(
        this.elevationUnder(inst, e.x, e.y),
        this.elevationUnder(inst, e.x, ny),
      ) &&
      !this.isBlocked(inst, e.x, ny, radius, blocks)
    ) {
      e.y = ny;
      moved = true;
    }
    return moved;
  }

  // ── attacks ───────────────────────────────────────────────────────────────

  private tryAttack(p: ServerPlayer, inst: Instance, now: number) {
    const slot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const def = slot ? this.content.item(slot.id) : null;
    if (def?.kind === "placeable") return; // held kits place via c:build, never swing
    if (def?.kind === "consumable") this.tryConsume(p, p.equipped!, now);
    else if (!combatAttackAllowed(p.staminaExhausted)) {
      if (now - p.lastExhaustedAttackToastAt > 1500) {
        p.lastExhaustedAttackToastAt = now;
        this.toast(p.sid, "Too exhausted to attack");
      }
    } else if (def?.weapon) this.tryShoot(p, inst, def.weapon, slot!.id, now);
    else this.tryMelee(p, inst, def?.melee ?? FISTS, now);
  }

  /** Left-click with a held consumable → use one (rate-limited, no toast spam when full). */
  private tryConsume(p: ServerPlayer, slot: number, now: number) {
    if (now - p.lastAttackAt < 600) return;
    const item = p.inv.slots[slot];
    if (!item) return;
    const def = this.content.item(item.id);
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

  private tryShoot(
    p: ServerPlayer,
    inst: Instance,
    w: RuntimeWeaponStats,
    weaponId: ItemId,
    now: number,
  ) {
    if (now - p.lastAttackAt < w.fireRateMs) return;
    if (now < p.reloadUntil) return; // mid-reload
    if (this.inWater(inst, p)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, "You cannot shoot while swimming");
        p.lastAttackAt = now;
      }
      return;
    }
    if (this.isSafeAt(inst, p.x, p.y)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, "Weapons are locked in the safe zone");
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
    if (p.equipped !== null && this.wearSlot(p, p.equipped)) return; // weapon wore out mid-shot
    // skills + mods tighten spread
    let spread = w.spread * (1 - 0.01 * (skillLevel(p.skills.shooting) - 1));
    if (p.equipment.mod === "attach_reddot") spread *= MOD_SPREAD_MULT;
    spread = Math.max(w.spread * 0.4, spread);
    const mx = p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 6);
    const my = p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 6);
    for (let i = 0; i < w.pellets; i++) {
      const a = p.angle + (this.rnd() - 0.5) * 2 * spread;
      inst.projectiles.push({
        id: this.nextId++,
        x: mx,
        y: my,
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
    // gunshot noise draws the dead (bows are quiet; suppressors quieter still) —
    // they investigate where the shot came from, they don't magically see you
    const noise = Math.min(
      w.noise ?? 380,
      p.equipment.mod === "attach_suppressor"
        ? SUPPRESSED_AGGRO_RANGE
        : Infinity,
    );
    const shotAt = Date.now();
    for (const e of inst.enemies.values()) {
      if (e.targetSid) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < noise) {
        e.targetSid = p.sid;
        e.lastSeenAt = shotAt;
        e.lastSeenX = p.x;
        e.lastSeenY = p.y;
      }
    }
    this.pushInventory(p);
  }

  private startReload(
    p: ServerPlayer,
    weaponId: ItemId,
    w: RuntimeWeaponStats,
    now: number,
    auto = false,
  ) {
    if (now < p.reloadUntil) return;
    const mag = p.mags[weaponId] ?? 0;
    if (mag >= w.magSize) return;
    if (this.countItem(p.inv, w.ammo) <= 0) {
      if (!auto || now - p.lastAttackAt > 800) {
        this.toast(p.sid, `No ${this.content.item(w.ammo).name}`);
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
    const def = slot ? this.content.item(slot.id) : null;
    if (def?.weapon) this.startReload(p, slot!.id, def.weapon, Date.now());
  }

  private tryMelee(
    p: ServerPlayer,
    inst: Instance,
    m: MeleeStats,
    now: number,
  ) {
    if (now - p.lastAttackAt < m.cooldownMs) return;
    if (this.inWater(inst, p)) {
      if (now - p.lastAttackAt > 1500) {
        this.toast(p.sid, "You cannot fight while swimming");
        p.lastAttackAt = now;
      }
      return;
    }
    // fishing rod + facing water = fish instead of swinging
    const eqSlot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    if (eqSlot?.id === "fishing_rod") {
      for (const dist of [28, 48, 64]) {
        const wx = p.x + Math.cos(p.angle) * dist;
        const wy = p.y + Math.sin(p.angle) * dist;
        if (this.tileUnder(inst, wx, wy) === Tile.Water) {
          p.lastAttackAt = now;
          p.lastSwingAt = now;
          this.startAction(p, "fish", "Fishing…", FISH_TIME_MS);
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
      let victim: ServerPlayer | Enemy | null = null;
      let victimIsEnemy = false;
      let bestD = reach;
      for (const other of this.players.values()) {
        if (other.sid === p.sid || other.dead || other.instanceId !== inst.id)
          continue;
        if (this.isSafeAt(inst, other.x, other.y)) continue;
        const d = inArc(other.x, other.y);
        if (d < bestD) {
          victim = other;
          victimIsEnemy = false;
          bestD = d;
        }
      }
      for (const e of inst.enemies.values()) {
        const d = inArc(e.x, e.y);
        if (d < bestD) {
          victim = e;
          victimIsEnemy = true;
          bestD = d;
        }
      }
      if (victim) {
        const dmg = Math.round(
          m.damage * Math.min(1.3, 1 + 0.01 * (skillLevel(p.skills.melee) - 1)),
        );
        this.addXp(p, "melee", dmg);
        if (p.equipped !== null) this.wearSlot(p, p.equipped); // melee weapon wears from hits
        if (victimIsEnemy) this.damageEnemy(inst, victim as Enemy, dmg, p);
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
      if (
        this.damageStructure(inst, i, m.damage) ||
        this.damageWorldBlock(inst, i, m.damage)
      )
        return; // authored/player structures take melee damage
      const tile = inst.tiles[i] as Tile;
      const resourceId = inst.resourceKinds[String(i)];
      const attachedResource = this.content.resource(resourceId);
      const resourceDef =
        attachedResource && harvestResourceTileMatches(attachedResource.tile, tile)
          ? attachedResource
          : undefined;
      const totalHits = resourceDef?.maxHits ?? NODE_HITS[tile];
      if (!totalHits) continue;

      const isTree = resourceDef
        ? resourceDef.skill === "woodcutting"
        : tile === Tile.Tree;
      const genericRockResource = Boolean(
        resourceDef && resourceDef.tile === Tile.Rock && !isTree,
      );
      const skill = resourceDef?.skill ?? (isTree ? "woodcutting" : "mining");
      const bonus = Math.floor((skillLevel(p.skills[skill]) - 1) / 5);
      // swinging at a node is hard work — costs stamina and slows you when spent
      p.stamina = Math.max(0, p.stamina - MINE_STAMINA_COST);
      p.lastExertAt = now;
      if (p.stamina === 0) p.staminaExhausted = true;
      if (p.equipped !== null) this.wearSlot(p, p.equipped); // tools wear from harvesting
      this.addXp(p, skill, 6);
      const left = (inst.nodeHits.get(i) ?? totalHits) - 1;
      let awarded = 0;
      if (resourceDef) {
        for (const drop of resourceDef.drops) {
          if (
            drop.when !== "hit" ||
            this.rnd() > drop.chance ||
            !this.content.hasItem(drop.itemId)
          )
            continue;
          const quantity =
            drop.min +
            Math.floor(this.rnd() * (drop.max - drop.min + 1)) +
            bonus;
          awarded +=
            quantity - this.addItem(p.inv, drop.itemId as ItemId, quantity);
        }
        const ore = genericRockResource ? ORE_YIELD[tile] : undefined;
        const explicitOreDrop = Boolean(
          ore &&
          resourceDef.drops.some(
            (drop) =>
              drop.when === "hit" && drop.itemId === ore && drop.chance > 0,
          ),
        );
        if (ore && !explicitOreDrop && this.addItem(p.inv, ore, 1) === 0) {
          awarded++;
          this.addXp(p, "mining", 4);
        }
        if (left <= 0) {
          for (const drop of resourceDef.drops) {
            if (
              drop.when !== "depleted" ||
              this.rnd() > drop.chance ||
              !this.content.hasItem(drop.itemId)
            )
              continue;
            const quantity =
              drop.min + Math.floor(this.rnd() * (drop.max - drop.min + 1));
            awarded +=
              quantity - this.addItem(p.inv, drop.itemId as ItemId, quantity);
          }
        }
      } else {
        const yieldQty = (isTree ? m.wood : m.stone) + bonus;
        const item: ItemId = isTree ? "wood" : "stone";
        awarded = yieldQty - this.addItem(p.inv, item, yieldQty);
        const ore = ORE_YIELD[tile];
        if (ore && this.addItem(p.inv, ore, 1) === 0) {
          awarded++;
          this.addXp(p, "mining", 4);
        }
      }
      if (awarded === 0)
        this.toast(p.sid, "Inventory full or no drop this strike");
      const soundId =
        left <= 0 ? resourceDef?.breakSound : resourceDef?.hitSound;
      this.hitFx(
        inst,
        tx * TILE + TILE / 2,
        ty * TILE + TILE / 2,
        awarded,
        "node",
        isTree ? "wood" : "stone",
        soundId,
      );

      if (left <= 0) {
        inst.nodeHits.delete(i);
        const depleted =
          resourceDef?.depletedTile ?? NODE_DEPLETED[tile] ?? Tile.Grass;
        const family: ResourceFamily =
          this.content.resourceFamily(resourceDef, tile) ??
          (isTree ? "tree" : "rock");
        const previousVariant = inst.nodeVariants.get(i);
        const baseTile = previousVariant?.baseTile ?? tile;
        const baseResourceId =
          previousVariant?.baseResourceId ?? resourceId ?? "";
        inst.tiles[i] = depleted;
        delete inst.resourceKinds[String(i)];
        this.io?.to(inst.id).emit(EV.tile, {
          i,
          tile: depleted,
          resourceId: null,
        });
        inst.nodeRespawns.push({
          i,
          at: now + (resourceDef?.respawnMs ?? NODE_RESPAWN_MS),
          family,
          depletedTile: depleted,
          baseTile,
          baseResourceId,
        });
        void this.persistWorldState(inst);
        this.toast(
          p.sid,
          `${resourceDef?.name ?? (isTree ? "Tree" : "Rock")} depleted`,
        );
      } else {
        inst.nodeHits.set(i, left);
      }
      this.pushInventory(p);
      return;
    }
  }

  // ── enemies ───────────────────────────────────────────────────────────────

  private updateEnemies(
    inst: Instance,
    dt: number,
    now: number,
    night = false,
  ) {
    for (const e of inst.enemies.values()) {
      const def = this.content.enemy(e.kind);
      // the dark belongs to the dead (and the wolves)
      const hunter = e.kind === "zombie" || e.kind === "wolf";
      const aggro =
        def.aggroRange *
        (e.aggroMult ?? 1) *
        (night && hunter ? NIGHT_AGGRO_MULT : 1);
      const speed =
        def.speed *
        (e.speedMult ?? 1) *
        (night && e.kind === "zombie" ? NIGHT_SPEED_MULT : 1);
      let target = e.targetSid ? this.players.get(e.targetSid) : undefined;
      // sight memory: refresh while the target is visible; hidden targets are
      // only hunted at their last-seen spot, and forgotten after a few seconds
      let seen = false;
      if (target && !target.dead && target.instanceId === inst.id) {
        seen = this.losClear(inst, e.x, e.y, target.x, target.y);
        if (seen) {
          e.lastSeenAt = now;
          e.lastSeenX = target.x;
          e.lastSeenY = target.y;
        }
      }
      if (
        !target ||
        target.dead ||
        target.instanceId !== inst.id ||
        this.isSafeAt(inst, target.x, target.y) ||
        now - e.lastSeenAt > LOS_MEMORY_MS || // you hid — it lost you
        Math.hypot(target.x - e.x, target.y - e.y) >
          Math.max(aggro * 1.6, e.enraged ? 480 : 0)
      ) {
        target = undefined;
        e.targetSid = null;
        let bestD = aggro;
        for (const p of this.players.values()) {
          if (
            p.dead ||
            p.instanceId !== inst.id ||
            this.isSafeAt(inst, p.x, p.y)
          )
            continue;
          const d = Math.hypot(p.x - e.x, p.y - e.y);
          // walls (and forest) break line of sight — you can hide
          if (d < bestD && this.losClear(inst, e.x, e.y, p.x, p.y)) {
            target = p;
            bestD = d;
          }
        }
        if (target) {
          e.targetSid = target.sid;
          seen = true;
          e.lastSeenAt = now;
          e.lastSeenX = target.x;
          e.lastSeenY = target.y;
        }
      }

      e.moving = false;
      if (target) {
        // chase the target where it was LAST SEEN — no tracking through walls
        const aimX = seen ? target.x : e.lastSeenX;
        const aimY = seen ? target.y : e.lastSeenY;
        const dx = aimX - e.x;
        const dy = aimY - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        e.angle = Math.atan2(dy, dx);

        // it searched your last-seen spot and found nothing — the trail is cold
        if (!seen && dist < 18 && now - e.lastSeenAt > LOS_GIVE_UP_MS) {
          e.targetSid = null;
          continue;
        }

        // wall-stuck safeguard: steer around obstacles instead of grinding into them
        const steer = (speed: number, dirX: number, dirY: number) => {
          if (now < e.detourUntil) {
            this.moveEntity(
              inst,
              e,
              Math.cos(e.detourAngle) * speed * dt,
              Math.sin(e.detourAngle) * speed * dt,
              ENEMY_RADIUS,
              BLOCKS_ENEMY,
            );
            e.moving = true;
            return;
          }
          const beforeX = e.x;
          const beforeY = e.y;
          this.moveEntity(
            inst,
            e,
            dirX * speed * dt,
            dirY * speed * dt,
            ENEMY_RADIUS,
            BLOCKS_ENEMY,
          );
          e.moving = true;
          const moved = Math.hypot(e.x - beforeX, e.y - beforeY);
          if (moved < speed * dt * 0.35) {
            e.detourAngle =
              Math.atan2(dirY, dirX) +
              (this.rnd() < 0.5 ? 1 : -1) * (Math.PI / 2 + this.rnd() * 0.6);
            e.detourUntil = now + 450 + this.rnd() * 350;
          }
        };
        const chase = (speed: number) => steer(speed, dx / dist, dy / dist);

        if (def.behavior === "flee") {
          // animals never fight — they bolt away from whoever spooked them
          e.angle = Math.atan2(-dy, -dx);
          steer(def.speed, -dx / dist, -dy / dist);
          continue;
        }

        if (def.behavior === "melee") {
          if (dist > def.attackRange - 4) {
            // reached the last-seen spot and still nothing? stand and sniff around
            if (!seen && dist < 18) {
              e.moving = false;
            } else chase(speed);
          } else if (seen && now >= e.nextAttackAt) {
            e.nextAttackAt = now + def.attackMs;
            e.lastAttackAt = now;
            const damage = Math.max(1, Math.round(def.damage * (e.damageMult ?? 1)));
            this.damagePlayer(target, damage, `a ${e.bossName ?? def.name}`, null, null);
            this.hitFx(inst, target.x, target.y, damage, "player");
          }
        } else {
          if (dist > def.attackRange) {
            chase(def.speed);
          } else if (seen && dist < 120) {
            this.moveEntity(
              inst,
              e,
              (-dx / dist) * def.speed * 0.7 * dt,
              (-dy / dist) * def.speed * 0.7 * dt,
              ENEMY_RADIUS,
              BLOCKS_ENEMY,
            );
            e.moving = true;
          }
          if (
            seen &&
            e.burstLeft <= 0 &&
            now >= e.nextAttackAt &&
            dist <= def.attackRange + 40
          ) {
            e.burstLeft = 3;
            e.nextAttackAt = now + def.attackMs + this.rnd() * 700;
          }
          if (e.burstLeft > 0 && now >= e.nextBurstShotAt) {
            e.burstLeft--;
            e.lastAttackAt = now;
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
              damage: Math.max(1, Math.round(def.damage * (e.damageMult ?? 1))),
              owner: e.id,
              ownerKind: e.kind,
              weapon: "rifle",
            });
          }
        }
      } else {
        const homeDist = Math.hypot(e.homeX - e.x, e.homeY - e.y);
        if (homeDist > 10 * TILE) {
          const a = Math.atan2(e.homeY - e.y, e.homeX - e.x);
          e.angle = a;
          this.moveEntity(
            inst,
            e,
            Math.cos(a) * def.speed * 0.6 * dt,
            Math.sin(a) * def.speed * 0.6 * dt,
            ENEMY_RADIUS,
            BLOCKS_ENEMY,
          );
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
              inst,
              e,
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

  private damageEnemy(
    inst: Instance,
    e: Enemy,
    dmg: number,
    attacker: ServerPlayer | null,
    ranged = false,
    projectile?: Projectile,
  ) {
    e.hp -= dmg;
    e.lastHitAt = Date.now();
    this.hitFx(inst, e.x, e.y, dmg, "enemy", undefined, undefined, projectile);
    if (attacker) {
      e.targetSid = attacker.sid;
      e.enraged = true; // neutral animals fight back (or bolt further) once hurt
      e.lastSeenAt = Date.now(); // pain tells it exactly where you are
      e.lastSeenX = attacker.x;
      e.lastSeenY = attacker.y;
      if (ranged) this.addXp(attacker, "shooting", dmg);
    }
    if (e.hp > 0) return;
    const death = {
      x: Math.round(e.x),
      y: Math.round(e.y),
      target: `mob:${e.kind}`,
      fallbackRow:
        e.kind === "zombie"
          ? 8
          : e.kind === "military"
            ? 9
            : e.kind === "deer"
              ? 11
              : e.kind === "rabbit"
                ? 12
                : e.kind === "boar"
                  ? 13
                  : e.kind === "wolf"
                    ? 14
                    : e.kind === "fox"
                      ? 15
                      : e.kind === "bear"
                        ? 16
                        : e.kind === "moose"
                          ? 17
                          : e.kind === "raccoon"
                            ? 18
                            : e.kind === "cougar"
                              ? 19
                        : 9,
    };
    for (const viewer of this.players.values()) {
      if (viewer.instanceId !== inst.id) continue;
      const visible =
        viewer.dead ||
        Math.hypot(e.x - viewer.x, e.y - viewer.y) < GameService.SENSE_RANGE ||
        this.losClear(inst, viewer.x, viewer.y, e.x, e.y);
      if (visible) this.emitTo(viewer.sid, EV.entityDeath, death);
    }
    inst.enemies.delete(e.id);
    if (attacker) {
      attacker.kills++;
      this.toast(attacker.sid, `☠ ${e.bossName ?? this.content.enemy(e.kind).name} down`);
      // kill-quest progress (locked quests don't tick — take them first)
      for (const def of this.quests) {
        if (
          def.kind !== "kill" ||
          def.target !== e.kind ||
          !this.questUnlocked(attacker, def)
        )
          continue;
        const prog = attacker.quests[def.id] ?? { kills: 0, claimed: false };
        if (!prog.claimed && prog.kills < def.count) {
          prog.kills++;
          attacker.quests[def.id] = prog;
          if (prog.kills === def.count)
            this.toast(attacker.sid, `Job done: ${def.name} — see the trader`);
        }
      }
      this.pushInventory(attacker);
    }
    const drops = e.eventId
      ? [
          ...rollNamed(
            this.rnd,
            this.content.enemyLootTable(e.kind),
            this.content.lootTables,
          ),
          ...rollChest(this.rnd, "rare", this.content.lootTables),
          ...rollChest(this.rnd, "rare", this.content.lootTables),
        ]
      : rollEnemyDrop(
          this.rnd,
          this.content.enemyLootTable(e.kind),
          this.content.lootTables,
        );
    if (drops.length > 0) {
      const id = `b${this.nextId++}`;
      inst.containers.set(id, {
        id,
        x: e.x,
        y: e.y,
        kind: "bag",
        tier: "normal",
        slots: drops,
        restockAt: null,
        expiresAt: droppedLootExpiresAt(Date.now()),
        ...(e.eventId ? { eventKind: "boss_reward" as const } : {}),
      });
      if (e.eventId)
        this.recordRandomEventLoot(drops, "random_event_boss_reward", e.eventId);
    }
    if (e.eventId) {
      const event = inst.randomEvents.get(e.eventId);
      inst.randomEvents.delete(e.eventId);
      if (event)
        this.io
          ?.to(inst.id)
          .emit(
            EV.toast,
            `${event.name} defeated${attacker ? ` by ${attacker.name}` : ""} - reward cache dropped`,
          );
    }
    this.nightHordeIds.delete(e.id);
    if (e.respawnMs > 0)
      inst.enemyRespawns.push({
        x: e.homeX,
        y: e.homeY,
        kind: e.kind,
        respawnMs: e.respawnMs,
        at: Date.now() + e.respawnMs + this.rnd() * 30_000,
      });
  }

  /** Straight-line sight check — walls, trees and rock block vision. */
  private losClear(
    inst: Instance,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 12);
    const sx = (x2 - x1) / steps;
    const sy = (y2 - y1) / steps;
    // skip the endpoints' own tiles so hugging a wall doesn't blind you
    let previousElevation = this.elevationUnder(inst, x1, y1);
    for (let s = 1; s <= steps; s++) {
      const tx = Math.floor((x1 + sx * s) / TILE);
      const ty = Math.floor((y1 + sy * s) / TILE);
      if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) return false;
      const elevation = inst.elevations[ty * inst.w + tx] ?? 0;
      if (Math.abs(elevation - previousElevation) > 1) return false;
      const index = ty * inst.w + tx;
      const blockId = inst.blockKinds[index];
      const block = blockId === undefined ? undefined : this.content.block(blockId);
      const openDoor = inst.openDoors.has(index);
      const tileBlocks =
        BLOCKS_BULLET[inst.tiles[index]] &&
        !(openDoor && inst.tiles[index] === Tile.Door);
      const blockBlocks =
        block?.collision.sight &&
        !(openDoor && block.playerPlacement?.buildType === "door");
      if (
        s < steps &&
        (tileBlocks ||
          blockBlocks ||
          this.terrainAtIndex(inst, index)?.collision.sight)
      )
        return false;
      previousElevation = elevation;
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
        const previousElevation = this.elevationUnder(inst, pr.x, pr.y);
        pr.x += sx;
        pr.y += sy;
        pr.traveled += Math.hypot(sx, sy);
        if (pr.traveled >= pr.range) {
          alive = false;
          break;
        }
        const tx = Math.floor(pr.x / TILE);
        const ty = Math.floor(pr.y / TILE);
        if (tx < 0 || ty < 0 || tx >= inst.w || ty >= inst.h) {
          alive = false;
          break;
        }
        if (
          Math.abs(
            (inst.elevations[ty * inst.w + tx] ?? 0) - previousElevation,
          ) > 1
        ) {
          alive = false;
          break;
        }
        const blockIndex = ty * inst.w + tx;
        const authoredBlock = this.content.block(
          inst.blockKinds[String(blockIndex)],
        );
        const openDoor = inst.openDoors.has(blockIndex);
        const tileBlocks =
          BLOCKS_BULLET[inst.tiles[blockIndex]] &&
          !(openDoor && inst.tiles[blockIndex] === Tile.Door);
        const blockBlocks =
          authoredBlock?.collision.bullets &&
          !(openDoor && authoredBlock.playerPlacement?.buildType === "door");
        if (
          tileBlocks ||
          blockBlocks ||
          this.terrainAtIndex(inst, blockIndex)?.collision.bullets
        ) {
          if (
            !this.damageStructure(inst, blockIndex, pr.damage) &&
            authoredBlock?.collision.bullets
          )
            this.damageWorldBlock(inst, blockIndex, pr.damage);
          alive = false;
          break;
        }
        for (const target of this.players.values()) {
          if (
            target.sid === pr.owner ||
            target.dead ||
            target.instanceId !== inst.id
          )
            continue;
          if (
            Math.hypot(target.x - pr.x, target.y - pr.y) <=
            PLAYER_RADIUS + 3
          ) {
            alive = false;
            if (!this.isSafeAt(inst, target.x, target.y)) {
              const shooter =
                pr.ownerKind === null ? this.players.get(pr.owner) : undefined;
              const enemyShooter =
                pr.ownerKind !== null ? inst.enemies.get(pr.owner) : undefined;
              const killerName = pr.ownerKind
                ? `a ${enemyShooter?.bossName ?? this.content.enemy(pr.ownerKind).name}`
                : (shooter?.name ?? "?");
              this.hitFx(
                inst,
                pr.x,
                pr.y,
                pr.damage,
                "player",
                undefined,
                undefined,
                pr,
              );
              this.damagePlayer(
                target,
                pr.damage,
                killerName,
                pr.weapon,
                shooter ?? null,
              );
            }
            break;
          }
        }
        if (!alive) break;
        for (const e of inst.enemies.values()) {
          if (e.id === pr.owner || e.kind === pr.ownerKind) continue;
          if (Math.hypot(e.x - pr.x, e.y - pr.y) <= ENEMY_RADIUS + 3) {
            alive = false;
            const shooter =
              pr.ownerKind === null ? this.players.get(pr.owner) : undefined;
            this.damageEnemy(inst, e, pr.damage, shooter ?? null, true, pr);
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
    if (target.dead || (target.admin && target.adminMode)) return;
    if (actionInterruptedByDamage(Boolean(target.action), dmg)) {
      target.action = null;
      this.emitTo(target.sid, EV.action, {
        label: "",
        ms: 0,
      } satisfies ActionSnap);
      this.toast(target.sid, "Action interrupted by damage");
    }
    const mitigated = Math.max(
      1,
      Math.round(dmg * armorMultiplier(target.equipment, this.content.items)),
    );
    // armor soaks the hit and wears down for it
    if (target.equipment.helmet) this.wearArmor(target, "helmet");
    if (target.equipment.vest) this.wearArmor(target, "vest");
    target.hp -= mitigated;
    target.lastHitAt = Date.now();
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
    const dropped = collectCarriedDrops(
      target.inv,
      target.equipment,
      target.armorDur,
      this.content.items,
    );
    if (dropped.length > 0) {
      const id = `b${this.nextId++}`;
      inst.containers.set(id, {
        id,
        x: target.x,
        y: target.y,
        kind: "bag",
        tier: "normal",
        slots: dropped,
        restockAt: null,
        expiresAt: droppedLootExpiresAt(Date.now()),
      });
    }
    if (this.isBot(target)) {
      this.telemetry.record({
        kind: "bot_contribution",
        value: dropped.reduce(
          (value, slot) =>
            value + this.content.estimatedItemValue(slot.id) * slot.qty,
          0,
        ),
        credits: target.money,
        source: "bot_death",
        metadata: { bot: target.name, droppedStacks: dropped.length },
      });
    }
    target.inv = this.starterInventory();
    target.equipment = { helmet: null, vest: null, mod: null };
    target.armorDur = {};
    target.equipped = null;
    target.mags = {};
    this.pushInventory(target);
    this.emitTo(target.sid, EV.death, { by: killerName });
    this.io?.emit(EV.killfeed, {
      killer: killerName,
      victim: target.name,
      weapon,
    });
    void this.saveProfileOf(target);
  }

  // ── output ────────────────────────────────────────────────────────────────

  private hitFx(
    inst: Instance,
    x: number,
    y: number,
    amount: number,
    kind: HitSnap["kind"],
    material?: "wood" | "stone",
    soundId?: string,
    projectile?: Projectile,
  ) {
    const payload: HitSnap = {
      x: Math.round(x),
      y: Math.round(y),
      amount,
      kind,
    };
    if (material) payload.material = material;
    if (soundId) payload.soundId = soundId;
    if (projectile) {
      payload.projectileId = projectile.id;
      payload.projectileAngle = projectile.angle;
    }
    this.io?.to(inst.id).emit(EV.hit, payload);
  }

  /** How far you can sense entities even without direct sight (footsteps, rustling). */
  private static readonly SENSE_RANGE = 130;

  private broadcast(inst: Instance, now: number) {
    if (!this.io) return;
    if (inst.players <= 0) return;
    const allPlayers: StateSnap["players"] = [];
    for (const p of this.players.values()) {
      if (p.instanceId !== inst.id) continue;
      allPlayers.push({
        id: p.sid,
        name: p.name,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 100) / 100,
        facing: Math.round(p.facing * 100) / 100,
        hp: p.hp,
        maxHp: PLAYER_MAX_HP,
        weapon:
          p.equipped !== null && p.inv.slots[p.equipped]
            ? p.inv.slots[p.equipped]!.id
            : null,
        helmet: p.equipment.helmet,
        vest: p.equipment.vest,
        dead: p.dead,
        moving: p.moving,
        swing: now - p.lastSwingAt < 400 ? p.lastSwingAt : 0,
        attackAt: now - p.lastAttackAt < 1000 ? p.lastAttackAt : 0,
        look: p.appearance.outfit,
        appearance: p.appearance,
        hitAt: now - p.lastHitAt < 1000 ? p.lastHitAt : 0,
        admin: p.admin,
        guest: p.guest,
        ack: p.lastInputSeq,
      });
    }
    const allEnemies: StateSnap["enemies"] = [...inst.enemies.values()].map(
      (e) => ({
        id: e.id,
        kind: e.kind,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        angle: Math.round(e.angle * 100) / 100,
        hp: e.hp,
        maxHp: e.maxHp,
        moving: e.moving,
        attackAt: now - e.lastAttackAt < 1000 ? e.lastAttackAt : 0,
        hitAt: now - e.lastHitAt < 1000 ? e.lastHitAt : 0,
        ...(e.eventId && e.bossName
          ? { boss: { eventId: e.eventId, name: e.bossName } }
          : {}),
      }),
    );
    const base = {
      t: now,
      day: (now % DAY_LENGTH_MS) / DAY_LENGTH_MS,
      population: allPlayers.length,
      events: [...inst.randomEvents.values()].map((event) => ({
        id: event.id,
        type: event.type,
        name: event.name,
        x: event.x,
        y: event.y,
        radius: event.radius,
        startedAt: event.startedAt,
        expiresAt: event.expiresAt,
      })),
    };
    const allProjectiles = inst.projectiles.map((pr) => ({
      id: pr.id,
      x: Math.round(pr.x),
      y: Math.round(pr.y),
      vx: pr.vx,
      vy: pr.vy,
      angle: pr.angle,
    }));
    const allContainers = [...inst.containers.values()].map(
      (c): ContainerSnap => ({
        id: c.id,
        x: c.x,
        y: c.y,
        kind: c.kind,
        looted: c.slots.every((s) => !s),
        ...(c.eventKind ? { event: c.eventKind } : {}),
      }),
    );
    const allGround = [...inst.ground.values()].map(
      (g): GroundItemSnap => ({
        id: g.id,
        x: Math.round(g.x),
        y: Math.round(g.y),
        item: g.item,
        qty: g.qty,
        ...(g.dur !== undefined ? { dur: g.dur } : {}),
      }),
    );
    if (inst.kind !== "world") {
      // your own camp: nothing to hide
      this.io.to(inst.id).volatile.emit(EV.state, {
        ...base,
        players: allPlayers,
        mapPlayers: [],
        enemies: allEnemies,
        projectiles: allProjectiles,
        containers: allContainers,
        ground: allGround,
      } satisfies StateSnap);
      return;
    }
    // per-viewer snapshots: walls (and forest) hide other players, NPCs and enemies
    const senseRangeSq = GameService.SENSE_RANGE * GameService.SENSE_RANGE;
    const viewRangeSq = SNAPSHOT_VIEW_RANGE * SNAPSHOT_VIEW_RANGE;
    for (const viewer of this.players.values()) {
      if (viewer.instanceId !== inst.id) continue;
      // Entities cluster on tiles and LOS is tile-resolution anyway, so one
      // raycast per target tile serves every entity standing on it. This is
      // the tick's hottest loop (viewers × entities × ray steps at 20 Hz).
      const losByTile = new Map<number, boolean>();
      const sees = (x: number, y: number) => {
        if (viewer.dead || (viewer.admin && viewer.adminMode)) return true;
        const dx = x - viewer.x;
        const dy = y - viewer.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < senseRangeSq) return true;
        if (distanceSq >= viewRangeSq) return false;
        const tileKey =
          Math.floor(y / TILE) * inst.w + Math.floor(x / TILE);
        let clear = losByTile.get(tileKey);
        if (clear === undefined) {
          clear = this.losClear(inst, viewer.x, viewer.y, x, y);
          losByTile.set(tileKey, clear);
        }
        return clear;
      };
      const snap: StateSnap = {
        ...base,
        players: allPlayers.filter(
          (s) => s.id === viewer.sid || sees(s.x, s.y),
        ),
        mapPlayers: allPlayers.flatMap((snapshot) => {
          if (snapshot.id === viewer.sid) return [];
          const other = this.players.get(snapshot.id);
          if (!other || other.dead || this.isBot(other)) return [];
          const sameClan = Boolean(
            viewer.clanId && other.clanId === viewer.clanId,
          );
          const isFriend = viewer.friendUserIds.has(other.userId);
          const adminTracking = viewer.admin && viewer.adminMode;
          if (!adminTracking && !sameClan && !isFriend) return [];
          return [
            {
              id: snapshot.id,
              name: snapshot.name,
              x: snapshot.x,
              y: snapshot.y,
              relation: sameClan
                ? ("clan" as const)
                : isFriend
                  ? ("friend" as const)
                  : ("admin" as const),
            },
          ];
        }),
        enemies: allEnemies.filter((s) => sees(s.x, s.y)),
        projectiles: allProjectiles.filter((s) => sees(s.x, s.y)),
        containers: allContainers.filter((s) => sees(s.x, s.y)),
        ground: allGround.filter((s) => sees(s.x, s.y)),
      };
      this.io.to(viewer.sid).volatile.emit(EV.state, snap);
    }
  }

  private pushInventory(p: ServerPlayer) {
    // never hold an empty slot (e.g. after finishing a stack of food in hand)
    if (p.equipped !== null && !p.inv.slots[p.equipped]) p.equipped = null;
    const eqSlot = p.equipped !== null ? p.inv.slots[p.equipped] : null;
    const mag =
      eqSlot && this.content.item(eqSlot.id).weapon
        ? (p.mags[eqSlot.id] ?? 0)
        : 0;
    this.emitTo(p.sid, EV.inventory, {
      inv: p.inv,
      equipped: p.equipped,
      equipment: p.equipment,
      armorDur: p.armorDur,
      hp: p.hp,
      kills: p.kills,
      deaths: p.deaths,
      money: p.money,
      skills: p.skills,
      quests: this.trackedQuests(p),
      mag,
      reloading: !!p.reloadTarget,
      nearWorkbench: this.nearStation(p, "workbench"),
      nearFirepit: this.nearStation(p, "firepit"),
      nearFurnace: this.nearStation(p, "furnace"),
      nearAnvil: this.nearStation(p, "anvil"),
      nearWater: this.nearTile(p, Tile.Water),
      hunger: Math.round(p.hunger),
      thirst: Math.round(p.thirst),
      stamina: Math.round(p.stamina),
      staminaExhausted: p.staminaExhausted,
      look: p.appearance.outfit,
      appearance: p.appearance,
    });
  }

  private toast(sid: string, msg: string) {
    this.emitTo(sid, EV.toast, msg);
  }

  private emitTo(sid: string, ev: string, payload: unknown) {
    this.io?.to(sid).emit(ev, payload);
  }

  private async saveAll() {
    const world = this.instances.get(WORLD);
    await Promise.all([
      ...[...this.players.values()].map((p) => this.saveProfileOf(p)),
      ...[...this.instances.values()].flatMap((instance) =>
        instance.clanId && instance.players > 0
          ? [this.db.renewClanHideoutLease(instance.clanId)]
          : [],
      ),
      world ? this.persistWorldState(world) : Promise.resolve(),
    ]);
  }

  private async renewPlayerLeases() {
    await Promise.all(
      [...this.players.values()].flatMap((player) => {
        if (
          this.isBot(player) ||
          player.guest ||
          this.exitingPlayers.has(player.sid)
        )
          return [];
        return [
          this.db
            .renewPlayerWorldLease(
              player.userId,
              player.sid,
              PLAYER_LEASE_TTL_SECONDS,
            )
            .then(async (renewed) => {
              if (renewed) return;
              // A successful query that updates nothing means another simulation
              // owns this survivor. Discard this stale in-memory copy immediately.
              this.telemetry.record({
                kind: "profile_lease_conflict",
                userId: player.userId,
                source: "lease_heartbeat",
                metadata: { serverKey: this.db.serverStateKey },
              });
              this.toast(
                player.sid,
                "Your survivor became active on another relay",
              );
              await this.evictPersonalHideoutVisitors(player.userId);
              this.finalizePlayerExit(player);
              this.io?.sockets.sockets.get(player.sid)?.disconnect(true);
            })
            .catch((error) => {
              // A transient database outage is not proof that ownership changed.
              // Guarded profile writes still prevent stale progress from committing.
              this.log.warn(
                `Player lease heartbeat unavailable: ${(error as Error).message}`,
              );
            }),
        ];
      }),
    );
  }

  runtimeStats() {
    const players = [...this.players.values()];
    const world = this.instances.get(WORLD);
    const memory = process.memoryUsage();
    return {
      players: players.filter((player) => !this.isBot(player)).length,
      guests: players.filter((player) => !this.isBot(player) && player.guest)
        .length,
      registeredPlayers: players.filter(
        (player) => !this.isBot(player) && !player.guest,
      ).length,
      bots: players.filter((player) => this.isBot(player)).length,
      capacity: MAX_PLAYERS_PER_SERVER,
      instances: this.instances.size,
      worldEnemies: world?.enemies.size ?? 0,
      worldContainers: world?.containers.size ?? 0,
      worldGroundItems: world?.ground.size ?? 0,
      activeMapId: this.activeMapId,
      activeMapVersion: this.activeMapVersion || null,
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      },
    };
  }
}
