# ADR-005: Single origin — NestJS serves the Angular bundle

- **Status:** Accepted — amended 2026-09-21 by ADR-014 (URL) and ADR-017 (deploy)
- **Date:** 2026-09-21
- **Source note:** `/knowledge/decisions/single-origin-over-cdn-hosting.md`

## Context

Hosting the Angular app on Vercel while the database stays on the Mac was
considered, for git-push deploys and CDN availability.

It fails in two distinct ways, both recorded in the source note: putting the
**API** on Vercel is impossible because serverless cannot join a tailnet
(ADR-004), and putting only the **bundle** there buys nothing once the service
worker caches the shell (ADR-006).

## Decision

One origin. NestJS serves the built Angular bundle as static files alongside the
API, behind `tailscale serve`.

```
Phone (Tailscale) ──HTTPS :443──> mac-mini.<tailnet>.ts.net   (tailscale serve)
                                  └──> 127.0.0.1:3000  NestJS
                                       ├── /         Angular bundle (static)
                                       └── /api/*    API
```

No CDN, no reverse proxy — nginx or Caddy in front buys nothing at four users.

## Consequences

- No CORS, no cross-site cookie handling. Auth is the tailnet identity guard
  (ADR-014).
- One build artifact, one deploy target, one process to supervise.
- **The Mac must be online for exactly two events:** the first install on a new
  device, and picking up a new app version. Neither is time-critical.
- No git-push deploy. Build in the devcontainer, ship, dump, migrate, switch,
  verify — ADR-017. First used in Phase 2, hardened in Phase 7.

Revisit if devices are added frequently enough that first-install windows become
hard to find.
