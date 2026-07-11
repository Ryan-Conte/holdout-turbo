# Anti-cheat

## Already enforced (server-authoritative core)

- Clients send **intents only** (movement booleans + aim angle + attack flag). Position, speed, collision, fire-rate, ammo, loot rolls, crafting costs, trade prices, damage — all computed server-side.
- Handshake JWT (10 min TTL) signed by the web app; socket rejected without it. One live player per account (reconnect hands over the live state and kicks the old socket).
- Input sanitation: numbers clamped/`Number.isFinite`-checked, slot indices bounds-checked, unknown recipe/item ids ignored.
- Rate limiting per socket (`rate-limit.ts`): global msg budget plus per-event budgets (interact/craft/trade). Violations are dropped and logged with the user id.
- Proximity checks on every interaction (containers, traders, hideout entry requires safe zone).
- Damage suppressed in safe zones in both directions; shooting disabled inside.

## Next steps (roadmap)

1. **Movement reconciliation**: send input sequence numbers; server echoes last-processed seq so the client can predict + reconcile — removes any incentive to lie about position (already impossible) while keeping feel crisp.
2. **Server-side vision culling**: only include entities within a view radius (+ LOS) in each player's snapshot → wallhacks/ESP become useless. The per-instance broadcast is already per-room; move to per-socket snapshots.
3. **Statistical telemetry**: log per-player APM, hit rates, loot/min into `profiles`; flag outliers for review. Add a `bans` table checked at token issue.
4. **Replay journal**: append-only per-instance event log (already have deterministic seeds) for post-report review.
5. Keep ALL new features intent-based — never accept client-computed results (e.g. map editor output is validated tile-by-tile against the allowed palette).
