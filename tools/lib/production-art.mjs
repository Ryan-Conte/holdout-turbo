const EMPTY = "#00000000";

export const PRODUCTION_RENDER_SCALE = 4 / 3;
export const PRODUCTION_CHARACTER_ROWS = {
  player: 0,
  zombie: 8,
  military: 9,
  trader: 10,
  deer: 11,
  rabbit: 12,
  boar: 13,
  wolf: 14,
  fox: 15,
  bear: 16,
  moose: 17,
  raccoon: 18,
  cougar: 19,
};

export const PRODUCTION_ACTOR_CELLS = {
  player: 0,
  zombie: 1,
  military: 2,
  trader: 3,
  deer: 4,
  rabbit: 5,
  boar: 6,
  wolf: 7,
  fox: 8,
  bear: 9,
  moose: 10,
  raccoon: 11,
  cougar: 12,
  brute: 13,
};

export const PRODUCTION_FLORA_BLOCK_CELLS = {
  dead_tree: 4,
  young_pine: 5,
  dense_shrub: 6,
  berry_bush: 7,
  fern_patch: 8,
  reeds: 9,
  wildflowers: 10,
  tall_grass: 11,
  fallen_log: 12,
  mossy_stump: 13,
  bramble: 14,
  mushrooms: 15,
};

export const PRODUCTION_PIXEL_PALETTE = [
  EMPTY,
  "#151816ff", "#222723ff", "#323832ff", "#4d544bff", "#73786dff", "#a5a394ff", "#ded7c3ff",
  "#243326ff", "#344a31ff", "#49643dff", "#6d8651ff", "#93a765ff",
  "#342a23ff", "#4d382aff", "#6c4a32ff", "#93623dff", "#bd8755ff", "#d8aa75ff",
  "#38292aff", "#63383aff", "#914844ff", "#c16051ff",
  "#26313aff", "#354854ff", "#4f6b76ff", "#7395a0ff",
  "#5b4b2cff", "#947135ff", "#c69a43ff", "#e8c867ff",
  "#57b9c4ff",
];

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));
const hash = (x, y, seed = 0) => {
  let value = Math.imul(x + 17 + seed, 374761393) + Math.imul(y + 29, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

function rgbaHex(red, green, blue, alpha = 255) {
  return `#${[red, green, blue, alpha].map((part) => clampByte(part).toString(16).padStart(2, "0")).join("")}`;
}

export function parseRgba(color) {
  const match = /^#([0-9a-f]{8})$/i.exec(color ?? "");
  if (!match) return [0, 0, 0, 0];
  const value = match[1];
  return [0, 2, 4, 6].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function visible(color) {
  return parseRgba(color)[3] > 8;
}

function shade(color, amount) {
  const [red, green, blue, alpha] = parseRgba(color);
  if (alpha <= 8) return EMPTY;
  const lift = amount >= 0 ? 255 : 0;
  const strength = Math.abs(amount);
  return rgbaHex(
    red + (lift - red) * strength,
    green + (lift - green) * strength,
    blue + (lift - blue) * strength,
    alpha,
  );
}

function blend(color, tint, amount) {
  const [red, green, blue, alpha] = parseRgba(color);
  const [tr, tg, tb] = parseRgba(tint);
  if (alpha <= 8) return EMPTY;
  return rgbaHex(
    red + (tr - red) * amount,
    green + (tg - green) * amount,
    blue + (tb - blue) * amount,
    alpha,
  );
}

export function cropSheetPixels(sheet, col, row = 0, width = 16, height = 16) {
  const pixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = ((row * 16 + y) * sheet.width + col * 16 + x) * 4;
      pixels.push(rgbaHex(
        sheet.data[offset],
        sheet.data[offset + 1],
        sheet.data[offset + 2],
        sheet.data[offset + 3],
      ));
    }
  }
  return pixels;
}

function cropGridCell(sheet, index, columns = 4, rows = 4, cuts = {}) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = cuts.columnCuts?.[column] ?? Math.round(column * sheet.width / columns);
  const right = cuts.columnCuts?.[column + 1] ?? Math.round((column + 1) * sheet.width / columns);
  const top = cuts.rowCuts?.[row] ?? Math.round(row * sheet.height / rows);
  const bottom = cuts.rowCuts?.[row + 1] ?? Math.round((row + 1) * sheet.height / rows);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const pixels = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * sheet.width + x) * 4;
      pixels.push(rgbaHex(
        sheet.data[offset],
        sheet.data[offset + 1],
        sheet.data[offset + 2],
        sheet.data[offset + 3],
      ));
    }
  }
  return { pixels, width, height };
}

function resizeNearest(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const target = new Array(targetWidth * targetHeight).fill(EMPTY);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth));
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight));
      target[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX] ?? EMPTY;
    }
  }
  return target;
}

