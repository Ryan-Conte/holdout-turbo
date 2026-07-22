import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AUTHORED_MAP_MAX_SIZE, AUTHORED_MAP_MIN_SIZE, AuthoredMap, BuildType, CharacterAppearance, EMPTY_SKILLS, Equipment, InvSlot, Inventory, ItemId, QuestDef, Skills, isCompleteByteRuns, sanitizeCharacterAppearance } from '@holdout/shared';
import { createHash } from 'node:crypto';
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
  mags: Partial<Record<ItemId, number>>;
  appearance: CharacterAppearance;
}

export interface PlayerAccess {
  admin: boolean;
  mutedUntil: number;
  muteReason: string;
  bannedUntil: number;
  banReason: string;
}

export interface ActiveModerationRecord {
  userId: string;
  name: string;
  mutedUntil: number;
  muteReason: string;
  bannedUntil: number;
  banReason: string;
}

export interface HideoutData {
  storage: InvSlot[];
  objects: { type: BuildType; tx: number; ty: number; rotation?: number; slots?: InvSlot[]; fuel?: number }[];
}

export type ClanRank = 'owner' | 'officer' | 'member';

export interface PlayerSocialAccess {
  friendIds: string[];
  clan: { id: string; name: string; tag: string; rank: ClanRank } | null;
  clanMateIds: string[];
}

export type ClanTreasuryTransferResult =
  | { ok: true; money: number; treasury: number }
  | { ok: false; reason: 'not_member' | 'forbidden' | 'insufficient_credits' | 'insufficient_treasury' | 'stale_lease' | 'unavailable' };

export interface PersistedWorldState {
  mapId: number | null;
  seed: number;
  nodeHits: [number, number][];
  nodeRespawns: {
    i: number;
    at: number;
    family: 'tree' | 'rock';
    depletedTile: number;
    baseTile: number;
    baseResourceId: string;
  }[];
  nodeVariants: {
    i: number;
    tile: number;
    resourceId: string;
    baseTile: number;
    baseResourceId: string;
  }[];
}

interface PublishedContentCache {
  manifest: Record<string, string>;
  docs: Record<string, unknown>;
}

export interface TelemetryEventWrite {
  kind: string;
  userId?: string;
  itemId?: string;
  quantity: number;
  credits: number;
  value: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');
  private prisma: PrismaClient;
  private readonly runtimeCacheDir = process.env.RUNTIME_CACHE_DIR?.trim() || join(tmpdir(), 'holdout-runtime-cache');
  private readonly contentChannel: 'live' | 'staging' = process.env.CONTENT_CHANNEL?.trim().toLowerCase() === 'staging' ? 'staging' : 'live';
  private readonly worldStateKey = (
    [process.env.SERVER_STATE_KEY, process.env.PUBLIC_SERVER_URL, process.env.RENDER_EXTERNAL_URL]
      .map((value) => value?.trim()).find(Boolean)
    ?? `${process.env.SERVER_NAME ?? 'Local'}:${process.env.SERVER_REGION ?? 'local'}`
  ).replace(/\/$/, '').concat(this.contentChannel === 'staging' ? ':staging' : '').slice(0, 240);
  private readonly worldCacheFile = `world-state-${createHash('sha256').update(this.worldStateKey).digest('hex').slice(0, 12)}.json`;
  private mapCache: { id: number; data: AuthoredMap } | null | undefined;
  private contentCache: PublishedContentCache | null | undefined;
  private worldStateCache: PersistedWorldState | null | undefined;
  private readonly lastErrorLog = new Map<string, number>();
  private databasePollFailures = 0;
  private databasePollBackoffUntil = 0;

  get stagingContent(): boolean {
    return this.contentChannel === 'staging';
  }

  get serverStateKey(): string {
    return this.worldStateKey;
  }

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

  private cachePath(name: 'map' | 'content' | 'world-state') {
    return join(this.runtimeCacheDir, name === 'world-state' ? this.worldCacheFile : `${name}${this.contentChannel === 'staging' ? '-staging' : ''}.json`);
  }

