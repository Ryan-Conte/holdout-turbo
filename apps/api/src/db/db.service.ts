import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AUTHORED_MAP_MAX_SIZE, AUTHORED_MAP_MIN_SIZE, AuthoredMap, BuildType, CharacterAppearance, EMPTY_SKILLS, Equipment, InvSlot, Inventory, QuestDef, Skills, isCompleteByteRuns, sanitizeCharacterAppearance } from '@holdout/shared';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface QuestProg {
  kills: number;
  claimed: boolean;
}

export interface ProfileRow {
  inventory: Inventory;
  equipment: Equipment;
  skills: Skills;
  quests: Record<string, QuestProg>;
  money: number;
  kills: number;
  deaths: number;
  hunger: number;
  thirst: number;
  armorDur: Partial<Record<'helmet' | 'vest', number>>;
  appearance: CharacterAppearance;
}

export interface HideoutData {
  storage: InvSlot[];
  objects: { type: BuildType; tx: number; ty: number; rotation?: number; slots?: InvSlot[] }[];
}

interface PublishedContentCache {
  manifest: Record<string, string>;
  docs: Record<string, unknown>;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');
  private prisma: PrismaClient;
  private readonly runtimeCacheDir = process.env.RUNTIME_CACHE_DIR?.trim() || join(tmpdir(), 'holdout-runtime-cache');
  private mapCache: { id: number; data: AuthoredMap } | null | undefined;
  private contentCache: PublishedContentCache | null | undefined;
  private readonly lastErrorLog = new Map<string, number>();
  private databasePollFailures = 0;
  private databasePollBackoffUntil = 0;

  async onModuleInit() {
    this.prisma = new PrismaClient();
    await mkdir(this.runtimeCacheDir, { recursive: true }).catch(() => undefined);
    try {
      await this.prisma.$connect();
      this.log.log('Prisma connected to Neon');
      await this.registerPublicServer();
    } catch (error) {
      this.pauseDatabasePolling();
      this.log.error(`Prisma unavailable; starting from runtime cache/fallbacks: ${(error as Error).message}`);
    }
  }

  private cachePath(name: 'map' | 'content') {
    return join(this.runtimeCacheDir, `${name}.json`);
  }

  private async readCacheFile<T>(name: 'map' | 'content'): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.cachePath(name), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn(`Runtime ${name} cache could not be read: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeCacheFile(name: 'map' | 'content', value: unknown) {
    const target = this.cachePath(name);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await mkdir(this.runtimeCacheDir, { recursive: true });
      await writeFile(temporary, JSON.stringify(value), 'utf8');
      await rename(temporary, target);
    } catch (error) {
      this.log.warn(`Runtime ${name} cache could not be written: ${(error as Error).message}`);
    }
  }

  private logQueryError(scope: string, error: unknown) {
    const now = Date.now();
    if (now - (this.lastErrorLog.get(scope) ?? 0) < 60_000) return;
    this.lastErrorLog.set(scope, now);
    this.log.error(`${scope}: ${(error as Error).message}`);
  }

  private databasePollingPaused() {
    return Date.now() < this.databasePollBackoffUntil;
  }

  private pauseDatabasePolling() {
    this.databasePollFailures++;
    const delay = Math.min(300_000, 30_000 * 2 ** Math.min(4, this.databasePollFailures - 1));
    this.databasePollBackoffUntil = Date.now() + delay;
  }

  private recordDatabasePollFailure(scope: string, error: unknown) {
    this.pauseDatabasePolling();
    this.logQueryError(scope, error);
  }

  private recordDatabasePollSuccess() {
    this.databasePollFailures = 0;
    this.databasePollBackoffUntil = 0;
  }

  private async registerPublicServer() {
    const url = (process.env.PUBLIC_SERVER_URL ?? '').trim().replace(/\/$/, '');
    if (!/^https:\/\//i.test(url)) return;
    const name = (process.env.SERVER_NAME ?? 'HOLDOUT Server').trim().slice(0, 40);
    const region = (process.env.SERVER_REGION ?? 'global').trim().slice(0, 20);
    const sort = Number(process.env.SERVER_SORT ?? 100) | 0;
    try {
      const existing = await this.prisma.gameServer.findFirst({ where: { url } });
      if (existing) {
        this.log.log(`Public game server already registered as ${existing.name} (${url})`);
      } else {
        await this.prisma.gameServer.create({ data: { name, region, url, sort, active: true } });
        this.log.log(`Registered public game server ${name} (${url})`);
      }
    } catch (error) {
      this.log.error(`Public server registration failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.prisma?.$disconnect();
  }

