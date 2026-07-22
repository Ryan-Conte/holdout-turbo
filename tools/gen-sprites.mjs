// Generates placeholder pixel-art sprite sheets (see docs/ART.md).
// Usage: node tools/gen-sprites.mjs
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "web",
  "public",
  "sprites",
);
fs.mkdirSync(OUT, { recursive: true });

const C = 16; // cell size

function sheet(cols, rows) {
  const png = new PNG({ width: cols * C, height: rows * C });
  return png;
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function px(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  const [r, g, b, a] = color;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = a;
}

function rect(png, x, y, w, h, color) {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) px(png, i, j, color);
}

// deterministic noise
function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(png, cx, cy, colors, count, seed) {
  const r = rnd(seed);
  for (let i = 0; i < count; i++) {
    px(
      png,
      cx + Math.floor(r() * C),
      cy + Math.floor(r() * C),
      colors[i % colors.length],
    );
  }
}

function save(png, name) {
  png
    .pack()
    .pipe(fs.createWriteStream(path.join(OUT, name)))
    .on("finish", () => console.log("wrote", name));
}

const T = {
  grassA: hex("#4a7c40"),
  grassB: hex("#457539"),
  grassD: hex("#3e6b35"),
  grassL: hex("#568a49"),
  water: hex("#33628f"),
  waterL: hex("#41799f"),
  waterD: hex("#2b5379"),
  sand: hex("#b99e6b"),
  sandD: hex("#a58a58"),
  sandL: hex("#c8af7e"),
  road: hex("#7a755f"),
  roadD: hex("#6a654f"),
  roadL: hex("#8a8570"),
  asphalt: hex("#3f3f45"),
  asphaltD: hex("#36363b"),
  asphaltL: hex("#4a4a52"),
  paint: hex("#a8a88a"),
  floor: hex("#8a6a48"),
  floorD: hex("#77593a"),
  wall: hex("#4c3a28"),
  wallL: hex("#63503a"),
  wallD: hex("#382a1c"),
  trunk: hex("#5c3f26"),
  leaf: hex("#2e5e33"),
  leafL: hex("#3d7542"),
  leafHL: hex("#4f8a52"),
  rock: hex("#77777d"),
  rockL: hex("#92929a"),
  rockD: hex("#5c5c62"),
  bedFrame: hex("#5c3f26"),
  bedSheet: hex("#7a8a99"),
  bedPillow: hex("#c8c8bd"),
  mat: hex("#6a5a3a"),
  matL: hex("#7d6c48"),
};

