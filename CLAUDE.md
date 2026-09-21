# home-mgmt

<!-- Local concerns only. Vault conventions and knowledge-base routing load globally from ~/.claude/CLAUDE.md — do not repeat them here, and do not import /knowledge/index.md (it is already loaded). -->

Household income, expense and planning app. Self-hosted on an always-on Mac,
offline-capable on two phones, no cloud account.

## Stack

- Node 24 (Active LTS), pinned in `.devcontainer/Dockerfile` as `NODE_VERSION`
- Angular (signals-based) PWA, `@angular/service-worker`, Dexie/IndexedDB
- NestJS — REST API and static host for the built Angular bundle; binds
  `127.0.0.1` only (ADR-014)
- Kysely on `pg`, hand-written SQL migrations (ADR-016)
- Postgres 17 (native on macOS, `localhost` only)
- big.js — inside `libs/core` only (ADR-012)
- Tailscale for device access and auth; launchd for process supervision

## Repo structure

Nx monorepo.

```
.devcontainer/     ← compose, Dockerfile, mount verification
apps/
  api/             ← NestJS: REST, sync, static host for the web build
    src/db/        ← the only code that imports kysely/pg; migrations = schema
  web/             ← Angular PWA
libs/
  core/            ← projection engine: pure TS, no I/O, no framework imports
  shared/          ← DTOs and types shared by api and web
docs/
  adr/             ← architecture decision records
  PROJECT-PLAN.md  ← phased delivery plan
```

`libs/core` is a library so its purity is enforced by the dependency graph
rather than by convention — that is what the monorepo buys at this size.

## Devcontainer

`.devcontainer/` carries the whole dev environment: Node 24 (Nx supplies the
Angular and Nest CLIs), a Postgres 17 service (ADR-008), and the shared Claude
home and knowledge vault bind-mounted from the host.

**Before first open:** `cp .devcontainer/.env.example .devcontainer/.env` and set
`CLAUDE_KB` to an **absolute** path. Compose reads `.env` from the compose
file's own directory, not the repo root, and it does not expand `~`. Get either
wrong and `${CLAUDE_KB}` expands to empty — the mount silently resolves to a
relative path and the container comes up with an empty Claude home. No error,
just no memory.

**`workspaceFolder` is `/home-mgmt`, not the default `/workspace`.** The Claude
auto-memory key is the full container path with slashes turned to dashes, so the
default interleaves this repo's memory with every other container using it. The
compose mount target (`..:/home-mgmt:cached`) must match — memory key
`projects/-home-mgmt/`.

`.devcontainer/verify-mounts.sh` runs on create and checks all of the above:
two distinct bind mounts, the repo's `.claude` not aliasing the live home, and
`/knowledge` readable and writable. Procedure and background:
`/knowledge/deployment/shared-claude-home-mounts.md`.

## Running locally

Inside the devcontainer. `PGHOST`/`PGUSER`/`PGDATABASE` are preset, so `psql`
needs no arguments.

```bash
psql                     # dev database (container service `db`)
npm run db:migrate       # apply apps/api/src/db/migrations/*.sql (db:status to list)
npm run db:seed          # load the SYNTHETIC household; idempotent
npm run db:codegen       # regenerate src/db/schema.ts after a migration — commit it
npm test                 # all projects; api includes integration tests
npm run start:api        # NestJS: API + static Angular bundle, :3000
npm run start:web        # Angular dev server, :4200
```

**API environment** (`apps/api/src/config.ts`): `DATABASE_URL` (required),
`TAILSCALE_ALLOWED_LOGIN` (the household login; unset = allow all in dev,
refuse all in production), `HOUSEHOLD_TZ` (default `Asia/Kolkata`), `HOST`
(default `127.0.0.1` — never `0.0.0.0`), `PORT`, `WEB_DIST`, `GIT_SHA`,
`BACKUP_STAMP_FILE`, `HORIZON_ROLL=off`, `FIXED_TODAY` (tests only).

