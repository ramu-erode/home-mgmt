# ADR-001: Self-host on an always-on Mac

- **Status:** Accepted — amended 2026-09-21 by ADR-015 (availability caveat, on-site backups)
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/self-host-vs-managed-backend.md`

## Context

`home-mgmt` holds a multi-year household financial record for a family of four,
with two adult users on separate phones. The data cannot be reconstructed if
lost. The initial assumption was a managed backend (Supabase).

The alternatives considered — managed backend, VPS, local-only with iCloud
sync — and why each lost are in the source note.

## Decision

Run the whole stack on a single always-on Mac at home:

- Postgres 17, native (ADR-002)
- NestJS API, which also serves the built Angular bundle (ADR-005)
- Tailscale for device access (ADR-004)
- Nightly encrypted `pg_dump` to an attached USB drive — off-disk, on-site
  (ADR-015)

No cloud database, no hosting bill, no vendor account in the critical path.

## Consequences

The trade accepted deliberately: roughly **99% availability for zero cost and
full data ownership** — excluding the time between a power cut and someone
unlocking the Mac, because FileVault stays on (ADR-015). Phones keep working
offline through that window.

This repo now depends on host configuration being treated as part of the system:

- The Mac must be always on — a MacBook that sleeps and travels cannot serve
  this. Sleep disabled; *Start up automatically after a power failure* enabled
  (it boots to the FileVault unlock screen; a UPS rides out short cuts).
- Services run under LaunchDaemons, not `brew services`
  (`/knowledge/guidelines/launchdaemon-not-brew-services.md`).
- Nightly off-disk `pg_dump`, with at least one **proven** restore. Time
  Machine over a live Postgres data directory is not crash-consistent and does
  not count as a backup. Theft and fire are an accepted risk (ADR-015).

Phase 0 of `docs/PROJECT-PLAN.md` carries the setup. Phases 1–2 run against the
devcontainer database (ADR-008); Phase 0 blocks Phase 3 onward.

**Exit:** `pg_dump` → `pg_restore` into a managed instance or VPS, plus a
connection string. Schema, API and client are untouched.
