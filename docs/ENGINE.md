# HOLDOUT game engine

The game engine is an admin-only authoring surface at `/admin/{slug}`. Every page and API request verifies the Better Auth session plus `profiles.admin`.

## Routes

| Route               | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `/admin/map`        | Map, placements, custom chest loot, custom mob/boss spawns, drafts and publish       |
| `/admin/terrain`    | ID-based ground art, traversal, swimming, collision, sight, bullets and footsteps    |
| `/admin/resources`  | Tree/rock/ore durability, respawn, drops, sprite and sound definitions               |
| `/admin/mobs`       | AI, health, damage, boss flag, drops, sprite link and respawn time                   |
| `/admin/animations` | Visual player/mob clip timeline, playback, sprite selection and inline frame editing |
| `/admin/sounds`     | Synthesized sound presets, preview and gameplay action routing                       |
| `/admin/items`      | Structured item metadata, combat/survival behavior, restrictions and sprite mapping  |
| `/admin/recipes`    | Structured output, ingredient, category and station controls                         |
| `/admin/loot`       | Structured weighted chest, ground and mob drop tables with probability feedback      |
| `/admin/traders`    | Structured stock rows, buy/sell prices and linked quest tier                         |
| `/admin/blocks`     | Sprite-backed world blocks, collision, health, drops and sounds                      |
| `/admin/sprites`    | RGBA pixel editor for 8-64 px custom assets                                          |
| `/admin/quests`     | Structured quest editor                                                              |
| `/admin/servers`    | Server-browser entries                                                               |
| `/admin/settings`   | Engine restrictions as systems migrate                                               |

`/editor` redirects to `/admin/map`. Non-admin users are redirected before the studio renders. APIs under `/api/admin/*` independently call `requireAdmin()`; the layout is not the only security boundary.

## Draft and publish

Content documents live in `game_content`, one row per kind. Rows contain `draft`, `published`, `revision`, `published_revision`, editor identity and timestamps. Every saved head is also copied to immutable `game_content_revisions` history.

Sprites use normalized storage because their RGBA frames grow much faster than ordinary engine JSON. The `sprites` content row now contains only its palette and global revision manifest. Each asset has an independent draft/published row in `game_sprite_assets`, and `game_sprite_asset_revisions` records only the assets changed at a revision. The first sprite API request migrates the legacy combined document transactionally. Older combined history remains readable for rollback, while new edits no longer duplicate the complete art library. Admin sprite lists return metadata by default; pixel frames are fetched per asset, or explicitly as one draft/published channel for editors that need a complete render catalog.

1. **Save draft** validates and stores work without changing the game.
2. **Publish live** validates again and copies the draft to `published`.
3. Game API instances cache published documents in process memory and poll only `published_revision`/`published_at` metadata every 10 seconds. A publish fetches only the changed document; unchanged sprite pixels and other JSON never cross the database connection again. The last successful bundle is also written atomically to `RUNTIME_CACHE_DIR` so a socket server can restart from local temp storage during a database outage. Failed metadata probes use exponential backoff up to five minutes while the cached world remains online.
4. Shared TypeScript definitions remain the fallback if a row is missing or invalid.

The revision safety bar is available across content and map editors. **ROLL BACK LIVE** restores a selected snapshot as a new head revision, so rollback never deletes the revision being replaced. Map publishes already create immutable rows; selecting an older row simply makes it active again.

For raid testing, run a separate API process with `CONTENT_CHANNEL=staging`. It reads current content drafts plus the newest draft map, uses channel-specific runtime/world cache keys, and does not self-register in the public server browser unless `REGISTER_STAGING_SERVER=true`. Set `NEXT_PUBLIC_STAGING_GAME_URL` on the web app to enable **OPEN STAGING RAID** in the admin bar. Never enable staging mode on a live regional process.

Maps use rows in `maps`: `draft=true` is private, while one `active=true, draft=false` row is live. Each game server downloads the active authored map once, expands it into its in-memory world, writes a local runtime snapshot, and then polls only the active row ID. Startup prefers current Postgres data but restores that snapshot when Postgres is unavailable. A newly published map document is fetched once and replaces the world only when no players are connected, so publishing cannot reset an active raid.

## Runtime coverage

