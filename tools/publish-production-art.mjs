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
  ENEMY_DEFS,
  ITEMS,
  ITEM_SPRITE_ORDER,
} = require("../packages/shared/dist/index.js");
const { PNG } = require("pngjs");

const readPng = (relative) => PNG.sync.read(readFileSync(new URL(relative, import.meta.url)));
const sprites = buildProductionSpriteDocument({
  tileSheet: readPng("../apps/web/public/sprites/tiles.png"),
  itemSheet: readPng("../apps/web/public/sprites/items.png"),
  itemSheetA: readPng("../apps/web/public/sprites/production-items-a.png"),
  itemSheetB: readPng("../apps/web/public/sprites/production-items-b.png"),
  charSheet: readPng("../apps/web/public/sprites/chars.png"),
  actorSheet: readPng("../apps/web/public/sprites/production-actors.png"),
  actorWalkASheet: readPng("../apps/web/public/sprites/production-actors-walk-a.png"),
  actorWalkBSheet: readPng("../apps/web/public/sprites/production-actors-walk-b.png"),
  actorPunchWindupSheet: readPng("../apps/web/public/sprites/production-actors-punch-windup.png"),
  actorPunchImpactSheet: readPng("../apps/web/public/sprites/production-actors-punch-impact.png"),
  actorPunchRecoverySheet: readPng("../apps/web/public/sprites/production-actors-punch-recovery.png"),
  floraSheet: readPng("../apps/web/public/sprites/production-flora.png"),
  propSheet: readPng("../apps/web/public/sprites/production-props.png"),
  terrainSheet: readPng("../apps/web/public/sprites/production-terrain.png"),
  itemSpriteOrder: ITEM_SPRITE_ORDER,
  items: ITEMS,
  buildables: BUILDABLES,
});
const incoming = new Map(sprites.assets.map((asset) => [asset.id, asset]));
const actor = "production-art-pass";
const prisma = new PrismaClient();
const manifest = { palette: sprites.palette, storage: "asset-rows-v1" };

try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" IN ('sprites', 'animations') FOR UPDATE`;
    const spriteContent = await tx.gameContent.findUniqueOrThrow({ where: { kind: "sprites" } });
    const mobContent = await tx.gameContent.findUnique({ where: { kind: "mobs" } });
    const animationContent = await tx.gameContent.findUnique({ where: { kind: "animations" } });
    const existingAssets = await tx.gameSpriteAsset.findMany();
    const spriteRevision = spriteContent.revision + 1;
    const animationRevision = (animationContent?.revision ?? 0) + 1;
    const publishedAt = new Date();

    for (const asset of sprites.assets) {
      await tx.gameSpriteAsset.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          draft: asset,
          published: asset,
          draftDeleted: false,
          publishedDeleted: false,
          draftRevision: spriteRevision,
          publishedRevision: spriteRevision,
          updatedBy: actor,
          publishedAt,
        },
        update: {
          draft: asset,
          published: asset,
          draftDeleted: false,
          publishedDeleted: false,
          draftRevision: spriteRevision,
          publishedRevision: spriteRevision,
          updatedBy: actor,
          updatedAt: publishedAt,
          publishedAt,
        },
      });
      await tx.gameSpriteAssetRevision.upsert({
        where: { assetId_revision: { assetId: asset.id, revision: spriteRevision } },
        create: {
          assetId: asset.id,
          revision: spriteRevision,
          data: asset,
          published: true,
          createdBy: actor,
        },
        update: {
          data: asset,
          deleted: false,
          published: true,
          createdBy: actor,
        },
      });
    }

    const removed = [];
    for (const asset of existingAssets) {
      if (incoming.has(asset.assetId)) continue;
      removed.push(asset.assetId);
      await tx.gameSpriteAsset.update({
        where: { assetId: asset.assetId },
        data: {
          draftDeleted: true,
          publishedDeleted: true,
          draftRevision: spriteRevision,
          publishedRevision: spriteRevision,
          updatedBy: actor,
          updatedAt: publishedAt,
          publishedAt,
        },
      });
      await tx.gameSpriteAssetRevision.upsert({
        where: { assetId_revision: { assetId: asset.assetId, revision: spriteRevision } },
        create: {
          assetId: asset.assetId,
          revision: spriteRevision,
          data: {},
          deleted: true,
          published: true,
          createdBy: actor,
        },
        update: {
          data: {},
          deleted: true,
          published: true,
          createdBy: actor,
        },
      });
    }

    await tx.gameContent.update({
      where: { kind: "sprites" },
      data: {
        draft: manifest,
        published: manifest,
        revision: spriteRevision,
        publishedRevision: spriteRevision,
        updatedBy: actor,
        updatedAt: publishedAt,
        publishedAt,
      },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: "sprites", revision: spriteRevision } },
      create: {
        kind: "sprites",
        revision: spriteRevision,
        data: manifest,
        published: true,
        createdBy: actor,
      },
      update: {
        data: manifest,
        published: true,
        createdBy: actor,
      },
    });

    const publishedMobs = mobContent?.published && typeof mobContent.published === "object"
      ? mobContent.published
      : mobContent?.draft && typeof mobContent.draft === "object"
        ? mobContent.draft
        : {};
    const animations = buildProductionAnimations({
      ...ENEMY_DEFS,
      ...publishedMobs,
      brute: publishedMobs.brute ?? { id: "brute" },
    });
    await tx.gameContent.upsert({
      where: { kind: "animations" },
      create: {
        kind: "animations",
        draft: animations,
        published: animations,
        revision: animationRevision,
        publishedRevision: animationRevision,
        updatedBy: actor,
        publishedAt,
      },
      update: {
        draft: animations,
        published: animations,
        revision: animationRevision,
        publishedRevision: animationRevision,
        updatedBy: actor,
        updatedAt: publishedAt,
        publishedAt,
      },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: "animations", revision: animationRevision } },
      create: {
        kind: "animations",
        revision: animationRevision,
        data: animations,
        published: true,
        createdBy: actor,
      },
      update: {
        data: animations,
        published: true,
        createdBy: actor,
      },
    });

    return {
      spriteRevision,
      animationRevision,
      assets: sprites.assets.length,
      animationTargets: Object.keys(animations).length,
      removed,
    };
  }, { maxWait: 15_000, timeout: 120_000 });

  console.log(JSON.stringify({
    ...result,
    pixelFrames: sprites.assets.reduce((sum, asset) => sum + asset.frames.length, 0),
    rgbaPixels: sprites.assets.reduce((sum, asset) => sum + asset.frames.length * asset.width * asset.height, 0),
    publishedBytes: sprites.assets.reduce((sum, asset) => sum + Buffer.byteLength(JSON.stringify(asset)), 0),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
