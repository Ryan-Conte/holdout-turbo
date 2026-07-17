# HOLDOUT implementation audit

Audit date: 2026-07-17

This audit reconciles the player-facing game loop, all repository Markdown guidance, and the current shared/API/web implementation. It is a living handoff for future changes, not a replacement for the focused system documents.

## Intended experience

HOLDOUT is strongest when every session completes a readable risk loop:

1. Wake at a persistent, safe hideout and prepare from the stash.
2. Deploy into a dangerous shared world with a clear purpose.
3. Scavenge, hunt, complete jobs, and decide when greed outweighs survival.
4. Hold an extraction beacon under interruption risk.
5. Return home with carried loot, improve the base/loadout, and choose the next objective.

The authoritative server must ensure death, logout, transfer, crafting, fuel, and extraction never create a shortcut around that loop.

## Polished in this pass

- Death now wakes a player at home empty-handed after dropping carried equipment; credits, skills, jobs, and stash remain safe.
- Unsafe disconnect expiry kills the exposed body and drops carried gear instead of acting as a delayed free extraction.
- Damage interrupts extraction and other timed actions.
- Player, enemy, projectile, container, and ground-loot snapshots are bounded by per-viewer range/LOS; the HUD receives a separate aggregate population count.
- Item and armor wear survives equipment swaps, containers, ground drops, corpses, and profile persistence.
- Published player-block stations work through the same proximity, interaction, crafting, repair, and demolish paths as compatibility tiles.
- Firepits and furnaces require stored wood heat. One wood adds four charges, one cook/smelt consumes one, capacity is 40, and hideout fuel persists.
- Resource damage, depletion deadlines, procedural seeds and live rare variants persist per server/map. Tree regrowth uses configurable weights and rocks reroll stone/copper/iron veins.
- Midnight is substantially darker; portable hand torches and broad placed torch posts reveal terrain through the darkness mask, while firepits emit light only when authoritative fuel is present.
- Unlocked jobs remain visible in a compact HUD tracker away from the trader.
- Starter objectives follow the actual raid sequence and complete important actions from server feedback rather than broad inventory coincidences.
- The signed-in deployment terminal renders the last saved layered survivor; cancelling appearance edits restores that saved look.
- README, architecture, engine, PvP, anti-cheat, roadmap, maintenance, art, deployment, and agent guidance now describe the same shipped behavior.
- A versioned runtime gameplay catalog now sends sanitized published items and recipes in `WorldInit` and hot-pushes later revisions; DB-only item IDs render, craft, trade, persist magazines, and use published pixel assets.
- Deterministic rule modules now own inventory transfers/death drops, fuel arithmetic, clan rank permissions, bounded admin inputs, action interruption, quest gates, foundation restoration, and elevation steps. Ten automated test groups cover every behavior named in the original P1, including authored-map conversion.
- Economy telemetry batches extraction value, item/currency sources and sinks, bot contribution, profile-save failures, and future lease conflicts into `game_telemetry_events`; aggregate counters are visible on `/health`.
- Every content draft is snapshotted in `game_content_revisions`. The admin revision bar restores old content or map revisions in one click, while `CONTENT_CHANNEL=staging` loads draft content and the latest draft map into a separate raid server.
- Verified admins now have an unmistakable cyan identity tag and an `F10` live world-control console for catalog-backed item grants, safe cross-instance movement, restoration/protection, announcements and persistent sanctions. Every action revalidates the DB role, is bounded/rate-limited and writes `admin_action` telemetry; bans are enforced before token issue and at socket admission.
- Logged-out visitors can enter an ephemeral guest raid without creating an account. Signed guest identities spawn empty-handed directly in the world, never lease or persist a profile, retain combat-log risk, and are blocked from chat, community, clans, hideouts and extraction to prevent trial accounts from becoming spam or economy shortcuts. Moderators see guest tags and can apply relay-local guest sanctions.
- The crafting panel now mirrors the authoritative timed craft in the panel itself with DB item art/name, a live countdown and progress bar, plus an emphasized active recipe cell, so queue progress never depends on noticing the world-level action bar.
- A renewable 45-second database lease gives one regional simulation exclusive ownership of each survivor. Token issue gives a friendly cross-relay rejection, socket admission is authoritative, reconnects atomically hand ownership to the new socket, and profile writes require the current connection token.
- Personal camp visits require the owner online on the same relay and visitors are evicted when ownership ends; personal hideout upserts also verify that owner's current server/connection lease in SQL. Clan bases retain their dedicated regional lease.
- Foxes and bears expand the wilderness ecology with distinct flee/territorial roles, two-frame engine art, biome-biased map placement, hide/trophy drops and trader value. Bounded night surges create a recurring after-dark event without permanent spawn inflation.
- Clan contributions and rank-gated withdrawals move profile and treasury credits in one transaction, serialize against profile saves, and write an immutable activity ledger.
- The isolated websocket harness admitted and deployed 200 real clients against the 500×500 map and 344 live enemies in 5.9 seconds. A 10-second all-moving steady-state run sustained 16.64 snapshots/client/second, 5.38 KB average snapshots, a 120 ms largest measured gap and 298 MB RSS; cleanup left zero benchmark users, profiles, leases or world rows. This is a repeatable local capacity baseline, not a substitute for region-specific soak testing.
- High-latency relays now feel immediate through collision-aware local movement/aim prediction, acknowledged-input reconciliation, instant cosmetic attack feedback, RTT telemetry, and volatile replaceable input/state delivery. Simulation authority is unchanged: client positions are never accepted and all consequential combat/economy state remains server-owned.

