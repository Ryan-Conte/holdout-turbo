# Art pipeline

All sprites are 16 px grid PNG sheets in `apps/web/public/sprites/`, generated as **placeholder templates** by `node tools/gen-sprites.mjs` (pngjs). Replace the PNGs with real pixel art keeping the same grid — the renderer only knows `(sheet, col, row, w, h)`.

Rendered at 2× world scale (TILE = 32 px world, 16 px art) with `imageSmoothingEnabled = false`.

## tiles.png (16×16 cells, single row unless noted)

| col | sprite |
|----|--------|
| 0 | grass A |
| 1 | grass B (variation) |
| 2 | water |
| 3 | sand |
| 4 | road (dirt) |
| 5 | asphalt |
| 6 | wood floor |
| 7 | wall |
| 8 | door mat / hideout exit |
| 9 | bed (top) — col 9 row 0 + row 1 stacked when drawn |
| 10-11 / rows 0-1 | tree (32×32 block) |
| 12 | rock |
| 13 | bed (bottom) |

## chars.png (16×16, 2 walk frames per row)

Rows 0-7 are survivor outfit bases; row 8 zombie, row 9 military, row 10 trader.
Frame 0 = idle, frame 1 = step. The survivor row is selected by `appearance.outfit`. `game/character-appearance.ts` composites skin tone, body silhouette, hair and accent at the same pixel scale, followed by gameplay armor and held items. The pre-deploy creator uses this same compositor, so its live preview matches the world renderer.

`CharacterAppearance.cosmetics` reserves `head`, `face`, `back` and `badge` asset identifiers. They are visual-only and intentionally separate from helmet/vest gameplay equipment. When real cosmetic art is added, resolve those identifiers to atlas layers in the shared compositor rather than adding creator-only rendering.

## Engine animation frames

Published `PixelAsset` records can contain multiple RGBA `frames`. `/admin/animations` maps entity states (`idle`, `walk`, `attack`, `hit`, `death`) to ordered frame indices with a visual timeline, playback/scrubbing, per-keyframe duration, optional event/sound cue and loop flag. It also provides sprite thumbnails and an inline pixel editor for the selected source frame. Targets use `player` or `mob:<mobId>` keys. Runtime clients cache frame canvases on initialization and receive visual hot reloads after publish.

Assets with no DB frame data continue using `chars.png`. This allows animation timing to be tuned before replacement artwork is ready and keeps partial art migrations safe.

## items.png (16×16)

One icon per `ItemId`, column order defined in `apps/web/game/sprites.ts` (`ITEM_SHEET_ORDER`). Used by both the canvas (held/dropped items) and the DOM UI (CSS sprite backgrounds).

Adding an item: add to shared `ITEMS`, append to `ITEM_SHEET_ORDER`, add a drawing block in `tools/gen-sprites.mjs` (or edit the PNG), rerun the generator.

## Browser pixel studio

`/admin/sprites` stores editable RGBA pixel arrays in the `sprites` game-content document. Existing item and character cells are seeded as source references and can be imported from checked-in PNGs. New assets support 8-64 px dimensions, allowing more detail than the original 16 px placeholders.

The runtime renders published DB frames when available and falls back to checked-in sheets otherwise. DB-to-atlas composition remains the next optimization step. See `docs/ENGINE.md`.
