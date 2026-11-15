# Mini App on uwelnes.site

Published 13 November 2026: https://uwelnes.site.

Booking routes `/` and `/book` use a fixed viewport with a compact date toolbar
and bottom confirmation dock. One finger pans the map, two fingers pinch;
ordinary mouse-wheel movement zooms. Taps toggle seats immediately without
automatic zoom or pan. The selection summary reserves a stable height so
choosing places does not resize the map. Reset shows the
whole map without clearing selection. Zoom and reset buttons remain visible; directional arrows are omitted.
The counter uses only administrator-enabled seats as its denominator. Telegram vertical swipes are disabled while this
screen is active and restored on leaving it.

The embedded admin map keeps page scrolling: one finger scrolls the page,
two fingers operate the map. Desktop users can drag or zoom with Ctrl + wheel.
Neither map treats dragging as seat selection. SVG geometry is unchanged.

Page zoom is locked at scale 1 through viewport settings, touch-action and
native gesture guards. Ctrl+wheel outside the map and page zoom shortcuts are
suppressed. The interactive map retains its independent zoom/pan controls.
Mobile form fields use at least 16px text to avoid focus-triggered page zoom.

The current frontend needs no server-side rendering or API requests. A Next.js
static export is built locally and served by `uwelnes-web-1` (`caddy:2-alpine`),
with a 96 MiB memory limit and automatic restart. No new host ports are exposed.
The existing edge Caddy proxies only the `uwelnes.site` hostname to
`uwelnes-web:8080` on Docker network `telegram-lead-hunter_default`.

The edge Caddy obtains and renews the Let's Encrypt certificate. Its existing
sites remain in `/opt/parsbot/Caddyfile`; do not replace that file with the
U-Wellness snippet. The pre-deployment backup is
`/opt/uwelnes/backups/edge-Caddyfile-20261113T143653Z`.

## Server paths

- Static releases: `/opt/uwelnes/releases/web-<UTC timestamp>/web`.
- Current release symlink: `/opt/uwelnes/web`.
- Compose: `/opt/uwelnes/deploy/compose.web.yml`.
- Static Caddy configuration: `/opt/uwelnes/deploy/Caddyfile.web`.
- Edge configuration addition: `deploy/Caddyfile.edge-snippet` in this repo.
- Bot: independent `uwelnes-bot.service`; see `bot-hosting.md`.

## Local development and build

Local development remains `npm.cmd run dev`. No tunnel is needed to use the
published site. Editing local source does not automatically update production.

Build a new static release from the repository root in PowerShell:

```powershell
$env:UWELNES_STATIC_EXPORT="1"
npm.cmd run build
Remove-Item Env:UWELNES_STATIC_EXPORT
```

Publish the contents of `apps/web/out` to a **new** release directory on the
server. Do not upload `.env`, `node_modules`, `.next` or the Python virtual
environment. Preserve older releases for rollback. Point `/opt/uwelnes/web` at
the new release's `web` directory, then recreate the static container so its
bind mount resolves the updated symlink:

```bash
docker compose -f /opt/uwelnes/deploy/compose.web.yml up -d --force-recreate web
```

For rollback, point the symlink back to a verified previous release and run the
same command. An ordinary frontend update does not require editing or reloading
the shared edge Caddy configuration, nor restarting the bot.

## Verify and manage

```bash
docker compose -f /opt/uwelnes/deploy/compose.web.yml ps
docker compose -f /opt/uwelnes/deploy/compose.web.yml logs --tail 30 web
curl -I https://uwelnes.site
curl -fsS https://uwelnes.site/maps/pool-map.svg | sha256sum
systemctl is-active uwelnes-bot
```

Browser regression against production from PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://uwelnes.site"
npm.cmd run test:web
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

Validation at deployment: valid HTTPS certificate, HTTP 200, healthy static
container, active bot, all 8 desktop/mobile browser tests passed against the
public URL. The SVG is byte-identical to the supplied `basseinmap-1.svg`:
`62e40b3c6cabc3cb9a6527a87723bc643a51298ea21e98ceba12edf11fe859e3`.

The bot's Web App menu already points to `https://uwelnes.site`. In Telegram,
send `/start` to `@u_welnes_bot` and use the newly generated button. Actual
Telegram-client interaction still requires the user's device check; browser
tests use an SDK mock and are not a real Telegram launch test.

The booking milestone subsequently added `/book`, the API service and a
dedicated PostgreSQL database. See [bookings.md](bookings.md) for current
routes, service management and backups. Payments remain unimplemented.
