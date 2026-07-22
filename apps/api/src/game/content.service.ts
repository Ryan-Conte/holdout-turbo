import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_LOOT_TABLES,
  DEFAULT_RESOURCE_NODES,
  AnimationDocument,
  BlockDocument,
  BuildType,
  DEFAULT_ENGINE_SETTINGS,
  ENEMY_DEFS,
  EnemyDef,
  EngineSettingsDocument,
  EngineMobDefinition,
  ITEMS,
  LootTableRegistry,
  RECIPES,
  RuntimeGameplayContent,
  RuntimeItemDef,
  RuntimeItemRegistry,
  RuntimeRecipe,
  RuntimeVisualContent,
  ResourceNodeDef,
  SoundDocument,
  SpriteDocument,
  TerrainDocument,
  Tile,
  TradeEntry,
  TRADER_TIER_STOCK,
  TraderTier,
} from '@holdout/shared';
import { DbService } from '../db/db.service';

const POLL_MS = 10_000;
const CONTENT_KINDS = ['items', 'mobs', 'recipes', 'traders', 'loot', 'sprites', 'animations', 'resources', 'sounds', 'blocks', 'terrain', 'settings'] as const;
const VISUAL_KINDS = new Set<string>(['mobs', 'sprites', 'animations', 'resources', 'sounds', 'blocks', 'terrain']);
const GAMEPLAY_KINDS = new Set<string>(['items', 'recipes']);
const FALLBACK_ITEMS = ITEMS as unknown as RuntimeItemRegistry;
const UNKNOWN_ITEM: RuntimeItemDef = {
  id: 'unknown', name: 'Unknown item', kind: 'material', kg: 0, stack: 1,
  desc: 'This item definition is unavailable in the active content revision.',
};

