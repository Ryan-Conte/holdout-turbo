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

## Web (apps/web)

- Better Auth at `app/api/auth/[...all]`; schema ensured by `lib/db.ts` (also `profiles`, `friends`, `maps`).
- `POST /api/game-token` exchanges the session for a 10-min JWT consumed by the socket handshake.
- `game/renderer.ts` draws from sprite sheets (`public/sprites`), with animation state (swings, shakes, falling trees, particles, muzzle flashes, corpses) kept client-side and driven by server events (`s:hit`, `s:tile`, snapshots).
- `components/GameClient.tsx` = socket wiring + input + all panels (inventory/equipment, crafting tabs, trade, social, loot, hideout prompts).
- `/editor` (admin emails only, `ADMIN_EMAILS`) paints tiles + placements and saves to `maps`; "activate" makes the API load it on next boot.

## Database (Neon Postgres)

- Better Auth: `user`, `session`, `account`, `verification` (camelCase columns, quoted).
- `profiles(user_id text pk, data jsonb, money int, kills int, deaths int, hideout jsonb, updated_at)` — `data` holds `{inv, equipment}`.
- `friends(user_id, friend_id, status 'pending'|'accepted', created_at)` — one row per direction request; accept writes the reverse row.
- `maps(id, name, data jsonb, active bool, updated_at)` — `data = { tiles: number[], w, h, objects: [{type, x, y, ...}] }`.
