# PvP & balance (top-down)

References: Project Zomboid (deep item/condition systems), Zero Sievert (top-down extraction gunplay).

## Current model

- TTK tuning: pistol ~7 body hits, rifle ~8 but 4× fire rate; shotgun burst up close. Fists/spear give unarmed players a fighting chance up close.
- **Armor** (equipment slots, found/bought/crafted):
  - Helmet: scrap (-10%), military (-18%)
  - Vest: light (-15%), military (-30%)
  - Multiplicative with each other, drops on death — Rust-style risk economics.
- Aim is a projectile sim with per-weapon spread; no hitscan → dodging matters at range.
- Red-dot and suppressor mods occupy the current global MOD slot; they tighten spread or reduce AI gunshot investigation radius.
- Weapons, tools, and armor have persisted durability. Use and incoming hits wear equipment; repairs cost scaled materials at the workbench/anvil.
- Per-viewer range/LOS culling and client fog hide entities and loot behind blockers; a short sense radius preserves close-range audio awareness.
- Nameplates render only within ~240 px (friends always) — information is positional, like Zero Sievert.
- Safe zones (trader outposts) create social hubs without combat logging issues: damage suppressed both directions, shooting disabled inside.

## Planned (in order)

1. **Item instances and weapon-specific slots**: migrate inventory entries from stack state to stable UIDs so each gun owns its fitted optic, suppressor, magazine upgrade, and condition. Add `attach_extmag` during this migration instead of extending the global MOD slot.
2. **Forward vision/readability pass**: consider a soft forward-cone contrast treatment without weakening the authoritative bounded LOS culling already shipped.
3. **Sound propagation for PvP**: server-authored gunshot events with distance/noise-class pings for nearby players; never reveal the exact shooter coordinate outside the intended information radius.
4. **Balance telemetry**: record weapon pick rate, extraction rate, hit rate, and armor survival before large TTK changes.
