# ADR-017: Build in the devcontainer, ship an artifact, dump before migrating

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/build-in-devcontainer-ship-artifact.md` (decision-ref stub)
- **Amends:** ADR-005 (deploy)

## Context

ADR-005 said "build + service restart"; the plan's Phase 7 said "build,
restart, verify". Neither said where the build runs, how migrations run, or how
to back out. On this system a bad migration writes to the only live copy of the
household record.

## Decision

1. **Build in the devcontainer** — `nx build api web --configuration=production`.
   There are no native dependencies (ADR-014 removed argon2; `pg` is pure JS),
   so linux-arm64 output runs unchanged on macOS arm64. The Mac holds no source,
   git or toolchain.
2. **Ship over Tailscale SSH** to `/opt/homemgmt/releases/<git-sha>/`; run
   `npm ci --omit=dev` there. The Mac runs the Node pinned by `NODE_VERSION` in
   the Dockerfile.
3. **Dump, then migrate, as separate steps.** An on-demand encrypted dump to the
   USB drive (ADR-015) precedes migrations. A failed migration stops the
   release with the old code still running on an untouched schema.
4. **Switch** the `current` symlink; `launchctl kickstart -k system/<label>`.
5. **Verify** — `GET /api/health` must return the new git SHA, migration
   version and database reachability within 30 s, or the script flips the
   symlink back and restarts.
6. Keep the last five releases.

The script refuses a release that adds a migration **and** drops a column
(ADR-009, expand-then-contract).

## Consequences

- **Code rollback is a symlink flip**, safe because the previous release still
  runs on the expanded schema. **Schema rollback is a manual restore** of the
  pre-deploy dump — deliberate, never automatic.
- Phones pick up the release on next contact; the app shows "Update ready —
  reload" rather than swapping mid-edit. Stragglers are handled by protocol
  versioning (ADR-009).
- The deploy script is Phase 2 work (first deploy to the Mac), hardened in
  Phase 7 — not Phase 0.