**Integration tests never touch the dev database.** Vitest's global setup
migrates a template database once per run; each integration spec clones it
(`createTestDatabase` in `apps/api/src/testing/`) and drops the clone after.
`src/testing/` is the only place outside `src/db/` allowed to import `kysely`
or `pg`, and it is excluded from the build.

The migration and seed scripts are `.mts` run by Node 24's type stripping —
no build step, and the same files run on the Mac during a deploy. That means
erasable TypeScript only: no parameter properties, enums or namespaces in them.

`libs/core/src/testing/synthetic-household.json` is the single fixture behind
both the seed and the engine's golden test. Change one, and the golden
expectation must be re-derived by hand, not copied from the engine's output.

Production Postgres is native on the always-on Mac under a LaunchDaemon
(ADR-002) and is never reachable from here (ADR-008).

**The web app** reads IndexedDB only (`apps/web/src/app/data/`): `Household`
exposes live signals, `LocalStore` is the only writer (row + outbox in one
Dexie transaction), `SyncService` is the only caller of the network. The dev
server proxies `/api` to `:3000`. Web tests run on fake-indexeddb against a
real Dexie.

## Conventions

- **Charts are hand-built SVG, no chart library.** Series colours are the
  `--series-*` tokens in `apps/web/src/styles.css`, validated with the dataviz
  skill's `validate_palette.js` against the app's own light and dark surfaces —
  re-run it before changing one. One y-axis per chart; every chart has a table
  view.
- **Money arithmetic in the web app goes through `addMoney` / `sumMoney` from
  libs/core** — never `Number()` on Money except for pixel geometry.
- **Dexie live queries only read.** A write inside `liveQuery` throws, and an
  errored subscription never recovers — the signal silently freezes. Mint ids
  and defaults outside the query.

- **Money:** storage `numeric(14,2)`; every boundary (DTO, JSON, Dexie,
  signals) a two-decimal string, branded `Money`; arithmetic big.js inside
  `libs/core` through its private constructor. Never float. `Big` never leaves
  core (ADR-012).
- **Dates:** a day is a `'YYYY-MM-DD'` string everywhere (`CivilDate`). No JS
  `Date` in `libs/core` — lint-enforced. "Today" is passed in, in household
  time (ADR-013).
- **Primary keys are client-generatable UUIDs.** Offline devices mint their own
  IDs; this is load-bearing, not stylistic (ADR-006). **Except occurrences:**
  only the server creates them; phones only preview (ADR-009).
- **Every query filters `deleted_at IS NULL`**, enforced in the repository layer,
  never at the call site (ADR-007).
- **Regeneration never touches a row that is not `PLANNED` and un-overridden**
  (ADR-003). This applies to every write path, not just the engine. Phones
  change occurrences only through commands (ADR-009).
- **Every project is `strict` TypeScript**, the API included — Kysely's insert
  types only know a nullable column is optional under `strictNullChecks`.
- **Migrations are expand, then contract** — never add and drop in one release
  (ADR-009, ADR-017).
- **No real household data in git.** Seeds and fixtures are synthetic; real
  data lives only in the database. `*.local.*` is ignored for a private seed.
- The projection engine (`project`, `cashflow`, `sinkingFund`) stays pure — no
  I/O, no framework imports — so it runs on server and client unchanged. This is
  **enforced by lint**, not convention: `@nx/enforce-module-boundaries` in
  `eslint.config.mjs` gives `scope:core` an `allowedExternalImports` whitelist,
  so any npm package not explicitly listed fails `nx lint core`. Adding one is a
  deliberate act — if you find yourself widening it to get something to compile,
  that is the design pushing back.
- **Node is pinned, not inherited.** Angular's devkit declares an `engines`
  range that npm only warns about; the Angular CLI enforces it at runtime, so a
  too-old Node installs cleanly and fails at build time. Check the devkit's
  `engines` before bumping `NODE_VERSION`.
- **No global `@angular/cli` or `@nestjs/cli`.** Nx supplies both; a second,
  differently versioned CLI on PATH produces confusing build errors.