  private async readCacheFile<T>(name: 'map' | 'content' | 'world-state'): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.cachePath(name), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn(`Runtime ${name} cache could not be read: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeCacheFile(name: 'map' | 'content' | 'world-state', value: unknown) {
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

  async writeTelemetryEvents(events: TelemetryEventWrite[]): Promise<boolean> {
    if (!events.length || this.databasePollingPaused()) return false;
    try {
      await this.prisma.gameTelemetryEvent.createMany({
        data: events.map((event) => ({
          serverKey: this.worldStateKey,
          userId: event.userId,
          kind: event.kind,
          itemId: event.itemId,
          quantity: event.quantity,
          credits: event.credits,
          value: event.value,
          source: event.source,
          metadata: event.metadata as object | undefined,
        })),
      });
      return true;
    } catch (error) {
      this.logQueryError('writeTelemetryEvents', error);
      return false;
    }
  }

  private async registerPublicServer() {
    if (this.contentChannel === 'staging' && process.env.REGISTER_STAGING_SERVER !== 'true') return;
    const url = (process.env.PUBLIC_SERVER_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').trim().replace(/\/$/, '');
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
      mags: this.sanitizeMags(data.mags),
      appearance: sanitizeCharacterAppearance(data.appearance, typeof data.look === 'number' ? data.look : 0),
    };
  }

  async loadPlayerAccess(userId: string): Promise<PlayerAccess> {
    const row = await this.prisma.profile.findUnique({
      where: { userId },
      select: { admin: true, mutedUntil: true, muteReason: true, bannedUntil: true, banReason: true },
    });
    return {
      admin: row?.admin === true,
      mutedUntil: row?.mutedUntil?.getTime() ?? 0,
      muteReason: row?.muteReason ?? '',
      bannedUntil: row?.bannedUntil?.getTime() ?? 0,
      banReason: row?.banReason ?? '',
    };
  }

  async listActiveModeration(limit = 100): Promise<ActiveModerationRecord[]> {
    const take = Math.max(1, Math.min(250, Math.floor(limit)));
    const rows = await this.prisma.$queryRaw<Array<{
      userId: string;
      name: string;
      mutedUntil: Date | null;
      muteReason: string | null;
      bannedUntil: Date | null;
      banReason: string | null;
    }>>`
      SELECT
        p."user_id" AS "userId",
        u."name" AS "name",
        p."muted_until" AS "mutedUntil",
        p."mute_reason" AS "muteReason",
        p."banned_until" AS "bannedUntil",
        p."ban_reason" AS "banReason"
      FROM "profiles" p
      JOIN "user" u ON u."id" = p."user_id"
      WHERE p."muted_until" > CURRENT_TIMESTAMP
         OR p."banned_until" > CURRENT_TIMESTAMP
      ORDER BY GREATEST(
        COALESCE(p."banned_until", TIMESTAMPTZ 'epoch'),
        COALESCE(p."muted_until", TIMESTAMPTZ 'epoch')
      ) DESC
      LIMIT ${take}
    `;
    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      mutedUntil: row.mutedUntil?.getTime() ?? 0,
      muteReason: row.muteReason ?? '',
      bannedUntil: row.bannedUntil?.getTime() ?? 0,
      banReason: row.banReason ?? '',
    }));
  }

  /** Apply a durable sanction only while the actor is still an admin. */
  async setPlayerSanction(
    actorUserId: string,
    targetUserId: string,
    kind: 'mute' | 'ban',
    until: Date,
    reason: string,
  ): Promise<boolean> {
    const rows = kind === 'mute'
      ? await this.prisma.$queryRaw<Array<{ userId: string }>>`
          UPDATE "profiles" AS target
          SET "muted_until" = ${until},
              "mute_reason" = ${reason},
              "moderated_by" = ${actorUserId},
              "updated_at" = CURRENT_TIMESTAMP
          WHERE target."user_id" = ${targetUserId}
            AND target."admin" = FALSE
            AND EXISTS (
              SELECT 1 FROM "profiles" actor
              WHERE actor."user_id" = ${actorUserId} AND actor."admin" = TRUE
            )
          RETURNING target."user_id" AS "userId"
        `
      : await this.prisma.$queryRaw<Array<{ userId: string }>>`
          UPDATE "profiles" AS target
          SET "banned_until" = ${until},
              "ban_reason" = ${reason},
              "moderated_by" = ${actorUserId},
              "updated_at" = CURRENT_TIMESTAMP
          WHERE target."user_id" = ${targetUserId}
            AND target."admin" = FALSE
            AND EXISTS (
              SELECT 1 FROM "profiles" actor
              WHERE actor."user_id" = ${actorUserId} AND actor."admin" = TRUE
            )
          RETURNING target."user_id" AS "userId"
        `;
    return rows.some((row) => row.userId === targetUserId);
  }

  /** Lift a durable sanction; supports offline players listed in the console. */
  async clearPlayerSanction(actorUserId: string, targetUserId: string, kind: 'mute' | 'ban'): Promise<boolean> {
    const rows = kind === 'mute'
      ? await this.prisma.$queryRaw<Array<{ userId: string }>>`
          UPDATE "profiles" AS target
          SET "muted_until" = NULL,
              "mute_reason" = NULL,
              "moderated_by" = ${actorUserId},
              "updated_at" = CURRENT_TIMESTAMP
          WHERE target."user_id" = ${targetUserId}
            AND EXISTS (
              SELECT 1 FROM "profiles" actor
              WHERE actor."user_id" = ${actorUserId} AND actor."admin" = TRUE
            )
          RETURNING target."user_id" AS "userId"
        `
      : await this.prisma.$queryRaw<Array<{ userId: string }>>`
          UPDATE "profiles" AS target
          SET "banned_until" = NULL,
              "ban_reason" = NULL,
              "moderated_by" = ${actorUserId},
              "updated_at" = CURRENT_TIMESTAMP
          WHERE target."user_id" = ${targetUserId}
            AND EXISTS (
              SELECT 1 FROM "profiles" actor
              WHERE actor."user_id" = ${actorUserId} AND actor."admin" = TRUE
            )
          RETURNING target."user_id" AS "userId"
        `;
    return rows.some((row) => row.userId === targetUserId);
  }

  private sanitizeMags(value: unknown): Partial<Record<ItemId, number>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const mags: Partial<Record<ItemId, number>> = {};
    for (const [rawId, rawRounds] of Object.entries(value)) {
      if (!/^[a-z0-9_-]{1,60}$/i.test(rawId) || typeof rawRounds !== 'number' || !Number.isFinite(rawRounds)) continue;
      const id = rawId as ItemId;
      mags[id] = Math.max(0, Math.min(100_000, Math.floor(rawRounds)));
    }
    return mags;
  }

  async loadAppearance(userId: string): Promise<CharacterAppearance> {
    const row = await this.prisma.profile.findUnique({ where: { userId }, select: { data: true } });
    const data = (row?.data ?? {}) as Record<string, unknown>;
    return sanitizeCharacterAppearance(data.appearance, typeof data.look === 'number' ? data.look : 0);
  }

  /**
   * Claims this survivor for the current regional simulation. A reconnect to
   * the same server may atomically hand ownership to its new socket; another
   * server must wait for an explicit release or lease expiry.
   */
  async acquirePlayerWorldLease(userId: string, connectionId: string, ttlSeconds = 45): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ connectionId: string }>>`
      INSERT INTO "player_world_leases" ("user_id", "server_key", "connection_id", "expires_at", "updated_at")
      VALUES (
        ${userId}, ${this.worldStateKey}, ${connectionId},
        CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second'), CURRENT_TIMESTAMP
      )
      ON CONFLICT ("user_id") DO UPDATE SET
        "server_key" = EXCLUDED."server_key",
        "connection_id" = EXCLUDED."connection_id",
        "expires_at" = EXCLUDED."expires_at",
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "player_world_leases"."server_key" = ${this.worldStateKey}
         OR "player_world_leases"."expires_at" <= CURRENT_TIMESTAMP
      RETURNING "connection_id" AS "connectionId"
    `;
    return rows.some((row) => row.connectionId === connectionId);
  }

  async renewPlayerWorldLease(userId: string, connectionId: string, ttlSeconds = 45): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "player_world_leases"
      SET "expires_at" = CURRENT_TIMESTAMP + (${ttlSeconds} * INTERVAL '1 second'),
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "user_id" = ${userId}
        AND "server_key" = ${this.worldStateKey}
        AND "connection_id" = ${connectionId}
        AND "expires_at" > CURRENT_TIMESTAMP
    `;
    return updated > 0;
  }

