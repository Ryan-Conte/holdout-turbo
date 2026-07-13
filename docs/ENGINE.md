# HOLDOUT game engine

The game engine is an admin-only authoring surface at `/admin/{slug}`. Every page and API request verifies the Better Auth session plus `profiles.admin`.

## Routes

| Route | Purpose |
| --- | --- |
| `/admin/map` | Map, placements, custom chest loot, custom mob/boss spawns, drafts and publish |
| `/admin/terrain` | ID-based ground art, traversal, swimming, collision, sight, bullets and footsteps |
| `/admin/resources` | Tree/rock/ore durability, respawn, drops, sprite and sound definitions |
| `/admin/mobs` | AI, health, damage, boss flag, drops, sprite link and respawn time |
| `/admin/animations` | Visual player/mob clip timeline, playback, sprite selection and inline frame editing |
| `/admin/sounds` | Synthesized sound presets, preview and gameplay action routing |
| `/admin/items` | Structured item metadata, combat/survival behavior, restrictions and sprite mapping |
| `/admin/recipes` | Structured output, ingredient, category and station controls |
| `/admin/loot` | Structured weighted chest, ground and mob drop tables with probability feedback |
| `/admin/traders` | Structured stock rows, buy/sell prices and linked quest tier |
| `/admin/blocks` | Sprite-backed world blocks, collision, health, drops and sounds |
| `/admin/sprites` | RGBA pixel editor for 8-64 px custom assets |
| `/admin/quests` | Structured quest editor |
| `/admin/servers` | Server-browser entries |
| `/admin/settings` | Engine restrictions as systems migrate |

`/editor` redirects to `/admin/map`. Non-admin users are redirected before the studio renders. APIs under `/api/admin/*` independently call `requireAdmin()`; the layout is not the only security boundary.

## Draft and publish

Content documents live in `game_content`, one row per kind. Rows contain `draft`, `published`, `revision`, `published_revision`, editor identity and timestamps.

1. **Save draft** validates and stores work without changing the game.
2. **Publish live** validates again and copies the draft to `published`.
3. Game API instances poll published mobs, recipes, traders and loot every 10 seconds.
4. Shared TypeScript definitions remain the fallback if a row is missing or invalid.

Maps use rows in `maps`: `draft=true` is private, while one `active=true, draft=false` row is live. Game servers poll the active revision and replace the world only when no players are connected to it, so publishing cannot reset an active raid.

## Runtime coverage

| Content | DB editable | Runtime hot reload | Notes |
| --- | --- | --- | --- |
| Mobs/bosses | Yes | Yes | Structured editor for AI, health, speed, ranges, damage, drops, respawn, boss flag and sprite |
| Entity animations | Yes | Yes | Player and mob profiles hot-push to connected clients; checked-in sheets remain fallbacks |
| Resource nodes | Yes | Yes | Map tiles reference IDs controlling health, skill, drops, respawn, art and sounds |
| Sound effects | Yes | Yes | Presets hot-push; animations, mobs and resources reference sound IDs |
| Chest and mob loot | Yes | Yes | Custom chests store a loot-table ID on the map |
| Recipes | Yes | Server: yes | Outputs/costs require known item IDs; the client recipe browser still uses shared display data |
| Traders | Yes | Yes | Tier 1/2 stock reloads; quests currently link through `questTier` |
| Maps | Yes | When empty | Sprite preview, zoom, private drafts and publish |
| Quests | Yes | Within 60s | Existing structured table/API |
| Items | Yes | Not yet | Fully new DB-only IDs require the dynamic item registry migration |
| World blocks | Yes | Yes | Map-layer IDs control pixel art, collision, LOS, bullets, health, drops and sounds |
| Terrain elements | Yes | Yes | ID-based map layer controls pixel art, minimap color, movement, swimming, collision, LOS, bullets and footsteps |
| Player buildables | Yes | Yes | All kit-placeable pieces are block definitions with DB art, health, collision and placement metadata; shared tiles remain a simulation fallback |
| Pixel art | Yes | Yes | Published RGBA frames render directly; atlas composition remains a payload optimization |
| Settings | Yes | Per setting | Live when each owning runtime system adopts it |

