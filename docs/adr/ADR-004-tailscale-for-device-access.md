# ADR-004: Tailscale for device access

- **Status:** Accepted — amended 2026-09-21 by ADR-014 (localhost bind, key expiry, identity) and ADR-015 (`tailscaled`)
- **Date:** 2026-09-21
- **Source note:** `/knowledge/guidelines/tailscale-for-self-hosted-services.md`

## Context

The Mac sits behind an ISP router on a private IP; a phone on mobile data has no
route to it. The app is useless if it only works on home wifi.

This repo adopts the cross-project guideline above rather than deciding afresh.
Port forwarding, public tunnels and hand-rolled WireGuard are rejected there.

## Decision

Tailscale on the Mac and every phone, free Personal plan. The API is reachable
only from inside the tailnet; no router port is opened.

- **MagicDNS** for hostnames rather than `100.x` addresses.
- **`tailscale serve --bg 3000`** for a valid HTTPS certificate inside the
  tailnet. This is a hard requirement, not a convenience: the PWA needs a secure
  context for service workers, which is what ADR-006 depends on. `serve`
  publishes on **443** — the URL is `https://mac-mini.<tailnet>.ts.net`, no port.
- **NestJS binds `127.0.0.1`**, so `serve` is the only way in (ADR-014).
- On the Mac, the open-source **`tailscaled`** as a system daemon, not the GUI
  app — it must run with no user logged in (ADR-015).
- One shared household Tailscale account on all nodes (ADR-014).

## Consequences

- Every device using the app must be a tailnet member. One-time setup per phone;
  there is no "send someone a link", and this app has no guests.
- **Key expiry is disabled on every node.** An expired server key drops the Mac
  off the tailnet silently — it looks fine locally while both phones lose
  access. With one shared account, re-authenticating a phone would mean typing
  that account's credentials into it, so phones are exempted too (ADR-014).
- Sign-up must use a public-domain address (Gmail/Apple). A custom domain is
  classified as business use and enrolled in a trial instead.
- Tailscale is a third party in the connection path, though not the data path.
- **This rules out serverless hosting for anything that touches the database** —
  see ADR-005.
