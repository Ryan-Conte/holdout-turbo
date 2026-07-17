# Deployment

The production topology is one Vercel project for `apps/web` plus one or more independent Render web services for `apps/api`. All services share the same Postgres database and JWT secret. Each Render process owns a separate in-memory game world and therefore needs its own public URL and server-browser entry.

## Before the first deploy

Apply the Prisma schema once from a trusted machine using the direct database connection. Deployments intentionally do not run `prisma db push`.

```bash
$env:DATABASE_URL='postgresql://...'
$env:DIRECT_DATABASE_URL='postgresql://...'
npx prisma db push
npx prisma generate
npm run seed:engine
```

Generate two unrelated long random secrets:

- `JWT_SECRET` must be identical on Vercel and every Render game server.
- `BETTER_AUTH_SECRET` is used only by the Vercel web/auth application.

## Vercel web application

Import the repository as a Vercel project and choose `apps/web` as the Root Directory. Vercel detects the Turborepo workspace; [apps/web/vercel.json](../apps/web/vercel.json) builds the shared package, Prisma client and Next.js application from the repository root.

Set these Production environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Pooled Postgres connection string |
| `JWT_SECRET` | Same value used by every Render service |
| `NEXT_PUBLIC_API_URL` | Preferred/default Render server URL |
| `BETTER_AUTH_SECRET` | Web-only auth secret |
| `BETTER_AUTH_URL` | Canonical Vercel/custom origin, with `https://` and no trailing slash |
| `ADMIN_EMAILS` | Comma-separated initial admin emails |
| `STEAM_API_KEY` | Optional Steam Web API key for persona names |

Use the canonical production origin for `BETTER_AUTH_URL`, not a preview deployment URL. Steam callbacks and session cookies depend on this value.

## Render game servers

Create a Render Blueprint from the repository-root [render.yaml](../render.yaml). It defines always-on Starter services in Oregon, Frankfurt and Singapore. Remove regions you do not need before applying the Blueprint to avoid provisioning cost.

During the first Blueprint creation, Render prompts for these values on the Oregon service only. Frankfurt and Singapore reference the Oregon values through Blueprint service references, so all worlds use the same credentials without committing them:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Same pooled Postgres database as Vercel |
| `JWT_SECRET` | Exactly the Vercel `JWT_SECRET` |
| `CORS_ORIGIN` | Allowed web origins, comma-separated, for example `https://holdout.example.com,https://holdout.vercel.app` |

Render injects each service's `RENDER_EXTERNAL_URL`, which the API uses to register that world in `game_servers`. Set `PUBLIC_SERVER_URL` manually only when registration should use a custom domain instead. Existing rows are left alone so the admin server page remains authoritative for renaming, reordering and deactivation.

That same external URL is the durable `game_world_state.server_key`, keeping node cooldowns and rare resource rolls isolated per regional world. For a self-hosted process without a stable public URL, set a unique, stable `SERVER_STATE_KEY`; changing it intentionally starts a fresh world-node state.

Set `MAX_PLAYERS_PER_SERVER` per world (default 200, clamped to 10-500). Reconnects retain admission priority, while new survivors receive a clear full-relay rejection. `/health` reports human players, bots, capacity, instances, active map, entity/container counts, process memory and economy telemetry for load monitoring.

Before raising a relay cap, run `npm run test:load`. The isolated harness creates disposable users and a temporary world key, admits 100 real websocket clients, deploys them together, sends movement at 20 Hz, measures snapshot rate/size/gaps and simulation memory, then closes the Nest app and removes all benchmark rows. Tune with `node tools/load-test.mjs --clients=N --seconds=N` after building the shared/API packages.

The 2026-07-16 local ceiling run used 200 deployed clients, the published 500×500 map and 344 enemies. It admitted everyone in 5.9 seconds and sustained 16.64 snapshots/client/second with a 120 ms largest steady-state gap at 298 MB RSS. Treat this as a regression baseline; run a longer soak from separate client processes in each hosting region before raising production caps or changing instance size.

The shared `holdout-api-runtime` environment group pins Node and sets `RUNTIME_CACHE_DIR=/tmp/holdout-runtime-cache`. Render supplies `NODE_ENV=production` at runtime and supplies `PORT`; do not set either manually. `/health` is the Blueprint health check and reports server identity, simulation load, memory and telemetry health.

The Blueprint installs dev dependencies during the build because the Nest CLI, TypeScript and Prisma generator are build tools. It does not run `prisma db push` or migrations; apply the schema once using the direct connection before the first deploy.

### Isolated staging raid

Content staging is a separate API process, never a mode switch on a live world:

- Copy a normal API service and give it a private URL/name.
- Set `CONTENT_CHANNEL=staging`; it reads current content drafts plus the newest draft map.
- Leave `REGISTER_STAGING_SERVER=false` so normal players do not see it in the public browser.
- Give the web deployment `NEXT_PUBLIC_STAGING_GAME_URL=https://your-staging-api.example` to enable **OPEN STAGING RAID** in the admin revision bar.
- Use a distinct `SERVER_STATE_KEY` when several staging processes share one database. The channel suffix is automatic, so live and staging worlds with the same base key still do not share node state or cache files.

Draft map changes are detected by ID plus `updated_at`, so repeated saves to one draft reload after the staging world empties. Publishing and rollback remain live-channel operations.

## Multiple-world rules

- Keep every service at the Blueprint's `numInstances: 1` and do not enable Render autoscaling. Socket sessions and simulation state are process-local, so load balancing one URL across processes would split players unpredictably.
- Add capacity by creating another named Render service with its own external URL. It automatically appears in the landing-page server browser.
- Published maps and engine content are shared through Postgres. Each API process keeps an in-memory copy, writes the last successful snapshot to `RUNTIME_CACHE_DIR`, and polls only lightweight revision metadata. Full map or asset JSON is fetched after an actual publish; startup restores the local snapshot when Postgres is unavailable, and failed probes back off for up to five minutes. A published map is adopted when that server's world is empty.
- Harvested-node damage, depleted deadlines, rerolled variants and procedural seeds are stored sparsely in `game_world_state`. Applying the current Prisma schema is required before rollout; the runtime-cache copy is only an outage fallback because Render `/tmp` is ephemeral.
- `/tmp` is ephemeral on Render, so a new service or deploy must successfully read Postgres once to warm its local snapshot. Do not deploy while the database is suspended or over its transfer quota.
- `game_content_revisions` and `game_telemetry_events` are required by the revision bar and economy telemetry. Apply the current Prisma schema before deploying this build.
- Vercel preview origins are denied unless added explicitly to `CORS_ORIGIN`. Keep production restrictive rather than allowing arbitrary origins.

## Verification

```bash
curl https://your-render-service.onrender.com/health
```

Check all three health endpoints, then load the Vercel site, confirm every active region appears in the server browser, and verify ping values before deploying a player. In each Render log, confirm `Prisma connected`, `Registered public game server` (or `already registered`) and the listening message before opening the service to players.
