import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PNG } from "pngjs";
import {
  buildProductionSpriteDocument,
  parseRgba,
} from "./lib/production-art.mjs";

const require = createRequire(import.meta.url);
const {
  BUILDABLES,
  ITEMS,
  ITEM_SPRITE_ORDER,
} = require("../packages/shared/dist/index.js");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spriteDir = resolve(root, "apps/web/public/sprites");
const outputDir = resolve(root, "docs/assets");
mkdirSync(outputDir, { recursive: true });

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

function fill(png, color) {
  const [red, green, blue, alpha] = parseRgba(color);
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = red;
    png.data[index + 1] = green;
    png.data[index + 2] = blue;
    png.data[index + 3] = alpha;
  }
}

function checker(png, x, y, width, height, size = 4) {
  const colors = ["#20251fff", "#2a3029ff"];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const color = colors[(Math.floor(px / size) + Math.floor(py / size)) & 1];
      const [red, green, blue, alpha] = parseRgba(color);
      const offset = ((y + py) * png.width + x + px) * 4;
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = alpha;
    }
  }
}

function blit(png, frame, frameWidth, frameHeight, x, y, scale = 1) {
  for (let sourceY = 0; sourceY < frameHeight; sourceY++) {
    for (let sourceX = 0; sourceX < frameWidth; sourceX++) {
      const [red, green, blue, alpha] = parseRgba(frame[sourceY * frameWidth + sourceX]);
      if (alpha <= 8) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const targetX = x + sourceX * scale + dx;
          const targetY = y + sourceY * scale + dy;
          if (targetX < 0 || targetY < 0 || targetX >= png.width || targetY >= png.height) continue;
          const offset = (targetY * png.width + targetX) * 4;
          png.data[offset] = red;
          png.data[offset + 1] = green;
          png.data[offset + 2] = blue;
          png.data[offset + 3] = alpha;
        }
      }
    }
  }
}

function blitFit(png, frame, frameWidth, frameHeight, x, y, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / frameWidth, maxHeight / frameHeight);
  const drawWidth = Math.max(1, Math.floor(frameWidth * scale));
  const drawHeight = Math.max(1, Math.floor(frameHeight * scale));
  for (let targetY = 0; targetY < drawHeight; targetY++) {
    for (let targetX = 0; targetX < drawWidth; targetX++) {
      const sourceX = Math.min(frameWidth - 1, Math.floor(targetX / scale));
      const sourceY = Math.min(frameHeight - 1, Math.floor(targetY / scale));
      const [red, green, blue, alpha] = parseRgba(frame[sourceY * frameWidth + sourceX]);
      if (alpha <= 8) continue;
      const offset = ((y + targetY) * png.width + x + targetX) * 4;
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = alpha;
    }
  }
  return { width: drawWidth, height: drawHeight };
}

function fittedSize(frameWidth, frameHeight, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / frameWidth, maxHeight / frameHeight);
  return {
    width: Math.max(1, Math.floor(frameWidth * scale)),
    height: Math.max(1, Math.floor(frameHeight * scale)),
  };
}

const characterAssets = document.assets.filter((entry) => entry.id.startsWith("character:"));
const serializedDocument = JSON.stringify(document);
{
  const maxFrameWidth = Math.max(...characterAssets.map((entry) => entry.width));
  const maxFrameHeight = Math.max(...characterAssets.map((entry) => entry.height));
  const scale = Math.max(maxFrameWidth, maxFrameHeight) > 32 ? 1 : 2;
  const gap = 4;
  const rowHeight = maxFrameHeight * scale + gap * 2;
  const columnWidth = maxFrameWidth * scale + gap;
  const png = new PNG({
    width: characterAssets[0].frames.length * columnWidth + gap,
    height: characterAssets.length * rowHeight + gap,
  });
  fill(png, "#171b17ff");
  characterAssets.forEach((entry, row) => {
    entry.frames.forEach((frame, column) => {
      const x = gap + column * columnWidth;
      const y = gap + row * rowHeight;
      checker(png, x, y, maxFrameWidth * scale, maxFrameHeight * scale, 6);
      blit(
        png,
        frame,
        entry.width,
        entry.height,
        x + Math.floor((maxFrameWidth - entry.width) * scale / 2),
        y + (maxFrameHeight - entry.height) * scale,
        scale,
      );
    });
  });
  writeFileSync(resolve(outputDir, "production-animation-frames.png"), PNG.sync.write(png));
}

{
  const groups = [
    document.assets.filter((entry) => entry.id.startsWith("item:")),
    document.assets.filter((entry) => entry.id.startsWith("block:")),
    document.assets.filter((entry) => entry.id.startsWith("resource:")),
    document.assets.filter((entry) => entry.id.startsWith("terrain:")),
  ];
  const columns = 18;
  const cell = 40;
  const groupRows = groups.map((entries) => Math.ceil(entries.length / columns));
  const png = new PNG({
    width: columns * cell + 16,
    height: groupRows.reduce((sum, rows) => sum + rows * cell + 12, 12),
  });
  fill(png, "#171b17ff");
  let top = 8;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const entries = groups[groupIndex];
    entries.forEach((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 8 + column * cell;
      const y = top + row * cell;
      checker(png, x, y, 34, 34, 5);
      const frame = entry.frames[0];
      const fitted = fittedSize(entry.width, entry.height, 32, 32);
      blitFit(
        png,
        frame,
        entry.width,
        entry.height,
        x + Math.floor((34 - fitted.width) / 2),
        y + 34 - fitted.height,
        32,
        32,
      );
    });
    top += groupRows[groupIndex] * cell + 12;
  }
  writeFileSync(resolve(outputDir, "production-sprite-catalog.png"), PNG.sync.write(png));
}

console.log(JSON.stringify({
  assets: document.assets.length,
  items: document.assets.filter((entry) => entry.id.startsWith("item:")).length,
  characters: characterAssets.length,
  animationFrames: characterAssets.reduce((sum, entry) => sum + entry.frames.length, 0),
  blocks: document.assets.filter((entry) => entry.id.startsWith("block:")).length,
  resources: document.assets.filter((entry) => entry.id.startsWith("resource:")).length,
  terrain: document.assets.filter((entry) => entry.id.startsWith("terrain:")).length,
  serializedMiB: Number((Buffer.byteLength(serializedDocument) / 1024 / 1024).toFixed(2)),
  compressedMiB: Number((gzipSync(serializedDocument).byteLength / 1024 / 1024).toFixed(2)),
  catalog: resolve(outputDir, "production-sprite-catalog.png"),
  animationPreview: resolve(outputDir, "production-animation-frames.png"),
}, null, 2));