function fitTransparentCell(sheet, index, {
  width = 64,
  height = 64,
  paddingX = 3,
  paddingTop = 3,
  paddingBottom = 2,
  columns = 4,
  rows = 4,
  rowCuts,
  columnCuts,
} = {}) {
  const cell = cropGridCell(sheet, index, columns, rows, { rowCuts, columnCuts });
  let minX = cell.width;
  let minY = cell.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (!visible(cell.pixels[y * cell.width + x])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return new Array(width * height).fill(EMPTY);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = new Array(cropWidth * cropHeight).fill(EMPTY);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      cropped[y * cropWidth + x] = cell.pixels[(minY + y) * cell.width + minX + x];
    }
  }
  const scale = Math.min(
    (width - paddingX * 2) / cropWidth,
    (height - paddingTop - paddingBottom) / cropHeight,
  );
  const drawWidth = Math.max(1, Math.floor(cropWidth * scale));
  const drawHeight = Math.max(1, Math.floor(cropHeight * scale));
  const resized = resizeNearest(cropped, cropWidth, cropHeight, drawWidth, drawHeight);
  const target = new Array(width * height).fill(EMPTY);
  const offsetX = Math.floor((width - drawWidth) / 2);
  const offsetY = height - paddingBottom - drawHeight;
  for (let y = 0; y < drawHeight; y++) {
    for (let x = 0; x < drawWidth; x++) {
      target[(offsetY + y) * width + offsetX + x] = resized[y * drawWidth + x];
    }
  }
  return target;
}

function fitPoseCells(inputs, {
  width = 64,
  height = 64,
  paddingX = 3,
  paddingTop = 3,
  paddingBottom = 2,
} = {}) {
  const cells = inputs.map(({ sheet, index, columns = 4, rows = 4, rowCuts, columnCuts }) =>
    cropGridCell(sheet, index, columns, rows, { rowCuts, columnCuts }));
  const crops = cells.map((cell) => {
    let minX = cell.width; let minY = cell.height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (!visible(cell.pixels[y * cell.width + x])) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return { pixels: [EMPTY], width: 1, height: 1 };
    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const pixels = new Array(cropWidth * cropHeight).fill(EMPTY);
    for (let y = 0; y < cropHeight; y++) {
      for (let x = 0; x < cropWidth; x++) pixels[y * cropWidth + x] = cell.pixels[(minY + y) * cell.width + minX + x];
    }
    return { pixels, width: cropWidth, height: cropHeight };
  });
  const maxCropWidth = Math.max(...crops.map((crop) => crop.width));
  const maxCropHeight = Math.max(...crops.map((crop) => crop.height));
  const scale = Math.min(
    (width - paddingX * 2) / maxCropWidth,
    (height - paddingTop - paddingBottom) / maxCropHeight,
  );
  return crops.map((crop) => {
    const drawWidth = Math.max(1, Math.floor(crop.width * scale));
    const drawHeight = Math.max(1, Math.floor(crop.height * scale));
    const resized = resizeNearest(crop.pixels, crop.width, crop.height, drawWidth, drawHeight);
    const target = new Array(width * height).fill(EMPTY);
    const offsetX = Math.floor((width - drawWidth) / 2);
    const offsetY = height - paddingBottom - drawHeight;
    for (let y = 0; y < drawHeight; y++) {
      for (let x = 0; x < drawWidth; x++) target[(offsetY + y) * width + offsetX + x] = resized[y * drawWidth + x];
    }
    return target;
  });
}

function fractionalCuts(length, fractions) {
  return fractions.map((fraction) => Math.round(length * fraction));
}

function gridTexture(sheet, index, width = 64, height = 64) {
  const cell = cropGridCell(sheet, index);
  return resizeNearest(cell.pixels, cell.width, cell.height, width, height);
}

function outlined(frame, width, height, color = "#11140fff") {
  const result = frame.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visible(frame[y * width + x])) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && py >= 0 && px < width && py < height && visible(frame[py * width + px])) {
            touches = true;
            break;
          }
        }
      }
      if (touches) result[y * width + x] = color;
    }
  }
  return result;
}

/**
 * Raises the fallback 16 px cluster language to 24 px (and 32 px resources
 * to 48 px) without blurring it. Boundary pixels are re-cut, top-left planes
 * receive restrained highlights, and material interiors get deterministic
 * micro-clusters instead of uniform nearest-neighbour blocks.
 */
