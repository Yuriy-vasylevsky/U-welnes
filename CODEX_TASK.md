# U-WELLNESS SPACE — Telegram Mini App + Python backend foundation

## Goal of this milestone
Create the initial working foundation of U-Wellness Space:
1. A Telegram bot that welcomes users and opens the Mini App.
2. A responsive Telegram Mini App with a premium navigation shell.
3. The pool map displayed inside the Mini App using the supplied SVG asset.
4. A Python backend foundation that can later host booking, availability, customer and payment logic.

This milestone is infrastructure and visual shell only. Do NOT implement actual reservations, payments, seat selection, customer accounts or database models yet.

## Required stack
- Frontend: Next.js App Router + React + TypeScript + Tailwind CSS.
- Backend: Python 3.12+ + FastAPI.
- Telegram bot: aiogram 3.
- Map: supplied SVG, kept as a standalone public asset.
- Use PostgreSQL only as a future integration point; do not require a running database for this milestone.

## Repository layout
Use a clean monorepo, for example:

/
  apps/
    web/                 # Next.js Telegram Mini App
    api/                 # FastAPI + aiogram bot
  assets/
    maps/pool-map.svg
    references/
  .env.example
  README.md

The supplied assets are in `assets/`. Copy the authoritative map to:
`apps/web/public/maps/pool-map.svg`

Do not replace the SVG with a screenshot, raster background, or recreated drawing.

## Telegram bot requirements
Implement an aiogram 3 bot with:
- `/start`: short welcome message and an inline button labelled "Відкрити басейн".
- The button must use Telegram Web App launch (`web_app=WebAppInfo(url=...)`) and open the Next.js app.
- `/help`: brief help text.
- Handle missing `BOT_TOKEN` gracefully with a clear startup error.
- Read configuration from environment variables, never hardcode tokens.
- Provide `.env.example` with `BOT_TOKEN`, `WEBAPP_URL`, `API_HOST`, `API_PORT`, and environment mode.
- In local development, allow polling mode.
- Keep production webhook setup as a clearly documented next step or configurable mode; do not expose an insecure webhook by default.

Important: the bot does not render the SVG itself. It launches the Mini App; the Mini App loads the SVG map.

## FastAPI requirements
Create a FastAPI application with:
- `GET /health` returning a simple health status.
- Versioned API prefix such as `/api/v1`.
- A modular router structure for future bookings, users and pool resources, but leave these routers as documented placeholders or empty routers.
- CORS configured through environment variables for the local Next.js origin.
- A clean configuration module using environment variables.
- A Telegram `initData` validation utility scaffold, with clear tests or documentation. Do not treat unvalidated client-supplied Telegram user data as trusted.
- No database dependency required at this stage.

## Mini App frontend requirements
Build a premium, responsive UI:
- Dark forest-green / emerald palette.
- Warm champagne-gold accents.
- Refined typography, restrained borders, subtle shadows.
- Premium minimal resort aesthetic, not a generic admin dashboard.
- Header with U-Wellness Space branding.
- Navigation items: "Басейн", "Послуги", "Контакти".
- On mobile, compact header and hamburger drawer.
- Default route opens the pool page.
- "Послуги" and "Контакти" are simple placeholder pages; do not invent business details.
- Telegram WebApp SDK integration point, safe-area support and viewport handling.
- The app must also work in an ordinary desktop/mobile browser without Telegram SDK (development fallback).

## Pool map requirements — highest priority
- Use `assets/maps/pool-map.svg` as the actual map asset.
- Keep it in `public/maps/pool-map.svg` and render it as SVG (`img`, `object`, or inline only if necessary for interaction).
- Preserve its viewBox, aspect ratio, geometry, path coordinates and sunbed locations.
- Do not trace, simplify, transform, distort or redraw the map.
- Do not add clickable reservation hotspots yet.
- Add pan and zoom suitable for mobile touch (pinch zoom) and desktop (wheel/buttons).
- Ensure the map fits the available screen and remains sharp at all zoom levels.
- Do not stretch it to fill a different aspect ratio.
- Inspect the SVG before integrating: confirm it renders correctly in a browser and check its actual viewBox and layer/path structure.
- If there are visual or SVG rendering defects, report them and isolate any repair into a separate copy; never silently alter the source geometry.

## Quality and deliverables
- Provide root README with exact local setup commands.
- Provide `.env.example` only; never create or commit a real `.env`.
- Add `.gitignore` for secrets, dependencies and build output.
- Add basic tests for FastAPI health endpoint and bot configuration/startup validation.
- Add a short architecture explanation.
- Ensure `npm run build` succeeds for the frontend.
- Ensure Python dependencies install and `GET /health` works.
- Provide commands to run frontend, API and bot locally.
- Explain that Telegram Web Apps require a publicly reachable HTTPS URL for real Telegram testing; local browser preview can run without it.
- Do not claim Telegram launch works until tested with a real bot token and HTTPS URL.

## Definition of done
A user can:
1. Start the Python API.
2. Start the aiogram bot in polling mode.
3. Send `/start` to the bot.
4. Press "Відкрити басейн".
5. Open the Mini App and see the supplied pool SVG with the premium navigation shell.
6. Open the same web app directly in a normal browser for development.

Before coding, inspect all supplied assets and report the SVG dimensions/viewBox and any issues. Then implement the smallest clean working foundation. Do not add booking features in this milestone.
