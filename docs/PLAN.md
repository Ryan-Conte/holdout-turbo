# Working plan

## Milestone A — Gameplay batch  ✅ (verifying)
- [x] Chest item moving fixed: server `containerMove` (reorder) + targeted `containerPut`; client drag-vs-click discrimination (justDragged)
- [x] Craft tabs hidden when away from station (SMELT needs furnace, FORGE needs anvil); auto-fallback tab
- [x] Esc menu: RETURN TO MENU (keeps session) + LOG OUT; combat-log warning when out in the open
- [x] Stamina: SHIFT sprint (1.55×, drains), mining/chopping cost stamina, regen after a beat; HUD bar
- [x] Durability: weapons/tools/armor wear with use; break at 0; REPAIR via context menu at the right station (scrap + bars); tooltip + slot strip
- [x] Character customization: 8 outfit looks (gear screen swatches), persisted; renderer uses `look`
- [x] Cliffs (Tile.Cliff): impassable vertical terrain, blocks sight/bullets; editor + sprite

## Milestone B — Game engine /admin  (in progress)
Admin-only. Everything editable and DB-backed, hot-reloaded over shared defaults.
- [ ] Move `/editor` → `/admin` hub (admin-gated middleware + layout with tabs)
- [ ] Map editor v2: zoom (wheel), pan, sprite live preview (real tiles/objects), publish button
- [ ] `game_content` DB table (jsonb per kind) + hot-reload merge in API `ContentService`
- [ ] Content editors: items, mobs (incl. bosses + custom spawns), crafting recipes, chest loot tables (in map editor), mob drop tables, trader stock/buy-sell + linked quests
- [ ] In-browser pixel-art editor → stores pixel data in DB, composes sheets client-side; seed from current generator output
- [ ] Seed `game_content` from current shared defaults on first boot
- [ ] docs/ENGINE.md

### Sequencing notes
- Content DB is the backbone; do it before the per-kind editors.
- Pixel-art editor is large — build after content data flows.
- Keep shared defaults as the fallback so nothing breaks if content rows are absent.
