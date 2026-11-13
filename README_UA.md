# U-Wellness Space — Codex handoff

Цей пакет призначений для передачі в Codex як стартові матеріали.

## Файли
- `assets/maps/pool-map.svg`
- `assets/references/pool-map-preview.png`
- `assets/maps/source-pool-plan.dxf`
- `assets/maps/source-pool-plan.dwg`
- `assets/references/previous-miniapp-prototype.html`

- `CODEX_TASK.md` — повне технічне завдання для Codex.

## Як почати
1. Розпакуй архів у нову папку проєкту.
2. Відкрий цю папку в Codex.
3. Попроси Codex спочатку прочитати `CODEX_TASK.md` та перевірити SVG/DXF.
4. Далі нехай створить monorepo з Next.js, FastAPI та aiogram 3.

## Важливо
Telegram-бот не показує SVG безпосередньо в чаті. Бот надсилає кнопку `Відкрити басейн`, яка відкриває Telegram Mini App. Саме вебапка завантажує SVG-карту.

Для реального запуску Mini App у Telegram потрібна публічна HTTPS-адреса. На етапі розробки сайт можна відкривати звичайним браузером.