| Content            | DB editable | Runtime hot reload | Notes                                                                                                                                           |
| ------------------ | ----------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobs/bosses        | Yes         | Yes                | Structured editor for AI, health, speed, ranges, damage, drops, respawn, boss flag and sprite                                                   |
| Entity animations  | Yes         | Yes                | Player and mob profiles hot-push to connected clients; checked-in sheets remain fallbacks                                                       |
| Resource nodes     | Yes         | Yes                | Map tiles reference IDs controlling health, skill, drops, respawn, art and sounds                                                               |
| Sound effects      | Yes         | Yes                | Presets hot-push; animations, mobs and resources reference sound IDs                                                                            |
| Chest and mob loot | Yes         | Yes                | Custom chests store a loot-table ID on the map                                                                                                  |
| Recipes            | Yes         | Yes                | Versioned runtime recipes hot-push to the simulation and client recipe browser                                                                 |
| Traders            | Yes         | Yes                | Tier 1/2 stock reloads; quests currently link through `questTier`                                                                               |
| Maps               | Yes         | When empty         | Sprite preview, zoom, private drafts and publish                                                                                                |
| Quests             | Yes         | Within 60s         | Existing structured table/API                                                                                                                   |
| Items              | Yes         | Yes                | Published overrides and DB-only IDs drive simulation, UI, tooltips, item art, equipment light and persistence                                  |
| World blocks       | Yes         | Yes                | Map-layer IDs control pixel art, collision, LOS, bullets, health, drops and sounds                                                              |
| Terrain elements   | Yes         | Yes                | ID-based map layer controls pixel art, minimap color, movement, swimming, collision, LOS, bullets and footsteps                                 |
| Player buildables  | Yes         | Yes                | All kit-placeable pieces are block definitions with DB art, health, collision and placement metadata; shared tiles remain a simulation fallback |
| Pixel art          | Yes         | Yes                | Published RGBA frames render directly; atlas composition remains a payload optimization                                                         |
| Settings           | Yes         | Per setting        | Live when each owning runtime system adopts it                                                                                                  |

This split gives artists and designers a stable DB workflow while preserving the authoritative server during migration.

## Map workflow

- The editor supports authored maps up to 2000x2000 cells. Close camera windows render detailed visible tiles; broad views switch to a sampled 1024-pixel overview built in small asynchronous chunks, so fitting a four-million-cell world never redraws the full grid each frame or locks the browser.
- The preview uses current tile, item and character sheets, animated mob frames, extraction pulses, POI radii and content labels.
- Mouse wheel zooms around the cursor. Pan with the H tool, middle-drag, Space+drag, Shift+wheel, or by clicking the minimap. `F` fits the world.
- The navigator shares the sampled terrain cache and draws the current camera bounds. Grid, labels and zone overlays can be toggled independently.
- The Height palette paints elevation levels 0-3 independently from terrain. One-level transitions are traversable hills; jumps of two or more levels block movement, vision and bullets as cliff faces. The published Cliff terrain remains a solid rock wall.
- There is no separate Base palette. Every authored cell carries a published terrain ID, and art and behavior remain centrally editable in `/admin/terrain`.
- The Nodes palette paints a published resource variant onto a compatible tile. Health, drops, respawn, sprite and sounds remain centrally editable in `/admin/resources`.
- The Blocks palette includes both player-buildable kit pieces and authored-only world blocks. `R` or **Rotate 90°** stores a clockwise quarter-turn per cell; the definition supplies its pixel asset and authoritative behavior.
- Terrain strokes interpolate between pointer samples. Undo/redo keeps the last 40 map transactions on ordinary maps, 8 above one million cells and 4 above two million cells (`Ctrl+Z` / `Ctrl+Y`) to keep browser memory bounded.
- Select a placement with `V` to edit position, POI name/radius, custom mob ID/respawn, or custom chest table in the inspector.
- **Custom zone** creates a new named POI with editable radius, map class and independent safe-zone/hot-loot flags. These settings become authoritative server POI behavior after publish.
- **Custom chest** placement selects a published loot-table ID from the content library.
- **Custom mob / boss** placement selects a published mob record; its respawn can be overridden in the inspector. The mob record carries `boss: true` for design semantics.
- Right-click or the `E` tool erases. Invalid custom content references block publish. Save a draft before publishing.

Map rows and socket initialization use run-length encoded tile, elevation and terrain-override layers. The editor and authoritative server inflate these into byte arrays only while the map is active; older dense map rows remain readable and are rewritten compactly the next time an admin saves them. The game renderer draws visible large-world cells directly and uses a sampled navigator up to 1024 pixels instead of allocating a full-world canvas. The HUD crops that navigator to a player-centered local window; the `M` tactical map supports cursor-anchored zoom, drag panning, player recentering and full-region fit. Opening the admin editor loads the editable draft plus live-map metadata, not a second full copy of the published map.

## Pixel workflow

Sprite records contain an ID, name, dimensions, RGBA animation frames and an optional source-sheet range. Existing item and character placeholders are seeded as source references. **IMPORT PLACEHOLDER FRAMES** copies those PNG cells into the DB draft. New assets can be 8-64 pixels per axis instead of being restricted to the original 16x16 cells.

