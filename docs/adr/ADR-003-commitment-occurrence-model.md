# ADR-003: Separate the recurrence rule from its occurrences

- **Status:** Accepted — amended 2026-09-21 by ADR-009 (server materialises),
  ADR-010 (`commitment` → `flow`), ADR-011 (sinking fund), ADR-013 (`INTERVAL` kind)
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/recurrence-rule-vs-materialised-occurrences.md`

## Context

The household's real cadences are monthly (swimming coaching, three members),
term-based (school fees, two daughters), four-monthly, and annual (vehicle and
health insurance). The product's value is seeing an expense cluster before it
arrives, so the forecast is the primary artifact, not the ledger.

A single `recurring_expenses` table with a cadence column was the starting
design; the source note records why it and the other alternatives fail.

## Decision

Two tables. `flow` (originally `commitment`; renamed when income joined it,
ADR-010) holds the **rule** and never stores due dates. `occurrence` holds
**materialised instances**, generated 18 months forward **by the server only**
(ADR-009), and is what every screen reads. Supporting: `flow_amount` (scheduled
amount changes), `flow_allocation` (member split by weight).

Recurrence is expressed three ways:

| `recurrence_kind` | Use | Example |
|---|---|---|
| `INTERVAL` | Evenly spaced: `freq` MONTHLY/YEARLY × `interval`, on `day_of_month` (ADR-013) | monthly, quarterly `interval=3`, four-monthly `interval=4`, annual |
| `MONTHS` | Fixed months of the year | school terms → `months = {6,10,2}` |
| `ONE_OFF` | A single planned future flow | a trip, a laptop, a contracting payment |

Sinking funds are derived, never stored — per occurrence over its accrual
window (ADR-011).

## Consequences

**The load-bearing invariant: regeneration may only touch rows that are
`PLANNED` and un-overridden.** On a rule change or horizon roll, the engine
recomputes the expected `(due_date, amount)` set and reconciles:

- computed date, no row → insert as `PLANNED`
- computed date, `PLANNED` + un-overridden, amount differs → update amount
- row no longer produced by the rule, `PLANNED` + un-overridden → soft-delete (ADR-007)
- anything `CONFIRMED`, `SETTLED`, `SKIPPED`, or flagged overridden → **leave alone**

The `is_amount_overridden` / `is_date_overridden` flags exist solely to protect
manual corrections from later rule edits. **Every write path must respect them,
not just the engine** — this is the easiest thing in the repo to get wrong.
Phones change occurrences only through server-applied commands (ADR-009).

`UNIQUE (flow_id, due_date)` makes regeneration idempotent. ADR-007 turns it
into a partial unique index; the two must be read together.

The projection engine stays pure TypeScript with no I/O — `project()`,
`cashflow()`, `sinkingFund()` — so it is unit-testable and runs unchanged on the
server (materialisation) and the phone (preview).

Engine-level edge case, not a schema concern: `day_of_month = 31` in a 30-day
month **clamps** to month-end; it never skips. Covered by a Phase 1 test.
