# Home Mgmt — Project Plan

**Version:** 1.0 · **Date:** 2026-09-21 · **Owner:** Ramu

A household income, expense and planning app for a family of four, self-hosted
on an always-on Mac, usable offline from two phones.

---

## 1. Problem

Household money is lumpy on both sides. Contracting income is irregular.
Expenses cluster badly — an insurance renewal, a school term and an annual fee
landing in the same month. Recurring commitments run at several cadences:
monthly (swimming coaching, three members), term-based (school fees, two
daughters), four-monthly, and annual (vehicle and health insurance).

The value is **seeing the spike before it arrives** and knowing what to set
aside each month to absorb it. Bookkeeping is secondary and deferred.

## 2. Goals — v1

- Record every recurring commitment as a rule, at any cadence we actually use.
- Project 18 months of due dates and amounts from those rules.
- Show a month-by-month cashflow against irregular expected income.
- Compute the monthly sinking-fund reserve that flattens the lumpy months.
- Attribute expenses to household members (swimming ÷ 3, school fees × 2).
- Work offline on a phone, sync when the Mac is reachable.
- Two users, shared data, no cloud account.

## 3. Non-goals — v1

- Transaction-level bookkeeping, bank import, receipt capture (ledger phase).
- Double-entry accounting. Wildly oversized for a household.
- Multi-currency, multi-household, sharing outside the family.
- Tax reporting or investment tracking.

## 4. Architecture

```
  Phone (PWA, installed)            Phone (PWA, installed)
  ├── service worker: app shell     ├── service worker: app shell
  └── IndexedDB + outbox            └── IndexedDB + outbox
            │                                  │
            └────────── Tailscale ─────────────┘
                            │
                  mac-mini.<tailnet>.ts.net:3000
                  ┌─────────────────────────────┐
                  │ NestJS                      │
                  │  ├── /        Angular build │
                  │  └── /api/*   REST + sync   │
                  ├─────────────────────────────┤
                  │ Postgres 17 (localhost)     │
                  └─────────────────────────────┘
                            │
                  nightly pg_dump → off-machine
```

Decisions behind this shape: [ADR-001](adr/ADR-001-self-host-on-always-on-mac.md),
[ADR-002](adr/ADR-002-postgres-native-on-macos.md),
[ADR-004](adr/ADR-004-tailscale-for-device-access.md),
[ADR-005](adr/ADR-005-single-origin-no-cdn.md).

**Stack:** Angular (signals-based) PWA · NestJS · Postgres 17 · Dexie ·
Tailscale · launchd.

**Layout:** Nx monorepo, mirroring `onedoc`.

```
apps/api      NestJS — REST, sync endpoints, static host for the web build
apps/web      Angular PWA
libs/core     projection engine — pure TypeScript, no I/O, no framework imports
libs/shared   DTOs and types shared by api and web
```

`libs/core` is a library rather than a folder so the "no I/O, no framework"
rule is enforced by its dependency graph instead of by discipline. That is the
whole reason for the monorepo at this size.

## 5. Data model

Full schema and DDL live in the table-design document. Summary:

| Table | Role |
|---|---|
| `member` | People expenses are attributed to (incl. non-users) |
| `app_user` | Login identities (2) |
| `category` | Two-level hierarchy for roll-ups |
| `commitment` | The recurrence **rule** |
| `commitment_amount` | Scheduled amount changes (fee hikes, renewals) |
| `commitment_allocation` | Member split, by weight |
| `occurrence` | Materialised instances — what every screen reads |
| `income_source` | Contracting clients, rent, interest |
| `expected_income` | Per source, per month, with confidence |
| `balance_snapshot` | Anchor for the projection |
| `goal` | Plans: a car, a trip, an emergency fund |

Every syncable table carries `deleted_at` ([ADR-007](adr/ADR-007-tombstones-for-sync.md)).

### The projection engine