// ── tiles.png ─────────────────────────────────────────────────────────────
{
  const png = sheet(29, 2);
  const cell = (c, r) => [c * C, r * C];

  // 0 grass A / 1 grass B
  for (const [col, base, seed] of [
    [0, T.grassA, 11],
    [1, T.grassB, 77],
  ]) {
    const [x, y] = cell(col, 0);
    rect(png, x, y, C, C, base);
    speckle(png, x, y, [T.grassD, T.grassL, T.grassD], 9, seed);
  }
  // 2 water
  {
    const [x, y] = cell(2, 0);
    rect(png, x, y, C, C, T.water);
    speckle(png, x, y, [T.waterL, T.waterD], 7, 5);
    rect(png, x + 3, y + 4, 4, 1, T.waterL);
    rect(png, x + 9, y + 10, 4, 1, T.waterL);
  }
  // 3 sand
  {
    const [x, y] = cell(3, 0);
    rect(png, x, y, C, C, T.sand);
    speckle(png, x, y, [T.sandD, T.sandL], 8, 9);
  }
  // 4 road
  {
    const [x, y] = cell(4, 0);
    rect(png, x, y, C, C, T.road);
    speckle(png, x, y, [T.roadD, T.roadL, T.roadD], 10, 21);
  }
  // 5 asphalt
  {
    const [x, y] = cell(5, 0);
    rect(png, x, y, C, C, T.asphalt);
    speckle(png, x, y, [T.asphaltD, T.asphaltL], 8, 31);
  }
  // 6 floor (planks)
  {
    const [x, y] = cell(6, 0);
    rect(png, x, y, C, C, T.floor);
    rect(png, x, y + 5, C, 1, T.floorD);
    rect(png, x, y + 11, C, 1, T.floorD);
    rect(png, x + 7, y, 1, 5, T.floorD);
    rect(png, x + 3, y + 6, 1, 5, T.floorD);
    rect(png, x + 11, y + 12, 1, 4, T.floorD);
  }
  // 7 wall
  {
    const [x, y] = cell(7, 0);
    rect(png, x, y, C, C, T.wall);
    rect(png, x, y, C, 3, T.wallL);
    rect(png, x, y + 14, C, 2, T.wallD);
    rect(png, x + 2, y + 6, 4, 2, T.wallD);
    rect(png, x + 9, y + 10, 4, 2, T.wallD);
  }
  // 8 door mat
  {
    const [x, y] = cell(8, 0);
    rect(png, x, y, C, C, T.mat);
    rect(png, x + 1, y + 1, C - 2, C - 2, T.matL);
    rect(png, x + 3, y + 3, C - 6, 1, T.mat);
    rect(png, x + 3, y + 7, C - 6, 1, T.mat);
    rect(png, x + 3, y + 11, C - 6, 1, T.mat);
  }
  // 9 bed top / 13 bed bottom
  {
    const [x, y] = cell(9, 0);
    rect(png, x + 1, y, C - 2, C, T.bedFrame);
    rect(png, x + 2, y + 1, C - 4, C - 1, T.bedPillow);
    rect(png, x + 3, y + 3, C - 6, 4, hex("#dedeD2"));
    const [x2, y2] = cell(13, 0);
    rect(png, x2 + 1, y2, C - 2, C, T.bedFrame);
    rect(png, x2 + 2, y2, C - 4, C - 2, T.bedSheet);
    rect(png, x2 + 2, y2 + 3, C - 4, 2, hex("#69798a"));
  }
  // 10-11 rows 0-1: tree 32×32
  {
    const x = 10 * C,
      y = 0;
    // trunk
    rect(png, x + 14, y + 20, 4, 9, T.trunk);
    rect(png, x + 13, y + 28, 6, 2, hex("#4a331e"));
    // canopy blob
    const r = rnd(4242);
    for (let j = 0; j < 22; j++)
      for (let i = 0; i < 26; i++) {
        const dx = i - 13,
          dy = j - 11;
        if (dx * dx * 0.85 + dy * dy * 1.2 < 120 + r() * 14)
          px(png, x + 3 + i, y + 1 + j, T.leaf);
      }
    for (let j = 0; j < 12; j++)
      for (let i = 0; i < 14; i++) {
        const dx = i - 7,
          dy = j - 6;
        if (dx * dx + dy * dy < 34 + r() * 6)
          px(png, x + 6 + i, y + 3 + j, T.leafL);
      }
    speckle(png, x + 6, y + 2, [T.leafHL], 6, 99);
    speckle(png, x + 14, y + 8, [T.leafHL, T.leafL], 6, 55);
  }
  // 14 workbench (table with tools)
  {
    const [x, y] = cell(14, 0);
    rect(png, x + 1, y + 4, 14, 8, hex("#6a4c2a"));
    rect(png, x + 1, y + 4, 14, 3, hex("#8a683c"));
    rect(png, x + 2, y + 12, 2, 3, hex("#4a331e"));
    rect(png, x + 12, y + 12, 2, 3, hex("#4a331e"));
    rect(png, x + 3, y + 5, 3, 1, hex("#8a8a92")); // saw
    rect(png, x + 9, y + 5, 1, 2, hex("#5c5c64")); // hammer
    rect(png, x + 8, y + 5, 3, 1, hex("#5c5c64"));
  }
  // 15 firepit / 16 furnace / 17 stump / 18 rubble
  {
    const [x, y] = cell(15, 0);
    rect(png, x + 3, y + 9, 10, 4, hex("#55565c")); // cold stone ring
    rect(png, x + 4, y + 9, 8, 2, hex("#6d6e73")); // upper stone faces
    rect(png, x + 5, y + 7, 6, 3, hex("#251f1a")); // dark, unlit coals
    rect(png, x + 4, y + 7, 7, 2, hex("#4a331e")); // crossed log
    rect(png, x + 7, y + 6, 5, 2, hex("#35261d")); // crossed log
    px(png, x + 6, y + 8, hex("#777477")); // cold ash
    px(png, x + 9, y + 9, hex("#858185"));
    px(png, x + 4, y + 11, hex("#85868b"));
    px(png, x + 11, y + 12, hex("#424349"));
  }
  {
    const [x, y] = cell(16, 0);
    rect(png, x + 2, y + 3, 12, 12, hex("#606168")); // stone body
    rect(png, x + 3, y + 2, 10, 3, hex("#7a7b82")); // cap
    rect(png, x + 4, y + 1, 4, 2, hex("#494a50")); // short flue
    rect(png, x + 4, y + 7, 8, 7, hex("#45464c")); // iron mouth rim
    rect(png, x + 5, y + 8, 6, 5, hex("#1d1e21")); // cold chamber
    rect(png, x + 6, y + 11, 4, 2, hex("#343236")); // ash bed
    px(png, x + 3, y + 5, hex("#85868d")); // masonry highlights
    px(png, x + 11, y + 5, hex("#4e4f55"));
    px(png, x + 12, y + 13, hex("#77787e"));
  }
  {
    const [x, y] = cell(17, 0);
    rect(png, x + 5, y + 8, 6, 5, hex("#5c3f26")); // stump
    rect(png, x + 5, y + 8, 6, 2, hex("#8a683c")); // rings
    px(png, x + 7, y + 9, hex("#5c3f26"));
    rect(png, x + 4, y + 12, 8, 2, hex("#4a331e"));
  }
  {
    const [x, y] = cell(18, 0);
    rect(png, x + 4, y + 10, 4, 3, hex("#77777d"));
    rect(png, x + 9, y + 11, 3, 2, hex("#5c5c62"));
    rect(png, x + 7, y + 8, 3, 3, hex("#92929a"));
    px(png, x + 5, y + 9, hex("#5c5c62"));
  }
  // 19 wood floor (player-built planks, lighter than ruin floor)
  {
    const [x, y] = cell(19, 0);
    rect(png, x, y, C, C, hex("#9a7a4c"));
    rect(png, x, y + 3, C, 1, hex("#84673d"));
    rect(png, x, y + 7, C, 1, hex("#84673d"));
    rect(png, x, y + 11, C, 1, hex("#84673d"));
    rect(png, x + 5, y, 1, 3, hex("#84673d"));
    rect(png, x + 10, y + 4, 1, 3, hex("#84673d"));
    rect(png, x + 4, y + 8, 1, 3, hex("#84673d"));
    rect(png, x + 12, y + 12, 1, 4, hex("#84673d"));
  }
  // 20 stone floor (cut slabs)
  {
    const [x, y] = cell(20, 0);
    rect(png, x, y, C, C, hex("#8a8a90"));
    rect(png, x, y + 5, C, 1, hex("#6e6e74"));
    rect(png, x, y + 10, C, 1, hex("#6e6e74"));
    rect(png, x + 7, y, 1, 5, hex("#6e6e74"));
    rect(png, x + 3, y + 6, 1, 4, hex("#6e6e74"));
    rect(png, x + 11, y + 11, 1, 5, hex("#6e6e74"));
    speckle(png, x, y, [hex("#9a9aa0"), hex("#7a7a80")], 6, 63);
  }
  // 21 wooden wall (vertical palisade logs)
  {
    const [x, y] = cell(21, 0);
    rect(png, x, y, C, C, hex("#6a4c2a"));
    for (const lx of [0, 4, 8, 12]) {
      rect(png, x + lx, y, 3, C, hex("#7a5a34"));
      rect(png, x + lx, y, 1, C, hex("#8a683c"));
    }
    rect(png, x, y, C, 2, hex("#8a683c"));
    rect(png, x, y + 14, C, 2, hex("#4a331e"));
  }
  // 22 wooden door (plank door + handle)
  {
    const [x, y] = cell(22, 0);
    rect(png, x, y, C, C, hex("#54401f"));
    rect(png, x + 1, y + 1, C - 2, C - 2, hex("#7a5a34"));
    rect(png, x + 5, y + 1, 1, C - 2, hex("#5c4426"));
    rect(png, x + 10, y + 1, 1, C - 2, hex("#5c4426"));
    rect(png, x + 1, y + 5, C - 2, 1, hex("#5c4426"));
    rect(png, x + 1, y + 10, C - 2, 1, hex("#5c4426"));
    rect(png, x + 12, y + 8, 2, 2, hex("#c8a84a")); // handle
  }
  // 23 fence (posts + rails — transparent bg so floors show through)
  {
    const [x, y] = cell(23, 0);
    rect(png, x + 2, y + 4, 2, 9, hex("#7a5a34")); // posts
    rect(png, x + 12, y + 4, 2, 9, hex("#7a5a34"));
    rect(png, x, y + 6, C, 2, hex("#8a683c")); // rails
    rect(png, x, y + 10, C, 2, hex("#6a4c2a"));
  }
  // 24 torch post (transparent bg so floors show through)
  {
    const [x, y] = cell(24, 0);
    rect(png, x + 7, y + 5, 2, 9, hex("#5c3f26")); // post
    rect(png, x + 6, y + 13, 4, 2, hex("#4a331e")); // base
    rect(png, x + 6, y + 3, 4, 3, hex("#d8722a")); // flame
    rect(png, x + 7, y + 1, 2, 3, hex("#f0b83a"));
    px(png, x + 7, y + 0, hex("#f8dc72"));
  }
  // 12 rock
  {
    const [x, y] = cell(12, 0);
    rect(png, x + 2, y + 6, 12, 8, T.rock);
    rect(png, x + 4, y + 3, 8, 4, T.rock);
    rect(png, x + 5, y + 4, 4, 3, T.rockL);
    rect(png, x + 3, y + 12, 10, 2, T.rockD);
    px(png, x + 10, y + 8, T.rockD[0] ? T.rockD : T.rockD);
    rect(png, x + 9, y + 8, 3, 1, T.rockD);
  }
  // 25 copper-veined rock / 26 iron-veined rock (rock silhouette + ore glints)
  for (const [col, veinA, veinB] of [
    [25, hex("#c87a3a"), hex("#e09a52")],
    [26, hex("#9aa4b0"), hex("#c8d2dc")],
  ]) {
    const [x, y] = cell(col, 0);
    rect(png, x + 2, y + 6, 12, 8, T.rock);
    rect(png, x + 4, y + 3, 8, 4, T.rock);
    rect(png, x + 5, y + 4, 4, 3, T.rockL);
    rect(png, x + 3, y + 12, 10, 2, T.rockD);
    rect(png, x + 5, y + 8, 2, 2, veinA);
    rect(png, x + 9, y + 6, 2, 2, veinB);
    rect(png, x + 8, y + 11, 2, 1, veinA);
    px(png, x + 6, y + 5, veinB);
    px(png, x + 11, y + 9, veinA);
  }
  // 27 anvil (transparent bg so floors show through)
  {
    const [x, y] = cell(27, 0);
    rect(png, x + 3, y + 12, 10, 2, hex("#3a3a40")); // base
    rect(png, x + 6, y + 9, 4, 3, hex("#4a4a52")); // waist
    rect(png, x + 2, y + 6, 12, 3, hex("#5c5c64")); // top
    rect(png, x + 2, y + 6, 12, 1, hex("#7a7a84")); // highlight
    rect(png, x + 12, y + 7, 3, 2, hex("#5c5c64")); // horn
  }
  // 28 cliff (raised rock face — high ground you can't cross or shoot through)
  {
    const [x, y] = cell(28, 0);
    rect(png, x, y, C, C, hex("#5a5048"));
    rect(png, x, y, C, 4, hex("#7a6f63")); // lit top edge
    speckle(png, x, y, [hex("#4a423a"), hex("#6a6055")], 10, 71);
    rect(png, x + 2, y + 6, 4, 1, hex("#3a332c")); // strata cracks
    rect(png, x + 8, y + 9, 5, 1, hex("#3a332c"));
    rect(png, x + 4, y + 12, 6, 1, hex("#3a332c"));
    rect(png, x, y + 14, C, 2, hex("#2e2822")); // shadow base
  }
  save(png, "tiles.png");
}

