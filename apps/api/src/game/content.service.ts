import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_LOOT_TABLES,
  AnimationDocument,
  BlockDocument,
  BuildType,
  ENEMY_DEFS,
  EnemyDef,
  EngineMobDefinition,
  ItemId,
  ITEMS,
  LootTableRegistry,
  RECIPES,
  Recipe,
  RuntimeVisualContent,
  ResourceNodeDef,
  SoundDocument,
  SpriteDocument,
  TerrainDocument,
  TradeEntry,
  TRADER_TIER_STOCK,
  TraderTier,
} from '@holdout/shared';
import { DbService } from '../db/db.service';

const POLL_MS = 10_000;
const CONTENT_KINDS = ['mobs', 'recipes', 'traders', 'loot', 'sprites', 'animations', 'resources', 'sounds', 'blocks', 'terrain'] as const;
const VISUAL_KINDS = new Set<string>(['mobs', 'sprites', 'animations', 'resources', 'sounds', 'blocks', 'terrain']);

@Injectable()
export class ContentService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Content');
  private timer: NodeJS.Timeout;
  private mobDefs: Record<string, EnemyDef> = ENEMY_DEFS;
  private recipeDefs: Recipe[] = RECIPES;
  private traderDefs: Record<TraderTier, TradeEntry[]> = TRADER_TIER_STOCK;
  private lootDefs: LootTableRegistry = DEFAULT_LOOT_TABLES;
  private visualDefs: RuntimeVisualContent = { assets: {}, animations: {}, resources: {}, sounds: { presets: {}, actions: {} }, mobSounds: {}, blocks: {}, terrain: {} };
  private visualVersion = 0;
  private publishedDocs: Record<string, unknown> = {};
  private publishedManifest: Record<string, string> = {};
  private refreshing = false;

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    await this.refresh(true);
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async refresh(force = false) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const manifest = await this.db.loadPublishedContentManifest([...CONTENT_KINDS]);
      if (!manifest) {
        if (force || !Object.keys(this.publishedDocs).length) await this.restoreRuntimeCache();
        return;
      }
      const changedKinds = CONTENT_KINDS.filter((kind) => force || manifest[kind] !== this.publishedManifest[kind]);
      if (!changedKinds.length) return;
      const changedDocs = await this.db.loadPublishedContent([...changedKinds]);
      if (!changedDocs) {
        if (force || !Object.keys(this.publishedDocs).length) await this.restoreRuntimeCache();
        return;
      }
      for (const kind of changedKinds) {
        if (Object.prototype.hasOwnProperty.call(changedDocs, kind)) this.publishedDocs[kind] = changedDocs[kind];
        else delete this.publishedDocs[kind];
      }
      this.publishedManifest = manifest;
      this.applyDocuments(this.publishedDocs, force || changedKinds.some((kind) => VISUAL_KINDS.has(kind)));
      await this.db.savePublishedContentCache(this.publishedManifest, this.publishedDocs);
      this.log.log(`Published content cached in memory (${changedKinds.join(', ')})`);
    } finally {
      this.refreshing = false;
    }
  }

  private async restoreRuntimeCache() {
    const cached = await this.db.loadPublishedContentCache();
    if (!cached) return false;
    this.publishedManifest = cached.manifest;
    this.publishedDocs = cached.docs;
    this.applyDocuments(this.publishedDocs, true);
    this.log.warn('Published content restored from the socket server runtime cache');
    return true;
  }

  private applyDocuments(docs: Record<string, unknown>, rebuildVisuals: boolean) {
    const mobs = docs.mobs && typeof docs.mobs === 'object' && !Array.isArray(docs.mobs)
      ? docs.mobs as Record<string, EngineMobDefinition>
      : {};
    this.mobDefs = { ...ENEMY_DEFS, ...mobs };

    this.recipeDefs = RECIPES;
    if (Array.isArray(docs.recipes)) {
      const valid = (docs.recipes as Recipe[]).filter((recipe) =>
        recipe && typeof recipe.id === 'string' && recipe.out?.id in ITEMS && Array.isArray(recipe.cost) &&
        recipe.cost.every((cost) => cost.id in ITEMS),
      );
      this.recipeDefs = valid.length ? valid : RECIPES;
    }

    const traders = docs.traders as Record<string, { stock?: TradeEntry[] }> | undefined;
    this.traderDefs = TRADER_TIER_STOCK;
    if (traders && typeof traders === 'object') {
      this.traderDefs = {
        1: this.validStock(traders.outpost?.stock) ?? TRADER_TIER_STOCK[1],
        2: this.validStock(traders.black_market?.stock) ?? TRADER_TIER_STOCK[2],
      };
    }

    const loot = docs.loot as LootTableRegistry | undefined;
    this.lootDefs = DEFAULT_LOOT_TABLES;
    if (loot && typeof loot === 'object' && Object.keys(loot).length) this.lootDefs = { ...DEFAULT_LOOT_TABLES, ...loot };

    if (!rebuildVisuals) return;
    const sprites = docs.sprites as SpriteDocument | undefined;
    const animations = docs.animations as AnimationDocument | undefined;
    const resources = docs.resources && typeof docs.resources === 'object' && !Array.isArray(docs.resources)
      ? docs.resources as Record<string, ResourceNodeDef>
      : {};
    const sounds = docs.sounds && typeof docs.sounds === 'object' && !Array.isArray(docs.sounds)
      ? docs.sounds as SoundDocument
      : { presets: {}, actions: {} };
    const blocks = docs.blocks && typeof docs.blocks === 'object' && !Array.isArray(docs.blocks)
      ? (docs.blocks as BlockDocument).world ?? {}
      : {};
    const terrain = docs.terrain && typeof docs.terrain === 'object' && !Array.isArray(docs.terrain)
      ? docs.terrain as TerrainDocument
      : {};
    const animationDefs: AnimationDocument = { ...(animations && typeof animations === 'object' ? animations : {}) };
    if (!animationDefs.player) animationDefs.player = { spriteId: 'character:player', clips: { idle: { frames: [0], frameMs: 500, loop: true }, walk: { frames: [0, 1], frameMs: 125, loop: true }, attack: { frames: [1, 0], frameMs: 110, loop: false } } };
    for (const [id, rawMob] of Object.entries(mobs)) {
      if (animationDefs[`mob:${id}`]) continue;
      const spriteId = typeof (rawMob as EnemyDef & { spriteId?: string }).spriteId === 'string' ? (rawMob as EnemyDef & { spriteId: string }).spriteId : `character:${id}`;
      animationDefs[`mob:${id}`] = { spriteId, clips: { idle: { frames: [0], frameMs: 500, loop: true }, walk: { frames: [0, 1], frameMs: 125, loop: true }, attack: { frames: [1, 0], frameMs: 110, loop: false } } };
    }
    const assets = Object.fromEntries((Array.isArray(sprites?.assets) ? sprites.assets : [])
      .filter((asset) => asset && typeof asset.id === 'string' && asset.width > 0 && asset.height > 0)
      .map((asset) => [asset.id, { width: asset.width, height: asset.height, pixels: asset.pixels, frames: asset.frames }]));
    this.visualDefs = {
      assets,
      animations: animationDefs,
      resources,
      sounds,
      mobSounds: Object.fromEntries(Object.entries(mobs).filter(([, mob]) => mob && typeof mob.sounds === 'object').map(([id, mob]) => [id, mob.sounds!])),
      blocks,
      terrain,
    };
    this.visualVersion++;
  }

  private validStock(stock: TradeEntry[] | undefined): TradeEntry[] | null {
    if (!Array.isArray(stock)) return null;
    const valid = stock.filter((entry) => entry && entry.id in ITEMS && Number.isFinite(entry.buy) && Number.isFinite(entry.sell));
    return valid.length ? valid : null;
  }

  enemy(kind: string): EnemyDef {
    return this.mobDefs[kind] ?? ENEMY_DEFS.zombie;
  }

  enemyRespawnMs(kind: string): number {
    const value = (this.mobDefs[kind] as EnemyDef & { respawnMs?: number } | undefined)?.respawnMs;
    return Number.isFinite(value) ? Math.max(1000, Math.min(86_400_000, Number(value))) : 90_000;
  }

  enemyLootTable(kind: string): string {
    const value = (this.mobDefs[kind] as EnemyDef & { lootTable?: string } | undefined)?.lootTable;
    return typeof value === 'string' && value ? value : kind;
  }

  resource(id: string | undefined): ResourceNodeDef | undefined {
    return id ? this.visualDefs.resources[id] : undefined;
  }

  block(id: string | undefined) {
    return id ? this.visualDefs.blocks[id] : undefined;
  }

  playerBlock(buildType: BuildType) {
    return Object.values(this.visualDefs.blocks).find((block) => block.playerPlacement?.buildType === buildType);
  }

  terrain(id: string | undefined) {
    return id ? this.visualDefs.terrain[id] : undefined;
  }

  get recipes(): Recipe[] {
    return this.recipeDefs;
  }

  traderStock(tier: TraderTier): TradeEntry[] {
    return this.traderDefs[tier] ?? this.traderDefs[1];
  }

  get lootTables(): LootTableRegistry {
    return this.lootDefs;
  }

  get visuals(): RuntimeVisualContent {
    return this.visualDefs;
  }

  get visualsVersion(): number {
    return this.visualVersion;
  }
}
