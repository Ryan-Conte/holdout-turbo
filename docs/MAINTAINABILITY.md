# Maintainability

This document records code ownership, current hotspots, and the safe order for future refactors. The goal is to make HOLDOUT easier to extend without weakening the authoritative-server model.

## Module ownership

- `packages/shared` owns serializable domain definitions, socket contracts, balance constants, and pure calculations used by both applications. It must not import from either app.
- `apps/api/src/game/game.gateway.ts` owns socket transport, authentication, and payload entry points. It should delegate simulation decisions to game services.
- `apps/api/src/game/game.service.ts` owns authoritative runtime orchestration. Persistent/runtime shapes live in `game.types.ts`; new pure calculations should live in focused modules instead of growing the service.
- `apps/web/components/GameClient.tsx` owns game-session coordination: socket lifecycle, input, renderer synchronization, and cross-panel state. Presentation belongs under `components/game`.
- `apps/web/game` owns canvas rendering, sprites, sound, and client-only interpolation. It must not decide authoritative collision, damage, loot, or inventory outcomes.
- `apps/web/components/admin` owns engine UI. `map-studio-model.ts` contains pure map-editor definitions and transforms; canvas lifecycle remains in `MapStudio.tsx`.
- `apps/web/lib/game-content.ts` owns default engine documents and API-side sanitization. Published runtime interpretation belongs in the API `ContentService`.

## Current hotspots

Line counts are indicators, not targets. Split a file only when a boundary has a clear owner and can be verified independently.

| Area | Current shape | Next safe boundary |
| --- | --- | --- |
| API simulation | `game.service.ts` is about 3,800 lines | Add behavior tests, then extract instance lifecycle, inventory/economy, stations, combat, bots, and enemy AI one subsystem at a time. |
| Web renderer | `renderer.ts` is about 1,800 lines | Separate terrain/world layers, entity drawing, and transient effects while keeping one render coordinator. |
| Game client | `GameClient.tsx` is about 1,750 lines | Extract socket/session and input hooks, then inventory/container presentation. Keep queue timers coordinated centrally. |
| Map editor | `MapStudio.tsx` is about 1,100 lines after its model split | Extract palette, inspector, and canvas viewport components around the existing camera contract. |
| Shared package | `shared/src/index.ts` is about 875 lines | Move protocol snapshots/events and world constants into modules that are re-exported by `index.ts`. |
| Engine defaults | `web/lib/game-content.ts` is about 550 lines | Split defaults from sanitizers and add fixture-based compatibility tests before removing legacy fallbacks. |

## Completed first pass

- Game item rendering, crafting, cooking, skills, trading, social, pause, and death UI now live in focused `components/game` modules.
- `GameClient` remains the owner of sockets and action queues, avoiding duplicated client state.
- Map editor constants, palette metadata, history cloning, labels, and numeric helpers now live in `map-studio-model.ts`.
- API runtime entities and instance shapes now live in `game.types.ts`, leaving `GameService` focused on behavior.
- Inventory/death-drop transfers, station fuel and cross-system simulation predicates now live in pure `game/rules` modules.
- Economy/save observability is isolated in `TelemetryService`; runtime item/recipe synchronization is isolated in `ContentService`.
- Root `npm run check` provides one command for workspace typechecks, production builds and deterministic gameplay tests.

## Automated verification

`npm run test:gameplay` compiles the shared/API packages and executes deterministic coverage for:

1. Death/disconnect drops and durability-preserving inventory transfers.
2. Extraction interruption by movement or damage.
3. Station fuel capacity/consumption and crafting payment.
4. Quest prerequisite/claim gates, foundation restoration, elevation cliffs and authored-map conversion.

Content sanitization and renderer transforms remain useful future coverage, but they no longer block the first service extraction. Every refactor must pass `npm run check` and should avoid mixing unrelated behavior changes with file moves.

## Refactor rules

- Preserve socket event names through `EV`; never create transport string literals.
- Keep server decisions server-side. Extracting a UI component must not move simulation rules into the browser.
- Prefer pure modules and narrow callback props over context objects that hide dependencies.
- Keep compatibility normalization at storage/runtime boundaries rather than throughout rendering code.
- Avoid circular imports. Leaf modules may import shared types, but coordinators should not be imported by their children.
- Make one subsystem move at a time and verify before starting the next.
