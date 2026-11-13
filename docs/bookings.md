# Daily seat booking — 13 November 2026

The user authorized booking after the initial infrastructure milestone, with a
whole-day reservation for a chosen date. Prices, limits, cancellations and
other commercial terms were deferred. This implementation does not collect
money, claim that admission is free, or add cancellation rules.

## User flow

- `/start` shows three inline buttons: «Забронювати», «Мої бронювання»,
  «Інформація».
- «Забронювати» and the bot's Web App menu open `https://uwelnes.site/book`.
- Choose a date, tap a free seat (or use the accessible select), confirm.
- The successful reservation appears in the Mini App and in the bot's
  «Мої бронювання». Dates before today in Europe/Kyiv are rejected.
- Occupied seats are marked red. Availability refreshes every 30 seconds;
  the database remains authoritative at confirmation.
- Browser preview can view availability but cannot create reservations or
  read a user's bookings without valid Telegram initData.

Inline Web App launch is intentional: reply-keyboard launches may not provide
initData. See [Telegram Mini Apps](https://core.telegram.org/bots/webapps) and
[aiogram WebApp data](https://docs.aiogram.dev/en/latest/utils/web_app.html).
Callback identity comes from `CallbackQuery.from_user`, not the bot-authored
message's sender.

## Map and IDs

`scripts/extract_seats.py` copies the exact 387 `.st48` paths under the SVG's
`shezlongs` group into separate JSON catalogs. It checks for inherited
transforms and never changes the source SVG. Frontend overlays the exact paths
in the original viewBox, aligned with the unchanged image. Dragging/pinching
does not count as selecting a seat.

IDs `S001`–`S387` are stable catalog IDs, not a claim about physical numbering
at the pool. Preserve their mapping when editing/replacing the map; existing
reservations refer to these IDs. Frontend checks the API's map hash before
allowing selection. Do not regenerate IDs after reordering SVG paths without
an explicit data-migration plan.

## API and storage

- `GET /api/v1/pool/availability?day=YYYY-MM-DD`: occupied IDs, map hash,
  server-local current date. No personal information.
- `GET /api/v1/bookings/mine`: current Telegram user's reservations.
- `POST /api/v1/bookings`: `{day, seat_id, request_id}`; the user ID is derived
  exclusively from signed Telegram data, never from request JSON.
- Protected requests use `Authorization: tma <raw initData>`, with a one-hour
  maximum age. Missing, forged, duplicate-field and stale signatures fail.
- API responses have `Cache-Control: no-store`.

PostgreSQL table `pool_bookings` stores UUID, Telegram user ID, date, seat ID
and UTC creation time. A database unique constraint on `(day, seat_id)`
prevents double booking across concurrent requests. Retrying an identical
request safely returns the existing booking; collisions return HTTP 409.
No payment/customer account models exist. Schema creation is additive for this
first table; future schema changes need versioned migrations.

## Hetzner deployment

- `uwelnes-db-1`: PostgreSQL 17, dedicated persistent Docker volume
  `uwelnes_booking-data`, port bound only to `127.0.0.1:55432`.
- `deploy/compose.booking.yml` combines with `deploy/compose.web.yml`.
- App role `uwelnes_app` has schema privileges and no superuser privileges.
- Root-only credentials: `/etc/uwelnes/postgres.env`,
  `/etc/uwelnes/bot.env`; never print or commit them.
- `uwelnes-api.service`: FastAPI on Docker bridge `172.18.0.1:8010`,
  not a public host interface. This bridge is the existing edge network's
  gateway; recheck the unit and edge routing if that network changes.
- Existing edge Caddy routes this domain's `/api/*` and `/health` to the API,
  and all frontend routes to the static web container.
- `uwelnes-bot.service`: independent polling process using the same database.
- Both Python services restart automatically. API is limited to 192 MiB;
  PostgreSQL to 160 MiB; the existing static web limit remains 96 MiB.

Manage on the server:

```bash
systemctl status uwelnes-bot uwelnes-api --no-pager
docker compose -f /opt/uwelnes/deploy/compose.web.yml -f /opt/uwelnes/deploy/compose.booking.yml ps
curl -fsS https://uwelnes.site/health
```

The `DATABASE_URL` setting is now active. For local tests, install the updated
API dependencies and run `python -m pytest apps/api/tests -q`. Local API runs
without a database retain `/health`; booking endpoints return 503 until a
database is configured. Do not run the local polling bot concurrently with
the hosted bot.

## Backups and verification

`uwelnes-bookings-backup.timer` runs daily at 03:20 UTC. Backups are written
with root-only permissions to `/opt/uwelnes/backups/postgres/*.dump` using
`pg_dump -Fc`. A first backup was created at deployment. These copies are on
the same VPS; off-server copies and retention policy remain a separate
operating task. Never remove the Docker volume when updating the service.

```bash
systemctl list-timers uwelnes-bookings-backup.timer
systemctl start uwelnes-bookings-backup.service
journalctl -u uwelnes-bookings-backup.service -n 10 --no-pager
```

Tests: 16 Python tests cover authentication, ownership, date/seat validation,
idempotency, conflicts, database persistence and bot callbacks. 14 browser
tests cover map navigation, actual seat clicks, confirmation, conflicts and
browser fallback; API mutation is mocked in browser tests. A separate test
against real PostgreSQL verified four concurrent requests yield one winner,
retry safety, ownership and persistence in a temporary database that is then
removed. No fake bookings are inserted into production by these tests.

Real user booking through a Telegram client still needs a device check.
