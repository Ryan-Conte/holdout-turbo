# Roadmap

## Shipped
- **Full raid loop**: log in at your home base → deploy via the door mat (random spawn) → loot/hunt/fight → hold an extraction beacon 5s to bring it all home (or lose it on death).
- **Base building** (Minecraft-style camp): wood/stone flooring as foundations, walls, doors (enemies/bullets blocked, you pass), fences, torch posts; X demolish mode reclaims kits; 26×20 camp; kits craftable or bought at the trader.
- **Day/night that matters**: oppressive midnight darkness with dusk/dawn tint, portable hand torches, broad torch-post light, fuel-aware firepit light, faster/longer-aggro zombies and wider-hunting wolves, nightfall/dawn notices, and HUD clock.
- **Stations**: fueled firepit cook queue, fueled furnace smelting, workbench/anvil crafting, persisted home fuel, and home rest healing.
- **Wildlife**: deer, rabbits and foxes flee; boars and bears are territorial; wolves hunt. Meat feeds the cooking loop, hides create steady hunting income, and rare intact antlers are trophies for the black market.
- **Game feel**: XP floats + level-up fanfare, kill confirms, loot/cook queues with progress rings, interactable highlight ring, starter objectives checklist, ambient howls/grunts/groans.
- Auth (Better Auth) + game-token socket handshake; profiles/friends/clans/maps in Neon.
- Instanced server: world + personal hideouts + larger shared clan holdouts with Owner/Officer/Member ranks, communal construction/storage, an atomic shared credit treasury with activity ledger, and clan tactical markers.
- Trader outposts: safe zones, NPC buy/sell, persistent credits.
- Survival loop: fists-only start → punch trees/rocks → spear → hatchet/pickaxe → looted guns; armor slots (helmets/vests) with damage mitigation.
- Enemies: zombies (towns/wilds), military (airport); loot bags; respawns.
- Sprite-sheet renderer + animation pass (walk frames, melee jabs/swings/thrusts, tree shake + fall, rock crumble, particles, muzzle flashes, corpses, day/night).
- Admin map editor (`/admin/map`; legacy `/editor` redirects) -> `maps` table -> server loads the active published map.
- Admin engine foundation at `/admin/{slug}`: DB-admin gate, draft/publish maps, content polling, custom spawn/loot placement and browser pixel studio.
- Friends: requests/accept, minimap markers.
- Relay-wide clan radio via `/c`, with ordinary overhead chat available anywhere inside the sender's current instance.
- Attachments (red dot/suppressor), durability/repair, bounded per-viewer snapshot culling, persistent job tracker, and optional survivor bots.
- Saved survivor appearance in the creator, deployment terminal, and live world.
- Persistent resource-node damage/cooldowns with configurable family rerolls: common trees can regrow as ironwood and rocks reroll stone/copper/iron.
- Versioned runtime DB items/recipes, DB-only item presentation, immutable content history, one-click rollback, and isolated draft-content raids.
- Deterministic gameplay tests for death/disconnect drops, extraction interruption, station fuel, durability, crafting, quests, structures and elevation.
- Batched extraction/economy/bot/save telemetry with aggregate health counters.
- Exclusive cross-region survivor leases with reconnect handoff and guarded profile writes; known relays are also preflighted during game-token issue.
- Population-scaled night surges spawn infected outside exposed survivors' sight, respect safe zones, and clear at dawn without entering the permanent respawn pool.
- Zero Sievert-flavored UI theme (inventory w/ equipment slots, tabbed crafting, trade, social).

## Next
1. Item instances + weapon-specific attachment slots, including extended magazines (see `docs/PVP.md`).
2. Client prediction/reconciliation plus broader movement/combat integration coverage (`docs/ANTICHEAT.md`, `docs/MAINTAINABILITY.md`).
3. Engine v2 follow-up: sprite atlas composition, building stamps, validation reports and multi-map rotation.
4. Wandering trader and regional dynamic events; night-only horde surges are shipped.
5. Base raiding rules for world structures (decay tuning, offline protection).
6. Real art to replace generated sprite templates (`docs/ART.md`).
