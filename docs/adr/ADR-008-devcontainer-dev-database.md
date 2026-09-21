# ADR-008: Development runs in a devcontainer with its own Postgres

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

ADR-002 places Postgres natively on the always-on Mac, and explicitly rejects
Docker for that role. Development, however, happens on a different machine (a
laptop) inside a devcontainer that already bind-mounts the shared Claude home
and knowledge vault.

That leaves the development database undecided, and the two obvious readings of
ADR-002 point opposite ways. Recorded here because it looks like a contradiction
of ADR-002 and is not.

## Decision

The devcontainer runs its **own** Postgres 17 service in
`.devcontainer/docker-compose.yml`, on a named volume, seeded with `pgcrypto`
and `citext` by `initdb/`.

The container does **not** connect to the production database on the always-on
Mac.

ADR-002 governs where the *household's real data* lives, where the cost of being
wrong is a lost multi-year record. A dev database is disposable by design; the
same reasoning does not reach it. This is the distinction the LaunchDaemon
guideline already draws — daemons for what must survive, conveniences for what
may be lost.

Connecting dev to the production database was rejected outright: it puts test
rows in the household's real record with nothing but care preventing it.

## Consequences

- **Same major version as production (17).** The postgres client in the image is
  pinned to 17 for the same reason — Debian bookworm ships client 15, and
  `pg_dump` refuses to run against a newer server. That failure would otherwise
  appear the first time a backup or restore is attempted.
- Dev data is disposable. Anything needed repeatedly belongs in seed scripts
  under version control, not in the volume.
- Schema changes are exercised against a container and deployed against a native
  install. The gap is version-pinned but not zero — migrations run on the Mac
  are the real test.
- **`workspaceFolder` must be `/home-mgmt`**, with the compose mount target
  matching. The default `/workspace` collides with every other container's
  Claude memory key. See `/knowledge/deployment/shared-claude-home-mounts.md`;
  `.devcontainer/verify-mounts.sh` checks it on create.