This split gives artists and designers a stable DB workflow while preserving the authoritative server during migration.

## Map workflow

- The editor uses a bounded camera viewport and renders only visible tiles, so 200x200 maps do not create enormous browser canvases.
- The preview uses current tile, item and character sheets, animated mob frames, extraction pulses, POI radii and content labels.
- Mouse wheel zooms around the cursor. Pan with the H tool, middle-drag, Space+drag, Shift+wheel, or by clicking the minimap. `F` fits the world.
- The navigator caches map terrain and draws the current camera bounds. Grid, labels and zone overlays can be toggled independently.
- The Height palette paints elevation levels 0-3 independently from terrain. One-level transitions are traversable hills; jumps of two or more levels block movement, vision and bullets as cliff faces. The published Cliff terrain remains a solid rock wall.
- There is no separate Base palette. Every authored cell carries a published terrain ID, and art and behavior remain centrally editable in `/admin/terrain`.
- The Nodes palette paints a published resource variant onto a compatible tile. Health, drops, respawn, sprite and sounds remain centrally editable in `/admin/resources`.
- The Blocks palette includes both player-buildable kit pieces and authored-only world blocks. `R` or **Rotate 90°** stores a clockwise quarter-turn per cell; the definition supplies its pixel asset and authoritative behavior.
- Terrain strokes interpolate between pointer samples, and undo/redo keeps the last 40 map transactions (`Ctrl+Z` / `Ctrl+Y`).
- Select a placement with `V` to edit position, POI name/radius, custom mob ID/respawn, or custom chest table in the inspector.
- **Custom zone** creates a new named POI with editable radius, map class and independent safe-zone/hot-loot flags. These settings become authoritative server POI behavior after publish.
- **Custom chest** placement selects a published loot-table ID from the content library.
- **Custom mob / boss** placement selects a published mob record; its respawn can be overridden in the inspector. The mob record carries `boss: true` for design semantics.
- Right-click or the `E` tool erases. Invalid custom content references block publish. Save a draft before publishing.

## Pixel workflow

Sprite records contain an ID, name, dimensions, RGBA animation frames and an optional source-sheet range. Existing item and character placeholders are seeded as source references. **IMPORT PLACEHOLDER FRAMES** copies those PNG cells into the DB draft. New assets can be 8-64 pixels per axis instead of being restricted to the original 16x16 cells.

The pixel studio includes name/ID/source-sheet asset search, pencil, eraser, flood fill, exact RGBA eyedropper, native color/alpha controls, custom palettes, undo, clear, horizontal/vertical flip, frame duplication/blank/delete, onion skin and animated playback. The frame builder can append 1-16 blank or duplicated frames per action up to the validated 64-frame asset limit. Animation profiles reference frame indices from these assets; publishing sprite or animation changes hot-pushes visual data to connected clients.

The animation studio provides a playable and scrub-able keyframe timeline for every entity state, source-frame thumbnails, step reordering/removal, visual sprite selection, and an inline pencil/eraser/fill/eyedropper editor. Every keyframe can override duration, emit an event marker and trigger a sound preset. Placeholder sheet frames remain read-only fallbacks until **IMPORT PLACEHOLDER FRAMES TO EDIT** materializes them in the sprite draft. **PUBLISH MOTION + ART** coordinates both documents when inline art changed.

## Resource and sound workflow

Resource definitions are reusable map building blocks. `maxHits`, `respawnMs`, harvest skill, depleted tile, sprite and hit/break sounds are authoritative server values. Drop rules select an item, min/max quantity, probability and whether they roll on every hit or only on depletion. The seeded **Ironwood tree** demonstrates a 14-hit tree with heavier wood yields, a depletion-only iron chance and unique audio IDs.