// ── chars.png — 16×16, 4 frames per row ──────────────────────────────────
const SHIRTS = [
  "#8a3a3a",
  "#3a5a8a",
  "#3a7a4a",
  "#8a6a2a",
  "#6a4a8a",
  "#2a7a7a",
  "#8a4a6a",
  "#5a6a2a",
];
{
  const rows = 17;
  const CHAR_FRAMES = [0, 1, 2, 3];
  const png = sheet(CHAR_FRAMES.length, rows);
  const skin = hex("#d8a878");
  const drawBody = (fx, fy, frame, shirt, skinC, hairC, helmet) => {
    const lift = frame === 2 ? -1 : 0;
    fy += lift;
    // legs
    const l1 = [12, 11, 12, 13][frame];
    const l2 = [12, 13, 12, 11][frame];
    rect(png, fx + 5, fy + l1, 2, 15 - l1 + 1, hex("#2e2838"));
    rect(png, fx + 9, fy + l2, 2, 15 - l2 + 1, hex("#2e2838"));
    // torso
    rect(png, fx + 4, fy + 6, 8, 6, shirt);
    rect(png, fx + 4, fy + 10, 8, 2, mul(shirt, 0.8));
    // arms
    rect(png, fx + 3, fy + 7 + (frame === 1 ? 1 : frame === 3 ? -1 : 0), 1, 4, shirt);
    rect(png, fx + 12, fy + 7 + (frame === 3 ? 1 : frame === 1 ? -1 : 0), 1, 4, shirt);
    // head
    rect(png, fx + 5, fy + 1, 6, 5, skinC);
    if (helmet) {
      rect(png, fx + 4, fy, 8, 3, helmet);
      rect(png, fx + 4, fy + 3, 1, 2, helmet);
      rect(png, fx + 11, fy + 3, 1, 2, helmet);
    } else if (hairC) {
      rect(png, fx + 5, fy, 6, 2, hairC);
      rect(png, fx + 4, fy + 1, 1, 3, hairC);
      rect(png, fx + 11, fy + 1, 1, 3, hairC);
    }
    // eyes
    px(png, fx + 6, fy + 3, hex("#1c1814"));
    px(png, fx + 9, fy + 3, hex("#1c1814"));
  };
  const mul = (c, f) => [
    Math.round(c[0] * f),
    Math.round(c[1] * f),
    Math.round(c[2] * f),
    255,
  ];

  SHIRTS.forEach((s, row) => {
    for (const frame of CHAR_FRAMES)
      drawBody(frame * C, row * C, frame, hex(s), skin, hex("#3a2a1a"), null);
  });
  // row 8: zombie
  for (const frame of CHAR_FRAMES)
    drawBody(
      frame * C,
      8 * C,
      frame,
      hex("#3f4a38"),
      hex("#7fa062"),
      hex("#2f3a2a"),
      null,
    );
  // row 9: military
  for (const frame of CHAR_FRAMES)
    drawBody(
      frame * C,
      9 * C,
      frame,
      hex("#50603f"),
      hex("#c9a276"),
      null,
      hex("#3a4632"),
    );
  // row 10: trader
  for (const frame of CHAR_FRAMES)
    drawBody(
      frame * C,
      10 * C,
      frame,
      hex("#6a5a3a"),
      hex("#d8a878"),
      hex("#8a8a8a"),
      null,
    );
  // row 11: deer (quadruped, side view)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 11 * C;
    const body = hex("#8a6a44");
    const dark = hex("#6a4e30");
    rect(png, fx + 3, fy + 6, 10, 5, body); // body
    rect(png, fx + 11, fy + 3, 3, 4, body); // head
    rect(png, fx + 12, fy + 1, 1, 2, dark); // antler
    px(png, fx + 14, fy + 1, dark);
    px(png, fx + 13, fy + 4, hex("#1c1814")); // eye
    const l = [0, 1, 0, -1][frame];
    rect(png, fx + 4 + l, fy + 11, 2, 4, dark); // legs
    rect(png, fx + 10 - l, fy + 11, 2, 4, dark);
    rect(png, fx + 3, fy + 5, 3, 2, hex("#f0ead8")); // tail
  }
  // row 12: rabbit (small, hops)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 12 * C;
    const fur = hex("#b8a88e");
    const dark = hex("#94836a");
    const hop = [0, -1, -2, -1][frame];
    rect(png, fx + 5, fy + 9 + hop, 6, 4, fur); // body
    rect(png, fx + 10, fy + 7 + hop, 3, 3, fur); // head
    rect(png, fx + 10, fy + 5 + hop, 1, 2, dark); // ears
    rect(png, fx + 12, fy + 5 + hop, 1, 2, dark);
    px(png, fx + 12, fy + 8 + hop, hex("#1c1814")); // eye
    px(png, fx + 4, fy + 9 + hop, hex("#f0ead8")); // tail
    rect(png, fx + 6, fy + 13, 2, 2, dark); // legs
    rect(png, fx + 9, fy + 13, 2, 2, dark);
  }
  // row 13: boar (bulky, tusks)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 13 * C;
    const hide = hex("#5a4a3c");
    const dark = hex("#42362c");
    rect(png, fx + 2, fy + 6, 10, 6, hide); // body
    rect(png, fx + 2, fy + 5, 8, 2, dark); // bristled back
    rect(png, fx + 11, fy + 7, 4, 4, hide); // head
    px(png, fx + 14, fy + 10, hex("#e8e0d0")); // tusk
    px(png, fx + 13, fy + 11, hex("#e8e0d0"));
    px(png, fx + 13, fy + 8, hex("#1c1814")); // eye
    const l = [0, 1, 0, -1][frame];
    rect(png, fx + 3 + l, fy + 12, 2, 3, dark);
    rect(png, fx + 9 - l, fy + 12, 2, 3, dark);
  }
  // row 14: wolf (lean, grey)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 14 * C;
    const fur = hex("#6e7076");
    const dark = hex("#54565c");
    rect(png, fx + 2, fy + 7, 10, 4, fur); // body
    rect(png, fx + 11, fy + 5, 4, 4, fur); // head
    rect(png, fx + 11, fy + 3, 1, 2, dark); // ears
    rect(png, fx + 13, fy + 3, 1, 2, dark);
    px(png, fx + 14, fy + 7, hex("#c03a2a")); // eye — hungry
    rect(png, fx + 0, fy + 6, 3, 2, dark); // tail
    const l = [0, 1, 0, -1][frame];
    rect(png, fx + 3 + l, fy + 11, 2, 4, dark);
    rect(png, fx + 9 - l, fy + 11, 2, 4, dark);
  }
  // row 15: red fox (small, bright tail tip)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 15 * C;
    const fur = hex("#b95d2e");
    const dark = hex("#6f3324");
    const cream = hex("#e7cfaa");
    const hop = [0, -1, -2, -1][frame];
    const step = [0, 1, 0, -1][frame];
    rect(png, fx + 3, fy + 8 + hop, 8, 4, fur);
    rect(png, fx + 10, fy + 6 + hop, 4, 4, fur);
    px(png, fx + 11, fy + 4 + hop, dark);
    px(png, fx + 13, fy + 4 + hop, dark);
    px(png, fx + 13, fy + 7 + hop, hex("#1c1814"));
    rect(png, fx + 0, fy + 7 + hop, 4, 2, fur);
    px(png, fx + 0, fy + 7 + hop, cream);
    rect(png, fx + 4 + step, fy + 12, 2, 3, dark);
    rect(png, fx + 9 - step, fy + 12, 2, 3, dark);
    px(png, fx + 12, fy + 9 + hop, cream);
  }
  // row 16: black bear (large silhouette, tan muzzle)
  for (const frame of CHAR_FRAMES) {
    const fx = frame * C;
    const fy = 16 * C;
    const fur = hex("#332d29");
    const light = hex("#4a4038");
    const muzzle = hex("#9a7958");
    rect(png, fx + 1, fy + 5, 11, 8, fur);
    rect(png, fx + 3, fy + 4, 7, 2, light);
    rect(png, fx + 10, fy + 5, 5, 6, fur);
    px(png, fx + 11, fy + 4, fur);
    px(png, fx + 14, fy + 4, fur);
    rect(png, fx + 13, fy + 8, 3, 2, muzzle);
    px(png, fx + 13, fy + 6, hex("#d6b45d"));
    const step = [0, 1, 0, -1][frame];
    rect(png, fx + 2 + step, fy + 12, 3, 4, fur);
    rect(png, fx + 9 - step, fy + 12, 3, 4, fur);
  }
  save(png, "chars.png");
}

