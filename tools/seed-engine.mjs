import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  buildProductionAnimations,
  buildProductionSpriteDocument,
} from "./lib/production-art.mjs";

const require = createRequire(import.meta.url);
const {
  BUILDABLES,
  BLOCKS_BULLET,
  BLOCKS_ENEMY,
  BLOCKS_MOVE,
  DEFAULT_LOOT_TABLES,
  DEFAULT_RESOURCE_NODES,
  ENEMY_DEFS,
  ITEMS,
  ITEM_SPRITE_ORDER,
  RECIPES,
  TRADER_STOCK,
  TRADER_STOCK_T2,
} = require("../packages/shared/dist/index.js");
const { PNG } = require("pngjs");

const tileSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/tiles.png", import.meta.url),
  ),
);
const itemSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/items.png", import.meta.url),
  ),
);
const itemSheetA = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-items-a.png", import.meta.url),
  ),
);
const itemSheetB = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-items-b.png", import.meta.url),
  ),
);
const charSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/chars.png", import.meta.url),
  ),
);
const actorSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors.png", import.meta.url),
  ),
);
const actorWalkASheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors-walk-a.png", import.meta.url),
  ),
);
const actorWalkBSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors-walk-b.png", import.meta.url),
  ),
);
const actorPunchWindupSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors-punch-windup.png", import.meta.url),
  ),
);
const actorPunchImpactSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors-punch-impact.png", import.meta.url),
  ),
);
const actorPunchRecoverySheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-actors-punch-recovery.png", import.meta.url),
  ),
);
const floraSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-flora.png", import.meta.url),
  ),
);
const propSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-props.png", import.meta.url),
  ),
);
const terrainSheet = PNG.sync.read(
  readFileSync(
    new URL("../apps/web/public/sprites/production-terrain.png", import.meta.url),
  ),
);

const cropPixels = (sheet, col, row = 0, width = 16, height = 16) => {
  const pixels = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = ((row * 16 + y) * sheet.width + col * 16 + x) * 4;
      pixels.push(
        `#${[0, 1, 2, 3].map((channel) => sheet.data[offset + channel].toString(16).padStart(2, "0")).join("")}`,
      );
    }
  return pixels;
};
const cropTilePixels = (col, row = 0, width = 16, height = 16) =>
  cropPixels(tileSheet, col, row, width, height);

const prisma = new PrismaClient();
const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalJson(value[key])]),
    );
  return value;
};
const sameJson = (left, right) =>
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

const sprites = buildProductionSpriteDocument({
  tileSheet,
  itemSheet,
  itemSheetA,
  itemSheetB,
  charSheet,
  actorSheet,
  actorWalkASheet,
  actorWalkBSheet,
  actorPunchWindupSheet,
  actorPunchImpactSheet,
  actorPunchRecoverySheet,
  floraSheet,
  propSheet,
  terrainSheet,
  itemSpriteOrder: ITEM_SPRITE_ORDER,
  items: ITEMS,
  buildables: BUILDABLES,
});

