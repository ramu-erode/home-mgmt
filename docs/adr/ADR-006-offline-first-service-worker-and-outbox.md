# ADR-006: Offline-first — service worker shell + IndexedDB outbox

- **Status:** Accepted — amended 2026-09-21 by ADR-009 (sync protocol) and the Phase 3 local-first sequencing
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/offline-first-pwa-sync.md`

## Context

The server is a Mac at home that will sometimes be off, rebooting or unreachable
(ADR-001). The app must still open and be usable on a phone in that window, and
edits made then must reach the database later.

This repo adopts the cross-project guideline above. Its five required pieces and
the reasoning behind the non-obvious ones are there; this ADR records what they
mean here.

## Decision

An installed PWA with two independent offline mechanisms.

**Shell** — `@angular/service-worker`, cache-first. In `ngsw-config.json`:
`index.html`, bundles, CSS, icons and fonts in an `assetGroup` with
`installMode: "prefetch"`. Routes are **eagerly loaded** in this app rather than
lazy, so nothing can be missing offline. No `dataGroups` on `/api/*`.

**Data** — Dexie over IndexedDB as the read model, plus an outbox of pending
mutations. The UI never calls the network directly.

**Sync** — specified in ADR-009: a server `version` cursor, last-write-wins
on `client_updated_at` for human-authored tables, commands (not upserts) for
occurrences, which only the server creates, and protocol versioning.

**Sequencing.** The UI is local-first **from Phase 3**: Dexie and the
repository service are the only data source from the first screen, with a
minimal online sync. Phase 5 adds only what is genuinely offline — service
worker prefetch, outbox retry, pending and last-synced indicators, stale-cursor
reset, install, and the drill. A "repository swap" late in the plan would have
rewritten every screen.

## Consequences

- **UUID primary keys are now load-bearing**, not a style choice: a phone must
  be able to create a row offline with its final identity. This constrains the
  Phase 1 migrations and cannot be retrofitted cheaply.
- **Deletes require tombstones** — ADR-007. Without them offline devices
  silently diverge.
- **The app must be installed to the home screen**, not used in a Safari tab.
  Safari evicts IndexedDB for sites not visited recently; installed web apps are
  exempt. For an app holding unsynced writes this is a data-loss issue.
- **The UI must show pending sync state, rejections and last-synced time.**
  Unsynced edits live only on the phone; if the Mac is off for a week and the
  phone is lost, that week is gone. With FileVault on (ADR-015) "the Mac is
  down" persists until someone unlocks it, so it must be visible.
- Phase 5 is not complete until the drill in the source note passes on a real
  device — Mac off, app force-quit, airplane mode, app opens and shows data.