The pixel studio includes name/ID/source-sheet asset search, pencil, eraser, flood fill, exact RGBA eyedropper, native color/alpha controls, custom palettes, undo, clear, horizontal/vertical flip, frame duplication/blank/delete, onion skin and animated playback. The frame builder can append 1-16 blank or duplicated frames per action up to the validated 64-frame asset limit. Animation profiles reference frame indices from these assets; publishing sprite or animation changes hot-pushes visual data to connected clients.

The animation studio provides a playable and scrub-able keyframe timeline for every entity state, source-frame thumbnails, step reordering/removal, visual sprite selection, and an inline pencil/eraser/fill/eyedropper editor. Every keyframe can override duration, emit an event marker and trigger a sound preset. Placeholder sheet frames remain read-only fallbacks until **IMPORT PLACEHOLDER FRAMES TO EDIT** materializes them in the sprite draft. **PUBLISH MOTION + ART** coordinates both documents when inline art changed.

## Resource and sound workflow

Resource definitions are reusable map building blocks. `maxHits`, `respawnMs`, harvest skill, depleted tile, sprite and hit/break sounds are authoritative server values. `respawnFamily` groups tree or rock definitions and `respawnWeight` controls their relative chance whenever a depleted node regrows; a weight of zero disables random regrowth without preventing authored placement. The seeded common tree / **Ironwood tree** weights are 94 / 6. Rocks separately reroll their stone, copper and iron vein tile. Cooldowns and chosen variants persist per server and map revision.

Drop rules select an item, min/max quantity, probability and whether they roll on every hit or only on depletion. The seeded **Ironwood tree** demonstrates a 14-hit rare tree with heavier wood yields, a depletion-only iron chance and unique audio IDs.

Sound presets are Web Audio synthesis definitions (waveform, start/end frequency, duration, volume, noise mix and low-pass filter), so new effects require no uploaded file. Action routing can replace built-in effects globally, while resource nodes, mob action slots and animation keyframes can reference a preset directly. The seeded **infected brute** demonstrates a keyframed windup/impact/recovery attack with roar and slam cues.

## Dynamic world blocks

World blocks are ID-based map layers rather than tile values. A block directly references a `PixelAsset` and controls render scale/offset, player collision, enemy collision, bullet blocking, sight blocking, health, hit/break sounds and destroyed-drop rules. Map-authored blocks in the main world are always protected from damage. Only structures registered from player kit placement use destructible health and can be destroyed by players; removing one reveals its terrain or foundation beneath it.

The same catalog contains all 12 player buildables: chest, workbench, firepit, furnace, anvil, bed, wood/stone floors, wall, door, fence and torch. `playerPlacement` links each block to its build type and kit item, plus hideout/foundation/storage restrictions. While holding a kit, `R` rotates its exact DB-art ghost in 90-degree steps; placement persists that orientation in world state and hideout data. Player placement and hideout loading assign the published block ID, so edited DB art renders in the map editor and in game. Shared `BUILDABLES`/tile values remain compatibility fallbacks for station, foundation and persistence logic until dynamic item IDs are complete.

Doors retain their authored quarter-turn as the closed orientation. When a player enters the doorway, the server marks it open and clients render an additional 90-degree swing. Open doors temporarily allow enemies, projectiles and line of sight through; they close once no player remains nearby.

## Terrain and economy workflow

Terrain definitions are the sole admin-authored ground source. Each one directly references a DB pixel asset and supplies a simulation role, minimap color, movement multiplier, swimming behavior, independent player/enemy/bullet/sight collision and a footstep sound. `simulationTile` derives an internal numeric compatibility cache used by older harvesting, station and building systems; it is not a second editable ground layer. The seeded **Deep mud** demonstrates slowed movement, custom art/color and soft footsteps.

Items, loot, crafting and trader documents no longer require raw JSON editing. The item editor exposes inventory metadata, category-specific weapon/tool/armor/consumable/placeable behavior, durability, equipped `lightRadius`, and pixel-asset mapping. The loot editor exposes table roll ranges, weighted item rows, quantity ranges, ordering and calculated per-roll probability. Recipes use item selectors for output and ingredient rows plus explicit category/station controls. Traders use item rows with separate “trader sells for” and “trader buys for” prices plus quest tier. Item references and numeric limits are sanitized again by the API before save and publish. The API merges published item definitions over shared outage/compatibility fallbacks, validates recipes and trader stock against that active registry, sends its actual item/recipe revision signature in `WorldInit`, and hot-pushes `s:gameplay` on later publishes. DB-only IDs receive published pixel art when available and a visible unknown-art placeholder otherwise. Runtime trader placement still resolves the established outpost and black-market tier records; arbitrary trader IDs remain part of the trader-ID migration below.

