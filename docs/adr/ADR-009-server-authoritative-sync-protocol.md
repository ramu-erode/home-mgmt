# ADR-009: Server-authoritative sync — version cursor, commands for derived rows

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/offline-first-pwa-sync.md`
- **Amends:** ADR-003 (who materialises occurrences), ADR-006 (sync protocol), ADR-007 (purge)

## Context

ADR-006 fixed the shape of sync — outbox, delta pull, last-write-wins on
`updated_at` — and the project plan had the projection engine materialising
occurrences client-side in v1. Taken together, four defects follow:

1. Two offline phones regenerating the same commitment mint different UUIDs for
   the same `(commitment_id, due_date)`; the second push violates the partial
   unique index (ADR-007), and LWW cannot resolve two different rows.
2. `updated_at = now()` is transaction *start* time. A pull that runs while a
   write transaction is open returns a `serverTime` later than rows that commit
   afterwards; those rows are never delivered.
3. A whole-row upsert on `occurrence` from a phone overwrites fields the person
   never touched — a confirm made offline reverts an amount the server has since
   regenerated.
4. A phone on an old cached bundle, or with a cursor older than the tombstone
   purge, silently diverges.

The general forms are in the source note.

## Decision

**Occurrences are created and regenerated only by the server.** When the server
applies an operation that changes a flow (ADR-010), `commitment_amount` or an
allocation, it regenerates that flow's occurrences in the same transaction.
Phones run `libs/core` to *preview* occurrences in memory for rules not yet
synced, and never write occurrence rows to Dexie themselves.

**Two columns, two jobs** on every synced table:

| Column | Set by | Used for |
|---|---|---|
| `version bigint` | trigger, from a sequence, on every insert/update | delta cursor |
| `client_updated_at timestamptz` | the originating device (server `now()` for server-generated rows) | LWW conflicts |
| `updated_at timestamptz` | trigger | audit only |
| `updated_by_device uuid` | the originating device (ADR-014) | audit only |

Every write transaction takes `pg_advisory_xact_lock(<const>)` before drawing
a version, so versions commit in the order they were assigned. The `version`
trigger itself takes the lock, so no write path — repository, migration, or a
hand-typed `psql` fix — can forget it.

**Protocol**

```
GET  /api/sync?since=<version>
     → { cursor: <max version>, changes: { <table>: Row[] } }
     | { resetRequired: true }            -- since < min_retained_version

POST /api/sync   { operations: Operation[] }
     → { applied: id[], rejected: { id, reason }[] }

Header on both: X-Protocol-Version: <n>
```

`Operation` is one of:

- `{ id, table, op: 'upsert'|'delete', payload, clientUpdatedAt }` — for
  human-authored tables. Applied only if `clientUpdatedAt` is later than the
  stored `client_updated_at`; otherwise rejected with reason `stale`.
- `{ id, table: 'occurrence', command, occurrenceId, args, clientUpdatedAt }` —
  `command ∈ confirm | settle {on, amount} | skip | unskip | override {amount?, due_date?} | note {text}`.
  Applied to the row *as it is on the server*. `confirm` takes the server's
  current amount. Rejected only when impossible (e.g. the occurrence has been
  tombstoned by regeneration), with a reason.

Phones never insert or delete occurrences.

**Version skew.** The server accepts protocol `n` and `n-1`, translating `n-1`
operations on the way in; anything older gets `426 Upgrade Required`. The
client keeps its outbox, activates the waiting service-worker update, reloads,
and pushes again. Outbox entries are tagged with the protocol version that
created them; Dexie upgrade functions rewrite queued entries when the local
schema moves.

**Stale cursor.** The tombstone purge (ADR-007) records `min_retained_version`.
A pull below it returns `resetRequired`; the client pushes its outbox first,
then clears its tables and pulls from zero. No local edit is lost.

## Consequences

- The partial unique index on `occurrence` is a real guarantee rather than a
  conflict source, and `libs/core` runs on the server from day one — "moves to
  the server unchanged" is no longer a future step.
- A flow created offline shows preview occurrences that cannot be confirmed or
  settled until the Mac has seen it. Accepted.
- **Every rejection is user-visible**, next to the pending-sync badge. A dropped
  rejection is data loss with extra steps.
- Migrations are **expand, then contract**: add in one release, drop in a later
  one. That is what makes `n-1` cheap. The deploy script (ADR-017) refuses a
  release that both adds a migration and drops a column.
- All writes are serialised by one advisory lock. At two devices contention is
  nil; revisit only if this ever serves more than a household.

**Settled while building Phase 2:**

- **Sync is the only write API.** There are no per-table REST endpoints: the UI
  is local-first (ADR-006) and never calls them, and a second write path would
  have to enforce the ADR-003 invariant twice. Reads outside sync are
  `GET /api/forecast` and `GET /api/health`.
- **A push is one transaction; each operation runs under a savepoint.** A bad
  operation is rolled back and rejected with a reason; the rest apply. Touched
  flows are regenerated once, after all operations, so a flow and its first
  amount can arrive in the same push in either order within it.
- **An unknown `X-Device-Id` is registered, not refused** — named "New device"
  with an epoch `client_updated_at`, so the phone's own device upsert always
  wins.
- **A `clientUpdatedAt` more than five minutes ahead of the server is clamped to
  server time.** A phone with a fast clock would otherwise win every conflict.
- **Rules the schema cannot express are enforced in the push:** a flow's
  `direction` is immutable (its history would flip sign), and categories are two
  levels deep.
- **Deleting a flow tombstones its amounts and allocations**; regeneration then
  tombstones its PLANNED, un-overridden occurrences and leaves the rest.
- **The horizon roll runs whenever the household date changes** — on boot, then
  checked hourly — rather than at a fixed time, so a Mac waiting for a FileVault
  unlock (ADR-015) catches up the moment it is back.