const documents = {
  items: ITEMS,
  recipes: RECIPES,
  mobs: {
    ...Object.fromEntries(
      Object.entries(ENEMY_DEFS).map(([id, def]) => [
        id,
        {
          id,
          ...def,
          boss: false,
          lootTable: id === "military" ? "military_drop" : id,
          spriteId: `character:${id}`,
          respawnMs: 90_000,
        },
      ]),
    ),
    brute: {
      id: "brute",
      name: "infected brute",
      behavior: "melee",
      maxHp: 240,
      speed: 82,
      aggroRange: 280,
      attackRange: 38,
      damage: 28,
      attackMs: 1450,
      boss: true,
      lootTable: "zombie",
      spriteId: "character:brute",
      respawnMs: 240_000,
      sounds: {
        alert: "brute_roar",
        attack: "brute_slam",
        death: "brute_roar",
      },
    },
  },
  loot: DEFAULT_LOOT_TABLES,
  traders: {
    outpost: {
      id: "outpost",
      name: "Outpost quartermaster",
      questTier: 1,
      stock: TRADER_STOCK,
    },
    black_market: {
      id: "black_market",
      name: "Black-market dealer",
      questTier: 2,
      stock: TRADER_STOCK_T2,
    },
  },
  blocks: {
    version: 1,
    world: {
      steel_crate: {
        id: "steel_crate",
        name: "Steel crate",
        spriteId: "block:steel_crate",
        scale: 1,
        offsetY: 0,
        maxHp: 120,
        destructible: true,
        collision: { move: true, enemy: true, bullets: true, sight: false },
        hitSound: "mine",
        breakSound: "rock_break",
        drops: [
          { itemId: "scrap", min: 2, max: 5, chance: 1, when: "depleted" },
        ],
      },
      wrecked_car: {
        id: "wrecked_car",
        name: "Wrecked car",
        spriteId: "block:wrecked_car",
        scale: 1,
        offsetY: 0,
        maxHp: 260,
        destructible: true,
        collision: { move: true, enemy: true, bullets: true, sight: false },
        hitSound: "mine_heavy",
        breakSound: "rock_break",
        drops: [
          { itemId: "scrap", min: 3, max: 7, chance: 1, when: "depleted" },
        ],
      },
      road_barrier: {
        id: "road_barrier",
        name: "Road barrier",
        spriteId: "block:road_barrier",
        scale: 1,
        offsetY: 0,
        maxHp: 80,
        destructible: true,
        collision: { move: true, enemy: true, bullets: false, sight: false },
        hitSound: "wood_heavy",
        breakSound: "tree_crack",
        drops: [
          { itemId: "wood", min: 1, max: 2, chance: 1, when: "depleted" },
        ],
      },
      sandbag_wall: {
        id: "sandbag_wall",
        name: "Sandbag wall",
        spriteId: "block:sandbag_wall",
        scale: 1,
        offsetY: 0,
        maxHp: 220,
        destructible: true,
        collision: { move: true, enemy: true, bullets: true, sight: false },
        hitSound: "mine_heavy",
        breakSound: "rock_break",
        drops: [],
      },
      dead_tree: {
        id: "dead_tree",
        name: "Dead tree",
        spriteId: "block:dead_tree",
        scale: 1,
        offsetY: 0,
        maxHp: 90,
        destructible: true,
        collision: { move: true, enemy: true, bullets: true, sight: false },
        hitSound: "chop",
        breakSound: "tree_fall",
        drops: [
          { itemId: "wood", min: 2, max: 4, chance: 1, when: "depleted" },
        ],
      },
      stone_wall: {
        id: "stone_wall",
        name: "Stone wall",
        spriteId: "block:stone_wall",
        scale: 1,
        offsetY: 0,
        maxHp: 320,
        destructible: true,
        collision: { move: true, enemy: true, bullets: true, sight: true },
        hitSound: "mine_heavy",
        breakSound: "rock_break",
        drops: [
          { itemId: "stone", min: 2, max: 5, chance: 1, when: "depleted" },
        ],
      },
      ...Object.fromEntries(
        [
          ["young_pine", "Young pine"],
          ["dense_shrub", "Dense shrub"],
          ["berry_bush", "Red berry bush"],
          ["fern_patch", "Fern patch"],
          ["reeds", "Reeds and cattails"],
          ["wildflowers", "Wildflower patch"],
          ["tall_grass", "Tall dry grass"],
          ["fallen_log", "Fallen mossy log"],
          ["mossy_stump", "Mossy stump"],
          ["bramble", "Bramble patch"],
          ["mushrooms", "Mushroom cluster"],
        ].map(([id, name]) => [
          id,
          {
            id,
            name,
            spriteId: `block:${id}`,
            scale: 1,
            offsetY: 0,
            maxHp: 1,
            destructible: false,
            collision: { move: false, enemy: false, bullets: false, sight: false },
            drops: [],
          },
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(BUILDABLES).map(([buildType, buildable]) => {
          const kit = Object.values(ITEMS).find(
            (item) => item.place === buildType,
          );
          const tile = buildable.tile;
          return [
            buildType,
            {
              id: buildType,
              name: buildable.name,
              spriteId: `block:${buildType}`,
              scale: 1,
              offsetY: 0,
              maxHp: Math.max(1, buildable.hp),
              destructible: buildable.hp > 0,
              collision: {
                move: tile === null ? true : Boolean(BLOCKS_MOVE[tile]),
                enemy: tile === null ? true : Boolean(BLOCKS_ENEMY[tile]),
                bullets: tile === null ? false : Boolean(BLOCKS_BULLET[tile]),
                sight: tile === null ? false : Boolean(BLOCKS_BULLET[tile]),
              },
              drops: [],
              playerPlacement: {
                buildType,
                kitItemId: kit.id,
                simulationTile: tile,
                hideoutOnly: Boolean(buildable.hideoutOnly),
                foundation:
                  buildType === "wood_floor" || buildType === "stone_floor",
                storageSlots: buildType === "chest" ? 12 : 0,
              },
            },
          ];
        }),
      ),
    },
    legacyBuildables: BUILDABLES,
  },
  sprites,
  animations: buildProductionAnimations({
    ...ENEMY_DEFS,
    brute: { id: "brute" },
  }),
  resources: DEFAULT_RESOURCE_NODES,
  terrain: {
    grass: {
      id: "grass",
      name: "Grass",
      spriteId: "terrain:grass",
      simulationTile: 0,
      minimapColor: "#527741",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    water: {
      id: "water",
      name: "Water",
      spriteId: "terrain:water",
      simulationTile: 1,
      minimapColor: "#3f7197",
      moveMultiplier: 1,
      swimmable: true,
      collision: { move: false, enemy: true, bullets: false, sight: false },
    },
    tree: {
      id: "tree",
      name: "Tree",
      spriteId: "terrain:tree",
      simulationTile: 2,
      minimapColor: "#294f30",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    floor: {
      id: "floor",
      name: "Interior floor",
      spriteId: "terrain:floor",
      simulationTile: 3,
      minimapColor: "#96704c",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    wall: {
      id: "wall",
      name: "Building wall",
      spriteId: "terrain:wall",
      simulationTile: 4,
      minimapColor: "#49382b",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    road: {
      id: "road",
      name: "Dirt road",
      spriteId: "terrain:road",
      simulationTile: 5,
      minimapColor: "#81765a",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    sand: {
      id: "sand",
      name: "Sand",
      spriteId: "terrain:sand",
      simulationTile: 6,
      minimapColor: "#bda66e",
      moveMultiplier: 0.9,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    rock: {
      id: "rock",
      name: "Rock",
      spriteId: "terrain:rock",
      simulationTile: 7,
      minimapColor: "#777a7d",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    asphalt: {
      id: "asphalt",
      name: "Asphalt",
      spriteId: "terrain:asphalt",
      simulationTile: 8,
      minimapColor: "#44464b",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    bed: {
      id: "bed",
      name: "Bed",
      spriteId: "terrain:bed",
      simulationTile: 9,
      minimapColor: "#6f7b86",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: false, sight: false },
    },
    doormat: {
      id: "doormat",
      name: "Door mat",
      spriteId: "terrain:doormat",
      simulationTile: 10,
      minimapColor: "#7b6844",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
    },
    copper_ore: {
      id: "copper_ore",
      name: "Copper vein",
      spriteId: "terrain:copper_ore",
      simulationTile: 22,
      minimapColor: "#ad683d",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    iron_ore: {
      id: "iron_ore",
      name: "Iron vein",
      spriteId: "terrain:iron_ore",
      simulationTile: 23,
      minimapColor: "#929ba5",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    cliff: {
      id: "cliff",
      name: "Cliff",
      spriteId: "terrain:cliff",
      simulationTile: 25,
      minimapColor: "#5f564b",
      moveMultiplier: 1,
      swimmable: false,
      collision: { move: true, enemy: true, bullets: true, sight: true },
    },
    mud: {
      id: "mud",
      name: "Deep mud",
      spriteId: "terrain:mud",
      simulationTile: 0,
      minimapColor: "#655943",
      moveMultiplier: 0.65,
      swimmable: false,
      collision: { move: false, enemy: false, bullets: false, sight: false },
      footstepSound: "step",
    },
  },
  sounds: {
    presets: {
      step: {
        id: "step",
        name: "Soft terrain step",
        wave: "triangle",
        frequency: 105,
        endFrequency: 72,
        durationMs: 70,
        volume: 0.12,
        noise: 0.12,
        filterHz: 1800,
      },
      chop: {
        id: "chop",
        name: "Wood chop",
        wave: "triangle",
        frequency: 100,
        endFrequency: 62,
        durationMs: 90,
        volume: 0.16,
        noise: 0.16,
        filterHz: 2400,
      },
      wood_heavy: {
        id: "wood_heavy",
        name: "Heavy wood impact",
        wave: "sawtooth",
        frequency: 78,
        endFrequency: 42,
        durationMs: 150,
        volume: 0.16,
        noise: 0.22,
        filterHz: 1800,
      },
      tree_fall: {
        id: "tree_fall",
        name: "Tree falling",
        wave: "sawtooth",
        frequency: 90,
        endFrequency: 28,
        durationMs: 650,
        volume: 0.16,
        noise: 0.28,
        filterHz: 1200,
      },
      tree_crack: {
        id: "tree_crack",
        name: "Ironwood crack",
        wave: "square",
        frequency: 64,
        endFrequency: 22,
        durationMs: 900,
        volume: 0.16,
        noise: 0.32,
        filterHz: 900,
      },
      mine: {
        id: "mine",
        name: "Pick strike",
        wave: "square",
        frequency: 420,
        endFrequency: 150,
        durationMs: 80,
        volume: 0.16,
        noise: 0.12,
        filterHz: 3200,
      },
      mine_heavy: {
        id: "mine_heavy",
        name: "Heavy pick strike",
        wave: "square",
        frequency: 280,
        endFrequency: 70,
        durationMs: 150,
        volume: 0.16,
        noise: 0.2,
        filterHz: 2600,
      },
      rock_break: {
        id: "rock_break",
        name: "Rock break",
        wave: "sawtooth",
        frequency: 180,
        endFrequency: 42,
        durationMs: 380,
        volume: 0.16,
        noise: 0.3,
        filterHz: 1600,
      },
      brute_roar: {
        id: "brute_roar",
        name: "Brute roar",
        wave: "sawtooth",
        frequency: 92,
        endFrequency: 48,
        durationMs: 700,
        volume: 0.16,
        noise: 0.18,
        filterHz: 1000,
      },
      brute_slam: {
        id: "brute_slam",
        name: "Brute slam",
        wave: "square",
        frequency: 68,
        endFrequency: 24,
        durationMs: 260,
        volume: 0.16,
        noise: 0.35,
        filterHz: 800,
      },
    },
    actions: {
      harvest_wood: "chop",
      harvest_stone: "mine",
      tree_break: "tree_fall",
      rock_break: "rock_break",
    },
  },
  settings: {
    map: { minSize: 20, maxSize: 2000 },
    publishing: { contentPollMs: 10_000, questPollMs: 60_000 },
    notes:
      "Global tuning values are introduced here as their runtime systems are migrated.",
  },
};

const TERRAIN_ID_BY_TILE = {
  0: "grass",
  1: "water",
  2: "tree",
  3: "floor",
  4: "wall",
  5: "road",
  6: "sand",
  7: "rock",
  8: "asphalt",
  9: "bed",
  10: "doormat",
  22: "copper_ore",
  23: "iron_ore",
  25: "cliff",
};

try {
  for (const [kind, document] of Object.entries(documents)) {
    const row = await prisma.gameContent.upsert({
      where: { kind },
      create: {
        kind,
        draft: document,
        published: document,
        publishedRevision: 1,
        publishedAt: new Date(),
      },
      update: {},
    });
    // Engine documents are designer-owned, so routine seeding never replaces
    // authored records. It does, however, publish newly shipped IDs so code,
    // DB content and the browser pixel-art catalog cannot drift apart.
    if (kind === "items") {
      const current = row.draft && typeof row.draft === "object" ? row.draft : {};
      const missing = Object.fromEntries(Object.entries(document).filter(([id]) => !(id in current)));
      if (Object.keys(missing).length) {
        const merged = { ...current, ...missing };
        await prisma.gameContent.update({
          where: { kind },
          data: { draft: merged, published: merged, revision: { increment: 1 }, publishedRevision: { increment: 1 }, publishedAt: new Date() },
        });
      }
    }
    if (kind === "recipes") {
      const current = Array.isArray(row.draft) ? row.draft : [];
      const ids = new Set(current.map((recipe) => recipe?.id));
      const missing = document.filter((recipe) => !ids.has(recipe.id));
      if (missing.length) {
        const merged = [...current, ...missing];
        await prisma.gameContent.update({
          where: { kind },
          data: { draft: merged, published: merged, revision: { increment: 1 }, publishedRevision: { increment: 1 }, publishedAt: new Date() },
        });
      }
    }
    if (kind === "loot") {
      const current = row.draft && typeof row.draft === "object" ? row.draft : {};
      const merged = { ...current };
      let changed = false;
      for (const [id, seeded] of Object.entries(document)) {
        if (!(id in merged)) { merged[id] = seeded; changed = true; continue; }
        // One-time semantic migration: old wildlife tables emitted cloth.
        // Replace only that recognizable legacy shape; authored tables stay put.
        if (["deer", "rabbit", "boar", "wolf"].includes(id)) {
          const entries = Array.isArray(merged[id]?.entries) ? merged[id].entries : [];
          if (entries.some((entry) => entry?.id === "cloth") && !entries.some((entry) => entry?.id === "animal_hide")) {
            merged[id] = seeded;
            changed = true;
          }
        }
      }
      if (changed) {
        await prisma.gameContent.update({
          where: { kind },
          data: { draft: merged, published: merged, revision: { increment: 1 }, publishedRevision: { increment: 1 }, publishedAt: new Date() },
        });
      }
    }
    if (kind === "traders") {
      const current = row.draft && typeof row.draft === "object" ? row.draft : {};
      const merged = { ...current };
      let changed = false;
      for (const [id, seeded] of Object.entries(document)) {
        if (!merged[id]) { merged[id] = seeded; changed = true; continue; }
        const currentStock = Array.isArray(merged[id].stock) ? merged[id].stock : [];
        const stockIds = new Set(currentStock.map((entry) => entry?.id));
        const missingStock = (seeded.stock ?? []).filter((entry) => !stockIds.has(entry.id));
        if (missingStock.length) {
          merged[id] = { ...merged[id], stock: [...currentStock, ...missingStock] };
          changed = true;
        }
      }
      if (changed) {
        await prisma.gameContent.update({
          where: { kind },
          data: { draft: merged, published: merged, revision: { increment: 1 }, publishedRevision: { increment: 1 }, publishedAt: new Date() },
        });
      }
    }
    if (
      kind === "sprites" &&
      row.revision === 1 &&
      row.publishedRevision === 1
    ) {
      const current = row.draft;
      const untouched =
        Array.isArray(current?.assets) &&
        current.assets.every(
          (asset) => Array.isArray(asset.pixels) && asset.pixels.length === 0,
        );
      if (untouched) {
        await prisma.gameContent.update({
          where: { kind },
          data: { draft: document, published: document },
        });
      }
    }
    if (kind === "mobs" || kind === "animations") {
      const current =
        row.draft && typeof row.draft === "object" ? row.draft : {};
      const missing = Object.fromEntries(
        Object.entries(document).filter(([id]) => !(id in current)),
      );
      if (Object.keys(missing).length) {
        const merged = { ...current, ...missing };
        await prisma.gameContent.update({
          where: { kind },
          data: {
            draft: merged,
            published: merged,
            revision: { increment: 1 },
            publishedRevision: { increment: 1 },
            publishedAt: new Date(),
          },
        });
      }
    }
    if (kind === "sprites") {
      if (row.draft?.storage === "asset-rows-v1") {
        const stored = await prisma.gameSpriteAsset.findMany();
        const byId = new Map(stored.map((asset) => [asset.assetId, asset]));
        const missing = sprites.assets.filter((asset) => {
          const existing = byId.get(asset.id);
          return !existing || existing.draftDeleted;
        });
        if (missing.length) {
          const currentContent = await prisma.gameContent.findUniqueOrThrow({ where: { kind } });
          const nextRevision = currentContent.revision + 1;
          const publishedAt = new Date();
          await prisma.$transaction(async (tx) => {
            for (const asset of missing) {
              await tx.gameSpriteAsset.upsert({
                where: { assetId: asset.id },
                create: {
                  assetId: asset.id,
                  draft: asset,
                  published: asset,
                  draftDeleted: false,
                  publishedDeleted: false,
                  draftRevision: nextRevision,
                  publishedRevision: nextRevision,
                  publishedAt,
                },
                update: {
                  draft: asset,
                  published: asset,
                  draftDeleted: false,
                  publishedDeleted: false,
                  draftRevision: nextRevision,
                  publishedRevision: nextRevision,
                  updatedAt: new Date(),
                  publishedAt,
                },
              });
              await tx.gameSpriteAssetRevision.upsert({
                where: { assetId_revision: { assetId: asset.id, revision: nextRevision } },
                create: { assetId: asset.id, revision: nextRevision, data: asset, published: true },
                update: { data: asset, deleted: false, published: true },
              });
            }
            await tx.gameContent.update({
              where: { kind },
              data: {
                revision: nextRevision,
                publishedRevision: nextRevision,
                publishedAt,
                updatedAt: new Date(),
              },
            });
            await tx.gameContentRevision.upsert({
              where: { kind_revision: { kind, revision: nextRevision } },
              create: { kind, revision: nextRevision, data: currentContent.draft, published: true },
              update: { data: currentContent.draft, published: true },
            });
          });
        }
        continue;
      }
      const current = row.draft;
      if (Array.isArray(current?.assets)) {
        const missing = sprites.assets.filter(
          (asset) =>
            !current.assets.some((existing) => existing.id === asset.id),
        );
        let imported = false;
        const upgraded = current.assets.map((existing) => {
          const seeded = sprites.assets.find(
            (asset) => asset.id === existing.id,
          );
          const hasPixels =
            (Array.isArray(existing.pixels) && existing.pixels.length > 0) ||
            (Array.isArray(existing.frames) &&
              existing.frames.some(
                (frame) => Array.isArray(frame) && frame.length > 0,
              ));
          const seededHasPixels =
            (Array.isArray(seeded?.pixels) && seeded.pixels.length > 0) ||
            (Array.isArray(seeded?.frames) &&
              seeded.frames.some(
                (frame) => Array.isArray(frame) && frame.length > 0,
              ));
          const previousBed =
            existing.id === "block:bed" &&
            existing.width === 16 &&
            existing.height === 16 &&
            JSON.stringify(existing.pixels) ===
              JSON.stringify(cropTilePixels(13));
          const previousChest =
            existing.id === "block:chest" &&
            JSON.stringify(existing.pixels) ===
              JSON.stringify(
                cropPixels(itemSheet, ITEM_SPRITE_ORDER.indexOf("kit_chest")),
              );
          if (
            !seeded ||
            !seededHasPixels ||
            (hasPixels && !previousBed && !previousChest)
          )
            return existing;
          imported = true;
          if (previousBed || previousChest) {
            const { source: _source, ...rest } = existing;
            return {
              ...rest,
              width: seeded.width,
              height: seeded.height,
              pixels: seeded.pixels,
              frames: seeded.frames,
            };
          }
          return {
            ...existing,
            width: seeded.width,
            height: seeded.height,
            pixels: seeded.pixels,
            frames: seeded.frames,
          };
        });
        if (missing.length || imported) {
          const merged = { ...current, assets: [...upgraded, ...missing] };
          await prisma.gameContent.update({
            where: { kind },
            data: {
              draft: merged,
              published: merged,
              revision: { increment: 1 },
              publishedRevision: { increment: 1 },
              publishedAt: new Date(),
            },
          });
        }
      }
    }
    if (kind === "terrain" || kind === "resources") {
      const current =
        row.draft && typeof row.draft === "object" ? row.draft : {};
      const merged = Object.fromEntries(
        Object.entries(document).map(([id, seeded]) => [
          id,
          { ...seeded, ...(current[id] ?? {}) },
        ]),
      );
      if (kind === "resources" && merged.tree?.spriteId === "tile:tree")
        merged.tree.spriteId = "resource:tree";
      for (const [id, value] of Object.entries(current))
        if (!(id in merged)) merged[id] = value;
      if (!sameJson(current, merged)) {
        await prisma.gameContent.update({
          where: { kind },
          data: {
            draft: merged,
            published: merged,
            revision: { increment: 1 },
            publishedRevision: { increment: 1 },
            publishedAt: new Date(),
          },
        });
      }
    }
    if (kind === "blocks") {
      const current =
        row.draft && typeof row.draft === "object" ? row.draft : {};
      if (!current.world) {
        const migrated = { ...document, legacyBuildables: current };
        await prisma.gameContent.update({
          where: { kind },
          data: {
            draft: migrated,
            published: migrated,
            revision: { increment: 1 },
            publishedRevision: { increment: 1 },
            publishedAt: new Date(),
          },
        });
      } else {
        const world = Object.fromEntries(
          Object.entries(document.world).map(([id, seeded]) => [
            id,
            { ...seeded, ...(current.world[id] ?? {}) },
          ]),
        );
        for (const [id, value] of Object.entries(current.world))
          if (!(id in world)) world[id] = value;
        const merged = {
          ...current,
          version: 1,
          world,
          legacyBuildables: current.legacyBuildables ?? BUILDABLES,
        };
        if (!sameJson(current, merged)) {
          await prisma.gameContent.update({
            where: { kind },
            data: {
              draft: merged,
              published: merged,
              revision: { increment: 1 },
              publishedRevision: { increment: 1 },
              publishedAt: new Date(),
            },
          });
        }
      }
    }
    if (kind === "sounds") {
      const current =
        row.draft && typeof row.draft === "object" ? row.draft : {};
      const currentPresets =
        current.presets && typeof current.presets === "object"
          ? current.presets
          : {};
      const missingPresets = Object.fromEntries(
        Object.entries(document.presets).filter(
          ([id]) => !(id in currentPresets),
        ),
      );
      if (Object.keys(missingPresets).length) {
        const merged = {
          ...current,
          presets: { ...currentPresets, ...missingPresets },
          actions: { ...document.actions, ...(current.actions ?? {}) },
        };
        await prisma.gameContent.update({
          where: { kind },
          data: {
            draft: merged,
            published: merged,
            revision: { increment: 1 },
            publishedRevision: { increment: 1 },
            publishedAt: new Date(),
          },
        });
      }
    }
  }
  const maps = await prisma.gameMap.findMany();
  let migratedMaps = 0;
  for (const map of maps) {
    const data = map.data && typeof map.data === "object" ? map.data : null;
    if (!data || !Array.isArray(data.tiles)) continue;
    const terrain =
      data.terrain && typeof data.terrain === "object"
        ? { ...data.terrain }
        : {};
    let changed = false;
    for (let index = 0; index < data.tiles.length; index++) {
      if (terrain[String(index)]) continue;
      terrain[String(index)] =
        TERRAIN_ID_BY_TILE[Number(data.tiles[index])] ?? "grass";
      changed = true;
    }
    if (!changed) continue;
    await prisma.gameMap.update({
      where: { id: map.id },
      data: { data: { ...data, terrain } },
    });
    migratedMaps++;
  }
  console.log(
    `Seeded ${Object.keys(documents).length} engine documents and migrated ${migratedMaps} maps (existing authored values preserved).`,
  );
} finally {
  await prisma.$disconnect();
}
