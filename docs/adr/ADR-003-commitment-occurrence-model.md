# ADR-003: Separate the recurrence rule from its occurrences

- **Status:** Accepted
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

Two tables. `commitment` holds the **rule** and never stores due dates.
`occurrence` holds **materialised instances**, generated 12–18 months forward,
and is what every screen reads. Supporting: `commitment_amount` (scheduled
amount changes), `commitment_allocation` (member split by weight).

Recurrence is expressed three ways:

| `recurrence_kind` | Use | Example |
|---|---|---|
| `RRULE` | Evenly spaced intervals (RFC 5545) | monthly, quarterly `INTERVAL=3`, four-monthly `INTERVAL=4`, annual |
| `MONTHS` | Fixed months of the year | school terms → `months = {6,10,2}` |
| `ONE_OFF` | A single planned future expense | a trip, a laptop |

Sinking funds are derived (`amount ÷ months_in_period`), never stored.

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

`UNIQUE (commitment_id, due_date)` makes regeneration idempotent. ADR-007 turns
it into a partial unique index; the two must be read together.

The projection engine stays pure TypeScript with no I/O — `project()`,
`cashflow()`, `sinkingFund()` — so it is unit-testable and can move from client
to server unchanged.

Engine-level edge case, not a schema concern: `BYMONTHDAY=31` in a 30-day month.
RRULE libraries **skip** the month rather than clamping, which is wrong for a
bill. Normalise to month-end before generating. Covered by a Phase 1 test.
