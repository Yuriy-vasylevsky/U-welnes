import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("daily reservation, occupied seats and confirmation", async ({
  page,
}, info) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'test-signed-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
  let saved: object[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/pool/availability")) {
      await route.fulfill({
        json: {
          today: "2026-01-01",
          reserved: ["S002"],
          ...pricing,
          map_version: catalog.source_sha256,
          enabled: Object.fromEntries(
            catalog.seats.map((seat) => [seat.id, true]),
          ),
        },
      });
    } else if (request.method() === "POST") {
      expect(request.headers().authorization).toBe("tma test-signed-data");
      const body = request.postDataJSON();
      expect(body.seat_ids.slice().sort()).toEqual(["S001", "S003"]);
      expect(body.user_id).toBeUndefined();
      saved = body.seat_ids.map((seat_id: string) => ({
        id: body.request_id + "-" + seat_id,
        seat_id,
        day: body.day,
        visit_time: "Цілий день · 08:00–21:00",
        price_uah: 900,
        created_at: new Date().toISOString(),
      }));
      await route.fulfill({
        status: 201,
        json: { bookings: saved, request_id: body.request_id },
      });
    } else {
      await route.fulfill({ json: { bookings: saved } });
    }
  });
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Вільно 386 із 387")).toBeVisible();
  await expect(page.locator("[data-seat]")).toHaveCount(387);
  const taken = page.getByRole("button", {
    name: "Шезлонг S002 — зайнято",
    exact: true,
  });
  await expect(taken).toHaveAttribute("aria-disabled", "true");
  const seat = page.getByRole("button", { name: "Шезлонг S001", exact: true });
  await seat.click();
  await expect(seat).toHaveAttribute("aria-pressed", "true");
  const third = page.getByRole("button", { name: "Шезлонг S003", exact: true });
  await third.click();
  await expect(third).toHaveAttribute("aria-pressed", "true");
  await seat.click();
  await expect(seat).toHaveAttribute("aria-pressed", "false");
  await seat.click();
  await expect(page.locator('[data-seat="S001"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-booking.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Підтвердити бронювання" }).click();
  await expect(page.getByRole("status")).toContainText("Бронювання збережено");
  await expect(page.getByRole("status")).toContainText("Кількість місць: 2");
  const result = page.getByRole("dialog", {
    name: "Бронювання збережено",
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(result).toContainText("08:00–21:00");
  await expect(result).toContainText(/1\s?800 грн/);
  const close = result.getByRole("button", { name: "Повернутися до карти" });
  await expect(close).toBeFocused();
  await page.screenshot({
    path: `test-results/${info.project.name}-booking-result.png`,
  });
  await close.click();
  await expect(result).not.toBeVisible();
  await expect(page.getByLabel("Дата відвідування")).toBeFocused();
  await expect(page.locator(".my-bookings")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Шезлонг S001 — зайнято", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("browser preview cannot submit reservations and conflicts are explained", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.route("**/api/v1/pool/availability?**", (route) =>
    route.fulfill({
      json: {
        today: "2026-01-01",
        reserved: [],
        ...pricing,
        map_version: catalog.source_sha256,
        enabled: Object.fromEntries(
          catalog.seats.map((seat) => [seat.id, true]),
        ),
      },
    }),
  );
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".seat-overlay")).toBeVisible();
  await page
    .getByRole("button", { name: "Збільшити карту", exact: true })
    .click();
  await page
    .locator('[data-seat="S003"][role="button"][aria-disabled="false"]')
    .click();
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Перегляд карти доступний у браузері.", { exact: false }),
  ).toBeVisible();
});

test("a seat taken during confirmation returns a usable conflict", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'test-signed-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().url().includes("/availability"))
      await route.fulfill({
        json: {
          today: "2026-01-01",
          reserved: [],
          ...pricing,
          map_version: catalog.source_sha256,
          enabled: Object.fromEntries(
            catalog.seats.map((seat) => [seat.id, true]),
          ),
        },
      });
    else if (route.request().method() === "POST")
      await route.fulfill({
        status: 409,
        json: { detail: "seat_unavailable" },
      });
    else await route.fulfill({ json: { bookings: [] } });
  });
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page
        .locator(".pool-map")
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    )
    .toBe(true);
  await page
    .locator('[data-seat="S004"][role="button"][aria-disabled="false"]')
    .click();

  await page.getByRole("button", { name: "Підтвердити бронювання" }).click();
  await expect(page.locator(".booking-error")).toContainText(
    "вже заброньоване",
  );
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Прибрати шезлонг S004", exact: true })
    .click();
  await page
    .locator('[data-seat="S005"][role="button"][aria-disabled="false"]')
    .click();
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeEnabled();
});
