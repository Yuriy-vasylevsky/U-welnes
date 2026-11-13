# U-Wellness Space

Mini App: https://uwelnes.site · Telegram: https://t.me/u_welnes_bot.

Next.js App Router / React / TypeScript / Tailwind CSS, FastAPI, aiogram 3 та
PostgreSQL. Бронювання шезлонга на цілий день за датою. Онлайн-оплата,
тарифи, ліміти й правила скасування ще не визначені.

## Що працює

- `/start`: «Забронювати», «Мої бронювання», «Інформація».
- «Забронювати» відкриває `/book`: дата, карта, вибір місця, підтвердження.
- 387 клікабельних шезлонгів; зайняті місця недоступні для вибору.
- Бронювання зберігаються в PostgreSQL і відображаються власнику в Mini App
  та боті. Обмеження БД захищає від подвійного бронювання місця на одну дату.
- Особа підтверджується серверною перевіркою Telegram `initData`.
- SVG залишається окремим asset без зміни геометрії. Інтерактивність — це
  додатковий шар точних контурів із вихідної карти.
- У звичайному браузері доступні карта й перегляд доступності; збереження
  бронювання потребує відкриття через Telegram.

## Локальне встановлення

Node.js 22+ і Python 3.12+. Перевірено на Windows із Node.js 24 / Python 3.13
і на сервері з Python 3.12. У PowerShell використовуйте `npm.cmd`, якщо
виконання `npm.ps1` заблоковано політикою Windows.

```powershell
npm.cmd ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e "apps/api[test]"
npm.cmd run dev
```

Браузер: http://localhost:3000. Без API карта відкривається; сторінка
бронювання повідомляє, що доступність не визначена.

API, в окремому терміналі:

```powershell
.\.venv\Scripts\python.exe -m wellness.serve
```

`GET /health` працює без БД. Для бронювання задайте `DATABASE_URL` із
`.env.example`, наприклад `postgresql+psycopg://user:password@localhost:5432/uwelnes`.
Початкова таблиця створюється під час запуску API. Локальний Next.js
автоматично передає `/api/*` на `http://127.0.0.1:8000`; у production це робить
Caddy. Ізольовані тести запускаються без PostgreSQL.

Бот, лише якщо серверний процес зупинений:

```powershell
.\.venv\Scripts\python.exe -m wellness.bot
```

Потрібні `BOT_TOKEN`, `WEBAPP_URL` і для перегляду бронювань `DATABASE_URL`.
Для реального Telegram запуску Mini App URL має бути публічним HTTPS.
Не запускайте локальний і серверний polling одночасно з одним токеном.

Секрети задаються змінними середовища або локальним ігнорованим `.env`.
У git є тільки `.env.example`; не додавайте справжні конфігурації й токени.

## Перевірки

```powershell
python scripts/check_map.py
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q -p no:cacheprovider
npm.cmd run build
npm.cmd run typecheck
npx.cmd playwright install chromium
npm.cmd run test:web -- --workers=2
```

Python-тести перевіряють авторизацію, ізоляцію власників, конкурентність,
повторні запити, дати, збереження даних та кнопки бота. Браузерні тести
перевіряють desktop/mobile; запити створення бронювань у них підмінені.
`deploy/verify-postgres.py` додатково перевіряє реальну PostgreSQL у тимчасовій
БД без тестових записів у production.

Для браузерної перевірки production:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://uwelnes.site"
npm.cmd run test:web -- --workers=2
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

## Production і архітектура

- `apps/web`: статична production-збірка Next.js, SDK Telegram, карта, `/book`.
- `apps/api/wellness`: FastAPI, підпис Telegram, транзакції PostgreSQL, бот.
- `deploy`: Compose для web/БД, systemd для API/бота, щоденні резервні копії.
- `assets/maps/pool-map.svg`: авторитетний SVG; public copy побайтово ідентична.
- Каталоги місць генерує `scripts/extract_seats.py`; стабільні ID не можна
  перенумеровувати після створення бронювань без плану міграції.

Код розробляється локально; зміни не публікуються автоматично. Серверний бот
та Mini App працюють незалежно від вашого комп’ютера. Версії npm зафіксовано
в `package-lock.json`, Python — у `apps/api/requirements.lock.txt`.

Деталі: [бронювання й PostgreSQL](docs/bookings.md),
[web hosting](docs/web-hosting.md), [bot hosting](docs/bot-hosting.md),
[перевірка карти](docs/map-inspection.md).
