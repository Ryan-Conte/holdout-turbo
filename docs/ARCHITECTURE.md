# Architecture

## Server (apps/api)

`GameService` owns a map of **instances**:

```
Instance {
  id: 'world' | 'h:<userId>'
  kind: 'world' | 'hideout' | 'clan_hideout'
  w, h, tiles: Uint8Array          // live — harvested nodes mutate it
  containers, ground, enemies      // Maps
  elevations, terrain/resource/block ID layers
  stationFuel, structures, openDoors
  projectiles: []
  pois (safe flags), traders, exit, spawns, lootSpots
  nodeHits / nodeRespawns / nodeVariants / enemyRespawns
}
```

- 20 Hz tick: player movement (intent-based), optional survivor-bot decisions, enemy AI, projectile sub-stepping, survival, timed actions, fuel use, node/enemy/chest respawns, and per-viewer range/LOS-filtered snapshots.
- Players carry `instanceId`; entering a hideout = leave room, join room, new `s:init`.
- **Hideouts**: 26×20 safe build fields with a movable bed, starter stash, and exit mat. Builds, chest slots, and firepit/furnace fuel persist in `profiles.hideout`. Players log in and wake after death at home; accepted friends may visit from their own home or a safe zone while the owner is online on the same relay, and are evicted before that owner releases regional authority.
- **Clans**: each survivor belongs to at most one clan with Owner, Officer or Member rank. The Owner manages invitations, ranks, removals, ownership transfer and disbanding through `/api/clans`. Clan instances are 42×30 safe holdouts keyed by `clan:<id>`; construction, station fuel, a 24-slot core stash and built chests persist in `clans.hideout`. Every member may enter/build/use storage, while demolition is limited to Officers and the Owner. The clan exit mat returns home when the member entered from their personal hideout, or returns them to the same world safe zone when that was their origin, preserving the extraction-only route home from the world. Members can contribute credits to a shared treasury; Officers/Owner can withdraw, and each atomic transfer records its resulting balance in `clan_ledger_entries`. A renewable 45-second database lease prevents separate regional API processes from simulating and overwriting the same clan holdout simultaneously.
- **Tactical allies**: world snapshots retain LOS filtering for normal entities. A separate server-authorized `StateSnap.mapPlayers` list exposes positions only for accepted friends and same-clan members in the same world instance, allowing map markers without leaking unrelated players.
- **Trading/quests**: proximity-gated tiered traders use hot-reloaded stock. Money lives on `profiles.money`; unlocked job status rides on `s:inventory` for the HUD and `s:trade` for claiming.
- **Chat**: local speech works anywhere and is broadcast within the sender's current instance, producing a chat-log entry and an overhead bubble when the speaker is visible. `/c message` is a private relay-wide clan radio channel with no positional bubble. Guests remain chat-disabled, and server rate limits plus admin mutes apply everywhere.
- **Live moderation**: the `F10` console sends only privileged intents. The API reloads `profiles.admin` for every state request/action, validates targets and active content IDs, caps quantities/durations/text/coordinates, applies a separate socket rate limit, prevents self/peer-admin sanctions, and records structured `admin_action` telemetry. Cross-instance go/bring/send-home use the same authoritative instance transfer and safe-tile rules as gameplay. Timed mutes/bans persist in profiles; active bans are rejected before web token issue and again during socket admission.
- **Guest raids**: logged-out players choose from the same pinged relay browser as registered players. The web tier issues a signed HTTP-only guest identity and short-lived JWT without creating a Better Auth user. The selected game API validates the guest subject and generated callsign, then creates an ephemeral zero-credit survivor directly in `world`. Guest state is never leased or persisted. Guests cannot chat, use community/clan APIs, enter hideouts or extract; death redeploys them empty-handed, while open-world disconnects still leave the normal 60-second vulnerable body. This keeps one-click trials out of persistent identity and economy systems.
- **Combat**: guns use server-tracked magazines and reserve ammunition; melee hits entities or harvest nodes. Armor mitigation and wear are authoritative. Death drops carried inventory/equipment with wear intact and returns the player home empty-handed. An unsafe disconnect leaves a vulnerable body; expiry kills it and drops the gear rather than granting a free extraction.
- **Stations**: firepits and furnaces store authoritative fuel per placed tile. Adding wood, proximity, capacity, and operation consumption are server-validated; hideout fuel persists. Workbench/anvil access and all recipe costs remain server-owned.
- **Resources**: depleted nodes remain as stumps/rubble until their server-owned deadline. Sparse damage, cooldown and live-variant state is saved every 10 seconds and immediately on depletion/regrowth. Tree variants use published family weights (seeded common/ironwood weights are 94/6); rock regrowth rerolls stone/copper/iron. Procedural worlds also persist their seed.
- **Night lighting**: the client composites a deep blue-black darkness mask on a separate canvas, then removes it around replicated light sources. Equipped items can declare `lightRadius`; the shared hand torch is portable light. Torch posts have the widest static radius. Firepit light is driven by authoritative `stationFuel` init/update messages and disappears at zero fuel.
- **Elevation**: world instances carry a byte height level per tile. Gradual one-level transitions are traversable hills; elevation jumps greater than one are authoritative cliff barriers for movement, line of sight and projectiles. `Tile.Cliff` remains an always-solid authored wall.
- **Stamina**: sprint and harvesting drain the server-owned meter. Sprint can drain through zero; depletion sets an exhausted latch, delays regeneration for 2.6 seconds, blocks melee/ranged combat, and applies the same 45% movement speed as overweight without double-stacking. The latch clears once 25 stamina has recovered; consumables remain usable. Clients receive the latch only for HUD feedback.
- **Player orientation**: `PlayerSnap.angle` is cursor/action aim used by weapons and combat. `PlayerSnap.facing` is independent body orientation, updated from movement while strafing and from stationary actions. This keeps guns aimed at the cursor without forcing the avatar to face the same direction.

