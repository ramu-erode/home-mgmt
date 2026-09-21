# ADR-013: Civil-date strings throughout; a structured INTERVAL kind replaces RRULE

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/civil-dates-are-strings-not-js-date.md`
- **Amends:** ADR-003 (`RRULE` kind and its `BYMONTHDAY` note)

## Context

`due_date` is a Postgres `date` — a calendar day. Every JavaScript layer turns
it into an instant: `node-postgres` parses it to local midnight of the server
process, JSON then serialises it as a UTC timestamp that renders as the wrong
day elsewhere, and rrule.js works in JS `Date`s with a history of off-by-one-day
bugs and a skip-not-clamp behaviour on `BYMONTHDAY=31` that ADR-003 already had
to special-case. `Temporal.PlainDate` is the right type but cannot be relied on
in iOS Safari, which is what both installed PWAs run in.

The recurrences actually used are monthly, quarterly, four-monthly and annual
on a day of the month — a tiny subset of RFC 5545.

## Decision

- **Drop `rrule`.** The `RRULE` recurrence kind becomes **`INTERVAL`**, stored
  as columns: `freq ∈ {MONTHLY, YEARLY}`, `interval` (≥1), `day_of_month`
  (1–31, clamped to month-end), `anchor_date`. `MONTHS` and `ONE_OFF` are
  unchanged.
- **A day is a `'YYYY-MM-DD'` string everywhere** — branded `CivilDate` in
  `libs/shared`, in DTOs, Dexie and signals.
- `libs/core` has a small `{ y, m, d }` helper (add months, clamp, compare,
  months-between) and **never uses JS `Date`** — enforced by
  `no-restricted-globals` in `libs/core/eslint.config.mjs`.
- The API registers `pg.types.setTypeParser(1082, v => v)` so `date` columns
  arrive as strings.
- **"Today" is the household's, not a machine's**: one setting,
  `Asia/Kolkata`, drives the horizon roll and "due this month". The engine takes
  `today` as a parameter and never reads a clock.

## Consequences

- Month-end clamping is the natural behaviour of the helper, not a patch.
- The Phase 1 test list is unchanged except that `INTERVAL=4` means the column,
  not an RRULE string.
- A future need such as "second Tuesday" is a new `recurrence_kind`, not a
  reason to reintroduce a library.
