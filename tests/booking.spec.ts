import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("daily reservation, occupied seats and personal list", async ({
  page,
}, info) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.Telegram={WebApp:{initData:'test-signed-data',ready(){},expand(){},onEvent(){},offEvent(){}}};`,
    }),
  );
  let saved: object | null = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/pool/availability")) {
      await route.fulfill({
        json: {
          today: "2026-01-01",
          reserved: ["S002"],
          map_version: catalog.source_sha256,
        },
      });
    } else if (request.method() === "POST") {
      expect(request.headers().authorization).toBe("tma test-signed-data");
      const body = request.postDataJSON();
      expect(body.seat_id).toBe("S001");
      expect(body.user_id).toBeUndefined();
      saved = {
        id: body.request_id,
        seat_id: body.seat_id,
        day: body.day,
        created_at: new Date().toISOString(),
      };
      await route.fulfill({ status: 201, json: saved });
    } else {
      await route.fulfill({ json: { bookings: saved ? [saved] : [] } });
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
  await expect(page.getByLabel("Шезлонг", { exact: true })).toHaveValue("S001");
  await page.screenshot({
    path: `test-results/${info.project.name}-booking.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Підтвердити бронювання" }).click();
  await expect(page.getByRole("status")).toContainText("Бронювання збережено");
  await expect(page.locator(".my-bookings li")).toContainText("S001");
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
        map_version: catalog.source_sha256,
      },
    }),
  );
  await page.goto("/book", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Шезлонг", { exact: true })).toBeEnabled();
  await page.getByLabel("Шезлонг", { exact: true }).selectOption("S003");
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
          map_version: catalog.source_sha256,
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
  await page.getByLabel("Шезлонг", { exact: true }).selectOption("S004");
  await page.getByRole("button", { name: "Підтвердити бронювання" }).click();
  await expect(page.locator(".booking-error")).toContainText(
    "вже заброньоване",
  );
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeDisabled();
  await page.getByLabel("Шезлонг", { exact: true }).selectOption("S005");
  await expect(
    page.getByRole("button", { name: "Підтвердити бронювання" }),
  ).toBeEnabled();
});