Publishing pixels does not rebuild `public/sprites/*.png`. Imported/custom frame data is rendered directly from the published per-asset DB rows, while checked-in sheets remain the fallback for assets with no frame pixels. Runtime servers assemble the published rows only after the sprite manifest revision changes.

Firepit and furnace fuel is runtime state, not a recipe ingredient. Players transfer carried wood into the selected station through the authoritative `c:station:fuel` intent; one wood supplies four heat charges and each completed cook or smelt consumes one. The station capacity is 40 heat. Fuel on hideout stations persists with the placed object, while temporary world stations lose their remaining fuel when destroyed or expired. Furnace recipe documents therefore describe ore/material inputs only; runtime normalization strips legacy wood costs to avoid charging fuel twice.

## Setup and seeding

```bash
npx prisma db push
npx prisma generate
npm run seed:engine
```

`seed:engine` creates missing documents from current items, recipes, mobs, terrain, resources, sounds, loot, traders, blocks and sprite metadata. Current terrain/resource PNG cells are materialized as editable DB RGBA frames, existing authored values are preserved, and older stored maps receive a terrain ID for every cell.

### Greyvale Frontier (recommended raid map)

`Greyvale Frontier - 500` is the deterministic 500x500 authored world intended for ordinary play. It contains Greyhaven and four surrounding villages, three fortified safe traders, two unsafe black-market dealers, Warden Airfield, Fort Greywall, two farms, two forests, Copperhead Quarry, Hollow Lake, Drowned Fen, Saint Mercy Hospital, the Old Greyvale Rail Yard and Burnt Orchard. Three cross-map road loops and three Greywater bridges give every district multiple approaches.

The validation contract requires at least twelve protected deployments, six extraction beacons, five settlements, three safe traders, five high-value regions, fifty containers, one hundred fauna and 7,000 persistent resource nodes. It also verifies every content reference, collision, overlap, trader/spawn safety, critical-route reachability and at least 92% walkable connectivity. The current seeded revision has 100% connectivity, 304 creature/enemy spawns, 112 fauna, 72 containers, 7,875 resource nodes and 79 buildings.

Generate the map report and preview without changing the active publication:

```bash
npm run validate:frontier-map
```

Publish a new immutable live revision and create or refresh its editable draft:

```bash
npm run seed:frontier-map
```

The generated minimap preview is written to `docs/assets/greyvale-frontier-500.png`. Existing deer, rabbit, boar and wolf engine sprites cover its fauna population; the generator does not introduce redundant art records.

### Showcase base map

`Ashfall Basin - Showcase Base` is a deterministic 2000x2000 authored map that uses the engine's maximum supported dimensions. Its 30 named regions include twelve compact settlements, three farms, Greywing Airfield and Rook Airstrip, two fortified military bases, four safe trading outposts, two risky black-market traders and distinct forest, marsh, quarry, highland and industrial regions. Buildings are deliberately limited to 14x10 cells; the current seed places 337 small houses, shops, hangars and barracks instead of a few oversized compounds.

Regional population and loot are part of the validation contract: infected gather around towns and farms, military guards defend airfields and hot zones, bosses anchor both forts, and wildlife occupies the surrounding biomes. The current seed provides 662 mob spawns across all seven published mob types, 141 loot containers, seven high-loot regions, 48 world spawns and twelve extraction routes. Safe-zone and deployment buffers reject enemy placement, while road loops, local spurs and four river crossings must retain 100% walkable connectivity before the map can publish.

The generator demonstrates every published block, resource, mob and loot table. It also validates catalog references, dimensions, collision, overlapping gameplay objects, critical-route reachability and total walkable connectivity before it can write to the database. Generate a preview and validation report without changing maps:

```bash
npm run validate:showcase-map
```

Publish the validated map and create or refresh its editable draft:

```bash
npm run seed:showcase-map
```

Publishing deactivates the previous live map but preserves its database row. Re-running the command updates the named draft and creates a new immutable live row. API worlds adopt the new active row when their current world has no connected players.

`ADMIN_EMAILS` only bootstraps `profiles.admin` on first check. The DB flag remains authoritative afterward.

## Next migration work

1. Compose published pixel assets into versioned runtime atlases to reduce initialization payload size.
2. Move remaining global tuning into published documents.
3. Replace trader tiers with trader IDs and explicit quest ID lists while retaining compatibility.
4. Add richer cross-document validation reports before publish.
5. Add staging-session access leases if the private staging server is ever exposed beyond administrators.