  async loadProfile(userId: string): Promise<ProfileRow | null> {
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    if (!row) return null;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const inv = data.inv as Inventory | undefined;
    if (!inv || !Array.isArray(inv.slots)) return null;
    const eq = (data.equipment ?? {}) as Partial<Equipment>;
    return {
      inventory: inv,
      equipment: { helmet: eq.helmet ?? null, vest: eq.vest ?? null, mod: eq.mod ?? null },
      skills: { ...EMPTY_SKILLS, ...((data.skills ?? {}) as Partial<Skills>) },
      quests: (data.quests ?? {}) as Record<string, QuestProg>,
      money: row.money,
      kills: row.kills,
      deaths: row.deaths,
      hunger: typeof data.hunger === 'number' ? data.hunger : 100,
      thirst: typeof data.thirst === 'number' ? data.thirst : 100,
      armorDur: (data.armorDur ?? {}) as Partial<Record<'helmet' | 'vest', number>>,
      appearance: sanitizeCharacterAppearance(data.appearance, typeof data.look === 'number' ? data.look : 0),
    };
  }

  async loadAppearance(userId: string): Promise<CharacterAppearance> {
    const row = await this.prisma.profile.findUnique({ where: { userId }, select: { data: true } });
    const data = (row?.data ?? {}) as Record<string, unknown>;
    return sanitizeCharacterAppearance(data.appearance, typeof data.look === 'number' ? data.look : 0);
  }

