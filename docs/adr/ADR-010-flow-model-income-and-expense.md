# ADR-010: One flow model for expense and income; per-person fees are per-person flows

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/recurrence-rule-vs-materialised-occurrences.md`
- **Amends:** ADR-003 (table names, allocation rules), project plan §5 and §9

## Context

ADR-003 modelled expenses as `commitment` → `occurrence`. The plan then gave
income a parallel model — `income_source` + `expected_income` per month with a
confidence, filled in by a "roll-forward" step. That duplicates recurrence
(rent and interest are rules), duplicates confidence (`PLANNED` vs `CONFIRMED`
already exists), and would need the override, skip, tombstone and command
machinery (ADR-003, ADR-007, ADR-009) rebuilt or silently go without it.

Separately, the plan treated swimming as one commitment ÷ 3 and school fees as
one commitment × 2. Both are billed **per person**, so a skipped term would need
a per-occurrence allocation override — open decision 1.

## Decision

**`commitment` becomes `flow`**, with `direction ∈ {OUT, IN}`. Amounts are
always positive; direction carries the sign. `expected_income` is dropped;
income sources are a `category` subtree (*Income → Contracting → Client X*).

- Regular income (rent, interest) is an `INTERVAL` flow (ADR-013).
- Irregular contracting income is a `ONE_OFF` IN flow per expected payment,
  `PLANNED` until confirmed. Single amounts only for now; a range would be an
  additive `amount_low` column later.
- The cashflow's two income lines are **confirmed** (`CONFIRMED` + `SETTLED`)
  and **all**.
- The ADR-003 invariant covers income unchanged: a confirmed payment is never
  regenerated away.

**Allocation**

- **Per-person fees are per-person flows**, allocated 100% to that member —
  three swimming flows, two school flows. Skipping a term is the `skip` command
  on that person's occurrence. Grouping for display comes from `category`. The
  editor offers "duplicate for another member".
- **Weights are for genuinely shared bills only** — one invoice covering
  several people (a family-floater health policy).
- **Zero allocation rows = household-general**, bucketed as `member_id: null`
  and shown as a "Household" row that makes the per-member breakdown sum to
  the total. The editor makes this an explicit choice ("Household — no split"),
  never the result of a skipped step.
- A split, once present, covers 100%. No partial split to household.
- On an IN flow, allocation means *whose income*; optional, same rules.

## Consequences

- Open decision 1 (per-occurrence allocation override) is **closed: not
  needed**. Revisit only if a genuinely shared bill needs per-occurrence
  re-splitting.
- `project()` and `cashflow()` handle both directions with one code path;
  sinking fund and goals (ADR-011) consider `OUT` only.
- Phase 6 shrinks to the IN direction in the flow editor plus a quick-add for a
  contracting payment.
- The rename touches every document that says "commitment"; the ADR-003
  invariant reads the same with "flow" substituted.
