# Testing before there is an always-on Mac

Phase 0 has no hardware yet, but the development machine is itself a Mac, so it
can stand in for the server long enough to try everything — including the
Phase 5 drill on real phones.

Nothing here is production. The devcontainer's database is disposable
([ADR-008](adr/ADR-008-devcontainer-dev-database.md)), so use the synthetic
household, not real numbers.

## 1. Dev mode — clicking around while changing code

No service worker in this mode.

```bash
npm run start:api     # API on :3000; materialises occurrences on startup
npm run start:web     # app on :4200, /api proxied to :3000
```

Open <http://localhost:4200> on the Mac. VS Code forwards both ports; its
**Ports** panel shows them if a page does not load.

## 2. Production-like — the service worker, offline, updates

The real build: one process serving the app and the API.

```bash
npx nx run-many -t build -p api web
node dist/apps/api/main.js          # http://localhost:3000
```

`localhost` is a secure context, so the service worker registers.

- **Offline:** DevTools → Application → Service workers, wait for *activated*.
  Stop the server, reload: the app opens with its data. Edit something — the
  badge reads *Offline · N unsynced*. Start the server; it syncs.
- **Update prompt:** leave the app open, rebuild the web app, then navigate
  inside the app. The "new version is ready" banner appears; Reload swaps it.

## 3. On the phones over Tailscale — the Phase 5 drill

The laptop plays the part of the always-on Mac. *(Written from the design, not
run in the devcontainer — it needs Tailscale on the host.)*

1. Tailscale on the laptop and both phones, all on the **one household
   account** ([ADR-014](adr/ADR-014-tailnet-identity-no-app-login.md)). The
   ordinary app is fine here; the headless `tailscaled` is only required on the
   always-on Mac ([ADR-015](adr/ADR-015-filevault-and-encrypted-on-site-backups.md)).
2. Tailscale admin → DNS: **MagicDNS** and **HTTPS Certificates** on.
3. In the container, run the production build with the identity guard on:
   ```bash
   TAILSCALE_ALLOWED_LOGIN=you@example.com node dist/apps/api/main.js
   ```
4. In a **Mac** terminal (not the container): `tailscale serve --bg 3000`. It
   prints `https://<laptop>.<tailnet>.ts.net` — the address the phones use. It
   forwards to port 3000 on the Mac, which exists only while VS Code is
   forwarding it, so leave VS Code open.
5. On each phone: open that address in Safari → **Share → Add to Home Screen**,
   then open it from the icon and set the phone up.
6. **The drill** ([ADR-006](adr/ADR-006-offline-first-service-worker-and-outbox.md)):
   stop the server, force-quit the app, turn on airplane mode, open the app — it
   must load and show data. Edit something; turn airplane mode off, restart the
   server, foreground the app: the edit syncs and appears on the other phone.
7. Afterwards: `tailscale serve reset` on the Mac.

**The phones must be reinstalled when the real Mac arrives.** An installed PWA
and its IndexedDB belong to the address they were installed from, so nothing
from this test carries over: remove the test app from both phones and install
again from the Mac's address.

## Resetting the dev data

Back to the synthetic household, from nothing:

```bash
psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && npm run db:migrate && npm run db:seed
```

Restart the API afterwards — the daily jobs materialise the occurrences on
startup. (Verified on a scratch database, 2026-09-22.)
