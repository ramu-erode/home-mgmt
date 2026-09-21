# ADR-012: Money is a decimal string at every boundary and big.js inside the engine

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/money-as-decimal-strings-exact-arithmetic.md`

## Context

Storage is settled: `numeric(14,2)`. Past Postgres nothing was: `node-postgres`
returns `numeric` as a string, JSON has no decimal, and `libs/core` — which
splits by weight, divides by accrual months and sums 18 months of positions —
had no decimal library on its whitelist, so it could only use float `number`.

## Decision

- **Wire, DTOs, Dexie and signals carry a decimal string** — branded
  `Money = string & { readonly __money: unique symbol }` in `libs/shared`,
  always two decimal places (`"40000.00"`).
- **`libs/core` does arithmetic with big.js**, through a private constructor —
  `const D = Big(); D.DP = 10; D.RM = Big.roundHalfUp;` — never the global
  `Big`, whose settings any importer can mutate.
- **`Big` never crosses the engine boundary.** Core parses on the way in and
  returns `toFixed(2)` strings on the way out. IndexedDB structured clone strips
  its prototype and signals compare by reference, so a leaked `Big` fails in
  two different ways.
- **Rounding happens at three named points only:**
  - split — largest-remainder, so shares sum exactly; the residual paisa goes
    to the highest weight, ties broken by `member_id`;
  - reserve and goal contributions — **up** to the whole rupee (ADR-011);
  - display — half-up to paise, via
    `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`,
    which formats decimal strings exactly. No big.js in `apps/web`.

## Consequences

- `big.js` is on the `scope:core` `allowedExternalImports` whitelist; `rrule`
  is removed (ADR-013). The package itself is installed in Phase 1, with the
  engine.
- The CLAUDE.md money rule covers all four layers: storage `numeric(14,2)`,
  boundary decimal string, arithmetic big.js, float never.
- `libs/shared` stays dependency-free — `Money` is a type, not a class.
