# Home Mgmt — Project Plan

**Version:** 1.1 · **Date:** 2026-09-21 · **Owner:** Ramu

A household income, expense and planning app for a family of four, self-hosted
on an always-on Mac, usable offline from two phones.

> **1.1** — design review. Server-authoritative sync, a single `flow` model for
> income and expense, big.js money, civil-date strings, tailnet-only auth,
> FileVault with encrypted USB backups, Kysely, a deploy script, local-first UI
> from Phase 3. ADR-009 to ADR-017; ADR-001 to ADR-007 amended.

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

- Record every recurring flow — expense or income — as a rule, at any cadence
  we actually use.
- Project 18 months of due dates and amounts from those rules.
- Show a month-by-month cashflow against irregular expected income.
- Compute the monthly sinking-fund reserve that flattens the lumpy months —
  both what to set aside **this month** and the **steady state**.
- Attribute expenses to household members, or to the household as a whole.
- Work offline on a phone, sync when the Mac is reachable.
- Two devices, shared data, no cloud account, no app login.

## 3. Non-goals — v1

- Transaction-level bookkeeping, bank import, receipt capture (ledger phase).
- Double-entry accounting. Wildly oversized for a household.
- Multi-currency, multi-household, sharing outside the family.
- Tax reporting or investment tracking.
- Escalation rules that invent future amounts (§9).

## 4. Architecture

```
  Phone (PWA, installed)            Phone (PWA, installed)
  ├── service worker: app shell     ├── service worker: app shell
  ├── IndexedDB read model + outbox ├── IndexedDB read model + outbox
  └── libs/core (preview only)      └── libs/core (preview only)
            │                                  │
            └──── Tailscale (one account) ─────┘
                            │ HTTPS :443
                  https://mac-mini.<tailnet>.ts.net   (tailscale serve)
                  ┌─────────────────────────────┐
                  │ NestJS on 127.0.0.1:3000    │
                  │  ├── /        Angular build │
                  │  └── /api/*   REST + sync   │
                  │      libs/core materialises │
                  ├─────────────────────────────┤
                  │ Postgres 17 (localhost)     │
                  └─────────────────────────────┘
                   FileVault on · all LaunchDaemons
                            │
                  nightly pg_dump | age → attached USB drive
```

Decisions behind this shape: [ADR-001](adr/ADR-001-self-host-on-always-on-mac.md),
[ADR-002](adr/ADR-002-postgres-native-on-macos.md),
[ADR-004](adr/ADR-004-tailscale-for-device-access.md),
[ADR-005](adr/ADR-005-single-origin-no-cdn.md),
[ADR-014](adr/ADR-014-tailnet-identity-no-app-login.md),
[ADR-015](adr/ADR-015-filevault-and-encrypted-on-site-backups.md).

**Stack:** Angular (signals-based) PWA · NestJS · Kysely on `pg` · Postgres 17 ·
Dexie · big.js (engine only) · Tailscale (`tailscaled`) · launchd · `age`.

**Layout:** Nx monorepo, mirroring `onedoc`.

```
apps/api      NestJS — REST, sync endpoints, static host for the web build
              src/db/  the only code that touches Kysely (ADR-016)
apps/web      Angular PWA
libs/core     projection engine — pure TypeScript, no I/O, no framework, no JS Date
libs/shared   DTOs and branded types (Money, CivilDate); no dependencies
```

`libs/core` is a library rather than a folder so the "no I/O, no framework"
rule is enforced by its dependency graph instead of by discipline. That is the
whole reason for the monorepo at this size.

**Value types** ([ADR-012](adr/ADR-012-money-decimal-strings-and-bigjs.md),
[ADR-013](adr/ADR-013-civil-dates-and-interval-recurrence.md)): money is a
two-decimal string at every boundary and big.js inside `libs/core`; a day is a
`'YYYY-MM-DD'` string everywhere. "Today" is the household's (`Asia/Kolkata`),
passed into the engine, never read from a clock.

## 5. Data model

The schema of record is the SQL migrations in `apps/api/src/db/migrations/`
([ADR-016](adr/ADR-016-kysely-and-sql-migrations.md)). Summary:

