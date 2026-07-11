# HOLDOUT

A fully-online top-down survival extraction shooter (DayZ / Rust / ARC Raiders inspired) with Stardew-Valley-style pixel graphics.

## Stack

Turborepo monorepo:

| Package | What it is |
| --- | --- |
| `apps/web` | Next.js 15 — auth API (Neon Postgres + bcrypt + JWT), login screen, canvas game client |
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
- `apps/web/.env.local` — `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL`

`JWT_SECRET` must be identical in both files — the web app signs tokens, the game server verifies them on the socket handshake.

Tables (`users`, `players`) are created automatically on first use.

## How to play

1. Register / log in — you're deployed into a procedurally generated map with named POIs: a **town** (zombie-infested), **Redfield Airport** (runway, hangars and supply crates guarded by military riflemen), scattered farms, lakes, roads, rock fields and forests.
2. **WASD** move · **mouse** aim & attack · **E** interact · **Q** quick-heal · **1-5** hotbar · **TAB** inventory · **C** crafting · **M** mute · **ESC** close panels.
3. **Harvesting:** punch trees for wood and rocks for stone with your bare fists (slow), or craft a **hatchet** / **pickaxe** for 3× yield. Nodes break after enough hits and regrow a few minutes later — for everyone, it's one shared world.
4. **Enemies:** zombies chase and claw; military guards keep their distance and fire rifle bursts (gunfire aggros nearby enemies). Both drop loot bags — military can drop the **Vanguard Rifle**.
5. Inventory is slot + weight based (kg). Find or craft **backpack upgrades** to carry more (12 slots/20 kg → 16/32 → 20/45).
6. Craft bandages, medkits, ammo, tools and backpacks from gathered materials.
7. Dying drops all your gear into a loot bag at your corpse — anyone can grab it. You respawn with a starter kit.
8. Inventory, backpack tier and K/D persist to the Neon database per account; chests restock a few minutes after being emptied; a full day/night cycle runs every 10 minutes.

**UI:** minimap with POI labels, hotbar, floating damage/harvest numbers, hit-direction red flash, interaction prompts, location banners when entering a POI, kill feed, synthesized positional sound effects (M to mute).

## Auth note ("neon-auth")

Auth is a basic email/password API backed by your **Neon** Postgres database (bcrypt password hashing, 7-day JWTs) at `apps/web/app/api/auth/*`. The managed **Neon Auth** product (Stack Auth) requires project keys from the Neon console; to switch to it later, enable Neon Auth on your Neon project and swap the routes for `@stackframe/stack` — the game server only cares that the JWT carries `sub` + `username`.

## Architecture notes

- The server simulates the world at 20 Hz (movement, projectiles with sub-stepped collision, chest restocking, ground-loot respawn) and broadcasts snapshots; the client interpolates.
- All gameplay actions (looting, crafting, item moves, shooting) are validated server-side — the client is display + intent only.
- A random map seed is generated on every server boot: buildings with doors and interior chests, lakes with sand shores, roads, tree collision borders.