@Injectable()
export class ContentService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Content');
  private timer: NodeJS.Timeout;
  private mobDefs: Record<string, EnemyDef> = ENEMY_DEFS;
  private itemDefs: RuntimeItemRegistry = FALLBACK_ITEMS;
  private recipeDefs: RuntimeRecipe[] = RECIPES;
  private traderDefs: Record<TraderTier, TradeEntry[]> = TRADER_TIER_STOCK;
  private lootDefs: LootTableRegistry = DEFAULT_LOOT_TABLES;
  private visualDefs: RuntimeVisualContent = { assets: {}, animations: {}, resources: DEFAULT_RESOURCE_NODES, sounds: { presets: {}, actions: {} }, mobSounds: {}, blocks: {}, terrain: {} };
  private settingsDoc: EngineSettingsDocument = DEFAULT_ENGINE_SETTINGS;
  private visualVersion = 0;
  private gameplayVersion = 0;
  private gameplayRevision = 'fallback';
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
      this.gameplayRevision = this.gameplayRevisionFromManifest(manifest);
      this.applyDocuments(
        this.publishedDocs,
        force || changedKinds.some((kind) => VISUAL_KINDS.has(kind)),
        force || changedKinds.some((kind) => GAMEPLAY_KINDS.has(kind)),
      );
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
    this.gameplayRevision = this.gameplayRevisionFromManifest(cached.manifest);
    this.publishedDocs = cached.docs;
    this.applyDocuments(this.publishedDocs, true, true);
    this.log.warn('Published content restored from the socket server runtime cache');
    return true;
  }

  private applyDocuments(docs: Record<string, unknown>, rebuildVisuals: boolean, rebuildGameplay: boolean) {
    const mobs = docs.mobs && typeof docs.mobs === 'object' && !Array.isArray(docs.mobs)
      ? docs.mobs as Record<string, EngineMobDefinition>
      : {};
    this.mobDefs = { ...ENEMY_DEFS, ...mobs };

    const publishedItems = docs.items && typeof docs.items === 'object' && !Array.isArray(docs.items)
      ? docs.items as RuntimeItemRegistry
      : {};
    const validItems = Object.fromEntries(Object.entries(publishedItems).flatMap(([id, item]) => {
      if (!item || typeof item !== 'object' || item.id !== id || typeof item.name !== 'string' || typeof item.kind !== 'string') return [];
      return [[id, item]];
    })) as RuntimeItemRegistry;
    this.itemDefs = Object.keys(validItems).length ? { ...FALLBACK_ITEMS, ...validItems } : FALLBACK_ITEMS;

    this.recipeDefs = RECIPES;
    if (Array.isArray(docs.recipes)) {
      const valid = (docs.recipes as RuntimeRecipe[]).filter((recipe) =>
        recipe && typeof recipe.id === 'string' && Boolean(this.itemDefs[recipe.out?.id]) && Array.isArray(recipe.cost) &&
        recipe.cost.every((cost) => Boolean(this.itemDefs[cost.id])),
      ).map((recipe) => recipe.station === 'furnace'
        ? { ...recipe, cost: recipe.cost.filter((cost) => cost.id !== 'wood') }
        : recipe);
      if (valid.length) {
        const requiredFallbacks = RECIPES.filter((recipe) => recipe.id === 'craft_hand_torch' && !valid.some((entry) => entry.id === recipe.id));
        this.recipeDefs = [...valid, ...requiredFallbacks];
      }
    }
    if (rebuildGameplay) this.gameplayVersion++;

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

    const rawSettings = docs.settings && typeof docs.settings === 'object' && !Array.isArray(docs.settings)
      ? docs.settings as Partial<EngineSettingsDocument>
      : {};
    const map = rawSettings.map && typeof rawSettings.map === 'object' ? rawSettings.map : {};
    const publishing = rawSettings.publishing && typeof rawSettings.publishing === 'object' ? rawSettings.publishing : {};
    const bots: Partial<EngineSettingsDocument['bots']> = rawSettings.bots && typeof rawSettings.bots === 'object' ? rawSettings.bots : {};
    this.settingsDoc = {
      ...DEFAULT_ENGINE_SETTINGS,
      map: { ...DEFAULT_ENGINE_SETTINGS.map, ...map },
      publishing: { ...DEFAULT_ENGINE_SETTINGS.publishing, ...publishing },
      bots: {
        ...DEFAULT_ENGINE_SETTINGS.bots,
        ...bots,
        names: Array.isArray(bots.names) ? bots.names.filter((name): name is string => typeof name === 'string' && Boolean(name)) : DEFAULT_ENGINE_SETTINGS.bots.names,
      },
      notes: typeof rawSettings.notes === 'string' ? rawSettings.notes : DEFAULT_ENGINE_SETTINGS.notes,
    };

    if (!rebuildVisuals) return;
    const sprites = docs.sprites as SpriteDocument | undefined;
    const animations = docs.animations as AnimationDocument | undefined;
    const publishedResources = docs.resources && typeof docs.resources === 'object' && !Array.isArray(docs.resources)
      ? docs.resources as Record<string, ResourceNodeDef>
      : {};
    const resources = Object.keys(publishedResources).length ? publishedResources : DEFAULT_RESOURCE_NODES;
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

  private gameplayRevisionFromManifest(manifest: Record<string, string>): string {
    return `items@${manifest.items ?? 'fallback'}|recipes@${manifest.recipes ?? 'fallback'}`;
  }

  private validStock(stock: TradeEntry[] | undefined): TradeEntry[] | null {
    if (!Array.isArray(stock)) return null;
    const valid = stock.filter((entry) => entry && Boolean(this.itemDefs[entry.id]) && Number.isFinite(entry.buy) && Number.isFinite(entry.sell));
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

  /** Published boss records are preferred by roaming boss-hunt events. */
  bossKinds(): string[] {
    return Object.entries(this.mobDefs).flatMap(([id, definition]) =>
      (definition as Partial<EngineMobDefinition>).boss === true &&
      definition.behavior !== 'flee'
        ? [id]
        : [],
    );
  }

  resource(id: string | undefined): ResourceNodeDef | undefined {
    return id ? this.visualDefs.resources[id] : undefined;
  }

  resourceFamily(resource: ResourceNodeDef | undefined, tile?: number): 'tree' | 'rock' | undefined {
    if (resource?.respawnFamily === 'tree' || resource?.respawnFamily === 'rock') return resource.respawnFamily;
    if (resource) return resource.skill === 'woodcutting' ? 'tree' : 'rock';
    if (tile === Tile.Tree) return 'tree';
    if (tile === Tile.Rock || tile === Tile.CopperOre || tile === Tile.IronOre) return 'rock';
    return undefined;
  }

  resourceVariants(family: 'tree' | 'rock'): { resource: ResourceNodeDef; weight: number }[] {
    return Object.values(this.visualDefs.resources).flatMap((resource) => {
      if (this.resourceFamily(resource) !== family) return [];
      const fallback = resource.id === 'ironwood' ? 6 : resource.id === 'tree' ? 94 : 1;
      const rawWeight = Number(resource.respawnWeight);
      const weight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(1_000_000, rawWeight)) : fallback;
      return weight > 0 ? [{ resource, weight }] : [];
    });
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

  item(id: string | undefined): RuntimeItemDef {
    return id ? this.itemDefs[id] ?? { ...UNKNOWN_ITEM, id, name: id } : UNKNOWN_ITEM;
  }

  hasItem(id: string | undefined): boolean {
    return Boolean(id && this.itemDefs[id]);
  }

  get items(): RuntimeItemRegistry {
    return this.itemDefs;
  }

  get recipes(): RuntimeRecipe[] {
    return this.recipeDefs;
  }

  get gameplay(): RuntimeGameplayContent {
    return { version: this.gameplayRevision, items: this.itemDefs, recipes: this.recipeDefs };
  }

  get gameplayVersionNumber(): number {
    return this.gameplayVersion;
  }

  traderStock(tier: TraderTier): TradeEntry[] {
    return this.traderDefs[tier] ?? this.traderDefs[1];
  }

  estimatedItemValue(id: string): number {
    let value = 0;
    for (const stock of Object.values(this.traderDefs)) {
      const entry = stock.find((candidate) => candidate.id === id);
      if (entry) value = Math.max(value, entry.sell, entry.buy > 0 ? Math.ceil(entry.buy * .35) : 0);
    }
    return value;
  }

  get lootTables(): LootTableRegistry {
    return this.lootDefs;
  }

  get visuals(): RuntimeVisualContent {
    return this.visualDefs;
  }

  get settings(): EngineSettingsDocument {
    return this.settingsDoc;
  }

  get visualsVersion(): number {
    return this.visualVersion;
  }
}
