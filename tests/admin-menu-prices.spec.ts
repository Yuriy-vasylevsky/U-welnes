import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";
import { pricing } from "./pricing-fixture";

test("admin menu opens the existing map and edits individual prices", async ({
  page,
}, info) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{initData:'admin-test',ready(){},expand(){},onEvent(){},offEvent(){}}};",
    }),
  );
  const tariffs = Array.from({ length: 7 }, (_, weekday) =>
    pricing.tariffs
      .filter((item) => weekday !== 5 || item.id !== "full")
      .map((item) => ({ ...item, weekday })),
  ).flat();
  let writes = 0;
  await page.route("**/api/v1/admin/**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("tma admin-test");
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      if (request.url().endsWith("/1/morning")) {
        await route.fulfill({
          status: 409,
          json: { detail: { code: "price_changed", price_uah: 700 } },
        });
        return;
      }
      expect(request.url()).toContain("/tariffs/0/full");
      expect(body).toEqual({ price_uah: 975, expected_price_uah: 900 });
      tariffs[0].price_uah = 975;
      writes++;
      await route.fulfill({ json: { weekday: 0, id: "full", price_uah: 975 } });
    } else if (request.url().endsWith("/tariffs"))
      await route.fulfill({ json: { tariffs } });
    else
      await route.fulfill({
        json: {
          numbers: { S001: 1 },
          enabled: {},
          map_version: catalog.source_sha256,
        },
      });
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Меню адміністратора" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Карта й місця/ }).click();
  await expect(page.locator(".map-panel")).toBeVisible();
  await page
    .getByRole("link", { name: "← Меню адміністратора", exact: true })
    .click();
  await page.getByRole("link", { name: /Редагування цін/ }).click();
  const monday = page.getByLabel("Понеділок: Повний день", { exact: true });
  await expect(monday).toHaveValue("900");
  await expect(page.locator(".tariff-edit")).toHaveCount(20);
  await expect(
    page.getByRole("region", { name: "Субота", exact: true }).locator("form"),
  ).toHaveCount(2);
  const form = page.locator("form").filter({ has: monday });
  await monday.fill("-10");
  await expect(
    form.getByRole("button", { name: "Зберегти", exact: true }),
  ).toBeDisabled();
  await monday.fill("975");
  await form.getByRole("button", { name: "Зберегти", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("975 грн");
  expect(writes).toBe(1);
  await page.reload();
  await expect(monday).toHaveValue("975");
  const tuesday = page.getByLabel("Вівторок: Ранок", { exact: true });
  await tuesday.fill("650");
  await page
    .locator("form")
    .filter({ has: tuesday })
    .getByRole("button", { name: "Зберегти", exact: true })
    .click();
  await expect(page.locator(".price-admin .booking-error")).toContainText("інший адміністратор");
  await expect(tuesday).toHaveValue("700");
  await expect(monday).toHaveValue("975");
  await page.screenshot({
    path: `test-results/${info.project.name}-admin-prices.png`,
  });
});

test("non-admin cannot use the menu or price editor", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{initData:'not-admin',ready(){},expand(){},onEvent(){},offEvent(){}}};",
    }),
  );
  await page.route("**/api/v1/admin/**", (route) =>
    route.fulfill({ status: 403, json: { detail: "admin_required" } }),
  );
  await page.goto("/admin");
  await expect(page.getByRole("status")).toContainText(
    "лише для адміністратора",
  );
  await expect(page.locator(".admin-menu-cards")).toHaveCount(0);
  await page.goto("/admin/prices");
  await expect(page.locator(".price-admin .booking-error")).toContainText(
    "лише для адміністратора",
  );
  await expect(page.locator("form")).toHaveCount(0);
});
