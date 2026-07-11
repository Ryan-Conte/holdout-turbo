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

rows 0-7 survivor shirt palette variants (name-hash picks row) · row 8 zombie · row 9 military · row 10 trader.
Frame 0 = idle, frame 1 = step. Aim direction, held weapon, armor overlays are composited by the renderer.

## items.png (16×16)

One icon per `ItemId`, column order defined in `apps/web/game/sprites.ts` (`ITEM_SHEET_ORDER`). Used by both the canvas (held/dropped items) and the DOM UI (CSS sprite backgrounds).

Adding an item: add to shared `ITEMS`, append to `ITEM_SHEET_ORDER`, add a drawing block in `tools/gen-sprites.mjs` (or edit the PNG), rerun the generator.
