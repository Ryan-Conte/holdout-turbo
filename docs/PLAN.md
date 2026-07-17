# Working plan

## Milestone A — Gameplay batch  ✅ (verifying)
- [x] Chest item moving fixed: server `containerMove` (reorder) + targeted `containerPut`; client drag-vs-click discrimination (justDragged)
- [x] Craft tabs hidden when away from station (SMELT needs furnace, FORGE needs anvil); auto-fallback tab
- [x] Esc menu: RETURN TO MENU (keeps session) + LOG OUT; combat-log warning when out in the open
- [x] Stamina: SHIFT sprint (1.55x) drains fully to zero; depletion applies a 2.6s regen delay and locks sprint until 25 stamina; mining/chopping also exhaust; HUD exposes the lockout
- [x] Durability: weapons/tools/armor wear with use; break at 0; REPAIR via context menu at the right station (scrap + bars); tooltip + slot strip
- [x] Character customization: separate pre-deploy creator with body, skin, hair, outfit and accent layers; profile persistence, live preview, network rendering and future cosmetic slots
- [x] Cliffs (Tile.Cliff): impassable vertical terrain, blocks sight/bullets; editor + sprite
- [x] Elevation layers: editor height brush, procedural hills/mesas, contour rendering, traversable grades and authoritative steep cliff faces
- [x] Audit polish: death returns home, disconnect expiry drops gear, damage interrupts timed actions, wear survives transfers, unlocked jobs stay visible, and range/LOS culling covers loot/projectiles
- [x] Fueled stations: firepits/furnaces store wood heat, persist at home, and consume one charge per cook/smelt
- [x] Deployment terminal portrait uses the saved layered survivor appearance

## Milestone B — Game engine /admin  (in progress)
Admin-only. Everything editable and DB-backed, hot-reloaded over shared defaults.
- [x] Move `/editor` to `/admin/{slug}` with a server-side DB-admin gate and API checks
- [x] Map editor v2: camera zoom/pan, viewport culling, minimap, animated sprite preview, inspector, undo/redo, validation, draft and publish
- [x] `game_content` draft/published documents plus API `ContentService` hot reload
- [x] Workbenches for items, mobs/bosses, recipes, loot, traders, blocks and settings
- [x] Structured mob builder + player/mob animation profiles + multi-frame pixel studio and runtime visual hot reload
- [x] Custom chest-table and mob/boss map placements with respawn delay
- [x] RGBA pixel editor with placeholder import and 8-64 px custom assets
- [x] Seed command for current defaults (`npm run seed:engine`)
- [x] `docs/ENGINE.md`
- [ ] Runtime dynamic-item registry and client init payload for DB-only item IDs
- [ ] Published pixel atlas composition for the live renderer
- [x] DB-backed block collision and player-placement rules
- [ ] Trader-specific quest ID lists (tiers remain the compatibility link)

### Sequencing notes
- Content DB is the backbone; do it before the per-kind editors.
- Pixel-art editor is large — build after content data flows.
- Keep shared defaults as the fallback so nothing breaks if content rows are absent.
