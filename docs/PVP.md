# PvP & balance (top-down)

References: Project Zomboid (deep item/condition systems), Zero Sievert (top-down extraction gunplay).

## Current model

- TTK tuning: pistol ~7 body hits, rifle ~8 but 4× fire rate; shotgun burst up close. Fists/spear give unarmed players a fighting chance up close.
- **Armor** (equipment slots, found/bought/crafted):
  - Helmet: scrap (-10%), military (-18%)
  - Vest: light (-15%), military (-30%)
  - Multiplicative with each other, drops on death — Rust-style risk economics.
- Aim is a projectile sim with per-weapon spread; no hitscan → dodging matters at range.
- Nameplates render only within ~240 px (friends always) — information is positional, like Zero Sievert.
- Safe zones (trader outposts) create social hubs without combat logging issues: damage suppressed both directions, shooting disabled inside.

## Planned (in order)

1. **Gun attachments** (Zero Sievert style): items `attach_reddot` (-spread), `attach_suppressor` (smaller aggro/sound radius), `attach_extmag`. Data model prepared: `ItemDef.attachSlots` + per-instance item state will move inventory slots from `{id, qty}` to `{uid, id, qty, mods[]}` — do this in shared first, migrate `profiles.data` lazily.
2. **Vision cone / fog**: render-side dimming outside a forward cone + server-side snapshot culling (see ANTICHEAT #2) so the view advantage is symmetric.
3. Durability/condition on weapons & armor (Zomboid-style repair with scrap).
4. Sound propagation: gunshot events with radius → minimap pings for nearby players.
