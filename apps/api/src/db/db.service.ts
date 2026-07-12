import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthoredMap, BuildType, EMPTY_SKILLS, Equipment, InvSlot, Inventory, QuestDef, Skills } from '@holdout/shared';

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
  look: number;
}

export interface HideoutData {
  storage: InvSlot[];
  objects: { type: BuildType; tx: number; ty: number; slots?: InvSlot[] }[];
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');
  private prisma: PrismaClient;

  async onModuleInit() {
    this.prisma = new PrismaClient();
    await this.prisma.$connect();
    this.log.log('Prisma connected to Neon');
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
      look: typeof data.look === 'number' ? data.look : 0,
    };
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
    look = 0,
  ) {
    const data = JSON.parse(JSON.stringify({ inv, equipment, skills, quests, hunger, thirst, armorDur, look }));
    try {
      await this.prisma.profile.upsert({
        where: { userId },
        create: { userId, data, money, kills, deaths },
        update: { data, money, kills, deaths, updatedAt: new Date() },
      });
    } catch (err) {
      this.log.error(`saveProfile ${userId}: ${(err as Error).message}`);
    }
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
    try {
      const row = await this.prisma.gameMap.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } });
      const data = row?.data as AuthoredMap | undefined;
      if (data && Array.isArray(data.tiles) && data.w > 0 && data.h > 0) return data;
    } catch (err) {
      this.log.error(`loadActiveMap: ${(err as Error).message}`);
    }
    return null;
  }

  async loadQuests(): Promise<QuestDef[]> {
    try {
      const rows = await this.prisma.quest.findMany({ where: { active: true }, orderBy: { id: 'asc' } });
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
      this.log.error(`loadQuests: ${(err as Error).message}`);
      return [];
    }
  }
}
