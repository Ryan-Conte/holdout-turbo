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

The Blueprint prompts for the shared environment group:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Same pooled Postgres database as Vercel |
| `JWT_SECRET` | Exactly the Vercel `JWT_SECRET` |
| `CORS_ORIGIN` | Allowed web origins, comma-separated, for example `https://holdout.example.com,https://holdout.vercel.app` |
| `RUNTIME_CACHE_DIR` | Local published map/content snapshot directory; the Blueprint uses `/tmp/holdout-runtime-cache` |

Each service also prompts for `PUBLIC_SERVER_URL`. Set it to that service's exact external HTTPS URL, for example `https://holdout-api-oregon.onrender.com`. On startup the API creates a missing `game_servers` row using `SERVER_NAME`, `SERVER_REGION`, `SERVER_SORT` and `PUBLIC_SERVER_URL`. Existing rows are left alone so the admin server page remains authoritative for renaming, reordering and deactivation.

Render supplies `PORT`; do not set it manually. `/health` is the Blueprint health check and reports the server name, region and process uptime.

## Multiple-world rules

- Do not use `numInstances` or Render autoscaling for a game service. Socket sessions and simulation state are process-local, so load balancing one URL across processes would split players unpredictably.
- Add capacity by creating another named Render service with a distinct `PUBLIC_SERVER_URL`. It automatically appears in the landing-page server browser.
- Published maps and engine content are shared through Postgres. Each API process keeps an in-memory copy, writes the last successful snapshot to `RUNTIME_CACHE_DIR`, and polls only lightweight revision metadata. Full map or asset JSON is fetched after an actual publish; startup restores the local snapshot when Postgres is unavailable, and failed probes back off for up to five minutes. A published map is adopted when that server's world is empty.
- Vercel preview origins are denied unless added explicitly to `CORS_ORIGIN`. Keep production restrictive rather than allowing arbitrary origins.

## Verification

```bash
curl https://your-render-service.onrender.com/health
```

Then load the Vercel site, confirm every active region appears in the server browser, and verify ping values before deploying a player.