Pure TypeScript, framework-free, no I/O:

```ts
project(commitments, from, to)                  → Occurrence[]
cashflow(occurrences, expectedIncome, opening)  → MonthPosition[]
sinkingFund(commitments)                        → { perCommitment, monthlyTotal }
```

This is the intellectual core and the most testable part of the system. It runs
client-side in v1 and moves to the server unchanged when scheduled
materialisation arrives.

## 6. Sync protocol

```
GET  /api/sync?since=<iso8601>   → { serverTime, changes: { <table>: Row[] } }
POST /api/sync                   → { operations: Operation[] } → { applied, rejected }
```

- Rows include soft-deleted ones so clients can remove them.
- `Operation` = `{ id, table, op: 'upsert'|'delete', payload, clientUpdatedAt }`.
- Client IDs are UUIDs minted offline — no reconciliation.
- Conflict: last-write-wins on `updated_at`.
- Cursor stored client-side; `serverTime` from the response becomes the next
  `since`.

## 7. Phases

Sequenced so something useful exists early. Phases 1–4 deliver a working
forecast on the home network; Phase 5 makes it genuinely mobile.

**Phase 0 is numbered first but does not block Phase 1.** Phase 0 needs hardware;
Phases 1 and 2 run entirely against the devcontainer's Postgres
([ADR-008](adr/ADR-008-devcontainer-dev-database.md)) on any machine. Phase 0
*does* block Phase 3 onward from being meaningfully testable — a forecast nobody
can open on a phone cannot be judged.

### Phase 0 — Infrastructure

> **Blocked: no always-on machine yet (2026-09-21).** Development continues on a
> laptop. Until this phase is done, ADR-001's premise is unmet — there is a
> design on paper and no host for it. Not urgent this week; it becomes the
> critical path the moment Phase 3 starts.

- Mac: disable sleep; enable *Start up automatically after a power failure*.
- `brew install postgresql@17`; create `homemgmt`; `pgcrypto` + `citext`.
- LaunchDaemon in `/Library/LaunchDaemons` (`RunAtLoad`, `KeepAlive`,
  `listen_addresses = 'localhost'`) — **not** `brew services`
  ([ADR-002](adr/ADR-002-postgres-native-on-macos.md)).
- Tailscale on the Mac and both phones; MagicDNS on; **key expiry disabled on
  the Mac node**.
- `backup-homemgmt.sh`: nightly `pg_dump -Fc` to iCloud Drive, 30 rotating
  copies, scheduled via launchd `StartCalendarInterval`.
- **Restore drill** — restore a dump into a scratch database and count rows.

*Done when:* the Mac survives a reboot with Postgres up and no login, and a dump
has been restored successfully once.

### Phase 1 — Schema and projection engine

- Migrations for every table, constraints, indexes (partial unique on
  `occurrence`, see [ADR-007](adr/ADR-007-tombstones-for-sync.md)).
- Seed: 4 members, category tree, the real commitments (swimming, two school
  fees, vehicle and health insurance).
- `project()`, `cashflow()`, `sinkingFund()` with unit tests.