export function refinePixelFrame(source, sourceWidth, sourceHeight, options = {}) {
  const targetWidth = options.targetWidth ?? Math.round(sourceWidth * 1.5);
  const targetHeight = options.targetHeight ?? Math.round(sourceHeight * 1.5);
  const seed = options.seed ?? 0;
  const texture = options.texture ?? 0.045;
  const target = new Array(targetWidth * targetHeight).fill(EMPTY);
  const at = (x, y) => x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight
    ? EMPTY
    : source[y * sourceWidth + x] ?? EMPTY;

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const sourceXFloat = ((x + 0.5) * sourceWidth / targetWidth) - 0.5;
      const sourceYFloat = ((y + 0.5) * sourceHeight / targetHeight) - 0.5;
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, Math.round(sourceXFloat)));
      const sourceY = Math.max(0, Math.min(sourceHeight - 1, Math.round(sourceYFloat)));
      const base = at(sourceX, sourceY);
      if (!visible(base)) continue;

      const left = at(sourceX - 1, sourceY);
      const right = at(sourceX + 1, sourceY);
      const up = at(sourceX, sourceY - 1);
      const down = at(sourceX, sourceY + 1);
      const localX = ((x + 0.5) * sourceWidth / targetWidth) - sourceX;
      const localY = ((y + 0.5) * sourceHeight / targetHeight) - sourceY;
      const openLeft = !visible(left);
      const openRight = !visible(right);
      const openUp = !visible(up);
      const openDown = !visible(down);

      // Re-cut diagonal silhouette corners so 1.5x scaling does not create
      // blocky stair-step protrusions.
      if (
        (openLeft && openUp && localX < -0.12 && localY < -0.12)
        || (openRight && openUp && localX > 0.12 && localY < -0.12)
        || (openLeft && openDown && localX < -0.12 && localY > 0.12)
        || (openRight && openDown && localX > 0.12 && localY > 0.12)
      ) continue;

      let color = base;
      if ((openUp && localY < 0.05) || (openLeft && localX < 0.05)) color = shade(color, 0.12);
      if ((openDown && localY > -0.05) || (openRight && localX > -0.05)) color = shade(color, -0.18);

      const noise = hash(x, y, seed);
      if (!openLeft && !openRight && !openUp && !openDown && noise < texture) {
        color = shade(color, noise < texture * 0.38 ? 0.08 : -0.09);
      }
      target[y * targetWidth + x] = color;
    }
  }
  return target;
}

function shiftUpper(frame, width, height, dx, dy, cutoff = 0.68) {
  const next = new Array(frame.length).fill(EMPTY);
  const cutoffY = Math.floor(height * cutoff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const move = y < cutoffY;
      const nx = x + (move ? dx : 0);
      const ny = y + (move ? dy : 0);
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) next[ny * width + nx] = frame[y * width + x];
    }
  }
  return next;
}

function tinted(frame, tint, amount) {
  return frame.map((color) => visible(color) ? blend(color, tint, amount) : EMPTY);
}

function recolorIronwood(frame) {
  return frame.map((color) => {
    const [red, green, blue, alpha] = parseRgba(color);
    if (alpha <= 8) return EMPTY;
    if (green > red * 1.05 && green > blue) return rgbaHex(red * 0.58, green * 0.68, blue * 0.68 + 12, alpha);
    if (red > green && red > blue) return rgbaHex(red * 0.7, green * 0.58, blue * 0.62 + 8, alpha);
    return rgbaHex(red * 0.72, green * 0.72, blue * 0.78 + 5, alpha);
  });
}

function bulkBrute(frame, width, height) {
  const next = tinted(frame, "#6f563fff", 0.22);
  const copy = next.slice();
  for (let y = Math.floor(height * 0.28); y < Math.floor(height * 0.78); y++) {
    for (let x = 1; x < width - 1; x++) {
      const color = copy[y * width + x];
      if (!visible(color)) continue;
      if (!visible(copy[y * width + x - 1])) next[y * width + x - 1] = shade(color, -0.12);
      if (!visible(copy[y * width + x + 1])) next[y * width + x + 1] = shade(color, -0.18);
    }
  }
  return next;
}

