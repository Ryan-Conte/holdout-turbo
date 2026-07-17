# Anti-cheat

## Already enforced (server-authoritative core)

- Clients send **intents only** (movement booleans + aim angle + attack flag). Position, speed, collision, fire-rate, ammo, loot rolls, crafting costs, trade prices, damage — all computed server-side.
- Handshake JWT (10 min TTL) signed by the web app; socket rejected without it. One live player per account (reconnect hands over the live state and kicks the old socket).
- Guest JWTs require a signed `guest:<uuid>` identity and generated callsign. Guests receive no starting currency/items, persistence or profile lease, and cannot chat, add friends, join clans, enter hideouts or extract; they still consume relay capacity and leave the normal vulnerable combat-log body.
- Input sanitation: numbers clamped/`Number.isFinite`-checked, slot indices bounds-checked, unknown recipe/item ids ignored.
- Rate limiting per socket (`rate-limit.ts`): global msg budget plus per-event budgets (interact/craft/trade/admin). Violations are dropped and logged with the user id.
- Proximity checks on every interaction (containers, traders, hideout entry requires safe zone).
- Clan holdout entry revalidates live database membership; building requires matching clan membership, demolition requires Owner/Officer rank, and tactical map positions are selected server-side from accepted friend/clan relationships.
- Damage suppressed in safe zones in both directions; shooting disabled inside.
- World snapshots are emitted per viewer. Players, enemies, projectiles, containers, and ground loot outside the bounded view/LOS rules are omitted, while only an aggregate population count remains global.
- Timed extraction is interrupted by movement or damage. Unsafe disconnect expiry kills the exposed body and drops carried gear, so waiting out the grace timer is never a free extraction.
- Admin controls are not trusted because the client shows an admin panel. Every privileged request reloads the actor's DB role, validates active-catalog items/targets/coordinates, caps grants and sanction duration, refuses self/peer-admin sanctions, and emits structured audit telemetry. Persistent bans are checked by both `/api/game-token` and authoritative socket admission; persistent mutes are enforced before local or clan chat broadcast.

## Next steps (roadmap)

1. **Movement reconciliation**: send input sequence numbers; server echoes last-processed seq so the client can predict + reconcile — removes any incentive to lie about position (already impossible) while keeping feel crisp.
2. **Statistical telemetry**: log per-player APM, hit rates, loot/min into `profiles`; flag outliers for review. Promote the current profile-backed sanctions into a dedicated moderation case/evidence model when appeals and multi-action histories are required.
3. **Replay journal**: append-only per-instance event log for post-report review. Do not assume the entire simulation is deterministic until time, content revisions, and random streams are explicitly captured.
4. Keep ALL new features intent-based — never accept client-computed results (e.g. map editor output is validated tile-by-tile against the allowed palette).
