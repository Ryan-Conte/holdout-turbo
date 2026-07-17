# HOLDOUT

A fully-online top-down survival extraction shooter (DayZ / Rust / ARC Raiders inspired) with Stardew-Valley-style pixel graphics.

## Stack

Turborepo monorepo:

| Package | What it is |
| --- | --- |
| `apps/web` | Next.js 15 — Better Auth (email/password + Steam bridge), landing briefing, canvas game client |
| `apps/api` | NestJS — socket.io game server: authoritative world simulation, map generation, loot, combat, crafting, persistence |
| `packages/shared` | Shared types, item/weapon definitions, crafting recipes, backpack tiers, socket protocol |

## Running it

```bash
npm install
npm run dev
```

- Web: http://localhost:3000
- Game API: http://localhost:3001 (socket.io)

Both apps read env files that are already set up for local dev:
- `apps/api/.env` — `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`
- `apps/web/.env.local` — `DATABASE_URL`, `JWT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_API_URL`

`JWT_SECRET` must be identical in both files — the web app signs tokens, the game server verifies them on the socket handshake.

Apply `prisma/schema.prisma` with `npx prisma db push` for a new database, then run `npx prisma generate`. Better Auth owns `user`, `session`, `account`, and `verification`; game state lives in `profiles`, `player_world_leases`, `friends`, `clans`, `clan_members`, `clan_invites`, `clan_ledger_entries`, `clan_hideout_leases`, `maps`, `quests`, `game_content`, `game_content_revisions`, `game_servers`, `game_world_state`, and `game_telemetry_events`.

## Admin game engine

Admins open `/admin/map`; legacy `/editor` redirects there. The engine includes draft/publish map authoring with zoom and sprite preview, content documents for mobs, items, recipes, loot, traders and blocks, plus a DB-backed pixel editor. Every editor exposes immutable revision history, one-click live rollback, and an optional isolated staging raid. Access is controlled by `profiles.admin`; `ADMIN_EMAILS` only bootstraps that flag.

In game, verified admins have a cyan `ADMIN` identity tag and can press **F10** (or the cyan `A` control) for the server-authorized world console. It can issue any active DB-catalog item, go to or bring players across instances, send survivors home, restore health/needs, teleport to exact tiles, enable protected moderator sight, broadcast relay notices, and manage kicks plus persistent timed mutes/bans. Privileged actions recheck the database role, are rate-limited and write audit telemetry; admins cannot sanction another admin.

After applying the Prisma schema, seed current definitions without overwriting edits:

```bash
npm run seed:engine
```

To install the recommended 500x500 `Greyvale Frontier` world as both an editable map draft and the active published map:

```bash
npm run seed:frontier-map
```

The seed includes a major town, four villages, three safe traders, two black-market dealers, Warden Airfield, Fort Greywall, farms, forests, a quarry, lake, marsh, hospital and rail yard. It also writes a validated preview to `docs/assets/greyvale-frontier-500.png`. The maximum-size engine showcase remains available separately:

```bash
npm run seed:showcase-map
```

See `docs/ENGINE.md` for publishing behavior and runtime coverage.

Run the deterministic gameplay rules suite with `npm run test:gameplay`. `npm run check` runs typechecks, production builds, and that suite together.

The current repo-wide gameplay/implementation findings and follow-up priorities are tracked in `docs/AUDIT.md`.

Production deployment is configured for Vercel (`apps/web`) plus independently addressable Render game servers (`apps/api`). See `docs/DEPLOYMENT.md` before applying the Render Blueprint.

## How to play

1. Register / log in, build your survivor, choose a server, and enter your hideout. Press **E** at the door mat when you are ready to deploy into the shared zone.
   Or select a relay and choose **Drop in as Guest** to enter that main world immediately with a temporary empty-handed survivor. Guest progress is not saved, and chat, community, clans, hideouts and extraction require a registered account.
2. **WASD** move · **SHIFT** sprint · **mouse** aim & attack · **E** interact · **Q** quick-heal · **1-5** hotbar · **TAB** inventory · **C** crafting · **M** world map · **ESC** close panels. The world map opens centered on the player at 2.5× zoom; use the wheel or `+`/`-` to zoom, drag to pan, `PLAYER` to recenter and `FIT` to restore the full region. Emptying stamina blocks attacks and slows walking to the overweight pace until 25 stamina has recovered; consumables remain usable.
3. **Harvesting:** punch trees for wood and rocks for stone with your bare fists (slow), or craft a **hatchet** / **pickaxe** for 3× yield. Nodes break after enough hits and regrow a few minutes later — for everyone, it's one shared world.
   Depleted nodes remain as stumps/rubble until their configured cooldown expires. Regrowth can promote a tree to rare ironwood or reroll a rock as stone, copper, or iron; cooldowns and rolled variants survive server restarts.
4. **Threats:** zombies chase and claw; military guards keep their distance and fire rifle bursts; wildlife flees, defends itself, or hunts. Gunfire draws nearby enemies. Midnight is extremely dark: craft and equip a **Hand Torch** while traveling, or place broad-radius **Torch Posts** around routes and your camp. Fueled firepits provide a smaller pool of light. Optional server survivors can populate low-player worlds when enabled by an admin.
5. Inventory is slot + weight based (kg). Find or craft **backpack upgrades** to carry more (12 slots/20 kg → 16/32 → 20/45). The expensive endgame **Expedition Backpack MK4** expands this to 32 slots and 80 kg.
6. Craft primitive survival gear by hand. The crafting panel keeps the current recipe art/name, countdown and progress visible while its server-timed action runs, including queued crafts. Workbenches make tools and equipment, furnaces smelt ore, and anvils forge weapons, ammunition, and attachments. Firepits and furnaces must be loaded with wood; each log provides four heat charges and each cook/smelt consumes one.
7. Dying drops all carried gear into a loot bag and wakes you at home empty-handed; your stash, credits, skills, and claimed jobs remain safe. Disconnecting outside safety leaves a vulnerable body for 60 seconds and never counts as an extraction.
8. Inventory, equipment wear, magazines, survival state, progression, and hideouts persist per account under an exclusive regional lease. Clans add Owner/Officer/Member ranks, a 42×30 shared holdout, communal storage, a transaction-safe credit treasury and tactical map markers for online clanmates. Use the clan holdout mat to return to your personal hideout when you entered from home; safe-zone visits return to the same safe zone. Chests restock 20 minutes after being completely emptied; a full day/night cycle runs every 10 minutes and can trigger bounded infected surges.

**UI:** the deployment terminal shows your saved survivor, while the game provides a player-centered minimap, zoomable/pannable `M` tactical map, persistent job tracker, hotbar, floating damage/harvest numbers, interaction prompts, location banners, kill feed, and synthesized positional sound. Audio can be toggled from the lower-right speaker button or pause menu.

## Authentication

Better Auth owns the web session and email/password identities. Steam OpenID is bridged through `/api/auth/steam` into a shadow Better Auth account; `STEAM_API_KEY` is optional and only enriches persona names. The session-gated `POST /api/game-token` issues a short-lived game JWT containing `sub` and `username`; every game server verifies it with the shared `JWT_SECRET`.

## Architecture notes

- The server simulates the world at 20 Hz (movement, projectiles with sub-stepped collision, chest restocking, ground-loot respawn) and sends range/LOS-filtered snapshots; the client interpolates.
- All gameplay actions (looting, crafting, item moves, shooting) are validated server-side — the client is display + intent only.
- The server loads the active published authored map from Postgres. Procedural generation remains the fallback when no active map exists.
