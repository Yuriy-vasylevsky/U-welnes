import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("free count includes only enabled seats in its total", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.route("**/api/v1/pool/availability?**", (route) =>
    route.fulfill({
      json: {
        enabled: { S001: true, S002: true, S003: false },
        reserved: ["S002", "S003"],
        numbers: {},
        today: "2026-11-14",
        ...pricing, map_version: catalog.source_sha256,
      },
    }),
  );
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Вільно 1 із 2", { exact: true })).toBeVisible();
  await expect(page.locator("header")).toHaveCSS("height", "52px");
  expect(
    (await page.getByLabel("Дата відвідування").boundingBox())!.width,
  ).toBeLessThanOrEqual(146);
  await expect(page.locator(".map-pan-controls")).toHaveCount(0);
});
test("admin activates a grey seat and only that seat can be selected for booking", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'test-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
  const numbers = Object.fromEntries(
    catalog.seats.map((s, i) => [s.id, i + 1]),
  );
  const enabled = Object.fromEntries(catalog.seats.map((s) => [s.id, false]));
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().url()).toContain("/S001/availability");
      expect(route.request().postDataJSON()).toEqual({
        enabled: true,
        expected_enabled: false,
      });
      enabled.S001 = true;
      await route.fulfill({ json: { seat_id: "S001", enabled: true } });
    } else if (route.request().url().includes("/bookings/mine"))
      await route.fulfill({ json: { bookings: [] } });
    else
      await route.fulfill({
        json: {
          numbers,
          enabled,
          reserved: [],
          today: "2026-01-01",
          ...pricing, map_version: catalog.source_sha256,
        },
      });
  });
  await page.goto("/admin/seats", { waitUntil: "domcontentloaded" });
  const closed = page.getByRole("button", {
    name: "Шезлонг 1 — недоступний",
    exact: true,
  });
  await expect(closed).toHaveClass(/closed/);
  await expect(closed).toHaveAttribute("aria-disabled", "false");
  await closed.click();
  const toggle = page.getByRole("switch", { name: "Доступний для бронювання" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Вільно 1 із 1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Шезлонг 2 — недоступний", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await page
    .getByRole("button", { name: "Шезлонг 2 — недоступний", exact: true })
    .dispatchEvent("click");
  await expect(page.locator("[data-seat][aria-pressed=true]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Шезлонг 1", exact: true })
    .press("Enter");
  await expect(page.locator('[data-seat="S001"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a place closed while the page is open becomes grey on confirmation", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'test-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ status: 409, json: { detail: "seat_disabled" } });
    else if (route.request().url().includes("/bookings/mine"))
      await route.fulfill({ json: { bookings: [] } });
    else
      await route.fulfill({
        json: {
          enabled: { S001: true },
          numbers: { S001: 1 },
          reserved: [],
          today: "2026-01-01",
          ...pricing, map_version: catalog.source_sha256,
        },
      });
  });
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-seat="S001"][role="button"][aria-disabled="false"]')
    .press("Enter");
  await page
    .getByRole("button", { name: "Підтвердити бронювання" })
    .press("Enter");
  await expect(page.locator(".booking-error")).toContainText(
    "закритий для бронювання",
  );
  await expect(page.locator('[data-seat="S001"]')).toHaveClass(/closed/);
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeDisabled();
});
