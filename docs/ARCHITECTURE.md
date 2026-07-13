# Architecture

## Server (apps/api)

`GameService` owns a map of **instances**:

```
Instance {
  id: 'world' | 'h:<userId>'
  kind: 'world' | 'hideout'
  w, h, tiles: Uint8Array          // live — harvested nodes mutate it
  containers, ground, enemies      // Maps
  projectiles: []
  pois (safe flags), traders, exit, spawns, lootSpots
  nodeHits / nodeRespawns / enemyRespawns
}
```

- 20 Hz tick: player movement (intent-based), enemy AI (zombie chase / military burst-fire), projectile sub-stepping, node/enemy/chest respawns, per-instance broadcast to the socket.io room named after the instance.
- Players carry `instanceId`; entering a hideout = leave room, join room, new `s:init`.
- **Hideouts**: 14×10 fixed layout (bed, storage chest `hs:<owner>`, exit mat). Storage persists to `profiles.hideout`. Owner or accepted friends may enter (checked against `friends` table), only from inside a safe zone.
- **Trading**: trader NPCs are static per instance. `c:trade:buy|sell` validate proximity + prices from shared `TRADER_STOCK`. Money lives on `profiles.money`, rides on `s:inventory`.
- **Combat**: guns consume ammo from inventory; melee (fists/spear/axe/pickaxe) hits entities in an arc or harvests the node tile in front. Armor (helmet/vest equipment slots) multiplies incoming damage. Death drops backpack + equipment into a loot bag; money is kept.
- **Elevation**: world instances carry a byte height level per tile. Gradual one-level transitions are traversable hills; elevation jumps greater than one are authoritative cliff barriers for movement, line of sight and projectiles. `Tile.Cliff` remains an always-solid authored wall.
- **Stamina**: sprint and harvesting drain the server-owned meter. Sprint can drain through zero; depletion sets an exhausted latch, delays regeneration for 2.6 seconds, and prevents another sprint until 25 stamina has recovered. Clients receive the latch only for HUD feedback.
- **Player orientation**: `PlayerSnap.angle` is cursor/action aim used by weapons and combat. `PlayerSnap.facing` is independent body orientation, updated from movement while strafing and from stationary actions. This keeps guns aimed at the cursor without forcing the avatar to face the same direction.

## Web (apps/web)

- Better Auth at `app/api/auth/[...all]`; schema ensured by `lib/db.ts` (also `profiles`, `friends`, `maps`).
- `POST /api/game-token` exchanges the session for a 10-min JWT consumed by the socket handshake.
- `game/renderer.ts` draws from sprite sheets (`public/sprites`), with animation state (swings, shakes, falling trees, particles, muzzle flashes, corpses) kept client-side and driven by server events (`s:hit`, `s:tile`, snapshots).
- `components/GameClient.tsx` coordinates socket wiring, input, rendering, and cross-panel queues. Focused crafting, cooking, trade, skills, social, and system UI lives under `components/game`.
- The signed-in landing briefing owns pre-deploy survivor customization. `/api/profile/appearance` reads and writes a sanitized layered appearance object; first-time players must save one before deploying.
- `game/character-appearance.ts` composites body, skin, hair, outfit accent and future cosmetic layers over the animated placeholder survivor sheet for both the creator preview and networked world rendering.
- Published sprite frames and player/mob animation profiles ride in `WorldInit` and `s:visuals`. The renderer caches each RGBA frame as an offscreen canvas and applies idle/walk/attack/hit clips, falling back to checked-in sheet frames.
- Every authored map cell stores a terrain content ID. Terrain definitions provide DB ground sprites, traversal, swimming, footsteps and collision; their `simulationTile` derives the internal numeric grid required by older simulation code. Resource and world-block ID layers add harvest/destruction behavior without becoming a second ground source.
- `/admin/{slug}` is the admin-only game engine. Its server layout and every `/api/admin/*` handler verify `profiles.admin`; `/editor` redirects to `/admin/map`.
- Map drafts use a camera-based, visible-tile canvas with sprite preview, minimap, custom loot/mob placement, validation and explicit publish. API instances poll the active revision and swap it in only when the world is empty.
- `game_content` stores versioned draft/published documents. The API hot-reloads published mobs, recipes, traders, loot and runtime visual/terrain documents while shared definitions remain safe fallbacks. See `docs/ENGINE.md`.
- Production runs the Next.js/auth application on Vercel and separate authoritative game worlds on Render. Render APIs self-register in `game_servers` from `PUBLIC_SERVER_URL`; they share Postgres content/profile state but never in-memory simulation state. See `docs/DEPLOYMENT.md`.
- Code ownership, current hotspots, and the staged refactor order are tracked in `docs/MAINTAINABILITY.md`.

## Database (Neon Postgres)

- Better Auth: `user`, `session`, `account`, `verification` (camelCase columns, quoted).
- `profiles(user_id text pk, data jsonb, money int, kills int, deaths int, hideout jsonb, updated_at)` - `data` holds inventory, equipment, skills, quests, survival state and `appearance`. Legacy numeric `look` values are migrated lazily into the layered appearance model.
- `friends(user_id, friend_id, status 'pending'|'accepted', created_at)` — one row per direction request; accept writes the reverse row.
- `maps(id, name, data jsonb, active bool, draft bool, updated_at)` — private drafts are never loaded by the game API.
- `game_content(kind unique, draft jsonb, published jsonb, revision, published_revision, updated_by, timestamps)` — versioned engine documents.
