# Big update — working plan

Goal reminder: build your base, collect rare loot to show off, earn money, kill players for their loot, level up.

## Status legend: [ ] todo · [~] in progress · [x] done

### Foundation (DB + shared)
- [x] Prisma: `Profile.admin` flag, `Quest.requiresId/tier`, `GameServer` model → pushed + generated
- [x] Shared items: revolver/carbine/dmr/lmg/prototype railgun, steel tools, .44/7.62 ammo, copper/iron ore + bars, valuables (gold bar, diamond, watch, data drive, artifact), kit_anvil
- [x] Shared tiles: CopperOre/IronOre nodes, Anvil station tile
- [x] Recipes by station: hand · workbench (tools/gear/kits) · furnace (SMELT only) · anvil (weapons/ammo/attachments)
- [x] Trader tiers: T1 outpost · T2 black-market (pays big for valuables)
- [x] Quest tree: `requires` chain + `tier`, locked quests hidden and don't tick
- [x] Hotzones: `PoiSnap.hot`, editor poi_hotzone + trader_black, airport hot by default

### Sprites
- [x] 19 new item icons + ore rock tiles + anvil tile; sprites.ts synced

### API server
- [x] Mapgen ore veins (14% copper / 8% iron per rock); hot chests roll RARE table
- [x] Mining ore yields stone + ore; RARE_TABLE with high-grade guns/attachments/valuables
- [x] nearAnvil, anvil craft checks, station E → right craft tab
- [x] Per-trader tier stock + quests; quest claim validates tier + unlock
- [x] Hold-to-place: kits equip in hand, click places (no build mode); X demolish unchanged
- [x] Combat-log: body persists 60s on disconnect
- [x] Survivor NPCs removed (LOS + per-viewer snapshots kept)

### Web (Next)
- [x] DB-backed admins (`profiles.admin`, env bootstraps) across all admin routes
- [x] Server browser: /api/servers (auto-seeds Local) + admin CRUD + editor SERVERS tab + login-page picker; client connects to picked server
- [x] Quest tree seeded (tools/seed-quests.mjs): T1 First Blood → Wolf Cull/Timber → Prospector → Iron Age ⇒ T2 Military Grade → The Drive → Impossible Geometry

### Client
- [x] Cooking fixed: click = +1 to queue (badges), QUEUE EVERYTHING; robust pop-on-fire drain
- [x] Craft menu: station recipes hidden unless at the station; SMELT/FORGE tabs; 🔒 hint
- [x] LOS fog overlay matching server wall-vision
- [x] Gun feel: barrel on the aim line (no 45° nudge), flips when aiming left, recoil kick, drawn crosshair (cursor hidden)
- [x] Custom Tip tooltips (inventory/hotbar/container/equipment/craft cells) with item stat cards
- [x] Map/minimap hotzone rings + ☠ labels; BLACK MARKET trade header
- [x] Friend visiting: VISIT CAMP from safe zones unchanged (own-camp warp stays removed)

### Verify
- [x] typecheck all workspaces
- [x] /api/servers auto-seed; forged-callback rejection (earlier); /play & /editor compile
- [~] Bot: ores on map, station gating, trader tier + quest tree, mining ore, cook end-to-end
- [ ] Play-test pass by a human (that's you)

### Notes / follow-ups
- Editor quest form now has TIER + REQUIRES; server hot-reloads quests within 60s
- To make yourself admin without env: `UPDATE profiles SET admin = true WHERE user_id = '…'`
- New servers must share JWT_SECRET + DATABASE_URL with the web app