*Test cases that must pass:* `INTERVAL=4` across a year boundary ·
`months = {6,10,2}` term billing · `BYMONTHDAY=31` in a 30-day month (clamp,
don't skip) · `commitment_amount` effective-date resolution · weight
normalisation for 3 swimmers · regeneration leaving overridden rows untouched.

*Done when:* the engine reproduces a hand-calculated 18-month forecast for the
real commitment set.

### Phase 2 — API

- NestJS + a Postgres client; repository layer that centralises
  `deleted_at IS NULL`.
- Auth: two users, argon2id, bearer tokens.
- CRUD for commitments, allocations, occurrences, income, goals.
- Regeneration endpoint + nightly horizon-roll job.
- Serve the Angular build as static files from the same process.

*Done when:* the seeded forecast is reachable over Tailscale from a phone
browser.

### Phase 3 — App shell and commitments

- Angular workspace, signals-based state, routing, layout.
- Commitment list and editor — the recurrence editor is the hard UI here: three
  kinds, a month picker for `MONTHS`, an interval picker for `RRULE`.
- Member and category management.
- Allocation editor.

### Phase 4 — Forecast views

The payoff screens:

- **Month view** — what's due, running total, per-member breakdown.
- **Calendar** — occurrences on a month grid.
- **Cashflow chart** — 18 months, two income lines (confirmed vs all), opening
  balance carried forward, spikes visible.
- **Sinking fund** — per commitment and household total.
- **Goals** — progress, and required monthly contribution competing with the
  reserve.

*Done when:* the March-type cluster is visible at a glance and the app says what
to set aside monthly.

### Phase 5 — Offline

- `ngsw-config.json`: prefetch the shell **and** all routes; no `dataGroups` on
  the API.
- Dexie schema mirroring synced tables; outbox table.
- Repository swap: UI reads IndexedDB, never the network directly.
- Sync service: push outbox → pull deltas → apply tombstones.
- Pending-sync indicator in the UI.
- Install to home screen on both phones.

*Done when:* **the drill passes** — Mac off, app force-quit, airplane mode on,
app opens and shows data; edits made offline appear on the other phone after the
Mac returns ([ADR-006](adr/ADR-006-offline-first-service-worker-and-outbox.md)).

### Phase 6 — Income and goals completion

- Income sources, monthly expectation entry, roll-forward-from-last-month.
- Confidence-split cashflow lines.
- Balance snapshot entry.
- Goal tracking.

### Phase 7 — Hardening

- Second restore drill, from the scheduled backups this time.
- Tombstone purge job (180 days).
- Deploy script: build, restart, verify.
- A week of real use before declaring v1.

### Later — ledger phase

`account`, `transaction`, `transaction_allocation`, `reserve_account`,
`attachment`. `occurrence.settled_on` / `settled_amount` are replaced by a link
to a transaction; both columns drop cleanly. Decide then whether one occurrence
can be settled by several transactions — part payments are common with school
fees, which argues for a join table.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Mac off during a power cut | App unreachable; no sync | Auto-restart after power failure; UPS if cuts are frequent |
| macOS update reboots the Mac | Services down until restart | LaunchDaemons, not `brew services` |
| Tailscale key expires on the Mac | Phones lose access silently | Disable key expiry on that node |
| Missed `deleted_at` filter | Deleted data reappears | Centralise in the repository layer |
| Partial unique index forgotten | Regeneration fails on soft-deleted dates | Called out in Phase 1; covered by a test |
| Unsynced edits lost with a phone | Days of entry gone | Pending-sync badge; sync opportunistically |
| Disk failure | Total loss | Off-machine nightly dumps + a proven restore |
| Scope creep into bookkeeping | v1 never ships | Non-goals in §3 are binding |

## 9. Open decisions

1. **Per-occurrence allocation override** — a daughter skipping one swimming
   term. Currently the split lives only on the commitment. Default: no for v1.
2. **Escalation rules** — auto-apply "fees rise ~8% each June" beyond the last
   known amount. Useful for long horizons, but invents numbers nobody committed
   to. Default: no.
3. **Shared vs personal goals** — `goal.member_id` is nullable, so a goal is
   household or one person's. Joint subsets need a join table. Default: no.
4. **Household-general bucket** — whether a commitment with no allocation rows
   is acceptable, or every expense must be attributed to someone.

Each can be added without restructuring what exists.

## 10. Definition of done for v1

- Every real household commitment is entered as a rule.
- The 18-month forecast matches a hand check.
- Both phones have the app installed, working offline, syncing reliably.
- One monthly sinking-fund number is visible on the home screen.
- A backup has been restored successfully at least once.
- The household has used it for a full month without falling back to a
  spreadsheet.
