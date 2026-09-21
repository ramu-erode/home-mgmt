# ADR-014: The tailnet is the perimeter — no app login, device identity for audit

- **Status:** Accepted
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/tailscale-for-self-hosted-services.md`
- **Amends:** ADR-004 (key expiry, URL), project plan Phase 2 auth

## Context

The plan specified two users with argon2id passwords and bearer tokens. Every
request already passes Tailscale authentication before reaching the Mac, and an
offline PWA makes app-level auth awkward: tokens expire while the phone is
offline, and the app must still open with no valid session.

The household will use **one shared Tailscale account** on both phones, so
Tailscale's identity headers cannot distinguish the two adults. The only use
left for per-user identity is audit.

Separately, NestJS listened on `0.0.0.0:3000` by default. `tailscale serve`
publishes HTTPS on 443 and forwards to localhost; with the default bind, plain
HTTP on `100.x.y.z:3000` was also reachable from the tailnet, bypassing `serve`,
its headers and the secure context the service worker needs.

## Decision

- **NestJS binds `127.0.0.1`** (`HOST` env, default `127.0.0.1`). The app URL is
  `https://mac-mini.<tailnet>.ts.net` — no port.
- **No app login.** A guard rejects any request whose `Tailscale-User-Login`
  is not the household account. No argon2id, tokens, login screen or refresh.
- **Device identity replaces `app_user`.** On first launch an install mints a
  `device_id` (UUID, stored in Dexie) and asks once "whose phone is this?",
  linking a `member`. Every outbox operation carries it; rows store
  `updated_by_device` (ADR-009).
- **Key expiry is disabled on every node** — the Mac and both phones. With one
  shared account, re-authenticating a phone means entering that account's
  credentials on it.
- The app opens and works with no server contact; the guard protects sync, not
  local data. Local data is protected by the phone's lock screen.

## Consequences

- `app_user` is dropped from the schema; `device` is added.
- **Revocation is per node**: a lost phone is removed in the Tailscale admin
  console. Changing the account password does not cut off an enrolled device.
- A device added to the tailnet under the household account is fully trusted.
  That is the intended perimeter (ADR-004: no guests).
- Identity headers are not set for tagged nodes; phones are user-owned, so this
  does not arise.