## Web (apps/web)

- Better Auth at `app/api/auth/[...all]`; Prisma also owns game tables including profiles, friendships, clans and maps.
- `POST /api/game-token` exchanges the session for a 10-min JWT consumed by the socket handshake.
- `game/renderer.ts` draws from sprite sheets (`public/sprites`), with animation state (swings, shakes, falling trees, particles, muzzle flashes, corpses) kept client-side and driven by server events (`s:hit`, `s:tile`, snapshots).
- `components/GameClient.tsx` coordinates socket wiring, input, rendering, and cross-panel queues. Focused crafting, cooking, trade, skills, social, and system UI lives under `components/game`.
- The local survivor uses collision-aware render prediction and smooth reconciliation keyed by the server's acknowledged input sequence. This hides relay round-trip delay for movement, aiming and cosmetic attack response without widening authority: the client never transmits predicted coordinates, while the API still owns movement, stamina, ammo, cooldowns, hits and inventory. Replaceable input/state packets are volatile to prevent stale queue playback after network stalls; reliable gameplay events remain ordered and retained.
- `components/game/AdminPanel.tsx` is rendered only after the authoritative init identifies the survivor as an admin. It provides the live relay player browser, DB-backed item picker, movement/restoration tools, protection/announcement controls, and persistent sanction management; hiding the panel is not treated as authorization.
- The signed-in landing briefing owns pre-deploy survivor customization. `/api/profile/appearance` reads and writes a sanitized layered appearance object; first-time players must save one before deploying.
- `game/character-appearance.ts` composites body, skin, hair, outfit accent and future cosmetic layers over the animated placeholder survivor sheet for the creator, deployment portrait, and networked world rendering.
- Published sprite frames and player/mob animation profiles ride in `WorldInit` and `s:visuals`. The renderer caches each RGBA frame as an offscreen canvas and applies idle/walk/attack/hit clips, falling back to checked-in sheet frames.
- Every authored map cell stores a terrain content ID. Terrain definitions provide DB ground sprites, traversal, swimming, footsteps and collision; their `simulationTile` derives the internal numeric grid required by older simulation code. Resource and world-block ID layers add harvest/destruction behavior without becoming a second ground source.
- `/admin/{slug}` is the admin-only game engine. Its server layout and every `/api/admin/*` handler verify `profiles.admin`; `/editor` redirects to `/admin/map`.
- Map drafts use a camera-based, visible-tile canvas with sprite preview, minimap, custom loot/mob placement, validation and explicit publish. Authored maps support up to 2000x2000 cells and persist run-length encoded tile, elevation and terrain layers; legacy dense rows remain readable. The client renderer draws large maps from visible cells and a sampled minimap instead of allocating a full-world canvas. API instances retain the expanded map in memory, poll only the active row ID, and fetch a new full document only when the world is empty after a publish.
- `game_content` stores versioned draft/published documents. The API caches published documents in memory, snapshots them with the active map under `RUNTIME_CACHE_DIR`, polls only revision metadata, and fetches just the changed kind before hot-reloading mobs, recipes, traders, loot and runtime visual/terrain data. The local snapshot and then shared definitions are outage fallbacks. See `docs/ENGINE.md`.
- Production runs the Next.js/auth application on Vercel and separate authoritative game worlds on Render. Render APIs self-register in `game_servers` from Render's injected external URL (`PUBLIC_SERVER_URL` can override it); they share Postgres content/profile state but never in-memory simulation state. See `docs/DEPLOYMENT.md`.
- Code ownership, current hotspots, and the staged refactor order are tracked in `docs/MAINTAINABILITY.md`.