| Table | Role |
|---|---|
| `member` | People flows are attributed to (incl. non-users) |
| `device` | An installed app; linked to a member; audit only ([ADR-014](adr/ADR-014-tailnet-identity-no-app-login.md)) |
| `category` | Two-level hierarchy for roll-ups; income sources live here |
| `flow` | The recurrence **rule**; `direction` OUT or IN ([ADR-010](adr/ADR-010-flow-model-income-and-expense.md)) |
| `flow_amount` | Scheduled amount changes (fee hikes, renewals) |
| `flow_allocation` | Member split, by weight; zero rows = household |
| `occurrence` | Materialised instances, **server-created only** — what every screen reads |
| `balance_snapshot` | Anchor for the projection; carries `reserved_amount` |
| `goal` | Plans: a car, a trip, an emergency fund; `saved_amount`, `priority` |

Dropped in 1.1: `app_user` (→ `device`), `income_source` (→ `category`),
`expected_income` (→ IN flows).

Every synced table carries `deleted_at` ([ADR-007](adr/ADR-007-tombstones-for-sync.md)),
`version`, `client_updated_at`, `updated_at` and `updated_by_device`
([ADR-009](adr/ADR-009-server-authoritative-sync-protocol.md)).

**Allocation.** Per-person fees are per-person flows — three swimming flows,
two school flows. Weights are for bills genuinely shared by one invoice. No
allocation rows means household-general, chosen explicitly.

### The projection engine

Pure TypeScript, framework-free, no I/O:

```ts
project(flows, from, to, today)                     → Occurrence[]
sinkingFund(occurrences, today, reserved)           → { byMonth, perOccurrence, steadyState }
cashflow(occurrences, snapshot, goals, today)       → MonthPosition[]
```

This is the intellectual core and the most testable part of the system. The
server runs it to materialise occurrences; phones run the same code to preview
flows not yet synced ([ADR-009](adr/ADR-009-server-authoritative-sync-protocol.md)).

**Reserve** — per occurrence over its accrual window, catch-up and steady
state, drawn down from `reserved_amount`. **Goals** — funded from monthly
surplus in priority order after the reserve; bills always come first
([ADR-011](adr/ADR-011-reserve-and-goals-accounting.md)).

## 6. Sync protocol

Full specification in [ADR-009](adr/ADR-009-server-authoritative-sync-protocol.md).

```
GET  /api/sync?since=<version>  → { cursor, changes: { <table>: Row[] } } | { resetRequired }
POST /api/sync                  → { operations } → { applied, rejected: { id, reason }[] }
X-Protocol-Version: <n>         (server accepts n and n-1; older → 426)
```

- Cursor is a server `version` from a sequence, commit-ordered by an advisory
  lock. No clock is involved.
- Human-authored tables: whole-row upsert, last-write-wins on
  `client_updated_at`.
- `occurrence`: commands only — `confirm`, `settle`, `skip`, `unskip`,
  `override`, `note` — applied to the server's current row.
- Rows include tombstones. A cursor older than the purge watermark gets
  `resetRequired`; the client pushes its outbox first, then re-pulls.
- Every rejection is shown to the user.

## 7. Phases

Sequenced so something useful exists early. Phases 1–4 deliver a working
forecast; Phase 5 makes it survive the Mac being gone.

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
  **FileVault on**; firmware/recovery lock; UPS
  ([ADR-015](adr/ADR-015-filevault-and-encrypted-on-site-backups.md)).
- `brew install postgresql@17`; create `homemgmt`; `pgcrypto` + `citext`.
- LaunchDaemon in `/Library/LaunchDaemons` (`RunAtLoad`, `KeepAlive`,
  `listen_addresses = 'localhost'`) — **not** `brew services`
  ([ADR-002](adr/ADR-002-postgres-native-on-macos.md)).
- Node pinned to the Dockerfile's `NODE_VERSION`, for the NestJS daemon.
- Tailscale: **`tailscaled` system daemon** on the Mac, not the GUI app; the
  app on both phones; one household account; MagicDNS on; **key expiry disabled
  on every node**; `tailscale serve --bg 3000`.