function animatedFrames(baseFrames, width, height, kind) {
  const quadruped = ["deer", "rabbit", "boar", "wolf", "fox", "bear", "moose", "raccoon", "cougar"].includes(kind);
  const original = baseFrames[0];
  const contactLeft = baseFrames[1] ?? original;
  const contactRight = baseFrames[2] ?? contactLeft;
  const punchWindup = baseFrames[3] ?? original;
  const punchImpact = baseFrames[4] ?? contactLeft;
  const punchRecovery = baseFrames[5] ?? punchWindup;
  const motion = Math.max(1, Math.round(width / 24));
  const idleLift = quadruped ? 0 : -Math.max(1, Math.round(motion / 2));
  const idleShift = kind === "bear" || kind === "moose" ? Math.max(1, Math.round(motion / 2)) : 0;
  const hitTint = kind === "zombie" || kind === "brute" ? "#c9896bff" : "#a94f48ff";

  // The generated sheets provide actual planted limb poses. Only the neutral
  // passing frames receive a tiny torso lift, keeping feet fixed instead of
  // sliding the entire sprite across its world-space anchor.
  const passingLeft = shiftUpper(original, width, height, 0, -Math.max(1, Math.round(motion / 2)), quadruped ? 0.62 : 0.72);
  const passingRight = original;
  const anticipation = quadruped
    ? original
    : shiftUpper(original, width, height, -Math.max(1, motion), 0, 0.72);
  const impact = quadruped
    ? contactLeft
    : shiftUpper(contactLeft, width, height, Math.max(1, motion), -Math.max(1, Math.round(motion / 2)), 0.72);
  const recoil = quadruped
    ? contactRight
    : shiftUpper(original, width, height, -motion * 2, Math.max(1, Math.round(motion / 2)), 0.72);
  const limp = quadruped
    ? contactLeft
    : shiftUpper(original, width, height, -motion, Math.max(1, motion), 0.8);

  let frames = [
    original,
    shiftUpper(original, width, height, idleShift, idleLift),
    contactLeft,
    passingLeft,
    contactRight,
    passingRight,
    contactLeft,
    contactRight,
    anticipation,
    impact,
    contactRight,
    tinted(recoil, hitTint, 0.26),
    tinted(original, hitTint, 0.1),
    tinted(recoil, hitTint, 0.12),
    limp,
    tinted(original, "#20251fff", 0.12),
    punchWindup,
    punchImpact,
    punchRecovery,
  ];
  if (kind === "brute") frames = frames.map((frame) => bulkBrute(frame, width, height));
  return frames;
}

function baseCanvas(width = 16, height = 16) {
  return {
    width,
    height,
    pixels: new Array(width * height).fill(EMPTY),
  };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  canvas.pixels[y * canvas.width + x] = color;
}

function fillRect(canvas, x, y, width, height, color) {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) setPixel(canvas, px, py, color);
  }
}

function wreckedCarBase() {
  const canvas = baseCanvas();
  fillRect(canvas, 1, 7, 14, 6, "#252b29ff");
  fillRect(canvas, 2, 6, 12, 6, "#6d5136ff");
  fillRect(canvas, 5, 4, 6, 4, "#4d5a5aff");
  fillRect(canvas, 6, 5, 4, 3, "#26383eff");
  fillRect(canvas, 2, 8, 12, 2, "#8b5b32ff");
  fillRect(canvas, 3, 12, 3, 3, "#171a19ff");
  fillRect(canvas, 11, 12, 3, 3, "#171a19ff");
  setPixel(canvas, 2, 7, "#c47a39ff");
  setPixel(canvas, 9, 10, "#d19745ff");
  setPixel(canvas, 13, 9, "#d7b45fff");
  return canvas;
}

function roadBarrierBase() {
  const canvas = baseCanvas();
  fillRect(canvas, 2, 6, 12, 4, "#d5c6a3ff");
  fillRect(canvas, 3, 7, 3, 2, "#9d4d3fff");
  fillRect(canvas, 8, 7, 3, 2, "#9d4d3fff");
  fillRect(canvas, 3, 10, 2, 5, "#4a4033ff");
  fillRect(canvas, 11, 10, 2, 5, "#4a4033ff");
  fillRect(canvas, 1, 14, 5, 2, "#272b29ff");
  fillRect(canvas, 10, 14, 5, 2, "#272b29ff");
  return canvas;
}

function sandbagBase() {
  const canvas = baseCanvas();
  for (const [x, y] of [[1, 10], [6, 10], [11, 10], [3, 7], [8, 7], [5, 4]]) {
    fillRect(canvas, x, y, 5, 3, "#81724eff");
    fillRect(canvas, x + 1, y, 3, 1, "#ad9b6cff");
    setPixel(canvas, x, y + 2, "#524832ff");
    setPixel(canvas, x + 4, y + 2, "#524832ff");
  }
  return canvas;
}

function deadTreeBase() {
  const canvas = baseCanvas(16, 24);
  fillRect(canvas, 7, 6, 3, 18, "#4c3828ff");
  fillRect(canvas, 8, 5, 1, 18, "#765238ff");
  for (const [x, y, w, h] of [[3, 7, 5, 2], [9, 9, 5, 2], [4, 3, 2, 6], [12, 5, 2, 6], [5, 1, 2, 4], [13, 3, 1, 4]]) {
    fillRect(canvas, x, y, w, h, "#4c3828ff");
  }
  fillRect(canvas, 5, 22, 7, 2, "#30271fff");
  return canvas;
}

function chestBase() {
  const canvas = baseCanvas();
  fillRect(canvas, 2, 5, 12, 9, "#302318ff");
  fillRect(canvas, 3, 6, 10, 7, "#7d512cff");
  fillRect(canvas, 2, 4, 12, 4, "#332419ff");
  fillRect(canvas, 3, 5, 10, 2, "#a06d38ff");
  fillRect(canvas, 7, 7, 3, 5, "#c99a49ff");
  setPixel(canvas, 8, 8, "#f0d071ff");
  return canvas;
}

