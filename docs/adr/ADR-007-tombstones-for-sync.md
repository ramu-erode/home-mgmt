# ADR-007: Soft delete with tombstones

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/offline-first-pwa-sync.md`
- **Supersedes:** the hard-delete step in ADR-003 regeneration
- **Amended:** 2026-09-21 by ADR-010 (table names) and ADR-009 (purge watermark);
  `CANCELLED` in the due-date index corrected to `SKIPPED`, the status that exists

## Context

ADR-003 specifies that regeneration hard-deletes stale `PLANNED` occurrences.
Standalone that is clean. Combined with offline clients (ADR-006) it is a
correctness bug: a delta sync returns rows *changed since* a cursor, and a
hard-deleted row is simply absent — indistinguishable from "outside my window"
or "unchanged". A phone offline during regeneration keeps those occurrences
forever.

The general form of this problem is in the source note.

## Decision

`deleted_at timestamptz NULL` on every synced table: `flow`, `flow_amount`,
`flow_allocation`, `occurrence`, `goal`, `balance_snapshot`, `member`,
`category`, `device` (ADR-010, ADR-014).

1. Nothing syncable is hard-deleted; deletion sets `deleted_at = now()`.
2. Regeneration **soft-deletes** stale `PLANNED`, un-overridden occurrences. The
   override protections in ADR-003 are unchanged.
3. `GET /api/sync` returns tombstoned rows so clients can remove them locally.
4. Every normal query filters `deleted_at IS NULL`, enforced in the repository
   layer rather than at each call site.
5. A monthly job hard-deletes tombstones older than 180 days and records
   `min_retained_version`; a pull older than that gets `resetRequired`
   (ADR-009).

## Consequences

**The constraint change that will bite if missed.** ADR-003's
`UNIQUE (flow_id, due_date)` now collides with tombstones — a soft-deleted
occurrence blocks regenerating that same date. It must become partial:

```sql
CREATE UNIQUE INDEX uq_occurrence ON occurrence (flow_id, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_occurrence_due ON occurrence (due_date)
  WHERE deleted_at IS NULL AND status <> 'SKIPPED';
```

This surfaces as a puzzling constraint violation far from its cause. It is
called out in Phase 1 and covered by a test.

- Accidental deletions become recoverable within the purge window.
- A missed `deleted_at` filter silently shows deleted data — the main risk this
  decision introduces, and the reason for centralising it.
- Without the purge job the occurrence table accumulates dead rows indefinitely.
