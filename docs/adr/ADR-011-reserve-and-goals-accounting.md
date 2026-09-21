# ADR-011: Sinking-fund reserve by accrual window; goals funded after the reserve

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/recurrence-rule-vs-materialised-occurrences.md`
- **Amends:** ADR-003 ("Sinking funds are derived, `amount ÷ months_in_period`")

## Context

The home-screen number is "what to set aside monthly". ADR-003 defined it as
`amount ÷ months_in_period` summed per commitment — the **steady-state**
figure. It is wrong in exactly the months the app is first used: with nothing
yet set aside, a ₹36,000 bill due in two months needs ₹18,000/month, not
₹3,000. It has no single answer for uneven terms (`{6,11,1}` → gaps 5, 2, 5)
and shifts mid-cycle when `commitment_amount` steps.

Goals were to show "required monthly contribution competing with the reserve",
with no accounting defined: nowhere to record progress without a ledger, and
nothing preventing the same money counting as both reserve and goal saving.

## Decision

**Reserve — per occurrence, not per flow.**

- Each future `OUT` occurrence has an **accrual window** from
  `max(previous occurrence of the same flow, today)` to its due date, and
  carries its own amount.
- Required contribution for month *M* = Σ `amount ÷ months_in_window` over
  occurrences whose window covers *M*, each rounded **up** to the rupee.
- `balance_snapshot.reserved_amount` records what is already earmarked; the
  engine draws it down against the nearest occurrences first.
- Home screen shows **This month** (catch-up) and **Steady state**. The first
  converges to the second.

**Goals.**

- `goal`: `target_amount`, `target_date`, `saved_amount` (hand-maintained,
  LWW-synced), `priority`, nullable `member_id`.
- The snapshot splits three ways and the engine checks it:
  `balance = reserved_amount + Σ goal.saved_amount + free`. The UI refuses a
  snapshot whose earmarks exceed the balance.
- Required goal contribution = `(target − saved) ÷ months_remaining`, derived,
  rounded up to the rupee.
- Monthly projected surplus (income − occurrences − reserve catch-up) funds the
  reserve first, then goals in priority order. **Bills always come first.** A
  month where goals cannot be fully funded is flagged, with the resulting
  target-date slip.
- Goals never generate occurrences; regeneration (ADR-003) never touches them.

Engine signatures:

```ts
sinkingFund(occurrences, today, reserved)            → { byMonth, perOccurrence, steadyState }
cashflow(occurrences, snapshot, goals, today)        → MonthPosition[]   // incl. after-goals line
```

## Consequences

- The cashflow chart gains a third line: *after goals*.
- `balance_snapshot` gains `reserved_amount`; `goal` gains `saved_amount` and
  `priority`.
- Open decision 3 (shared vs personal goals) stands as defaulted: nullable
  `member_id`, no joint subsets.
- Escalation rules (open decision 2) stay out; big.js (ADR-012) keeps the door
  cheap if that is ever reversed.
