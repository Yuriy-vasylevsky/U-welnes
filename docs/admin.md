# Seat numbering administration

Published at `https://uwelnes.site/admin`. Access is granted only to Telegram
IDs in `ADMIN_TELEGRAM_IDS` (JSON array in the protected server environment).
The initial authorized administrator is `752963390`, as supplied by the user.
Administrator `397274113` was subsequently added; both IDs retain access.
Without a valid Telegram signature and allowlisted ID, API reads/writes are
rejected; hiding the UI is not the access-control mechanism.

## Use

1. In `@u_welnes_bot`, send `/admin`, then press «Відкрити адмінпанель».
   The administrator also gets an «Адмінпанель» button after `/start`.
2. Tap a seat directly on the map. There is no dropdown seat picker.
3. Enter a unique number from 1 to 9999 and press «Зберегти номер».
4. Zoom the map to read the number labels. Pan/zoom still work.

## Open and close places for booking

All seats default to **closed**. Closed seats are grey on the overview, booking
map and admin map. Administrators can still select a grey seat and press
«Відкрити для бронювання»; active seats can be closed with the same switch.
This is a global setting for new daily reservations, independent of the
selected date. Existing reservations are never cancelled by closing a seat.

The API rejects new bookings for closed seats, including requests from stale
clients. Booking creation and availability updates lock the same seat row to
serialize concurrent changes. Exact retries of a previously saved booking
remain safe after closure. Activation changes are audited with the admin ID
and timestamp. Clearing display numbers does not change availability.

API: `PUT /api/v1/admin/seats/{seat_id}/availability`, with
`{"enabled":true,"expected_enabled":false}`. The expected state prevents
overwriting another administrator's change. Catalog/availability responses
include an `enabled` mapping; clients fail closed when it is absent.

`deploy/migrate-seat-availability.py` adds `enabled BOOLEAN NOT NULL DEFAULT
FALSE` to existing seats and creates the availability audit table. The first
deployment closes all seats for new reservations as requested. Rerunning the
migration or restarting services does not reset later administrator choices.
Production numbering and booking IDs are checked before and after migration.

«Очистити всі номери» opens a confirmation panel. Only after
«Підтвердити очищення» is pressed are display numbers cleared. Seat shapes,
stable IDs and all reservations are preserved. Cleared seats can be numbered
again; until then accessible map labels use stable IDs for identification.
The map does not display stable IDs as number labels for cleared seats.

This action is admin-only, transactional and audited. Retrying an already
empty map changes nothing. Restarting does not restore default numbers.
Deployment of this button does not itself clear any production numbers.

Initial display numbers are 1–387; source IDs `S001`–`S387` are unchanged.
A number already used by another seat is rejected. To rearrange occupied
numbers, first use an unused temporary number; the UI does not silently swap
or overwrite another seat's number.

## Persistence and safety

- Additive tables: `pool_seats` (stable ID and unique display number),
  `pool_seat_number_audit` (admin, seat, old/new numbers, UTC time).
- Existing `pool_bookings` rows and their IDs are untouched. Booking references
  remain stable; lists and confirmations resolve the current display number.
- Initial numbers are seeded only if the numbering table is empty, in one
  transaction. Restarting never resets edited numbers. Catalog changes require
  an explicit migration.
- Update requests carry `expected_number`; a stale editor gets HTTP 409 and
  refreshes its current value rather than overwriting another administrator.
- Unique numbering and audit insertion are committed atomically. A duplicate
  number rolls back the complete edit.
- SVG source and public copy remain byte-identical. Number text and exact
  hit areas are separate SVG overlays. No coordinates, geometry or sunbed
  positions are edited by this feature.

## API

- `GET /api/v1/admin/seats`: admin-only numbering map and SVG version hash.
- `PUT /api/v1/admin/seats/{stable_id}`:
  `{ "number": 500, "expected_number": 1 }`.
- `POST /api/v1/admin/seats/clear-numbers` requires
  `{ "confirmation": "CLEAR_ALL_NUMBERS" }`. After clearing, `expected_number`
  for renumbering a seat is `null`.
- `GET /api/v1/pool/seats` and availability expose display numbers publicly.
- Personal booking responses now also include `seat_number`.

Authentication uses the same server-validated raw Telegram initData as booking.
Admin command and button use inline Web App launch, not reply-keyboard launch.
Admin IDs are configured on the server, never accepted from client input.

For a new administrator, edit `/etc/uwelnes/bot.env` through SSH, preserve its
root-only permissions, then restart both `uwelnes-api` and `uwelnes-bot`.
Example configuration (no token): `ADMIN_TELEGRAM_IDS=[752963390]`.

## Verification

21 Python tests and 20 desktop/mobile browser tests passed. Tests cover denied
access, unique numbers, invalid input, stale edits, retained booking ownership
and IDs, audit records, number persistence and client display. Browser tests
mock admin mutations and do not alter production numbering. The real PostgreSQL
verification runs in a temporary database and checks renaming while retaining
the reservation and after reopening the store.

A database backup was taken before schema deployment and again afterward.
The migration adds tables and does not rewrite existing bookings. Daily backups
continue via `uwelnes-bookings-backup.timer`.

For the clear-number feature, `deploy/migrate-nullable-numbers.py` makes the
number and audit before/after fields nullable. It does not change existing
values. A backup and production number/booking-ID preservation checks precede
publication. Updated tests: 23 Python tests; 24 applicable browser tests passed
(two device-inapplicable checks skipped).
# Групова доступність

Натискайте кілька місць на карті, потім «Відкрити вибрані» або «Закрити вибрані». Повторне натискання знімає вибір; «Зняти вибір» очищує його повністю. Редагування номера доступне для одного вибраного місця. Геометрія карти й наявні бронювання зберігаються.

`PUT /api/v1/admin/seats/availability/batch` приймає `enabled` і словник `expected_enabled` для вибраних ID. Зміни виконуються однією транзакцією з перевіркою поточного стану та аудитом кожного зміненого місця. При конфлікті повертається 409 без часткового збереження.

# Меню адміністратора

`/admin` у Mini App — окреме меню з двома розділами:
«Карта й місця» (`/admin/seats`) та «Редагування цін» (`/admin/prices`).
У кожному розділі є повернення до меню. Доступ перевіряється через підписані
Telegram initData та список адміністраторів у конфігурації.

Ціни редагуються окремо для кожного дня тижня й періоду, у цілих гривнях
від 0 до 1 000 000. Кнопка «Зберегти» записує лише свій тариф. Якщо ціну
встиг змінити інший адміністратор, форма показує актуальне значення й просить
перевірити зміну ще раз. Старі бронювання не переоцінюються.