## Database (Neon Postgres)

Profile snapshots are written every ten seconds and at lifecycle/economy boundaries. Before loading a survivor, an API world claims a renewable 45-second `player_world_leases` row; 15-second heartbeats retain it and every gameplay profile or personal-hideout upsert verifies the active server/connection in the same statement. A same-world reconnect atomically changes the connection token, while another regional world is rejected until release or expiry. `TelemetryService` batches append-only records into `game_telemetry_events` for extraction value, item/currency sources and sinks, survivor-bot contribution, profile-save failures, and lease conflicts. `/health` exposes aggregate in-process counters plus queue/flush health; user-level event details remain in Postgres.

Published content heads live in `game_content`, while immutable `game_content_revisions` rows support rollback without erasing newer work. `CONTENT_CHANNEL=staging` makes a separate API process read drafts and the latest draft map with isolated cache/world keys.

`ContentService` sanitizes the active item registry before validating dependent recipes and trader stock. `WorldInit.gameplay` carries the item/recipe revision signature and full runtime catalog; `s:gameplay` hot-pushes later changes. Server item lookup, inventory rules, crafting, trade, HUD panels, tooltips, renderer lights and published item sprites all consume that same catalog. Checked-in shared definitions remain startup/outage and compatibility fallbacks.

Pure deterministic rules under `apps/api/src/game/rules` own inventory/death-drop transfers, station fuel arithmetic, timed-action interruption, quest gates, foundation restoration and elevation steps. `GameService` orchestrates sockets and instances around those tested rules instead of reimplementing their arithmetic.

- `game_world_state(server_key text pk, map_id int nullable, data jsonb, updated_at)` stores sparse node damage, depleted cooldowns, rerolled variants and the procedural seed independently for each API world.

- Better Auth: `user`, `session`, `account`, `verification` (camelCase columns, quoted).
- `profiles(user_id text pk, data jsonb, money int, kills int, deaths int, hideout jsonb, admin bool, muted_until, mute_reason, banned_until, ban_reason, moderated_by, updated_at)` - `data` holds inventory, equipment, loaded weapon magazines, skills, quests, survival state and `appearance`. Moderation role/sanctions remain queryable columns so admission and live checks do not depend on loading mutable survivor JSON. Magazine counts are validated against current weapon capacities when loaded; legacy numeric `look` values are migrated lazily into the layered appearance model.
- `player_world_leases(user_id, server_key, connection_id, expires_at, updated_at)` — exclusive, expiring ownership of one survivor simulation and its gameplay writes.
- `friends(user_id, friend_id, status 'pending'|'accepted', created_at)` — one row per direction request; accept writes the reverse row.
- `clans(id, name, tag, hideout, created_at, updated_at)` — shared identity and authoritative clan-hideout persistence.
- `clan_members(clan_id, user_id unique, rank, joined_at)` — one-clan-per-survivor membership with Owner/Officer/Member rank.
- `clan_invites(clan_id, user_id, invited_by, created_at)` — pending invitations removed on acceptance or disband.
- `clan_hideout_leases(clan_id, server_key, expires_at)` — short regional simulation ownership lease for shared clan bases.
- `clan_ledger_entries(id, clan_id, actor_user_id, actor_name, kind, amount, balance, created_at)` — immutable shared-credit audit trail; `clans.treasury` is the current balance.
- `maps(id, name, data jsonb, active bool, draft bool, updated_at)` — private drafts are never loaded by the game API.
- `game_content(kind unique, draft jsonb, published jsonb, revision, published_revision, updated_by, timestamps)` — versioned engine documents.
