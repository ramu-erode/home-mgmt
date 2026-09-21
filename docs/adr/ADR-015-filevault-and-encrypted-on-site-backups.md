# ADR-015: FileVault on; encrypted backups to an attached USB drive

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/self-host-vs-managed-backend.md`
- **Amends:** ADR-001 (availability claim, off-machine backups), ADR-002 (host setup)

## Context

ADR-001 assumed the Mac recovers from a power cut unattended and that nightly
dumps go off-machine, to iCloud Drive per the plan. On macOS three things
contradict that:

- With **FileVault on**, a cold boot stops at the pre-boot unlock screen; no
  LaunchDaemon runs until someone types a password. `fdesetup authrestart`
  covers planned restarts only.
- **iCloud Drive** syncs only inside a logged-in session, and a root
  LaunchDaemon writing there is blocked by TCC.
- The Tailscale GUI apps run inside a user session; the variant that runs at
  boot is the open-source `tailscaled`.

The household chose to keep FileVault on and not to use iCloud for backups.
On an Apple Silicon Mac the SSD is soldered and, with FileVault, bound to the
board's Secure Enclave — so a board failure takes every on-disk copy with it.

## Decision

**Host**

- FileVault **on**. After a power cut someone unlocks the Mac; on Apple
  Silicon the unlock also logs that user in. A UPS rides out short cuts.
- Every service is a LaunchDaemon — Postgres, NestJS, `tailscaled`
  (`brew install tailscale; sudo tailscaled install-system-daemon`), backup.
  macOS update restarts auto-unlock but return to the login window, so nothing
  may depend on a session.
- Firmware / recovery lock set; strong admin password.

**Backups**

- Nightly LaunchDaemon: `pg_dump -Fc | age -r <public key>` to an **external
  USB drive** (30 copies) and to `/Library/Backups/homemgmt/` (a few days, for
  fast undo after a bad migration).
- The script **fails loudly if the drive is not mounted**. An unmounted
  `/Volumes/<name>` is an empty directory on the internal disk; writing into it
  "succeeds" and silently puts the backup back on the database's disk.
- Only the `age` **public** key is on the Mac. The private key lives in the
  password manager plus a printed copy; the restore drill must use it.
- Each run writes a timestamp; `GET /api/health` reports the last write **to
  the drive**, and the app shows a banner when it is older than 3 days.
- No iCloud, no cloud account.

## Consequences

- ADR-001's ~99% becomes **~99% excluding the time between a power cut and a
  manual unlock**. Phones keep working offline meanwhile; nothing is lost,
  nothing syncs. The app shows "last synced N hours ago" so the state is
  noticed.
- "Off-machine" backups become **off-disk, on-site**. Disk and board failure
  are covered. **Theft and fire are an accepted risk** — the drive sits beside
  the Mac. A second drive rotated off-site monthly would close it and can be
  added without changing anything else.
- Phase 0's done-criterion becomes: after unlock, all services answer from a
  phone with no further interaction; and a backup has been restored from the
  USB drive using the off-Mac private key.