- **Do not approve npm install scripts to silence the warning.** `npm install`
  reports unrun scripts for `nx`, `@parcel/watcher` and `unrs-resolver` on every
  fresh install. All three ship prebuilt native bindings as optional deps
  (`@nx/nx-linux-arm64-gnu`, `@parcel/watcher-linux-arm64-glibc`,
  `@unrs/resolver-binding-linux-arm64-gnu`), so the scripts are
  build-from-source fallbacks that are not needed. Approving them trades a
  supply-chain protection for tidier output. Revisit only if a binding is
  genuinely missing for the platform — the symptom would be a load error at
  runtime, not a warning at install.

## ADRs

Architectural decisions live in `docs/adr/`. This table is a map — open the file
for reasoning, alternatives and constraints.

- Path: `docs/adr/ADR-NNN-slug.md`, zero-padded to three digits.
- Next number is one above the highest existing file. Never reuse a number.
- One line per ADR in this table. Detail belongs in the ADR file.
- If an ADR derives from a `/knowledge` note, cite it in Context and add
  `{repo: home-mgmt, id: ADR-NNN, path: ...}` to that note's `adrs:` frontmatter.
  Both files change together or neither does.
- Template: `docs/adr/TEMPLATE.md`.

| ADR | Decision | Status |
|---|---|---|
| [001](docs/adr/ADR-001-self-host-on-always-on-mac.md) | Self-host the whole stack on an always-on Mac; ~99% availability for zero cost and data ownership | Accepted, amended |
| [002](docs/adr/ADR-002-postgres-native-on-macos.md) | Postgres 17 native under a LaunchDaemon, bound to localhost | Accepted, amended |
| [003](docs/adr/ADR-003-commitment-occurrence-model.md) | Flows store the recurrence rule; occurrences are materialised from it | Accepted, amended |
| [004](docs/adr/ADR-004-tailscale-for-device-access.md) | Devices reach the API over Tailscale; nothing is publicly exposed | Accepted, amended |
| [005](docs/adr/ADR-005-single-origin-no-cdn.md) | NestJS serves the Angular bundle; single origin, no CDN | Accepted, amended |
| [006](docs/adr/ADR-006-offline-first-service-worker-and-outbox.md) | Cache-first shell, IndexedDB read model, outbox; local-first from Phase 3 | Accepted, amended |
| [007](docs/adr/ADR-007-tombstones-for-sync.md) | Soft delete with tombstones; partial unique index on occurrence | Accepted, amended |
| [008](docs/adr/ADR-008-devcontainer-dev-database.md) | Devcontainer runs its own Postgres 17; production stays native on the host | Accepted |
| [009](docs/adr/ADR-009-server-authoritative-sync-protocol.md) | Server alone creates occurrences; `version` cursor, LWW on client time, commands, protocol versioning | Accepted |
| [010](docs/adr/ADR-010-flow-model-income-and-expense.md) | One `flow` model with direction; per-person fees are per-person flows; no rows = household | Accepted |
| [011](docs/adr/ADR-011-reserve-and-goals-accounting.md) | Reserve by per-occurrence accrual window; goals funded after the reserve | Accepted |
| [012](docs/adr/ADR-012-money-decimal-strings-and-bigjs.md) | Money is a decimal string at boundaries, big.js inside core | Accepted |
| [013](docs/adr/ADR-013-civil-dates-and-interval-recurrence.md) | Civil-date strings, no JS `Date` in core; structured `INTERVAL` replaces RRULE | Accepted |
| [014](docs/adr/ADR-014-tailnet-identity-no-app-login.md) | Tailnet is the perimeter; no app login; device identity for audit | Accepted |
| [015](docs/adr/ADR-015-filevault-and-encrypted-on-site-backups.md) | FileVault on; `age`-encrypted backups to an attached USB drive | Accepted |
| [016](docs/adr/ADR-016-kysely-and-sql-migrations.md) | Kysely on `pg`, SQL migrations as schema of record, one repository layer | Accepted |
| [017](docs/adr/ADR-017-build-ship-migrate-rollback.md) | Build in devcontainer, ship artifact, dump before migrate, symlink rollback | Accepted |