  async releasePlayerWorldLease(userId: string, connectionId: string): Promise<boolean> {
    try {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM "player_world_leases"
        WHERE "user_id" = ${userId}
          AND "server_key" = ${this.worldStateKey}
          AND "connection_id" = ${connectionId}
      `;
      return deleted > 0;
    } catch (error) {
      this.logQueryError('releasePlayerWorldLease', error);
      return false;
    }
  }

  async saveProfile(
    userId: string,
    connectionId: string,
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
    mags: Partial<Record<ItemId, number>> = {},
  ) {
    const cleanAppearance = sanitizeCharacterAppearance(appearance);
    const cleanMags = this.sanitizeMags(mags);
    const gameplayData = JSON.stringify({ inv, equipment, skills, quests, hunger, thirst, armorDur, mags: cleanMags });
    const initialData = JSON.stringify({
      inv, equipment, skills, quests, hunger, thirst, armorDur, mags: cleanMags,
      appearance: cleanAppearance,
      look: cleanAppearance.outfit,
    });
    try {
      // Gameplay and web appearance writes can race; merge only the fields this
      // server owns so a lingering combat-log body cannot restore an old look.
      const updated = await this.prisma.$executeRaw`
        INSERT INTO "profiles" ("user_id", "data", "money", "kills", "deaths", "updated_at")
        SELECT ${userId}, CAST(${initialData} AS jsonb), ${money}, ${kills}, ${deaths}, CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM "player_world_leases"
          WHERE "user_id" = ${userId}
            AND "server_key" = ${this.worldStateKey}
            AND "connection_id" = ${connectionId}
            AND "expires_at" > CURRENT_TIMESTAMP
        )
        ON CONFLICT ("user_id") DO UPDATE SET
          "data" = COALESCE("profiles"."data", '{}'::jsonb) || CAST(${gameplayData} AS jsonb),
          "money" = EXCLUDED."money",
          "kills" = EXCLUDED."kills",
          "deaths" = EXCLUDED."deaths",
          "updated_at" = CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM "player_world_leases"
          WHERE "user_id" = ${userId}
            AND "server_key" = ${this.worldStateKey}
            AND "connection_id" = ${connectionId}
            AND "expires_at" > CURRENT_TIMESTAMP
        )
      `;
      if (updated === 0) this.log.warn(`Skipped stale profile save without an active lease: ${userId}`);
      return updated > 0;
    } catch (err) {
      this.log.error(`saveProfile ${userId}: ${(err as Error).message}`);
      return false;
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

  async saveHideout(userId: string, connectionId: string, hideout: HideoutData) {
    try {
      const payload = JSON.stringify(hideout);
      const initialData = JSON.stringify({ inv: { backpack: 0, slots: [] } });
      const updated = await this.prisma.$executeRaw`
        INSERT INTO "profiles" ("user_id", "data", "hideout", "updated_at")
        SELECT ${userId}, CAST(${initialData} AS jsonb), CAST(${payload} AS jsonb), CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM "player_world_leases"
          WHERE "user_id" = ${userId}
            AND "server_key" = ${this.worldStateKey}
            AND "connection_id" = ${connectionId}
            AND "expires_at" > CURRENT_TIMESTAMP
        )
        ON CONFLICT ("user_id") DO UPDATE SET
          "hideout" = CAST(${payload} AS jsonb),
          "updated_at" = CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM "player_world_leases"
          WHERE "user_id" = ${userId}
            AND "server_key" = ${this.worldStateKey}
            AND "connection_id" = ${connectionId}
            AND "expires_at" > CURRENT_TIMESTAMP
        )
      `;
      if (updated === 0) this.log.warn(`Skipped stale personal hideout save without an active lease: ${userId}`);
      return updated > 0;
    } catch (err) {
      this.log.error(`saveHideout ${userId}: ${(err as Error).message}`);
      return false;
    }
  }

  async loadClanHideout(clanId: string): Promise<HideoutData> {
    const row = await this.prisma.clan.findUnique({ where: { id: clanId }, select: { hideout: true } });
    const hideout = (row?.hideout ?? {}) as Partial<HideoutData>;
    return {
      storage: Array.isArray(hideout.storage) ? hideout.storage : [],
      objects: Array.isArray(hideout.objects) ? hideout.objects : [],
    };
  }

  async saveClanHideout(clanId: string, hideout: HideoutData) {
    try {
      const payload = JSON.stringify(hideout);
      const updated = await this.prisma.$executeRaw`
        UPDATE "clans"
        SET "hideout" = CAST(${payload} AS jsonb), "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${clanId}
          AND EXISTS (
            SELECT 1 FROM "clan_hideout_leases"
            WHERE "clan_id" = ${clanId}
              AND "server_key" = ${this.worldStateKey}
              AND "expires_at" > CURRENT_TIMESTAMP
          )
      `;
      if (updated === 0) this.log.warn(`Skipped clan hideout save without an active lease: ${clanId}`);
      return updated > 0;
    } catch (err) {
      this.log.error(`saveClanHideout ${clanId}: ${(err as Error).message}`);
      return false;
    }
  }

  async acquireClanHideoutLease(clanId: string): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<{ clan_id: string }[]>`
        INSERT INTO "clan_hideout_leases" ("clan_id", "server_key", "expires_at")
        VALUES (${clanId}, ${this.worldStateKey}, CURRENT_TIMESTAMP + INTERVAL '45 seconds')
        ON CONFLICT ("clan_id") DO UPDATE SET
          "server_key" = EXCLUDED."server_key",
          "expires_at" = EXCLUDED."expires_at"
        WHERE "clan_hideout_leases"."server_key" = ${this.worldStateKey}
           OR "clan_hideout_leases"."expires_at" < CURRENT_TIMESTAMP
        RETURNING "clan_id"
      `;
      return rows.length > 0;
    } catch (error) {
      this.log.error(`acquireClanHideoutLease ${clanId}: ${(error as Error).message}`);
      return false;
    }
  }

  async renewClanHideoutLease(clanId: string): Promise<boolean> {
    try {
      const result = await this.prisma.clanHideoutLease.updateMany({
        where: { clanId, serverKey: this.worldStateKey },
        data: { expiresAt: new Date(Date.now() + 45_000) },
      });
      return result.count > 0;
    } catch {
      return false;
    }
  }

  async releaseClanHideoutLease(clanId: string) {
    await this.prisma.clanHideoutLease.deleteMany({ where: { clanId, serverKey: this.worldStateKey } }).catch(() => undefined);
  }

  async loadPlayerSocialAccess(userId: string): Promise<PlayerSocialAccess> {
    const [friendRows, membership] = await Promise.all([
      this.prisma.friend.findMany({
        where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
        select: { userId: true, friendId: true },
      }),
      this.prisma.clanMember.findUnique({
        where: { userId },
        include: { clan: { select: { id: true, name: true, tag: true, members: { select: { userId: true } } } } },
      }),
    ]);
    return {
      friendIds: [...new Set(friendRows.map((row) => row.userId === userId ? row.friendId : row.userId))],
      clan: membership ? {
        id: membership.clan.id,
        name: membership.clan.name,
        tag: membership.clan.tag,
        rank: (['owner', 'officer', 'member'].includes(membership.rank) ? membership.rank : 'member') as ClanRank,
      } : null,
      clanMateIds: membership ? membership.clan.members.map((member) => member.userId).filter((id) => id !== userId) : [],
    };
  }

  /**
   * Moves credits between a live survivor and their clan in one transaction.
   * Positive amounts contribute; negative amounts withdraw. The profile-side
   * update is guarded by the same connection lease as ordinary profile saves.
   */
  async transferClanTreasury(
    userId: string,
    connectionId: string,
    actorName: string,
    clanId: string,
    signedAmount: number,
  ): Promise<ClanTreasuryTransferResult> {
    const amount = Math.trunc(signedAmount);
    if (amount === 0) return { ok: false, reason: 'insufficient_credits' };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const membership = await tx.clanMember.findUnique({ where: { userId }, select: { clanId: true, rank: true } });
        if (!membership || membership.clanId !== clanId) throw new Error('not_member');
        if (amount < 0 && membership.rank !== 'owner' && membership.rank !== 'officer') throw new Error('forbidden');

        let money: number;
        let treasury: number;
        if (amount > 0) {
          const profiles = await tx.$queryRaw<Array<{ money: number }>>`
            UPDATE "profiles"
            SET "money" = "money" - ${amount}, "updated_at" = CURRENT_TIMESTAMP
            WHERE "user_id" = ${userId}
              AND "money" >= ${amount}
              AND EXISTS (
                SELECT 1 FROM "player_world_leases"
                WHERE "user_id" = ${userId}
                  AND "server_key" = ${this.worldStateKey}
                  AND "connection_id" = ${connectionId}
                  AND "expires_at" > CURRENT_TIMESTAMP
              )
            RETURNING "money"
          `;
          if (!profiles.length) {
            const ownsLease = await tx.playerWorldLease.count({
              where: { userId, serverKey: this.worldStateKey, connectionId, expiresAt: { gt: new Date() } },
            });
            throw new Error(ownsLease ? 'insufficient_credits' : 'stale_lease');
          }
          const clans = await tx.$queryRaw<Array<{ treasury: number }>>`
            UPDATE "clans"
            SET "treasury" = "treasury" + ${amount}, "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${clanId}
            RETURNING "treasury"
          `;
          if (!clans.length) throw new Error('not_member');
          money = profiles[0].money;
          treasury = clans[0].treasury;
        } else {
          const credits = Math.abs(amount);
          const clans = await tx.$queryRaw<Array<{ treasury: number }>>`
            UPDATE "clans"
            SET "treasury" = "treasury" - ${credits}, "updated_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${clanId} AND "treasury" >= ${credits}
            RETURNING "treasury"
          `;
          if (!clans.length) throw new Error('insufficient_treasury');
          const profiles = await tx.$queryRaw<Array<{ money: number }>>`
            UPDATE "profiles"
            SET "money" = "money" + ${credits}, "updated_at" = CURRENT_TIMESTAMP
            WHERE "user_id" = ${userId}
              AND EXISTS (
                SELECT 1 FROM "player_world_leases"
                WHERE "user_id" = ${userId}
                  AND "server_key" = ${this.worldStateKey}
                  AND "connection_id" = ${connectionId}
                  AND "expires_at" > CURRENT_TIMESTAMP
              )
            RETURNING "money"
          `;
          if (!profiles.length) throw new Error('stale_lease');
          money = profiles[0].money;
          treasury = clans[0].treasury;
        }
        await tx.clanLedgerEntry.create({
          data: {
            clanId,
            actorUserId: userId,
            actorName: actorName.trim().slice(0, 80) || 'Survivor',
            kind: amount > 0 ? 'contribution' : 'withdrawal',
            amount: Math.abs(amount),
            balance: treasury,
          },
        });
        return { ok: true as const, money, treasury };
      });
    } catch (error) {
      const reason = (error as Error).message;
      if (['not_member', 'forbidden', 'insufficient_credits', 'insufficient_treasury', 'stale_lease'].includes(reason)) {
        return { ok: false, reason: reason as Exclude<ClanTreasuryTransferResult, { ok: true }>['reason'] };
      }
      this.logQueryError('transferClanTreasury', error);
      return { ok: false, reason: 'unavailable' };
    }
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friend.findFirst({
      where: { userId: a, friendId: b, status: 'accepted' },
      select: { userId: true },
    });
    return !!row;
  }

  private validWorldState(value: unknown): PersistedWorldState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Partial<PersistedWorldState>;
    const mapId = raw.mapId === null ? null : Number.isInteger(raw.mapId) && Number(raw.mapId) > 0 ? Number(raw.mapId) : null;
    const seed = Number(raw.seed);
    if (!Number.isFinite(seed)) return null;
    const cleanIndex = (input: unknown) => Number.isInteger(input) && Number(input) >= 0 ? Number(input) : null;
    const cleanTile = (input: unknown) => Number.isInteger(input) && Number(input) >= 0 && Number(input) <= 255 ? Number(input) : null;
    const nodeHits: [number, number][] = Array.isArray(raw.nodeHits) ? raw.nodeHits.slice(0, 250_000).flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return [];
      const i = cleanIndex(entry[0]);
      const left = Number(entry[1]);
      return i !== null && Number.isInteger(left) && left > 0 ? [[i, left] as [number, number]] : [];
    }) : [];
    const nodeRespawns: PersistedWorldState['nodeRespawns'] = Array.isArray(raw.nodeRespawns) ? raw.nodeRespawns.slice(0, 250_000).flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const node = entry as PersistedWorldState['nodeRespawns'][number];
      const i = cleanIndex(node.i);
      const at = Number(node.at);
      const depletedTile = cleanTile(node.depletedTile);
      const baseTile = cleanTile(node.baseTile);
      if (i === null || !Number.isFinite(at) || depletedTile === null || baseTile === null || (node.family !== 'tree' && node.family !== 'rock')) return [];
      return [{ i, at, family: node.family, depletedTile, baseTile, baseResourceId: typeof node.baseResourceId === 'string' ? node.baseResourceId.slice(0, 80) : '' }];
    }) : [];
    const nodeVariants: PersistedWorldState['nodeVariants'] = Array.isArray(raw.nodeVariants) ? raw.nodeVariants.slice(0, 250_000).flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const node = entry as PersistedWorldState['nodeVariants'][number];
      const i = cleanIndex(node.i);
      const tile = cleanTile(node.tile);
      const baseTile = cleanTile(node.baseTile);
      if (i === null || tile === null || baseTile === null || typeof node.resourceId !== 'string' || !node.resourceId) return [];
      return [{ i, tile, resourceId: node.resourceId.slice(0, 80), baseTile, baseResourceId: typeof node.baseResourceId === 'string' ? node.baseResourceId.slice(0, 80) : '' }];
    }) : [];
    return { mapId, seed: seed | 0, nodeHits, nodeRespawns, nodeVariants };
  }

  private async loadCachedWorldState(mapId: number | null) {
    if (this.worldStateCache === undefined) this.worldStateCache = this.validWorldState(await this.readCacheFile('world-state'));
    return this.worldStateCache?.mapId === mapId ? this.worldStateCache : null;
  }

  async loadWorldState(mapId: number | null): Promise<PersistedWorldState | null> {
    if (this.databasePollingPaused()) return this.loadCachedWorldState(mapId);
    try {
      const row = await this.prisma.gameWorldState.findUnique({ where: { serverKey: this.worldStateKey }, select: { mapId: true, data: true } });
      const state = row ? this.validWorldState({ ...(row.data as object), mapId: row.mapId }) : null;
      if (!state || state.mapId !== mapId) return null;
      this.worldStateCache = state;
      await this.writeCacheFile('world-state', state);
      return state;
    } catch (error) {
      this.logQueryError('loadWorldState', error);
      const cached = await this.loadCachedWorldState(mapId);
      if (cached) this.log.warn(`Restored world node state from ${this.cachePath('world-state')}`);
      return cached;
    }
  }

  async saveWorldState(state: PersistedWorldState): Promise<void> {
    const clean = this.validWorldState(state);
    if (!clean) return;
    this.worldStateCache = clean;
    await this.writeCacheFile('world-state', clean);
    if (this.databasePollingPaused()) return;
    const { mapId, ...data } = clean;
    try {
      await this.prisma.gameWorldState.upsert({
        where: { serverKey: this.worldStateKey },
        create: { serverKey: this.worldStateKey, mapId, data: data as object },
        update: { mapId, data: data as object, updatedAt: new Date() },
      });
    } catch (error) {
      this.logQueryError('saveWorldState', error);
    }
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

  async loadActiveMapRevisionId(): Promise<{ id: number; version: string } | null> {
    if (this.databasePollingPaused()) {
      const cached = await this.loadCachedMapRevision();
      return cached ? { id: cached.id, version: String(cached.id) } : null;
    }
    try {
      const row = await this.prisma.gameMap.findFirst({
        where: this.contentChannel === 'staging' ? { draft: true } : { active: true, draft: false },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, updatedAt: true },
      });
      this.recordDatabasePollSuccess();
      return row ? { id: row.id, version: this.contentChannel === 'staging' ? `${row.id}:${row.updatedAt.getTime()}` : String(row.id) } : null;
    } catch (err) {
      this.recordDatabasePollFailure('loadActiveMapRevisionId', err);
      const cached = await this.loadCachedMapRevision();
      return cached ? { id: cached.id, version: String(cached.id) } : null;
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
        where: this.contentChannel === 'staging' ? { draft: true } : { active: true, draft: false },
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
        select: { kind: true, revision: true, updatedAt: true, publishedRevision: true, publishedAt: true },
      });
      this.recordDatabasePollSuccess();
      return Object.fromEntries(rows.map((row) => [
        row.kind,
        this.contentChannel === 'staging'
          ? `${row.revision}:${row.updatedAt.getTime()}`
          : `${row.publishedRevision}:${row.publishedAt?.getTime() ?? 0}`,
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
        select: { kind: true, draft: true, published: true },
      });
      const documents = Object.fromEntries(rows.flatMap((row) => {
        const document = this.contentChannel === 'staging' ? row.draft : row.published;
        return document === null ? [] : [[row.kind, document]];
      }));
      const spriteManifest = documents.sprites;
      if (
        spriteManifest &&
        typeof spriteManifest === 'object' &&
        !Array.isArray(spriteManifest) &&
        (spriteManifest as { storage?: unknown }).storage === 'asset-rows-v1'
      ) {
        const spriteRows = await this.prisma.gameSpriteAsset.findMany({ orderBy: { assetId: 'asc' } });
        const staging = this.contentChannel === 'staging';
        const palette = Array.isArray((spriteManifest as { palette?: unknown }).palette)
          ? (spriteManifest as { palette: unknown[] }).palette.filter((color): color is string => typeof color === 'string')
          : [];
        documents.sprites = {
          palette,
          assets: spriteRows.flatMap((asset) => {
            const deleted = staging ? asset.draftDeleted : asset.publishedDeleted;
            return deleted ? [] : [staging ? asset.draft : asset.published];
          }),
        };
      }
      this.recordDatabasePollSuccess();
      return documents;
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
