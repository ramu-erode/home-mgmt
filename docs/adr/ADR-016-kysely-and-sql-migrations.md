# ADR-016: Kysely on `pg`, hand-written SQL migrations, one repository layer

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/kysely-over-orm-for-sql-heavy-schema.md` (decision-ref stub)

## Context

The plan said only "NestJS + a Postgres client". This layer is where most of
the design either holds or leaks: `numeric` as string (ADR-012), `date` as
string (ADR-013), `deleted_at IS NULL` everywhere (ADR-007), the partial unique
index, `version` trigger and per-transaction advisory lock (ADR-009), and
regeneration inside the flow-edit transaction.

- **Prisma** maps `@db.Date` to JS `Date` with no opt-out — breaks ADR-013.
- **TypeORM** can be configured to strings, but its soft-delete filter is known
  to leak through query builders and relations, and it carries a great deal of
  hidden behaviour.
- **Drizzle** fits, but trigger and lock SQL would still be hand-written beside
  a TypeScript schema — two sources of truth.

## Decision

- **Kysely** on `pg`, typed by `kysely-codegen` from the live dev database.
- **Hand-written SQL migrations** in `apps/api/src/db/migrations/` are the
  **schema of record**. Plan §5 links there; no separate table-design document.
- **A repository base** in `apps/api/src/db/` is the only code that touches
  Kysely. It adds `deleted_at IS NULL`, stamps `client_updated_at` /
  `updated_by_device`, and turns deletes into tombstones. What the database can
  enforce, it does: the `version` trigger takes the advisory lock, and a
  `BEFORE DELETE` trigger refuses hard deletes.
- Migrations run with `node apps/api/src/db/migrate.mts` — Node 24's type
  stripping, no build step — so the same file runs in the devcontainer and on
  the Mac during a deploy.
- `apps/api/eslint.config.mjs` restricts `kysely` and `pg` imports to
  `src/db/**`, the same move as the `libs/core` whitelist.

## Consequences

- What runs on the Mac is exactly what was reviewed; no generated DDL.
- Migrations follow expand-then-contract (ADR-009).
- `kysely-codegen` needs a running database; types are regenerated after each
  migration in the devcontainer and committed.
