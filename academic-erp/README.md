# AI-Integrated Academic ERP — Phase 1

Real, runnable foundation: **authentication, RBAC, PostgreSQL database, and
student / faculty / admin management**. Later phases (timetable, QR attendance,
assignments, tests, leave, AI modules...) plug into this without a rewrite.

## Free-plan hosting: Render + Supabase

Render's free web service has **no persistent disk**, so a file database would
be wiped on every deploy. Data lives in **Supabase Postgres (free tier)** instead.

### 1. Create the database (Supabase)
1. Create a free project at supabase.com and note the database password.
2. Click **Connect** and copy the **Session pooler** connection string
   (looks like `postgresql://postgres.xxxx:[PASSWORD]@aws-0-...pooler.supabase.com:5432/postgres`).
   Use the pooler string, not "Direct connection": direct is IPv6-only and often fails from Render.
3. Replace `[PASSWORD]` with your database password. If it has special characters, URL-encode them.

Tables are created automatically on first start. No SQL to run by hand.

### 2. Deploy (Render)
1. Push this folder to GitHub.
2. Render → **New → Web Service** (or **Blueprint**, which reads `render.yaml`). Plan: **Free**.
3. Build command `npm install`, start command `npm start`.
4. Environment variables: `NODE_ENV=production`, `JWT_SECRET` (long random string), `DATABASE_URL` (the Supabase string).
5. After the first deploy, open Render **Shell** and run `npm run seed` once. It creates the roles,
   the first super admin (`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`, set these env vars first),
   and a demo department/programme/section so the sample CSV validates.

### Free-tier things to know
- Render free services **sleep after ~15 minutes idle**; the first request after that takes ~30-60 s. `/healthz` exists for uptime pings.
- Supabase free projects **pause after about a week of no activity** (restore with one click; data is kept). Back up with Supabase's dashboard or `pg_dump` before relying on this for real records.
- Keep `PG_POOL_MAX` small (default 5) to respect free connection limits.

## Run locally
```bash
npm install
cp .env.example .env      # set JWT_SECRET; leave DATABASE_URL empty
npm run seed
npm start                 # http://localhost:3000
```
With `DATABASE_URL` empty, a local embedded Postgres (PGlite, stored in `./data/pglite`) is used, so
you need no database install. It is refused when `NODE_ENV=production`. To test against Supabase locally, put its string in `.env`.

## What's implemented
- **Auth**: login/logout, forgot + reset password (hashed, expiring, single-use token), change password,
  forced change at first login (all other APIs blocked until done), activate/deactivate, 5-failure lockout, httpOnly cookie sessions.
- **RBAC**: every route role-checked. Students/faculty only ever reach their *own* record (looked up from the session, never a client-sent ID).
  Roles `dean` and `hod` exist in the database but get dashboards in a later phase.
- **Bulk student import**: CSV → validation (missing fields, bad email/mobile, duplicate Student ID/Roll/email in-file and in-database,
  invalid programme/semester/section) → preview with per-row errors → explicit commit that creates only valid rows → downloadable credentials CSV.
  `sample-data/students_sample.csv` has deliberately bad rows to show this.
- **Management**: student search/filter/pagination, edit, bulk activate/deactivate, CSV export; faculty add/activate/deactivate.
- **Audit log**: account creation, password changes, profile edits, status changes, imports. Audit rows are written in the same
  transaction as the change they describe, and there is no route that edits or deletes them.
- **Dashboards**: admin (overview, students, bulk import, faculty, audit log), student and faculty profile pages; responsive down to phones.

## Not in Phase 1 (by design)
Timetable, QR attendance, assignments, tests, leave, results, analytics, notifications, AI modules, events, placements.
Known Phase 1 limits: forgot-password returns the token only outside production (connect an email/SMS provider before go-live);
no rate limiting or CSRF tokens yet (Phase 9 hardening; cookies are `sameSite=lax`); imports run inside the request (up to 2000 rows;
background jobs come later); two-factor auth not yet built.

## Layout
```
src/config/db.js    Postgres (pg) in production, embedded PGlite for local dev
src/db/schema.sql   Tables (idempotent, applied on boot)    src/db/seed.js   Roles, first admin, demo structure
src/middleware/     requireAuth / requireRole               src/utils/       auth, audit, import validation
src/routes/         auth, admin, student, faculty           src/server.js    App wiring, /healthz
public/             Static frontend (vanilla JS, no build)  render.yaml      Render free-plan blueprint
```