function asset(id, name, width, height, frames, renderScale = PRODUCTION_RENDER_SCALE) {
  return {
    id,
    name,
    width,
    height,
    renderScale,
    pixels: frames[0] ?? [],
    frames,
  };
}

function refinedAsset(id, name, source, sourceWidth, sourceHeight, options = {}) {
  const width = options.width ?? Math.round(sourceWidth * 1.5);
  const height = options.height ?? Math.round(sourceHeight * 1.5);
  const pixels = refinePixelFrame(source, sourceWidth, sourceHeight, {
    targetWidth: width,
    targetHeight: height,
    seed: options.seed ?? 0,
    texture: options.texture,
  });
  return asset(id, name, width, height, [pixels], options.renderScale ?? PRODUCTION_RENDER_SCALE);
}

export function buildProductionSpriteDocument({
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
  itemSpriteOrder,
  items,
  buildables,
}) {
  const assets = [];

  const itemRowsA = itemSheetA
    ? fractionalCuts(itemSheetA.height, [0, 0.17, 0.33, 0.49, 0.62, 0.79, 1])
    : undefined;
  const itemRowsB = itemSheetB
    ? fractionalCuts(itemSheetB.height, [0, 0.17, 0.34, 0.5, 0.64, 0.79, 1])
    : undefined;
  for (let index = 0; index < itemSpriteOrder.length; index++) {
    const id = itemSpriteOrder[index];
    const generatedSheet = index < 36 ? itemSheetA : itemSheetB;
    const generatedCell = index < 36 ? index : index - 36;
    const generatedRows = index < 36 ? itemRowsA : itemRowsB;
    const pixels = generatedSheet
      ? fitTransparentCell(generatedSheet, generatedCell, {
        width: 48,
        height: 48,
        paddingX: 2,
        paddingTop: 2,
        paddingBottom: 2,
        columns: 6,
        rows: 6,
        rowCuts: generatedRows,
      })
      : outlined(refinePixelFrame(
        cropSheetPixels(itemSheet, index),
        16,
        16,
        { targetWidth: 32, targetHeight: 32, seed: 1000 + index, texture: 0.055 },
      ), 32, 32);
    const itemSize = generatedSheet ? 48 : 32;
    assets.push(asset(
      `item:${id}`,
      items[id].name,
      itemSize,
      itemSize,
      [pixels],
      1,
    ));
  }

  if (actorSheet) {
    const actorRowCuts = fractionalCuts(actorSheet.height, [0, 0.25, 0.5, 0.7, 1]);
    const actorWalkARowCuts = actorWalkASheet
      ? fractionalCuts(actorWalkASheet.height, [0, 0.25, 0.5, 0.7, 1])
      : undefined;
    const actorWalkBRowCuts = actorWalkBSheet
      ? fractionalCuts(actorWalkBSheet.height, [0, 0.25, 0.5, 0.7, 1])
      : undefined;
    const actorPunchWindupRowCuts = actorPunchWindupSheet
      ? fractionalCuts(actorPunchWindupSheet.height, [0, 0.25, 0.5, 0.7, 1])
      : undefined;
    const actorPunchImpactRowCuts = actorPunchImpactSheet
      ? fractionalCuts(actorPunchImpactSheet.height, [0, 0.25, 0.5, 0.7, 1])
      : undefined;
    const actorPunchRecoveryRowCuts = actorPunchRecoverySheet
      ? fractionalCuts(actorPunchRecoverySheet.height, [0, 0.25, 0.5, 0.7, 1])
      : undefined;
    const actorScales = {
      player: 0.72,
      zombie: 0.72,
      military: 0.72,
      trader: 0.72,
      deer: 0.78,
      rabbit: 0.56,
      boar: 0.82,
      wolf: 0.78,
      fox: 0.7,
      bear: 0.92,
      moose: 0.92,
      raccoon: 0.6,
      cougar: 0.84,
      brute: 0.9,
    };
    for (const [id, cell] of Object.entries(PRODUCTION_ACTOR_CELLS)) {
      const quadruped = ["deer", "rabbit", "boar", "wolf", "fox", "bear", "moose", "raccoon", "cougar"].includes(id);
      // Wider transparent canvases let committed strikes extend beyond the
      // idle silhouette without shrinking the actor's height or clipping the
      // fist, muzzle, antlers, or tail.
      const actorWidth = quadruped ? 96 : 80;
      const [base, contactLeft, contactRight, punchWindup, punchImpact, punchRecovery] = fitPoseCells([
        { sheet: actorSheet, index: cell, rowCuts: actorRowCuts },
        { sheet: actorWalkASheet ?? actorSheet, index: cell, rowCuts: actorWalkARowCuts ?? actorRowCuts },
        { sheet: actorWalkBSheet ?? actorWalkASheet ?? actorSheet, index: cell, rowCuts: actorWalkBRowCuts ?? actorWalkARowCuts ?? actorRowCuts },
        { sheet: actorPunchWindupSheet ?? actorSheet, index: cell, rowCuts: actorPunchWindupRowCuts ?? actorRowCuts },
        { sheet: actorPunchImpactSheet ?? actorSheet, index: cell, rowCuts: actorPunchImpactRowCuts ?? actorRowCuts },
        { sheet: actorPunchRecoverySheet ?? actorSheet, index: cell, rowCuts: actorPunchRecoveryRowCuts ?? actorRowCuts },
      ], { width: actorWidth, height: 64 });
      const frames = animatedFrames([base, contactLeft, contactRight, punchWindup, punchImpact, punchRecovery], actorWidth, 64, id);
      assets.push(asset(
        `character:${id}`,
        id === "player" ? "Survivor base" : id === "brute" ? "Infected brute" : id.replaceAll("_", " "),
        actorWidth,
        64,
        frames,
        actorScales[id] ?? 0.72,
      ));
    }
  } else {
    for (const [id, row] of Object.entries(PRODUCTION_CHARACTER_ROWS)) {
      const bases = [0, 1, 2, 3].map((frame) => refinePixelFrame(
        cropSheetPixels(charSheet, frame, row),
        16,
        16,
        { targetWidth: 24, targetHeight: 24, seed: 2000 + row * 17 + frame, texture: 0.018 },
      ));
      const frames = animatedFrames(bases, 24, 24, id);
      assets.push(asset(`character:${id}`, id === "player" ? "Survivor base" : id.replaceAll("_", " "), 24, 24, frames));
    }
    const zombieFrames = assets.find((entry) => entry.id === "character:zombie").frames;
    assets.push(asset(
      "character:brute",
      "Infected brute",
      24,
      24,
      zombieFrames.map((frame) => bulkBrute(frame, 24, 24)),
    ));
  }

  if (floraSheet) {
    const floraRowCuts = fractionalCuts(floraSheet.height, [0, 0.29, 0.54, 0.76, 1]);
    assets.push(asset("resource:tree", "Broadleaf tree", 64, 64, [fitTransparentCell(floraSheet, 1, { rowCuts: floraRowCuts })], 1));
    assets.push(asset("resource:ironwood", "Autumn ironwood", 64, 64, [fitTransparentCell(floraSheet, 3, { rowCuts: floraRowCuts })], 1));
    assets.push(asset("resource:pine_tree", "Spruce pine", 64, 64, [fitTransparentCell(floraSheet, 0, { rowCuts: floraRowCuts })], 1));
    assets.push(asset("resource:birch_tree", "White birch", 64, 64, [fitTransparentCell(floraSheet, 2, { rowCuts: floraRowCuts })], 1));
  } else {
    const treeSource = cropSheetPixels(tileSheet, 10, 0, 32, 32);
    const tree = refinePixelFrame(treeSource, 32, 32, { targetWidth: 48, targetHeight: 48, seed: 3001, texture: 0.055 });
    assets.push(asset("resource:tree", "Common tree", 48, 48, [tree]));
    assets.push(asset("resource:ironwood", "Ironwood tree", 48, 48, [recolorIronwood(tree)]));
  }
  assets.push(refinedAsset("resource:rock", "Stone outcrop", cropSheetPixels(tileSheet, 12), 16, 16, { width: 40, height: 40, seed: 3003, texture: 0.08, renderScale: 0.9 }));
  assets.push(refinedAsset("resource:copper_vein", "Copper vein", cropSheetPixels(tileSheet, 25), 16, 16, { width: 40, height: 40, seed: 3004, texture: 0.07, renderScale: 0.9 }));
  assets.push(refinedAsset("resource:iron_vein", "Iron vein", cropSheetPixels(tileSheet, 26), 16, 16, { width: 40, height: 40, seed: 3005, texture: 0.07, renderScale: 0.9 }));

  if (propSheet) {
    const propRowCuts = fractionalCuts(propSheet.height, [0, 0.25, 0.5, 0.72, 1]);
    const propCells = {
      workbench: 0,
      furnace: 1,
      anvil: 2,
      firepit: 3,
      bed: 4,
      chest: 5,
      steel_crate: 6,
      torch: 7,
      wall: 8,
      stone_wall: 9,
      door: 10,
      fence: 11,
      wrecked_car: 12,
      road_barrier: 13,
      sandbag_wall: 14,
      dead_tree: 15,
    };
    const propScales = {
      wall: 0.55,
      stone_wall: 0.55,
      door: 0.58,
      fence: 0.62,
      torch: 0.72,
      road_barrier: 0.72,
      wrecked_car: 0.88,
      sandbag_wall: 0.82,
      dead_tree: 1,
    };
    for (const [id, cell] of Object.entries(propCells)) {
      assets.push(asset(
        `block:${id}`,
        buildables[id]?.name ?? id.replaceAll("_", " "),
        64,
        64,
        [fitTransparentCell(propSheet, cell, { rowCuts: propRowCuts })],
        propScales[id] ?? 0.82,
      ));
    }
    if (terrainSheet) {
      assets.push(asset("block:wood_floor", buildables.wood_floor?.name ?? "Wood floor", 64, 64, [gridTexture(terrainSheet, 6)], 0.5));
      assets.push(asset("block:stone_floor", buildables.stone_floor?.name ?? "Stone floor", 64, 64, [gridTexture(terrainSheet, 7)], 0.5));
    }
  } else {
    const blockColumns = {
      workbench: 14,
      firepit: 15,
      furnace: 16,
      wood_floor: 19,
      stone_floor: 20,
      wall: 21,
      door: 22,
      fence: 23,
      torch: 24,
      anvil: 27,
    };
    let blockSeed = 4000;
    for (const [id, col] of Object.entries(blockColumns)) {
      assets.push(refinedAsset(
        `block:${id}`,
        buildables[id]?.name ?? id.replaceAll("_", " "),
        cropSheetPixels(tileSheet, col),
        16,
        16,
        { seed: blockSeed++, texture: id.includes("floor") ? 0.045 : 0.025 },
      ));
    }
    const bedSource = [
      ...cropSheetPixels(tileSheet, 9),
      ...cropSheetPixels(tileSheet, 13),
    ];
    assets.push(refinedAsset("block:bed", "Bed", bedSource, 16, 32, { width: 24, height: 48, seed: 4020, texture: 0.018 }));
    assets.push(refinedAsset("block:chest", "Storage chest", chestBase().pixels, 16, 16, { seed: 4021, texture: 0.02 }));
    assets.push(refinedAsset("block:steel_crate", "Steel crate", cropSheetPixels(tileSheet, 14), 16, 16, { seed: 4022, texture: 0.022 }));
    for (const [id, name, base, seed] of [
      ["wrecked_car", "Wrecked car", wreckedCarBase(), 4030],
      ["road_barrier", "Road barrier", roadBarrierBase(), 4031],
      ["sandbag_wall", "Sandbag wall", sandbagBase(), 4032],
      ["dead_tree", "Dead tree", deadTreeBase(), 4033],
    ]) {
      assets.push(refinedAsset(`block:${id}`, name, base.pixels, base.width, base.height, { seed, texture: 0.03 }));
    }
  }

  if (floraSheet) {
    const floraRowCuts = fractionalCuts(floraSheet.height, [0, 0.29, 0.54, 0.76, 1]);
    const floraNames = {
      young_pine: "Young pine",
      dense_shrub: "Dense shrub",
      berry_bush: "Red berry bush",
      fern_patch: "Fern patch",
      reeds: "Reeds and cattails",
      wildflowers: "Wildflower patch",
      tall_grass: "Tall dry grass",
      fallen_log: "Fallen mossy log",
      mossy_stump: "Mossy stump",
      bramble: "Bramble patch",
      mushrooms: "Mushroom cluster",
    };
    const floraScales = {
      young_pine: 0.78,
      dense_shrub: 0.68,
      berry_bush: 0.68,
      fern_patch: 0.58,
      reeds: 0.64,
      wildflowers: 0.56,
      tall_grass: 0.64,
      fallen_log: 0.8,
      mossy_stump: 0.68,
      bramble: 0.64,
      mushrooms: 0.52,
    };
    for (const [id, cell] of Object.entries(PRODUCTION_FLORA_BLOCK_CELLS)) {
      if (id === "dead_tree") continue;
      assets.push(asset(
        `block:${id}`,
        floraNames[id] ?? id.replaceAll("_", " "),
        64,
        64,
        [fitTransparentCell(floraSheet, cell, { rowCuts: floraRowCuts })],
        floraScales[id] ?? 0.65,
      ));
    }
  }

  const terrainSources = {
    grass: [0, "Grass"],
    water: [1, "Water"],
    sand: [2, "Sand"],
    road: [3, "Dirt road"],
    mud: [4, "Deep mud"],
    asphalt: [5, "Asphalt"],
    floor: [6, "Interior floor"],
    wall: [7, "Building wall"],
    tree: [8, "Tree ground"],
    rock: [9, "Rock ground"],
    doormat: [10, "Door mat"],
    bed: [11, "Bed"],
    copper_ore: [12, "Copper vein ground"],
    iron_ore: [13, "Iron vein ground"],
    cliff: [14, "Cliff"],
  };
  if (terrainSheet) {
    for (const [id, [cell, name]] of Object.entries(terrainSources)) {
      assets.push(asset(`terrain:${id}`, name, 64, 64, [gridTexture(terrainSheet, cell)], 0.5));
    }
  } else {
    const fallbackColumns = {
      grass: 0,
      water: 2,
      sand: 3,
      road: 4,
      mud: 4,
      asphalt: 5,
      floor: 6,
      wall: 7,
      doormat: 8,
      tree: 0,
      rock: 12,
      bed: 13,
      copper_ore: 25,
      iron_ore: 26,
      cliff: 28,
    };
    let terrainSeed = 5000;
    for (const [id, [, name]] of Object.entries(terrainSources)) {
      const col = fallbackColumns[id];
      let pixels = refinePixelFrame(cropSheetPixels(tileSheet, col), 16, 16, {
        targetWidth: 24,
        targetHeight: 24,
        seed: terrainSeed++,
        texture: ["grass", "tree", "road", "mud", "sand"].includes(id) ? 0.075 : 0.04,
      });
      if (id === "mud") pixels = pixels.map((color) => visible(color) ? blend(shade(color, -0.13), "#514536ff", 0.22) : color);
      if (id === "tree") pixels = pixels.map((color) => visible(color) ? blend(color, "#365839ff", 0.12) : color);
      assets.push(asset(`terrain:${id}`, name, 24, 24, [pixels], 1));
    }
  }

  return { palette: PRODUCTION_PIXEL_PALETTE, assets };
}

