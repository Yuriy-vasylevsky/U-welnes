import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("clear numbers requires confirmation and permits numbering again", async ({
  page,
}) => {
  await telegram(page);
  let numbers: Record<string, number | null> = Object.fromEntries(
    catalog.seats.map((seat, i) => [seat.id, i + 1]),
  );
  let clears = 0;
  await page.route("**/api/v1/admin/**", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        confirmation: "CLEAR_ALL_NUMBERS",
      });
      clears++;
      numbers = Object.fromEntries(
        catalog.seats.map((seat) => [seat.id, null]),
      );
      await route.fulfill({ json: { cleared: 387, numbers } });
    } else if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toEqual({
        number: 1,
        expected_number: null,
      });
      numbers.S001 = 1;
      await route.fulfill({ json: { seat_id: "S001", number: 1 } });
    } else
      await route.fulfill({
        json: {
          numbers,
          ...pricing, map_version: catalog.source_sha256,
          enabled: Object.fromEntries(
            catalog.seats.map((seat) => [seat.id, true]),
          ),
        },
      });
  });
  await page.goto("/admin/seats", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Очистити всі номери", exact: true })
    .click();
  expect(clears).toBe(0);
  await page.getByRole("button", { name: "Скасувати", exact: true }).click();
  expect(clears).toBe(0);
  await expect(page.locator(".seat-number")).toHaveCount(387);
  await page
    .getByRole("button", { name: "Очистити всі номери", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Підтвердити очищення", exact: true })
    .click();
  await expect(page.locator(".booking-success")).toContainText(
    "Номери очищено: 387",
  );
  expect(clears).toBe(1);
  await expect(page.locator(".seat-number")).toHaveCount(0);
  await expect(page.locator("[data-seat]")).toHaveCount(387);
  await page.getByRole("button", { name: "Шезлонг S001", exact: true }).click();
  await expect(page.getByLabel("Новий номер")).toHaveValue("");
  await page.getByLabel("Новий номер").fill("1");
  await page
    .getByRole("button", { name: "Зберегти номер", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Шезлонг 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".seat-number")).toHaveCount(1);
});

async function telegram(page: import("@playwright/test").Page) {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'admin-test-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
}

test("admin renumbers the clicked seat and booking uses the same internal ID", async ({
  page,
}, info) => {
  await telegram(page);
  const numbers = Object.fromEntries(
    catalog.seats.map((seat, i) => [seat.id, i + 1]),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      expect(request.headers().authorization).toBe("tma admin-test-data");
      expect(request.url()).toContain("/admin/seats/S001");
      expect(request.postDataJSON()).toEqual({
        number: 500,
        expected_number: 1,
      });
      numbers.S001 = 500;
      await route.fulfill({ json: { seat_id: "S001", number: 500 } });
    } else if (request.url().includes("/bookings/mine"))
      await route.fulfill({ json: { bookings: [] } });
    else
      await route.fulfill({
        json: {
          numbers,
          ...pricing, map_version: catalog.source_sha256,
          enabled: Object.fromEntries(
            catalog.seats.map((seat) => [seat.id, true]),
          ),
          reserved: [],
          today: "2026-01-01",
        },
      });
  });
  await page.goto("/admin/seats", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Шезлонг 1", exact: true }).click();
  await expect(page.getByLabel("Новий номер")).toHaveValue("1");
  await page.getByLabel("Новий номер").fill("500");
  await page
    .getByRole("button", { name: "Зберегти номер", exact: true })
    .click();
  await expect(page.locator(".booking-success")).toContainText("1 → 500");
  await expect(
    page.getByRole("button", { name: "Шезлонг 500", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".seat-number").filter({ hasText: /^500$/ }),
  ).toHaveCount(1);
  await page.screenshot({
    path: `test-results/${info.project.name}-admin.png`,
    fullPage: true,
  });
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Шезлонг 500", exact: true })
    .press("Enter");
  await expect(page.locator('[data-seat="S001"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".booking-confirm")).toContainText("500");
});

test("non-admin cannot see an editor", async ({ page }) => {
  await telegram(page);
  await page.route("**/api/v1/admin/**", (route) =>
    route.fulfill({ status: 403, json: { detail: "admin_required" } }),
  );
  await page.goto("/admin/seats", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".booking-error")).toContainText(
    "лише для адміністратора",
  );
  await expect(page.locator(".seat-overlay")).toHaveCount(0);
});

test("duplicate number error preserves the form for correction", async ({
  page,
}) => {
  await telegram(page);
  const numbers = Object.fromEntries(
    catalog.seats.map((seat, i) => [seat.id, i + 1]),
  );
  await page.route("**/api/v1/admin/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 409, json: { detail: "number_in_use" } })
      : route.fulfill({
          json: {
            numbers,
            ...pricing, map_version: catalog.source_sha256,
            enabled: Object.fromEntries(
              catalog.seats.map((seat) => [seat.id, true]),
            ),
          },
        }),
  );
  await page.goto("/admin/seats", { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-seat="S001"][role="button"][aria-disabled="false"]')
    .click();
  await page.getByLabel("Новий номер").fill("2");
  await page.getByRole("button", { name: "Зберегти номер" }).click();
  await expect(page.locator(".booking-error")).toContainText(
    "уже використовується",
  );
  await expect(page.getByLabel("Новий номер")).toHaveValue("2");
  await expect(
    page.getByRole("button", { name: "Зберегти номер" }),
  ).toBeEnabled();
});
