# home-mgmt — documentation

- **[PROJECT-PLAN.md](PROJECT-PLAN.md)** — problem, architecture, phased
  delivery, risks, definition of done.
- **[adr/](adr/)** — architecture decision records. The index with one-line
  summaries is the ADR table in the repo `CLAUDE.md`.

## Where reasoning lives

Per the vault convention, `/knowledge` holds the reasoning and the rejected
alternatives; an ADR here states the verdict in repo-local terms and cites its
source note. Do not restate a note's alternatives in an ADR, and do not copy ADR
body text into the vault.

| ADR | Source note |
|---|---|
| 001 | `/knowledge/decisions/self-host-vs-managed-backend.md` |
| 002 | `/knowledge/decisions/postgres-over-sqlite-for-money.md` |
| 003 | `/knowledge/decisions/recurrence-rule-vs-materialised-occurrences.md` |
| 004 | `/knowledge/guidelines/tailscale-for-self-hosted-services.md` |
| 005 | `/knowledge/decisions/single-origin-over-cdn-hosting.md` |
| 006, 007 | `/knowledge/guidelines/offline-first-pwa-sync.md` |
| 008 | `/knowledge/decisions/devcontainer-dev-database.md` (decision-ref stub) |

Also binding, without a corresponding ADR:

- `/knowledge/guidelines/launchdaemon-not-brew-services.md` — host services
- `/knowledge/deployment/shared-claude-home-mounts.md` — devcontainer mounts and
  `workspaceFolder`

## The three decisions that shape everything else

1. **Rule, not rows.** A commitment stores a recurrence; occurrences are
   generated from it, and regeneration never touches an overridden or settled
   one. (ADR-003)
2. **The Mac is the whole backend.** Postgres, API and static bundle on one
   machine, reachable only inside the tailnet. (ADR-001, 004, 005)
3. **The phone works without the Mac.** Cache-first shell, local IndexedDB,
   outbox of pending mutations, tombstones so deletes propagate. (ADR-006, 007)