Sound presets are Web Audio synthesis definitions (waveform, start/end frequency, duration, volume, noise mix and low-pass filter), so new effects require no uploaded file. Action routing can replace built-in effects globally, while resource nodes, mob action slots and animation keyframes can reference a preset directly. The seeded **infected brute** demonstrates a keyframed windup/impact/recovery attack with roar and slam cues.

## Dynamic world blocks

World blocks are ID-based map layers rather than tile values. A block directly references a `PixelAsset` and controls render scale/offset, player collision, enemy collision, bullet blocking, sight blocking, health, hit/break sounds and destroyed-drop rules. Map-authored blocks in the main world are always protected from damage. Only structures registered from player kit placement use destructible health and can be destroyed by players; removing one reveals its terrain or foundation beneath it.

The same catalog contains all 12 player buildables: chest, workbench, firepit, furnace, anvil, bed, wood/stone floors, wall, door, fence and torch. `playerPlacement` links each block to its build type and kit item, plus hideout/foundation/storage restrictions. While holding a kit, `R` rotates its exact DB-art ghost in 90-degree steps; placement persists that orientation in world state and hideout data. Player placement and hideout loading assign the published block ID, so edited DB art renders in the map editor and in game. Shared `BUILDABLES`/tile values remain compatibility fallbacks for station, foundation and persistence logic until dynamic item IDs are complete.

Doors retain their authored quarter-turn as the closed orientation. When a player enters the doorway, the server marks it open and clients render an additional 90-degree swing. Open doors temporarily allow enemies, projectiles and line of sight through; they close once no player remains nearby.

## Terrain and economy workflow

Terrain definitions are the sole admin-authored ground source. Each one directly references a DB pixel asset and supplies a simulation role, minimap color, movement multiplier, swimming behavior, independent player/enemy/bullet/sight collision and a footstep sound. `simulationTile` derives an internal numeric compatibility cache used by older harvesting, station and building systems; it is not a second editable ground layer. The seeded **Deep mud** demonstrates slowed movement, custom art/color and soft footsteps.

Items, loot, crafting and trader documents no longer require raw JSON editing. The item editor exposes inventory metadata, category-specific weapon/tool/armor/consumable/placeable behavior, durability and pixel-asset mapping. The loot editor exposes table roll ranges, weighted item rows, quantity ranges, ordering and calculated per-roll probability. Recipes use item selectors for output and ingredient rows plus explicit category/station controls. Traders use item rows with separate “trader sells for” and “trader buys for” prices plus quest tier. Item references and numeric limits are sanitized again by the API before save and publish. Existing shared item IDs retain runtime authority until the dynamic item registry migration is complete; loot changes hot-reload today. Runtime trader placement still resolves the established outpost and black-market tier records; arbitrary trader IDs remain part of the trader-ID migration below.

Publishing pixels does not rebuild `public/sprites/*.png`. Imported/custom frame data is rendered directly from the published DB document, while checked-in sheets remain the fallback for assets with no frame pixels.

## Setup and seeding

```bash
npx prisma db push
npx prisma generate
npm run seed:engine
```

`seed:engine` creates missing documents from current items, recipes, mobs, terrain, resources, sounds, loot, traders, blocks and sprite metadata. Current terrain/resource PNG cells are materialized as editable DB RGBA frames, existing authored values are preserved, and older stored maps receive a terrain ID for every cell.

`ADMIN_EMAILS` only bootstraps `profiles.admin` on first check. The DB flag remains authoritative afterward.

## Next migration work

1. Send a dynamic item registry in game initialization and enable DB-only item IDs.
2. Compose published pixel assets into versioned runtime atlases to reduce initialization payload size.
3. Move block collision, placement restrictions and global tuning into published documents.
4. Replace trader tiers with trader IDs and explicit quest ID lists while retaining compatibility.
5. Add revision history, rollback, validation reports and staging preview sessions.
