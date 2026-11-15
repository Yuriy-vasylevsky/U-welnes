import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";
import { pricing } from "./pricing-fixture";

test("a changed price needs a second confirmation with the new total", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) => route.fulfill({ contentType: "application/javascript", body: "window.Telegram={WebApp:{initData:'test',ready(){},expand(){},onEvent(){},offEvent(){}}};" }));
  let attempts = 0;
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); attempts++;
      if (attempts === 1) {
        expect(body.expected_price_uah).toBe(900);
        await route.fulfill({ status: 409, json: { detail: { code: "price_changed", price_uah: 1000 } } });
      } else {
        expect(body.expected_price_uah).toBe(1000);
        await route.fulfill({ json: { bookings: [{ id: "saved", seat_id: "S001", day: body.day, price_uah: 1000, visit_time: "08:00–21:00" }] } });
      }
    } else await route.fulfill({ json: { ...pricing, reserved: [], enabled: { S001: true }, numbers: { S001: 1 }, today: "2026-01-01", map_version: catalog.source_sha256 } });
  });
  await page.goto("/book");
  await page.locator('[data-seat="S001"][aria-disabled="false"]').press("Enter");
  const confirm = page.getByRole("button", { name: "Підтвердити бронювання" });
  await confirm.click();
  await expect(page.locator(".booking-error")).toContainText("оновив ціну");
  await expect(page.locator(".booking-total")).toContainText(/1\s?000 грн/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await confirm.click();
  await expect(page.getByRole("dialog")).toContainText(/1\s?000 грн/);
  expect(attempts).toBe(2);
});

test("period prices, totals, age confirmation and Saturday choices", async ({
  page,
}, info) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Telegram={WebApp:{initData:'test',ready(){},expand(){},onEvent(){},offEvent(){}}};",
    }),
  );
  let submitted = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.period).toBe("morning");
      expect(body.adult_confirmed).toBe(false);
      expect(body.price_uah).toBeUndefined();
      expect(body.seat_ids.sort()).toEqual(["S003", "S004"]);
      submitted++;
      await route.fulfill({
        json: {
          total_uah: 1200,
          bookings: body.seat_ids.map((id: string) => ({
            id,
            seat_id: id,
            day: body.day,
            visit_time: "08:00–13:00",
            price_uah: 600,
          })),
        },
      });
      return;
    }
    const params = new URL(request.url()).searchParams;
    const day = params.get("day");
    let tariffs = pricing.tariffs.map((item) => ({ ...item }));
    if (day === "2030-01-09")
      tariffs = tariffs.map((item) => ({
        ...item,
        price_uah: item.id === "full" ? 1500 : 900,
        adults_only: true,
      }));
    if (day === "2030-01-12")
      tariffs = tariffs
        .filter((item) => item.id !== "full")
        .map((item) => ({
          ...item,
          price_uah: item.id === "morning" ? 1100 : 1950,
          adults_only: item.id === "evening",
        }));
    const period = params.get("period") || tariffs[0].id;
    await route.fulfill({
      json: {
        period,
        tariffs,
        today: "2026-01-01",
        reserved: period === "morning" ? ["S001"] : [],
        numbers: { S001: 1, S003: 3, S004: 4 },
        enabled: { S001: true, S003: true, S004: true },
        map_version: catalog.source_sha256,
      },
    });
  });
  await page.goto("/book");
  await expect(page.getByText("Вільно 3 із 3", { exact: true })).toBeVisible();
  const seat = (id: string) =>
    page.locator(`[data-seat="${id}"][role="button"]`);
  await seat("S003").press("Enter");
  await seat("S004").press("Enter");
  await expect(page.locator(".booking-total")).toContainText(/1\s?800 грн/);
  const periods = page.getByRole("group", { name: "Час відвідування" });
  await periods.getByRole("button", { name: /^Ранок/ }).click();
  await expect(seat("S003")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Вільно 2 із 3", { exact: true })).toBeVisible();
  await expect(seat("S001")).toHaveAttribute("aria-disabled", "true");
  await seat("S003").press("Enter");
  await seat("S004").press("Enter");
  await expect(page.locator(".booking-total")).toContainText(/1\s?200 грн/);
  await page.getByRole("button", { name: "Підтвердити бронювання" }).click();
  await expect(page.getByRole("status")).toContainText(/Разом: 1\s?200 грн/);
  expect(submitted).toBe(1);
  await expect(
    page.getByRole("dialog", { name: "Бронювання збережено", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Дата відвідування").fill("2030-01-09");
  await expect(
    periods.getByRole("button", { name: /^Повний день/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Усім гостям виповнилося 18 років"),
  ).not.toBeChecked();
  await expect(seat("S003")).toHaveAttribute("aria-disabled", "false");
  await seat("S003").press("Enter");
  const confirm = page.getByRole("button", { name: "Підтвердити бронювання" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Усім гостям виповнилося 18 років").check();
  await expect(confirm).toBeEnabled();
  await page.getByLabel("Дата відвідування").fill("2030-01-12");
  await expect(periods.getByRole("button")).toHaveCount(2);
  await expect(periods).toContainText(/1\s?100 грн/);
  await periods.getByRole("button", { name: /^Вечір/ }).click();
  await expect(
    page.getByLabel("Усім гостям виповнилося 18 років"),
  ).not.toBeChecked();
  await expect(periods).toContainText(/1\s?950 грн/);
  await expect(confirm).toBeInViewport();
  await page.screenshot({
    path: `test-results/${info.project.name}-pricing.png`,
  });
});
