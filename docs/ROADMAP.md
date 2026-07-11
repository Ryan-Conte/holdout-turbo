# Roadmap

## Shipped
- **Full raid loop**: log in at your home base → deploy via the door mat (random spawn) → loot/hunt/fight → hold an extraction beacon 5s to bring it all home (or lose it on death).
- **Base building** (Minecraft-style camp): wood/stone flooring as foundations, walls, doors (enemies/bullets blocked, you pass), fences, torch posts; X demolish mode reclaims kits; 26×20 camp; kits craftable or bought at the trader.
- **Day/night that matters**: deeper darkness with dusk/dawn tint, torch/firepit light halos, zombies faster + longer aggro and wolves hunting wider at night, nightfall/dawn notices, HUD clock.
- **Stations**: campfire cook-queue panel, furnace/workbench open crafting at the right tab; resting at home heals.
- **Wildlife**: deer, rabbits (flee), boars (neutral, fight back), wolves (hunt); animal drops feed the cooking loop.
- **Game feel**: XP floats + level-up fanfare, kill confirms, loot/cook queues with progress rings, interactable highlight ring, starter objectives checklist, ambient howls/grunts/groans.
- Auth (Better Auth) + game-token socket handshake; profiles/friends/maps in Neon.
- Instanced server: world + personal hideouts (bed, storage chest, friend access from safe zones).
- Trader outposts: safe zones, NPC buy/sell, persistent credits.
- Survival loop: fists-only start → punch trees/rocks → spear → hatchet/pickaxe → looted guns; armor slots (helmets/vests) with damage mitigation.
- Enemies: zombies (towns/wilds), military (airport); loot bags; respawns.
- Sprite-sheet renderer + animation pass (walk frames, melee jabs/swings/thrusts, tree shake + fall, rock crumble, particles, muzzle flashes, corpses, day/night).
- Admin map editor (`/editor`) → `maps` table → server loads active map.
- Friends: requests/accept, minimap markers.
- Zero Sievert-flavored UI theme (inventory w/ equipment slots, tabbed crafting, trade, social).

## Next
1. Gun attachments + item instances (see docs/PVP.md #1).
2. Snapshot culling + client prediction (docs/ANTICHEAT.md).
3. Editor v2: building stamps, POI naming UI, multi-map rotation.
4. Wandering trader; night-only enemy spawns / horde events.
5. Base raiding rules for world structures (decay tuning, offline protection).
6. Real art to replace generated sprite templates (docs/ART.md).