- `backup-homemgmt.sh` (LaunchDaemon, `StartCalendarInterval`):
  `pg_dump -Fc | age -r <pubkey>` to the USB drive (30 copies) and
  `/Library/Backups/homemgmt/` (a few days). **Fail loudly if the drive is not
  mounted.** Write a freshness timestamp.
- `age` private key in the password manager plus a printed copy — never on the
  Mac.
- **Restore drill** — restore a dump from the USB drive into a scratch
  database, using the off-Mac private key, and count rows.

*Done when:* after a reboot and FileVault unlock, Postgres, NestJS and Tailscale
answer from a phone with no further interaction; and a dump from the USB drive
has been restored once.

### Phase 1 — Schema and projection engine

> **Done 2026-09-21.** Engine, migration, seed and tests merged (PR #2). The
> golden expectations were hand-calculated independently of the engine and
> reviewed by the owner.

- Kysely + `pg`; `setTypeParser` for `numeric` and `date`; SQL migrations for
  every table, constraints, indexes (partial unique on `occurrence`, see
  [ADR-007](adr/ADR-007-tombstones-for-sync.md)); `version` trigger;
  `kysely-codegen` types.
- Seed: **synthetic** — four members, a category tree, and flows with the same
  shape as the real set (three per-person swimming flows, two per-child school
  flows on `{6,10,2}` plus one on `{6,11,1}`, an `interval=4`, annual
  insurance, a `day_of_month=31`, a contracting `ONE_OFF` IN flow, a shared
  family-floater policy with weights, a goal). Real data never enters git.
- `project()`, `cashflow()`, `sinkingFund()` with unit tests.

*Test cases that must pass:* `interval=4` across a year boundary ·
`months = {6,10,2}` term billing · `day_of_month=31` in a 30-day month (clamp,
don't skip) · `flow_amount` effective-date resolution · largest-remainder split
of a shared bill over three weights · accrual windows on uneven terms
`{6,11,1}` · catch-up converging to steady state · reserve drawn down from
`reserved_amount` · goals funded after the reserve, in priority order ·
regeneration leaving confirmed, settled, skipped and overridden rows untouched ·
a tombstoned occurrence not blocking regeneration of its date.

*Done when:* the engine reproduces a hand-calculated 18-month forecast for the
synthetic set — the hand calculation committed as a golden fixture
(`synthetic-household.json` in, `synthetic-household.expected.json` out; the
seed reads the same fixture, so seeded data and tested forecast cannot drift).

### Phase 2 — API

> **Built 2026-09-21 except the deploy.** Everything below except the last
> bullet is in and tested against the devcontainer database: sync push and pull,
> regeneration, forecast, health, the tailnet guard and static hosting. The
> first deploy and the done-criterion both need the Mac, so they wait on
> Phase 0 — the deploy script is deliberately not written until there is a Mac
> to run it against, since an untested deploy script is worse than none.

- Repository base in `apps/api/src/db/`: `deleted_at IS NULL`, advisory lock,
  `client_updated_at` / `updated_by_device`, tombstoning. Lint confines Kysely
  to it.
- Auth: tailnet identity guard on `Tailscale-User-Login`; NestJS on
  `127.0.0.1` ([ADR-014](adr/ADR-014-tailnet-identity-no-app-login.md)).
- **Writes go through the sync protocol only** — `POST /api/sync` upserts and
  deletes for members, categories, flows, amounts, allocations, goals,
  snapshots and devices, plus occurrence commands; `GET /api/sync` pulls deltas
  ([ADR-009](adr/ADR-009-server-authoritative-sync-protocol.md)). *Changed in
  build:* the plan listed per-table REST CRUD, but the UI is local-first from
  Phase 3 and never calls it, and a second write path would have to enforce the
  ADR-003 invariant twice.
- `GET /api/forecast`: the engine's cashflow and sinking fund, computed on the
  server.
- Server-side regeneration inside the flow-edit transaction; horizon roll
  whenever the household date changes (on boot, checked hourly).
- `GET /api/health`: git SHA, migration version, database, last backup to the
  drive.
- Serve the Angular build as static files from the same process.
- First deploy to the Mac with the ADR-017 script.

*Done when:* the seeded forecast is reachable over Tailscale from a phone
browser.

### Phase 3 — App shell, local-first data, flows

> **Built 2026-09-21 except the last bullet.** Local-first data layer, sync,
> device setup, flow list and editor, members, categories. Driven end to end in
> headless Chromium at phone size against the production build and the dev API:
> a flow created on the "phone" materialised on the server with month-end
> clamping. Entering the real household flows is the owner's step, once the Mac
> exists — until then there is nowhere durable to put them.

- Angular workspace, signals-based state, routing (eager), layout.
- **Dexie schema and repository service — the UI's only data source from the
  first screen.** Minimal sync: full pull on start, outbox pushed immediately
  while online, protocol `X-Protocol-Version` from day one.
- First-launch "whose phone is this?" → `device`.
- Flow list and editor — the recurrence editor is the hard UI here: three kinds,
  a month picker for `MONTHS`, freq/interval/day for `INTERVAL`; OUT or IN;
  "duplicate for another member".
- Member and category management.
- Allocation editor, with an explicit "Household — no split" choice.
- Real household flows entered through the app.

### Phase 4 — Forecast views

> **Built 2026-09-21.** Home (the one number), month view with calendar and
> per-member split, cashflow, reserve, goals. The engine runs on the phone over
> the local read model; flows with unsynced changes are previewed with the same
> `project` + `reconcile` the Mac runs. *Added in build:* confirm / paid / skip /
> change / note on each occurrence in the month view — the commands existed
> from Phase 2 with no screen to issue them. The done-criterion is met on the
> synthetic household: November and June stand out at ₹80,999, and the home
> screen leads with what to set aside this month. Judging it on a phone waits
> for the Mac.

The payoff screens:

- **Month view** — what's due, running total, per-member breakdown plus a
  Household row.
- **Calendar** — occurrences on a month grid.
- **Cashflow chart** — 18 months; income confirmed vs all; after-goals line;
  opening balance carried forward; spikes visible.
- **Sinking fund** — this month and steady state, per occurrence and household
  total.
- **Goals** — progress, required monthly contribution, underfunded months and
  target-date slip.

*Done when:* the March-type cluster is visible at a glance and the app says what
to set aside this month.

### Phase 5 — Offline

> **Built 2026-09-22; the real-device drill waits for the Mac.** Service worker
> (prefetch everything, API never cached, `/api/**` excluded from navigation),
> manifest and icons, persistent-storage request, install card, update banner,
> 426 → look for the new bundle, sync on foreground/online with backoff. The
> drill was run in headless Chromium against the production build — Mac
> stopped, page closed, browser offline: the app reopened from cache with the
> same figures, deep links worked, an offline edit showed as unsynced, reached
> the Mac on reconnect and appeared on a second phone. An update deployed under
> a running app raised the banner and swapped cleanly. **The done-criterion is
> the drill on a real phone**, installed to the home screen (Safari's eviction
> and iOS standalone behaviour cannot be emulated) — that stays open.
>
> The initial-bundle warning budget is 600 kB, not the default 500 kB: every
> route is eager by design (ADR-006), and the phone downloads it once — 152 kB
> gzipped — before the service worker serves it from cache.

- `ngsw-config.json`: prefetch the shell **and** all routes; no `dataGroups` on
  the API.
- Outbox retry with backoff; rejections surfaced with reasons.
- Pending-sync badge; "last synced N hours ago".
- Stale-cursor `resetRequired` handling; `426` → activate update, reload, push.
- "Update ready — reload" prompt.
- Install to home screen on both phones.

*Done when:* **the drill passes** — Mac off, app force-quit, airplane mode on,
app opens and shows data; edits made offline appear on the other phone after the
Mac returns ([ADR-006](adr/ADR-006-offline-first-service-worker-and-outbox.md)).

### Phase 6 — Income and goals completion

> **Built 2026-09-22.** Balance entry with the three-way split shown as you
> type (and a split that does not add up refused, with the reason), snapshot
> history; goals — add, edit, add to saved, reorder priority, remove; a quick
> add for an expected contracting payment (a one-off income flow, defaulting to
> a "Contracting" category). Confidence-split cashflow lines already shipped in
> Phase 4. Checked in the browser against the server: the extra ₹10,000 set
> aside lowered "this month" by exactly ₹10,000.

- IN flows in the editor; quick-add for an expected contracting payment.
- Confidence-split cashflow lines (confirmed vs all).
- Balance snapshot entry with the three-way split (reserved, goals, free).
- Goal tracking.

### Phase 7 — Hardening

> **Purge built 2026-09-22.** The tombstone purge runs with the daily jobs,
> keeps tombstones that surviving rows reference, and raises the watermark;
> tested against its own database. The rest of this phase is about the Mac —
> deploy script, backup script and LaunchDaemons are written against the real
> machine, not before it.

- Second restore drill, from the scheduled backups this time.
- Tombstone purge job (180 days) with `min_retained_version`.
- Deploy script hardened: expand/contract check, automatic rollback on failed
  health check ([ADR-017](adr/ADR-017-build-ship-migrate-rollback.md)).
- Backup-freshness banner verified by unplugging the drive.
- A week of real use before declaring v1.

### Later — ledger phase

`account`, `transaction`, `transaction_allocation`, `reserve_account`,
`attachment`. `occurrence.settled_on` / `settled_amount` are replaced by a link
to a transaction; both columns drop cleanly. `balance_snapshot.reserved_amount`
gives way to `reserve_account`. Decide then whether one occurrence can be
settled by several transactions — part payments are common with school fees,
which argues for a join table.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Power cut | FileVault unlock screen; app unreachable, no sync until someone unlocks | UPS for short cuts; phones work offline; "last synced" visible |
| macOS update reboots the Mac | Returns to login window | Every service a LaunchDaemon; `tailscaled`, not the GUI app |
| Tailscale key expires | Phones lose access silently | Key expiry disabled on every node |
| Lost phone | Enrolled node keeps tailnet access | Remove the node in the Tailscale admin console |
| Missed `deleted_at` filter | Deleted data reappears | Centralise in the repository layer; lint confines Kysely to it |
| Partial unique index forgotten | Regeneration fails on soft-deleted dates | Called out in Phase 1; covered by a test |
| Sync cursor race | Rows silently never delivered | `version` cursor + advisory lock (ADR-009) |
| Phone on an old bundle | Outbox ops in an old shape | Protocol versioning, n-1 accepted, expand/contract migrations |
| Unsynced edits lost with a phone | Days of entry gone | Pending-sync badge; sync opportunistically |
| Board or SSD failure | Database and on-disk dumps gone together | Encrypted dumps to an attached USB drive + a proven restore |
| Backup drive unplugged or full | Backups silently stop | Script fails loudly; freshness banner in the app |
| Theft or fire | Mac and drive lost together | **Accepted.** Close later with a second drive rotated off-site |
| Real data committed to git | Permanent in history | Synthetic seeds and fixtures; `*.local.*` ignored |
| Scope creep into bookkeeping | v1 never ships | Non-goals in §3 are binding |

## 9. Open decisions — resolved in 1.1

1. **Per-occurrence allocation override** — **closed, not needed.** Per-person
   fees are per-person flows; skipping a term is `skip` on that person's
   occurrence ([ADR-010](adr/ADR-010-flow-model-income-and-expense.md)).
2. **Escalation rules** — **no.** A forecast that invents numbers is harder to
   trust than one that stops at what is known.
3. **Shared vs personal goals** — **as defaulted:** nullable `goal.member_id`,
   no joint subsets.
4. **Household-general bucket** — **yes:** zero allocation rows, chosen
   explicitly in the editor.

Each can be revisited without restructuring what exists.

## 10. Definition of done for v1

- Every real household flow is entered as a rule.
- The 18-month forecast matches a hand check — once, against the real database
  on the Mac, recorded as an acceptance step.
- Both phones have the app installed, working offline, syncing reliably.
- The monthly sinking-fund number (this month and steady state) is visible on
  the home screen.
- A backup has been restored successfully at least once, using the off-Mac key.
- The household has used it for a full month without falling back to a
  spreadsheet.