## Current strengths

- Server authority is consistently respected: clients send intents and receive outcomes.
- The home/deploy/extract/death structure creates a real extraction loop rather than a generic survival sandbox spawn.
- Shared item definitions, content fallbacks, and DB publishing give designers a usable migration path without making the game depend on every content row.
- Safe zones, bounded visibility, sight memory, positional pressure, day/night modifiers, durability, stations, and tiered traders reinforce risk without requiring excessive UI complexity.
- The authored-map and runtime-cache work is designed for large worlds and intermittent database availability.

## Closed P0/P1/P2 findings

- **Cross-world profile concurrency:** `player_world_leases` enforces one regional simulation per account with a 45-second expiry and 15-second heartbeat. Same-relay reconnects replace the connection token atomically; every gameplay profile write checks the active server and connection in the same SQL statement. Clean exits release immediately, combat-log bodies retain ownership until resolved, and a server that loses a lease discards its stale copy. Token issue preflights known public relays and socket admission remains the authoritative enforcement point.

- **Automated behavior coverage:** `npm run check` now runs the deterministic gameplay suite after typechecking and production builds. The suite covers death/disconnect carried drops, extraction interruption by movement/damage, station fuel, durability transfers, crafting payment, quest prerequisite/claim gates, structure foundation restoration, elevation cliffs, and authored-map conversion.
- **Dynamic recipe/item presentation:** the server owns a sanitized `RuntimeGameplayContent` bundle whose version is derived from published item/recipe revisions. Initial state and `s:gameplay` keep simulation, crafting, trading, tooltips, lights and item art on the same catalog. Shared definitions are fallback/compatibility content.
- **Simulation ownership hotspot:** inventory/death-drop, fuel, and cross-system simulation decisions moved into pure modules under `apps/api/src/game/rules`; telemetry is a separate lifecycle service. This establishes the tested extraction seam for continuing the larger `GameService` split.
- **Persistence/economy observability:** profile saves run every ten seconds plus important economy boundaries. Append-only telemetry records extraction value, sources/sinks, bots and failures, with live aggregate health counters and a reserved lease-conflict event.
- **Content rollback/staging:** immutable content snapshots and retained map revisions drive the global admin rollback bar. A separate API process with `CONTENT_CHANNEL=staging` reads drafts and the latest draft map, uses separate runtime/world caches, and stays out of the public browser unless explicitly registered.
- **Operational moderation:** DB-backed admin identity is visible in world/chat UI and gates a server-authoritative console. Item grants validate the active runtime catalog; relocation uses safe authoritative transfers; timed mute/ban state survives restarts; peer admins are protected; all actions are auditable.

## Verification baseline

- `npm run check` must pass before handoff.
- `npm run test:gameplay` can run the deterministic suite independently.
- `git diff --check` must be clean.
- Validate the signed-in landing portrait and station panels in a real session when test credentials are available.
- Do not run seed commands as verification against a shared database; use dry-run fixtures or a disposable database.