function clip(frames, frameMs, loop, keyframes) {
  return { frames, frameMs, loop, ...(keyframes?.length ? { keyframes } : {}) };
}

export function buildProductionAnimations(mobDefs) {
  const profile = (id) => {
    const animal = ["deer", "rabbit", "boar", "wolf", "fox", "bear", "moose", "raccoon", "cougar"].includes(id);
    const heavy = id === "bear" || id === "moose" || id === "brute";
    const contactMs = id === "rabbit" || id === "raccoon" ? 72 : heavy ? 138 : animal ? 102 : 112;
    const passingMs = id === "rabbit" || id === "raccoon" ? 48 : heavy ? 92 : animal ? 68 : 78;
    const walk = clip([2, 3, 4, 5], contactMs, true, [
      { frame: 2, durationMs: contactMs, event: animal ? "stride_a" : "foot_l" },
      { frame: 3, durationMs: passingMs },
      { frame: 4, durationMs: contactMs, event: animal ? "stride_b" : "foot_r" },
      { frame: 5, durationMs: passingMs },
    ]);
    return {
      spriteId: `character:${id}`,
      clips: {
        idle: clip([0, 1], heavy ? 620 : 520, true, [
          { frame: 0, durationMs: heavy ? 760 : 620 },
          { frame: 1, durationMs: heavy ? 540 : 420 },
        ]),
        walk,
        attack: clip([8, 9, 10], heavy ? 150 : 105, false, [
          { frame: 8, durationMs: heavy ? 220 : 120, event: "windup" },
          { frame: 9, durationMs: heavy ? 190 : 90, event: "impact" },
          { frame: 10, durationMs: heavy ? 230 : 150, event: "recover" },
        ]),
        punch: clip([16, 17, 18, 0], heavy ? 170 : animal ? 120 : 110, false, [
          { frame: 16, durationMs: heavy ? 200 : animal ? 140 : 110, event: "windup" },
          { frame: 17, durationMs: heavy ? 130 : animal ? 90 : 70, event: "impact" },
          { frame: 18, durationMs: heavy ? 180 : animal ? 120 : 105, event: "retract" },
          { frame: 0, durationMs: heavy ? 170 : animal ? 130 : 165, event: "recover" },
        ]),
        hit: clip([11, 12], 90, false, [
          { frame: 11, durationMs: 95, event: "recoil" },
          { frame: 12, durationMs: 135, event: "settle" },
        ]),
        death: clip([13, 14, 15], heavy ? 190 : 145, false, [
          { frame: 13, durationMs: 110, event: "stagger" },
          { frame: 14, durationMs: heavy ? 230 : 170, event: "fall" },
          { frame: 15, durationMs: 900, event: "down" },
        ]),
      },
    };
  };

  const animations = {
    player: profile("player"),
    trader: profile("trader"),
  };
  for (const id of Object.keys(mobDefs)) animations[`mob:${id}`] = profile(id);
  if (animations["mob:brute"]) {
    animations["mob:brute"].clips.attack = clip([8, 9, 10], 180, false, [
      { frame: 8, durationMs: 260, soundId: "brute_roar", event: "windup" },
      { frame: 9, durationMs: 310, soundId: "brute_slam", event: "impact" },
      { frame: 10, durationMs: 280, event: "recover" },
    ]);
  }
  return animations;
}
