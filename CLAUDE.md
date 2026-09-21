# home-mgmt

<!-- Local concerns only. Vault conventions and knowledge-base routing load globally from ~/.claude/CLAUDE.md — do not repeat them here, and do not import /knowledge/index.md (it is already loaded). -->

Household income, expense and planning app. Self-hosted on an always-on Mac,
offline-capable on two phones, no cloud account.

## Stack

- Node 24 (Active LTS), pinned in `.devcontainer/Dockerfile` as `NODE_VERSION`
- Angular (signals-based) PWA, `@angular/service-worker`, Dexie/IndexedDB
- NestJS — REST API and static host for the built Angular bundle
- Postgres 17 (native on macOS, `localhost` only)
- Tailscale for device access; launchd for process supervision

## Repo structure

Nx monorepo.

```
.devcontainer/     ← compose, Dockerfile, mount verification
apps/
  api/             ← NestJS: REST, sync, static host for the web build
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

`.devcontainer/` carries the whole dev environment: Node 22 + Angular/Nest CLIs,
a Postgres 17 service (ADR-008), and the shared Claude home and knowledge vault
bind-mounted from the host.

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
npm run start:api        # NestJS: API + static Angular bundle, :3000
npm run start:web        # Angular dev server, :4200
```

Production Postgres is native on the always-on Mac under a LaunchDaemon
(ADR-002) and is never reachable from here (ADR-008).

## Conventions

- **Money is `numeric(14,2)`.** Never float, never integer paise.
- **Primary keys are client-generatable UUIDs.** Offline devices mint their own
  IDs; this is load-bearing, not stylistic (ADR-006).
- **Every query filters `deleted_at IS NULL`**, enforced in the repository layer,
  never at the call site (ADR-007).
- **Regeneration never touches a row that is not `PLANNED` and un-overridden**
  (ADR-003). This applies to every write path, not just the engine.
- The projection engine (`project`, `cashflow`, `sinkingFund`) stays pure — no
  I/O, no framework imports — so it can move client↔server unchanged. This is
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
| [001](docs/adr/ADR-001-self-host-on-always-on-mac.md) | Self-host the whole stack on an always-on Mac; ~99% availability for zero cost and data ownership | Accepted |
| [002](docs/adr/ADR-002-postgres-native-on-macos.md) | Postgres 17 native under a LaunchDaemon, bound to localhost | Accepted |
| [003](docs/adr/ADR-003-commitment-occurrence-model.md) | Commitments store the recurrence rule; occurrences are materialised from it | Accepted |
| [004](docs/adr/ADR-004-tailscale-for-device-access.md) | Devices reach the API over Tailscale; nothing is publicly exposed | Accepted |
| [005](docs/adr/ADR-005-single-origin-no-cdn.md) | NestJS serves the Angular bundle; single origin, no CDN | Accepted |
| [006](docs/adr/ADR-006-offline-first-service-worker-and-outbox.md) | Cache-first shell, IndexedDB read model, outbox of pending mutations | Accepted |
| [007](docs/adr/ADR-007-tombstones-for-sync.md) | Soft delete with tombstones; partial unique index on occurrence | Accepted |
| [008](docs/adr/ADR-008-devcontainer-dev-database.md) | Devcontainer runs its own Postgres 17; production stays native on the host | Accepted |