// ── items.png — order must match apps/web/game/sprites.ts ────────────────
const ITEM_ORDER = [
  "pistol",
  "smg",
  "shotgun",
  "rifle",
  "spear",
  "axe",
  "pickaxe",
  "ammo_9mm",
  "ammo_shell",
  "ammo_556",
  "cloth",
  "scrap",
  "wood",
  "stone",
  "bandage",
  "medkit",
  "backpack_mk2",
  "backpack_mk3",
  "helmet_scrap",
  "helmet_military",
  "vest_light",
  "vest_military",
  "attach_reddot",
  "attach_suppressor",
  "fishing_rod",
  "raw_fish",
  "cooked_fish",
  "raw_meat",
  "cooked_meat",
  "canteen",
  "canteen_full",
  "kit_firepit",
  "kit_furnace",
  "kit_workbench",
  "kit_chest",
  "kit_floor_wood",
  "kit_floor_stone",
  "kit_wall",
  "kit_door",
  "kit_fence",
  "kit_torch",
  "bow",
  "arrow",
  "revolver",
  "carbine",
  "dmr",
  "lmg",
  "prototype_rifle",
  "steel_axe",
  "steel_pickaxe",
  "ammo_44",
  "ammo_762",
  "copper_ore",
  "iron_ore",
  "copper_bar",
  "iron_bar",
  "gold_bar",
  "diamond",
  "rolex",
  "data_drive",
  "artifact",
  "kit_anvil",
  "kit_bed",
  "torch",
  "animal_hide",
  "antler",
  "backpack_mk4",
];
{
  const png = sheet(ITEM_ORDER.length, 1);
  const dark = hex("#22201c"),
    steel = hex("#8a8a92"),
    steelD = hex("#5c5c64"),
    woodC = hex("#7a5a34");
  const draw = {
    pistol(x) {
      rect(png, x + 3, 6, 9, 3, dark);
      rect(png, x + 4, 9, 3, 4, steelD);
      rect(png, x + 10, 5, 2, 1, steel);
    },
    smg(x) {
      rect(png, x + 2, 6, 11, 3, dark);
      rect(png, x + 5, 9, 2, 4, steelD);
      rect(png, x + 9, 9, 2, 3, dark);
      rect(png, x + 12, 5, 2, 2, steelD);
    },
    shotgun(x) {
      rect(png, x + 1, 7, 13, 2, woodC);
      rect(png, x + 6, 6, 8, 2, dark);
      rect(png, x + 2, 9, 4, 2, woodC);
    },
    rifle(x) {
      rect(png, x + 1, 7, 14, 2, dark);
      rect(png, x + 2, 9, 3, 3, woodC);
      rect(png, x + 7, 9, 2, 4, steelD);
      rect(png, x + 12, 5, 2, 2, dark);
    },
    spear(x) {
      for (let i = 0; i < 10; i++) px(png, x + 3 + i, 12 - i, woodC);
      rect(png, x + 12, 2, 2, 2, steel);
      px(png, x + 13, 1, steel);
    },
    axe(x) {
      for (let i = 0; i < 9; i++) px(png, x + 4 + i, 13 - i, woodC);
      rect(png, x + 10, 2, 4, 4, steel);
      rect(png, x + 12, 3, 2, 4, steelD);
    },
    pickaxe(x) {
      for (let i = 0; i < 9; i++) px(png, x + 4 + i, 13 - i, woodC);
      rect(png, x + 9, 2, 6, 2, steel);
      rect(png, x + 8, 3, 2, 2, steelD);
      rect(png, x + 13, 4, 2, 2, steelD);
    },
    ammo_9mm(x) {
      for (const [bx, by] of [
        [4, 5],
        [7, 5],
        [10, 5],
      ]) {
        rect(png, x + bx, by, 2, 5, hex("#c8a84a"));
        px(png, x + bx, by, hex("#8a6a2a"));
      }
    },
    ammo_shell(x) {
      for (const [bx, by] of [
        [4, 4],
        [9, 4],
      ]) {
        rect(png, x + bx, by, 3, 7, hex("#a83a3a"));
        rect(png, x + bx, by + 5, 3, 2, hex("#c8a84a"));
      }
    },
    ammo_556(x) {
      for (const [bx, by] of [
        [3, 4],
        [6, 4],
        [9, 4],
        [12, 4],
      ]) {
        rect(png, x + bx, by, 2, 7, hex("#b09048"));
        px(png, x + bx, by, hex("#6a5a2a"));
      }
    },
    cloth(x) {
      rect(png, x + 3, 4, 10, 8, hex("#b8b0a0"));
      rect(png, x + 3, 7, 10, 1, hex("#98907f"));
      rect(png, x + 3, 10, 10, 1, hex("#98907f"));
      px(png, x + 12, 4, hex("#98907f"));
    },
    scrap(x) {
      rect(png, x + 3, 6, 6, 4, steel);
      rect(png, x + 8, 4, 5, 3, steelD);
      rect(png, x + 5, 10, 7, 3, hex("#6a5a4a"));
      px(png, x + 4, 5, steelD);
    },
    wood(x) {
      rect(png, x + 2, 6, 12, 3, woodC);
      rect(png, x + 2, 10, 12, 3, hex("#6a4c2a"));
      rect(png, x + 2, 6, 2, 3, hex("#9a7a4c"));
      rect(png, x + 2, 10, 2, 3, hex("#9a7a4c"));
    },
    stone(x) {
      rect(png, x + 4, 6, 8, 6, T.rock);
      rect(png, x + 5, 5, 5, 3, T.rockL);
      rect(png, x + 5, 11, 6, 1, T.rockD);
    },
    animal_hide(x) {
      rect(png, x + 4, 3, 8, 10, hex("#8b633f"));
      rect(png, x + 2, 5, 3, 6, hex("#8b633f"));
      rect(png, x + 11, 5, 3, 6, hex("#8b633f"));
      px(png, x + 5, 4, hex("#b58a5d"));
      px(png, x + 10, 11, hex("#5f402a"));
      rect(png, x + 6, 6, 4, 4, hex("#9e744b"));
    },
    antler(x) {
      const bone = hex("#d5c39c");
      for (let i = 0; i < 10; i++) px(png, x + 4 + Math.floor(i / 2), 13 - i, bone);
      rect(png, x + 7, 4, 5, 1, bone);
      rect(png, x + 9, 2, 1, 4, bone);
      rect(png, x + 6, 7, 5, 1, bone);
      rect(png, x + 9, 6, 1, 3, bone);
    },
    bandage(x) {
      rect(png, x + 3, 5, 10, 6, hex("#e0ded2"));
      rect(png, x + 3, 7, 10, 2, hex("#c0beb2"));
      rect(png, x + 6, 5, 4, 6, hex("#d0685a"));
    },
    medkit(x) {
      rect(png, x + 3, 4, 10, 9, hex("#b84a42"));
      rect(png, x + 7, 5, 2, 7, hex("#e8e8e0"));
      rect(png, x + 5, 8, 6, 2, hex("#e8e8e0"));
    },
    backpack_mk2(x) {
      rect(png, x + 4, 4, 8, 9, hex("#7a6a3a"));
      rect(png, x + 5, 6, 6, 4, hex("#8a7a48"));
      rect(png, x + 6, 2, 4, 2, hex("#5a4c2a"));
    },
    backpack_mk3(x) {
      rect(png, x + 3, 3, 10, 11, hex("#5a5442"));
      rect(png, x + 4, 5, 8, 5, hex("#6c6650"));
      rect(png, x + 6, 1, 4, 2, hex("#443f30"));
      rect(png, x + 4, 11, 3, 2, hex("#443f30"));
      rect(png, x + 9, 11, 3, 2, hex("#443f30"));
    },
    backpack_mk4(x) {
      const canvas = hex("#343b32");
      const canvasHi = hex("#56614f");
      const canvasDark = hex("#202620");
      const frame = hex("#9a8b62");
      const clasp = hex("#d1b45d");
      rect(png, x + 2, 3, 12, 11, canvasDark);
      rect(png, x + 3, 2, 10, 11, canvas);
      rect(png, x + 4, 3, 8, 5, canvasHi);
      rect(png, x + 4, 9, 8, 4, canvas);
      rect(png, x + 1, 6, 2, 6, canvas);
      rect(png, x + 13, 6, 2, 6, canvas);
      rect(png, x + 5, 1, 6, 2, canvasDark);
      rect(png, x + 3, 5, 10, 1, frame);
      rect(png, x + 3, 10, 10, 1, frame);
      rect(png, x + 5, 12, 6, 2, canvasDark);
      px(png, x + 7, 9, clasp);
      px(png, x + 8, 9, clasp);
    },
    helmet_scrap(x) {
      rect(png, x + 4, 5, 8, 5, steel);
      rect(png, x + 3, 8, 10, 2, steelD);
      rect(png, x + 5, 3, 6, 2, steel);
      px(png, x + 6, 6, steelD);
      px(png, x + 10, 7, steelD);
    },
    helmet_military(x) {
      rect(png, x + 4, 4, 8, 5, hex("#4a5a3a"));
      rect(png, x + 3, 7, 10, 2, hex("#3a4a2e"));
      rect(png, x + 5, 2, 6, 2, hex("#4a5a3a"));
      rect(png, x + 3, 9, 2, 2, hex("#3a4a2e"));
      rect(png, x + 11, 9, 2, 2, hex("#3a4a2e"));
    },
    vest_light(x) {
      rect(png, x + 4, 3, 8, 10, hex("#8a7a5a"));
      rect(png, x + 5, 5, 6, 3, hex("#9a8a68"));
      rect(png, x + 5, 9, 6, 2, hex("#7a6a4c"));
    },
    vest_military(x) {
      rect(png, x + 4, 3, 8, 10, hex("#44503a"));
      rect(png, x + 5, 5, 6, 2, hex("#525f46"));
      rect(png, x + 5, 8, 2, 3, hex("#38422e"));
      rect(png, x + 9, 8, 2, 3, hex("#38422e"));
    },
    attach_reddot(x) {
      rect(png, x + 4, 8, 8, 3, dark);
      rect(png, x + 6, 4, 4, 4, dark);
      rect(png, x + 7, 5, 2, 2, hex("#d84a3a"));
    },
    attach_suppressor(x) {
      rect(png, x + 2, 6, 12, 4, dark);
      rect(png, x + 3, 7, 10, 1, steelD);
      rect(png, x + 13, 7, 2, 2, steelD);
    },
    fishing_rod(x) {
      for (let i = 0; i < 11; i++) px(png, x + 2 + i, 13 - i, woodC);
      px(png, x + 13, 2, steelD);
      px(png, x + 13, 4, steelD);
      px(png, x + 13, 6, steelD);
      px(png, x + 12, 8, hex("#d84a3a"));
    },
    raw_fish(x) {
      rect(png, x + 3, 7, 9, 3, hex("#7a94a8"));
      px(png, x + 12, 6, hex("#7a94a8"));
      rect(png, x + 12, 7, 3, 3, hex("#5c7488"));
      px(png, x + 4, 8, hex("#1c1814"));
    },
    cooked_fish(x) {
      rect(png, x + 3, 7, 9, 3, hex("#c08a4a"));
      rect(png, x + 12, 7, 3, 3, hex("#a06c34"));
      rect(png, x + 5, 8, 2, 1, hex("#8a5a28"));
    },
    raw_meat(x) {
      rect(png, x + 4, 5, 8, 7, hex("#b84a52"));
      rect(png, x + 5, 6, 3, 3, hex("#d87a80"));
      rect(png, x + 10, 9, 2, 2, hex("#f0ead8"));
    },
    cooked_meat(x) {
      rect(png, x + 4, 5, 8, 7, hex("#8a5228"));
      rect(png, x + 5, 6, 4, 2, hex("#a86c3a"));
      rect(png, x + 10, 9, 2, 2, hex("#e8d8b8"));
    },
    canteen(x) {
      rect(png, x + 5, 4, 6, 9, hex("#5a6a52"));
      rect(png, x + 6, 2, 4, 3, hex("#3c4636"));
      rect(png, x + 7, 1, 2, 2, steelD);
      rect(png, x + 6, 7, 4, 3, hex("#48543f"));
    },
    canteen_full(x) {
      rect(png, x + 5, 4, 6, 9, hex("#5a6a52"));
      rect(png, x + 6, 2, 4, 3, hex("#3c4636"));
      rect(png, x + 7, 1, 2, 2, steelD);
      rect(png, x + 6, 7, 4, 3, hex("#4a90c8"));
    },
    // placeable kits — a crate marked with a mini-icon of the structure
    kit_firepit(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 6, 8, 4, 4, hex("#d8722a"));
      px(png, x + 7, 7, hex("#f0b83a"));
    },
    kit_furnace(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 5, 7, 6, 5, hex("#6a6a72"));
      rect(png, x + 6, 9, 4, 2, hex("#d8722a"));
    },
    kit_workbench(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 5, 8, 6, 3, hex("#8a683c"));
      rect(png, x + 5, 7, 3, 1, steel);
    },
    kit_chest(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 5, 8, 6, 4, hex("#a8712f"));
      px(png, x + 8, 9, hex("#d8a24a"));
    },
    // base-building pieces — drawn as the piece itself so the hotbar reads at a glance
    kit_floor_wood(x) {
      rect(png, x + 2, 4, 12, 9, hex("#9a7a4c"));
      rect(png, x + 2, 7, 12, 1, hex("#84673d"));
      rect(png, x + 2, 10, 12, 1, hex("#84673d"));
      rect(png, x + 7, 4, 1, 3, hex("#84673d"));
      rect(png, x + 5, 8, 1, 2, hex("#84673d"));
    },
    kit_floor_stone(x) {
      rect(png, x + 2, 4, 12, 9, hex("#8a8a90"));
      rect(png, x + 2, 8, 12, 1, hex("#6e6e74"));
      rect(png, x + 8, 4, 1, 4, hex("#6e6e74"));
      rect(png, x + 5, 9, 1, 4, hex("#6e6e74"));
    },
    kit_wall(x) {
      for (const lx of [3, 6, 9, 12]) {
        rect(png, x + lx, 3, 2, 11, hex("#7a5a34"));
        px(png, x + lx, 3, hex("#8a683c"));
      }
      rect(png, x + 3, 13, 11, 1, hex("#4a331e"));
    },
    kit_door(x) {
      rect(png, x + 4, 2, 8, 12, hex("#7a5a34"));
      rect(png, x + 4, 2, 8, 1, hex("#8a683c"));
      rect(png, x + 7, 2, 1, 12, hex("#5c4426"));
      rect(png, x + 4, 7, 8, 1, hex("#5c4426"));
      rect(png, x + 10, 8, 1, 2, hex("#c8a84a"));
    },
    kit_fence(x) {
      rect(png, x + 3, 5, 2, 8, hex("#7a5a34"));
      rect(png, x + 11, 5, 2, 8, hex("#7a5a34"));
      rect(png, x + 1, 7, 14, 2, hex("#8a683c"));
      rect(png, x + 1, 10, 14, 1, hex("#6a4c2a"));
    },
    kit_torch(x) {
      rect(png, x + 7, 6, 2, 8, hex("#5c3f26"));
      rect(png, x + 6, 3, 4, 3, hex("#d8722a"));
      rect(png, x + 7, 1, 2, 3, hex("#f0b83a"));
      px(png, x + 7, 0, hex("#f8dc72"));
    },
    torch(x) {
      for (let i = 0; i < 9; i++) px(png, x + 3 + i, 13 - i, woodC);
      rect(png, x + 10, 2, 4, 4, hex("#d8722a"));
      rect(png, x + 11, 0, 2, 3, hex("#f0b83a"));
      px(png, x + 12, 0, hex("#f8dc72"));
    },
    bow(x) {
      // curved limb + string + nocked arrow
      for (let i = 0; i < 12; i++) {
        const b = Math.round(Math.sin((i / 11) * Math.PI) * 3);
        px(png, x + 4 + b, 2 + i, woodC);
        px(png, x + 5 + b, 2 + i, hex("#8a683c"));
      }
      for (let i = 0; i < 12; i++) px(png, x + 4, 2 + i, hex("#d8d2b8")); // string
      rect(png, x + 5, 7, 8, 1, hex("#9a7a4c")); // arrow shaft
      px(png, x + 13, 7, steel);
      px(png, x + 12, 6, steel);
      px(png, x + 12, 8, steel); // head
      px(png, x + 5, 6, hex("#c25047"));
      px(png, x + 5, 8, hex("#c25047")); // fletching
    },
    arrow(x) {
      for (const [ax, ay] of [
        [3, 4],
        [8, 6],
      ]) {
        rect(png, x + ax, ay, 9, 1, hex("#9a7a4c"));
        px(png, x + ax + 9, ay, steel);
        px(png, x + ax + 8, ay - 1, steel);
        px(png, x + ax + 8, ay + 1, steel);
        px(png, x + ax, ay - 1, hex("#c25047"));
        px(png, x + ax, ay + 1, hex("#c25047"));
      }
    },
    // ── forged / rare guns
    revolver(x) {
      rect(png, x + 3, 6, 10, 3, hex("#7a7a84"));
      rect(png, x + 6, 8, 3, 3, hex("#5c5c64"));
      rect(png, x + 4, 9, 3, 4, hex("#6a4c2a"));
      rect(png, x + 11, 5, 2, 1, hex("#9a9aa4"));
    },
    carbine(x) {
      rect(png, x + 1, 7, 13, 2, hex("#7a7a84"));
      rect(png, x + 2, 9, 4, 3, woodC);
      rect(png, x + 8, 9, 2, 3, hex("#5c5c64"));
      rect(png, x + 12, 5, 2, 2, hex("#5c5c64"));
    },
    dmr(x) {
      rect(png, x + 0, 7, 15, 2, dark);
      rect(png, x + 1, 9, 4, 3, woodC);
      rect(png, x + 8, 9, 2, 4, steelD);
      rect(png, x + 8, 4, 5, 2, hex("#3a4a3a"));
      rect(png, x + 9, 5, 3, 1, hex("#78c8f0"));
    },
    lmg(x) {
      rect(png, x + 0, 6, 14, 3, dark);
      rect(png, x + 3, 9, 4, 4, hex("#3a3a40"));
      rect(png, x + 9, 9, 2, 3, steelD);
      rect(png, x + 1, 4, 3, 2, steelD);
      rect(png, x + 12, 4, 3, 2, dark);
    },
    prototype_rifle(x) {
      rect(png, x + 0, 6, 15, 3, hex("#2a3a4a"));
      rect(png, x + 2, 5, 10, 1, hex("#66c0f4"));
      rect(png, x + 4, 9, 3, 4, hex("#1c2833"));
      rect(png, x + 13, 6, 2, 3, hex("#8af0e8"));
      px(png, x + 8, 4, hex("#8af0e8"));
    },
    // ── steel tools
    steel_axe(x) {
      for (let i = 0; i < 9; i++) px(png, x + 4 + i, 13 - i, woodC);
      rect(png, x + 9, 1, 5, 5, hex("#9aa4b0"));
      rect(png, x + 12, 2, 2, 5, hex("#c8d2dc"));
    },
    steel_pickaxe(x) {
      for (let i = 0; i < 9; i++) px(png, x + 4 + i, 13 - i, woodC);
      rect(png, x + 8, 2, 8, 2, hex("#9aa4b0"));
      rect(png, x + 7, 3, 2, 3, hex("#c8d2dc"));
      rect(png, x + 14, 4, 2, 3, hex("#c8d2dc"));
    },
    // ── new ammo
    ammo_44(x) {
      for (const [bx, by] of [
        [4, 4],
        [8, 4],
        [6, 9],
      ]) {
        rect(png, x + bx, by, 3, 6, hex("#d8a24a"));
        px(png, x + bx + 1, by, hex("#8a6a2a"));
      }
    },
    ammo_762(x) {
      for (const [bx, by] of [
        [3, 3],
        [7, 3],
        [11, 3],
      ]) {
        rect(png, x + bx, by, 2, 9, hex("#b87848"));
        px(png, x + bx, by, hex("#6a4a2a"));
        px(png, x + bx + 1, by + 8, hex("#8a5a34"));
      }
    },
    // ── ores & bars
    copper_ore(x) {
      rect(png, x + 4, 6, 8, 6, T.rock);
      rect(png, x + 5, 5, 5, 3, T.rockL);
      rect(png, x + 6, 8, 2, 2, hex("#c87a3a"));
      rect(png, x + 10, 7, 2, 2, hex("#e09a52"));
      px(png, x + 8, 11, hex("#c87a3a"));
    },
    iron_ore(x) {
      rect(png, x + 4, 6, 8, 6, T.rock);
      rect(png, x + 5, 5, 5, 3, T.rockL);
      rect(png, x + 6, 8, 2, 2, hex("#9aa4b0"));
      rect(png, x + 10, 7, 2, 2, hex("#c8d2dc"));
      px(png, x + 8, 11, hex("#9aa4b0"));
    },
    copper_bar(x) {
      rect(png, x + 3, 6, 10, 5, hex("#c87a3a"));
      rect(png, x + 4, 5, 10, 5, hex("#e09a52"));
      rect(png, x + 5, 6, 4, 1, hex("#f0b87a"));
    },
    iron_bar(x) {
      rect(png, x + 3, 6, 10, 5, hex("#7a848e"));
      rect(png, x + 4, 5, 10, 5, hex("#9aa4b0"));
      rect(png, x + 5, 6, 4, 1, hex("#c8d2dc"));
    },
    // ── rare valuables
    gold_bar(x) {
      rect(png, x + 3, 7, 10, 5, hex("#b8860b"));
      rect(png, x + 4, 5, 10, 5, hex("#e8c84a"));
      rect(png, x + 5, 6, 5, 1, hex("#f8e88a"));
      px(png, x + 12, 7, hex("#f8e88a"));
    },
    diamond(x) {
      for (let j = 0; j < 4; j++)
        rect(png, x + 6 - j, 6 + j, 4 + j * 2, 1, hex("#a8e8f0"));
      for (let j = 0; j < 5; j++)
        rect(png, x + 3 + j, 10 + j, 10 - j * 2, 1, hex("#78c8e0"));
      px(png, x + 7, 7, hex("#ffffff"));
    },
    rolex(x) {
      rect(png, x + 6, 2, 4, 3, hex("#e8c84a"));
      rect(png, x + 6, 11, 4, 3, hex("#e8c84a"));
      rect(png, x + 4, 5, 8, 6, hex("#c8a83a"));
      rect(png, x + 6, 6, 4, 4, hex("#f8f8f0"));
      px(png, x + 8, 7, hex("#1c1814"));
      px(png, x + 8, 8, hex("#1c1814"));
    },
    data_drive(x) {
      rect(png, x + 4, 4, 8, 9, hex("#1c2833"));
      rect(png, x + 5, 5, 6, 3, hex("#2a3a4a"));
      rect(png, x + 6, 9, 4, 2, hex("#66c0f4"));
      px(png, x + 10, 5, hex("#5ff08a"));
    },
    artifact(x) {
      for (let j = 0; j < 6; j++) {
        rect(
          png,
          x + 7 - (j % 3),
          3 + j * 2,
          3 + (j % 3) * 2,
          1,
          hex("#b078e0"),
        );
      }
      rect(png, x + 6, 6, 4, 5, hex("#d0a0f8"));
      px(png, x + 7, 8, hex("#ffffff"));
      px(png, x + 9, 5, hex("#e8c8ff"));
    },
    kit_anvil(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 4, 8, 8, 2, hex("#5c5c64"));
      rect(png, x + 6, 10, 4, 2, hex("#4a4a52"));
    },
    kit_bed(x) {
      rect(png, x + 2, 5, 12, 9, hex("#7a5a34"));
      rect(png, x + 2, 5, 12, 2, hex("#8a6a3c"));
      rect(png, x + 4, 8, 8, 4, hex("#7a8a99"));
      rect(png, x + 4, 8, 3, 4, hex("#c8c8bd"));
    },
  };
  ITEM_ORDER.forEach((id, i) => draw[id](i * C));
  save(png, "items.png");
}

console.log("sprite sheets generated into", OUT);
