import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  buildProductionAnimations,
  buildProductionSpriteDocument,
} from "./lib/production-art.mjs";

/**
 * Exports the exact document art:publish would write to the database as a
 * local JSON file consumed by the /dev/animations QA harness. The file is
 * gitignored, so production deploys never carry it.
 */

const require = createRequire(import.meta.url);
const {
  BUILDABLES,
  ENEMY_DEFS,
  ITEMS,
  ITEM_SPRITE_ORDER,
} = require("../packages/shared/dist/index.js");
const { PNG } = require("pngjs");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spriteDir = resolve(root, "apps/web/public/sprites");
const readPng = (name) => PNG.sync.read(readFileSync(resolve(spriteDir, name)));

const document = buildProductionSpriteDocument({
  tileSheet: readPng("tiles.png"),
  itemSheet: readPng("items.png"),
  itemSheetA: readPng("production-items-a.png"),
  itemSheetB: readPng("production-items-b.png"),
  charSheet: readPng("chars.png"),
  actorSheet: readPng("production-actors.png"),
  actorWalkASheet: readPng("production-actors-walk-a.png"),
  actorWalkBSheet: readPng("production-actors-walk-b.png"),
  actorPunchWindupSheet: readPng("production-actors-punch-windup.png"),
  actorPunchImpactSheet: readPng("production-actors-punch-impact.png"),
  actorPunchRecoverySheet: readPng("production-actors-punch-recovery.png"),
  floraSheet: readPng("production-flora.png"),
  propSheet: readPng("production-props.png"),
  terrainSheet: readPng("production-terrain.png"),
  itemSpriteOrder: ITEM_SPRITE_ORDER,
  items: ITEMS,
  buildables: BUILDABLES,
});

const animations = buildProductionAnimations({
  ...ENEMY_DEFS,
  brute: { id: "brute" },
});

const payload = {
  generatedAt: new Date().toISOString(),
  palette: document.palette,
  assets: Object.fromEntries(document.assets.map((asset) => [asset.id, {
    name: asset.name,
    width: asset.width,
    height: asset.height,
    renderScale: asset.renderScale,
    frames: asset.frames,
  }])),
  animations,
};

const serialized = JSON.stringify(payload);
const outPath = resolve(root, "apps/web/public/dev-art-preview.json");
writeFileSync(outPath, serialized);

console.log(JSON.stringify({
  out: outPath,
  assets: document.assets.length,
  animationTargets: Object.keys(animations).length,
  serializedMiB: Number((Buffer.byteLength(serialized) / 1024 / 1024).toFixed(2)),
  compressedMiB: Number((gzipSync(serialized).byteLength / 1024 / 1024).toFixed(2)),
}, null, 2));