  async saveProfile(
    userId: string,
    inv: Inventory,
    equipment: Equipment,
    skills: Skills,
    quests: Record<string, QuestProg>,
    money: number,
    kills: number,
    deaths: number,
    hunger: number,
    thirst: number,
    armorDur: Partial<Record<'helmet' | 'vest', number>> = {},
    appearance: CharacterAppearance,
  ) {
    const cleanAppearance = sanitizeCharacterAppearance(appearance);
    const gameplayData = JSON.stringify({ inv, equipment, skills, quests, hunger, thirst, armorDur });
    const initialData = JSON.stringify({
      inv, equipment, skills, quests, hunger, thirst, armorDur,
      appearance: cleanAppearance,
      look: cleanAppearance.outfit,
    });
    try {
      // Gameplay and web appearance writes can race; merge only the fields this
      // server owns so a lingering combat-log body cannot restore an old look.
      await this.prisma.$executeRaw`
        INSERT INTO "profiles" ("user_id", "data", "money", "kills", "deaths", "updated_at")
        VALUES (${userId}, CAST(${initialData} AS jsonb), ${money}, ${kills}, ${deaths}, CURRENT_TIMESTAMP)
        ON CONFLICT ("user_id") DO UPDATE SET
          "data" = COALESCE("profiles"."data", '{}'::jsonb) || CAST(${gameplayData} AS jsonb),
          "money" = EXCLUDED."money",
          "kills" = EXCLUDED."kills",
          "deaths" = EXCLUDED."deaths",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    } catch (err) {
      this.log.error(`saveProfile ${userId}: ${(err as Error).message}`);
    }
  }

  async saveAppearance(userId: string, appearance: CharacterAppearance) {
    const cleanAppearance = sanitizeCharacterAppearance(appearance);
    const patch = JSON.stringify({ appearance: cleanAppearance, look: cleanAppearance.outfit });
    await this.prisma.$executeRaw`
      INSERT INTO "profiles" ("user_id", "data", "updated_at")
      VALUES (${userId}, CAST(${patch} AS jsonb), CURRENT_TIMESTAMP)
      ON CONFLICT ("user_id") DO UPDATE SET
        "data" = COALESCE("profiles"."data", '{}'::jsonb) || CAST(${patch} AS jsonb),
        "updated_at" = CURRENT_TIMESTAMP
    `;
  }

  async loadHideout(userId: string): Promise<HideoutData> {
    const row = await this.prisma.profile.findUnique({ where: { userId }, select: { hideout: true } });
    const h = (row?.hideout ?? {}) as Partial<HideoutData>;
    return {
      storage: Array.isArray(h.storage) ? h.storage : [],
      objects: Array.isArray(h.objects) ? h.objects : [],
    };
  }

  async saveHideout(userId: string, hideout: HideoutData) {
    try {
      await this.prisma.profile.upsert({
        where: { userId },
        create: { userId, data: { inv: { backpack: 0, slots: [] } }, hideout: hideout as object },
        update: { hideout: hideout as object, updatedAt: new Date() },
      });
    } catch (err) {
      this.log.error(`saveHideout ${userId}: ${(err as Error).message}`);
    }
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friend.findFirst({
      where: { userId: a, friendId: b, status: 'accepted' },
      select: { userId: true },
    });
    return !!row;
  }

  async loadActiveMap(): Promise<AuthoredMap | null> {
    return (await this.loadActiveMapRevision())?.data ?? null;
  }

  private validMapRevision(value: unknown): { id: number; data: AuthoredMap } | null {
    const row = value as { id?: unknown; data?: unknown } | null;
    const id = Number(row?.id) | 0;
    const data = row?.data as AuthoredMap | undefined;
    const w = Number(data?.w) | 0;
    const h = Number(data?.h) | 0;
    const cellCount = w * h;
    const validDimensions = w >= AUTHORED_MAP_MIN_SIZE && h >= AUTHORED_MAP_MIN_SIZE
      && w <= AUTHORED_MAP_MAX_SIZE && h <= AUTHORED_MAP_MAX_SIZE;
    const hasDenseTiles = Array.isArray(data?.tiles) && data.tiles.length === cellCount;
    return id > 0 && data && validDimensions && Array.isArray(data.objects) && (hasDenseTiles || isCompleteByteRuns(data.tileRuns, cellCount))
      ? { id, data }
      : null;
  }

  private async loadCachedMapRevision() {
    if (this.mapCache !== undefined) return this.mapCache;
    this.mapCache = this.validMapRevision(await this.readCacheFile('map'));
    return this.mapCache;
  }

  private async cacheMapRevision(revision: { id: number; data: AuthoredMap }) {
    this.mapCache = revision;
    await this.writeCacheFile('map', revision);
  }

  async loadActiveMapRevisionId(): Promise<number | null> {
    if (this.databasePollingPaused()) return (await this.loadCachedMapRevision())?.id ?? null;
    try {
      const row = await this.prisma.gameMap.findFirst({
        where: { active: true, draft: false },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      this.recordDatabasePollSuccess();
      return row?.id ?? null;
    } catch (err) {
      this.recordDatabasePollFailure('loadActiveMapRevisionId', err);
      return (await this.loadCachedMapRevision())?.id ?? null;
    }
  }

  async loadActiveMapRevision(): Promise<{ id: number; data: AuthoredMap } | null> {
    if (this.databasePollingPaused()) {
      const cached = await this.loadCachedMapRevision();
      if (cached) this.log.warn(`Restored authored map #${cached.id} from ${this.cachePath('map')}`);
      return cached;
    }
    try {
      const row = await this.prisma.gameMap.findFirst({
        where: { active: true, draft: false },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, data: true },
      });
      this.recordDatabasePollSuccess();
      const revision = this.validMapRevision(row);
      if (revision) await this.cacheMapRevision(revision);
      return revision;
    } catch (err) {
      this.recordDatabasePollFailure('loadActiveMapRevision', err);
      const cached = await this.loadCachedMapRevision();
      if (cached) this.log.warn(`Restored authored map #${cached.id} from ${this.cachePath('map')}`);
      return cached;
    }
  }

  async loadMapRevision(id: number): Promise<{ id: number; data: AuthoredMap } | null> {
    if (this.databasePollingPaused()) {
      const cached = await this.loadCachedMapRevision();
      return cached?.id === id ? cached : null;
    }
    try {
      const row = await this.prisma.gameMap.findUnique({ where: { id }, select: { id: true, data: true } });
      this.recordDatabasePollSuccess();
      const revision = this.validMapRevision(row);
      if (revision) await this.cacheMapRevision(revision);
      return revision;
    } catch (err) {
      this.recordDatabasePollFailure(`loadMapRevision ${id}`, err);
      const cached = await this.loadCachedMapRevision();
      return cached?.id === id ? cached : null;
    }
  }

  async loadPublishedContentManifest(kinds: string[]): Promise<Record<string, string> | null> {
    if (this.databasePollingPaused()) return (await this.loadPublishedContentCache())?.manifest ?? null;
    try {
      const rows = await this.prisma.gameContent.findMany({
        where: { kind: { in: kinds } },
        select: { kind: true, publishedRevision: true, publishedAt: true },
      });
      this.recordDatabasePollSuccess();
      return Object.fromEntries(rows.map((row) => [
        row.kind,
        `${row.publishedRevision}:${row.publishedAt?.getTime() ?? 0}`,
      ]));
    } catch (err) {
      this.recordDatabasePollFailure('loadPublishedContentManifest', err);
      return (await this.loadPublishedContentCache())?.manifest ?? null;
    }
  }

  async loadPublishedContent(kinds: string[]): Promise<Record<string, unknown> | null> {
    if (this.databasePollingPaused()) return null;
    try {
      const rows = await this.prisma.gameContent.findMany({
        where: { kind: { in: kinds } },
        select: { kind: true, published: true },
      });
      this.recordDatabasePollSuccess();
      return Object.fromEntries(rows.filter((row) => row.published !== null).map((row) => [row.kind, row.published]));
    } catch (err) {
      this.recordDatabasePollFailure('loadPublishedContent', err);
      return null;
    }
  }

  async loadPublishedContentCache(): Promise<PublishedContentCache | null> {
    if (this.contentCache !== undefined) return this.contentCache;
    const value = await this.readCacheFile<PublishedContentCache>('content');
    this.contentCache = value
      && value.manifest && typeof value.manifest === 'object' && !Array.isArray(value.manifest)
      && value.docs && typeof value.docs === 'object' && !Array.isArray(value.docs)
      ? value
      : null;
    return this.contentCache;
  }

  async savePublishedContentCache(manifest: Record<string, string>, docs: Record<string, unknown>) {
    this.contentCache = { manifest: { ...manifest }, docs: { ...docs } };
    await this.writeCacheFile('content', this.contentCache);
  }

  async loadQuests(): Promise<QuestDef[]> {
    if (this.databasePollingPaused()) return [];
    try {
      const rows = await this.prisma.quest.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
      this.recordDatabasePollSuccess();
      return rows.map((q) => ({
        id: q.id,
        name: q.name,
        desc: q.desc,
        kind: q.kind === 'fetch' ? 'fetch' : 'kill',
        target: q.target,
        count: q.count,
        rewardMoney: q.rewardMoney,
        rewardItem: (q.rewardItem as QuestDef['rewardItem']) ?? null,
        rewardQty: q.rewardQty,
        requires: q.requiresId ?? null,
        tier: q.tier === 2 ? 2 : 1,
      }));
    } catch (err) {
      this.recordDatabasePollFailure('loadQuests', err);
      return [];
    }
  }
}
