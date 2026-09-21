# ADR-002: Postgres 17, native on macOS, under a LaunchDaemon

- **Status:** Accepted — amended 2026-09-21 by ADR-015 (FileVault)
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/postgres-over-sqlite-for-money.md`

## Context

Following ADR-001 the datastore is open. This schema needs exact decimal money,
`smallint[]` for term-billed fees, `citext`, partial indexes and
client-generatable UUID keys (ADR-006).

SQLite, PGlite and a containerised Postgres were considered and rejected; the
reasoning is in the source note. The short version: SQLite has no true decimal
type, which is disqualifying for a finance app.

## Decision

Postgres 17 via Homebrew, native, bound to `localhost`, started by a
LaunchDaemon in `/Library/LaunchDaemons`.

```bash
brew install postgresql@17
brew link postgresql@17 --force
createdb homemgmt
psql homemgmt -c "CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;"
```

Daemon, not `brew services` — see
`/knowledge/guidelines/launchdaemon-not-brew-services.md` for why. The plist is
in Phase 0 of `docs/PROJECT-PLAN.md`.

## Consequences

- The schema is written without compromise: `numeric(14,2)`, `smallint[]`,
  `citext`, partial indexes, `gen_random_uuid()`.
- Postgres is never reachable from the network. Only the NestJS process talks to
  it, over loopback; the API is the only exposed surface, and only inside the
  tailnet (ADR-004).
- One daemon to supervise, versus SQLite's zero. With FileVault on (ADR-015)
  it starts only after the disk is unlocked — after a power cut that needs a
  person at the Mac.
- `node-postgres` returns `numeric` and `date` as strings by configuration
  (ADR-012, ADR-013); the data layer is Kysely with SQL migrations (ADR-016).
- No tuning. At this volume the database lives in the OS page cache.
- This is what keeps ADR-001 reversible — Postgres here means Postgres anywhere.
