# Queue SaaS API — Backend

Node.js + Express + Prisma backend for the Universal Smart Queue & Booking Management System.

## Phase 5 status: Backend Foundation ✅

This is the project skeleton: Express app, middleware pipeline, Prisma connection, environment validation, health check. No feature routes (auth, branches, services, bookings, queue) are wired into `app.js` yet — they'll be introduced and explained one at a time in their own phases, even though the files already exist under `src/controllers` and `src/routes`.

## Setup (Windows / PowerShell)

```powershell
# 1. Install dependencies
npm install

# 2. Create your .env file (copy the template, then edit the values)
Copy-Item .env.example .env

# 3. Edit .env — set DATABASE_URL to your local MySQL connection,
#    and set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET to any long random strings

# 4. Generate the Prisma Client (reads prisma/schema.prisma, generates
#    the typed query builder your code imports as "@prisma/client")
npx prisma generate

# 5. Run migrations against your database (creates all 22 tables)
npx prisma migrate dev --name init

# 6. Start the dev server (auto-restarts on file changes)
npm run dev
```

## Verifying it works

With the server running, check:

```powershell
curl http://localhost:4000/api/v1/health
```

Expected response once your database is reachable:
```json
{"status":"ok","database":"connected"}
```

If you get `{"status":"error","database":"unreachable"}`, double-check `DATABASE_URL` in `.env` and confirm MySQL is actually running.

## Project structure

See `PROJECT_PLAN.md` / `DATABASE_DESIGN.md` (in the sibling docs folder) for the full architecture reasoning. Quick orientation:

- `src/app.js` — Express app: middleware, route mounting, error handling. Exported, not started (see `server.js`).
- `src/server.js` — actually starts the HTTP server; handles graceful shutdown.
- `src/config/` — environment validation (`env.js`) and the Prisma client singleton (`db.js`).
- `src/middleware/` — `error.middleware.js` is active now; `auth`/`tenant`/`role` middleware exist and will be wired in starting Phase 6.
- `src/routes/` — `index.js` is the central router (health check only for now); feature route files exist and get mounted phase by phase.
- `src/controllers/` — feature logic (auth, branches, services, bookings, queue) already written, introduced formally in later phases.

## Note on this being a fresh clone

`npx prisma generate` needs network access to download Prisma's query-engine binary the first time — this can't be pre-generated for you in a sandboxed environment, so it must be run on your own machine.
