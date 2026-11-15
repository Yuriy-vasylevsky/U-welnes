import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("page zoom is locked outside the interactive map", async ({
  page,
  context,
}, info) => {
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewport).toContain("maximum-scale=1");
  expect(viewport).toContain("user-scalable=no");
  const blocked = () =>
    page.evaluate(() => {
      const wheel = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector("h1")!.dispatchEvent(wheel);
      const key = new KeyboardEvent("keydown", {
        ctrlKey: true,
        key: "+",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(key);
      const gesture = new Event("gesturestart", {
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(gesture);
      return (
        wheel.defaultPrevented &&
        key.defaultPrevented &&
        gesture.defaultPrevented
      );
    });
  await expect.poll(blocked).toBe(true);
  if (info.project.name === "mobile") {
    const cdp = await context.newCDPSession(page);
    const x = page.viewportSize()!.width / 2,
      y = 170;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 35, y, id: 1 },
        { x: x + 35, y, id: 2 },
      ],
    });
    for (const d of [50, 75, 110])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: x - d, y, id: 1 },
          { x: x + d, y, id: 2 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  }
});

test.beforeEach(async ({ page }) => {
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
  await expect
    .poll(() =>
      page
        .locator(".pool-map")
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    )
    .toBe(true);
});

test("booking fills the viewport and confirmation stays reachable", async ({
  page,
}) => {
  const confirm = page.getByRole("button", { name: "Підтвердити бронювання" });
  await expect(confirm).toBeInViewport();
  await expect(page.getByLabel("Дата відвідування")).toBeInViewport();
  const viewport = page.viewportSize()!;
  const box = (await page.locator(".map-panel").boundingBox())!;
  expect(box.height).toBeGreaterThan(viewport.height * 0.35);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("seat taps select immediately without changing map position or size", async ({
  page,
}, info) => {
  const seat = page.locator(
    '[data-seat="S001"][role="button"][aria-disabled="false"]',
  );
  const tap = () =>
    info.project.name === "mobile" ? seat.tap() : seat.click();
  const matrix = () =>
    page
      .locator(".map-content")
      .evaluate((el) => getComputedStyle(el).transform);
  const before = await matrix();
  const box = await page.locator(".map-viewport").boundingBox();
  await tap();
  await expect(page.locator(".map-panel .map-legend")).toBeVisible();
  await expect(page.locator(".booking-page > .booking-legend")).toHaveCount(0);
  await expect(seat).toHaveAttribute("aria-pressed", "true");
  expect(await matrix()).toBe(before);
  expect(await page.locator(".map-viewport").boundingBox()).toEqual(box);
  await tap();
  await expect(seat).toHaveAttribute("aria-pressed", "false");
  expect(await matrix()).toBe(before);
  expect(await page.locator(".map-viewport").boundingBox()).toEqual(box);
  await tap();
  await expect(
    page.getByRole("button", { name: "Прибрати шезлонг S001", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показати всю карту" }).click();
  await expect
    .poll(() =>
      page
        .locator(".map-content")
        .evaluate((el) => getComputedStyle(el).transform),
    )
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await expect(seat).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("group", { name: "Переміщення карти" }),
  ).toHaveCount(0);
});

test("small and landscape screens keep the date and action visible", async ({
  page,
}) => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.getByLabel("Дата відвідування")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Підтвердити бронювання" }),
    ).toBeInViewport();
    const box = (await page.locator(".map-panel").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(100);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("one finger pans the map without scrolling or selecting", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "mobile", "Native touch check");
  await page
    .getByRole("button", { name: "Збільшити карту", exact: true })
    .click();
  const matrix = () =>
    page
      .locator(".map-content")
      .evaluate((el) => getComputedStyle(el).transform);
  await expect(page.locator(".map-panel .map-legend")).toBeVisible();
  await expect(page.locator(".booking-page > .booking-legend")).toHaveCount(0);
  // Wait until the zoom transition settles before a separate gesture.
  await page.waitForTimeout(300);
  const before = await matrix();
  const box = (await page.locator(".map-viewport").boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (const delta of [10, 25, 45, 70, 100]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + delta, y: y - delta, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect.poll(matrix).not.toBe(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('[data-seat][aria-pressed="true"]')).toHaveCount(0);
});

test("wheel zoom and dragging operate without page scrolling", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Mouse wheel check");
  const matrix = () =>
    page
      .locator(".map-content")
      .evaluate((el) => getComputedStyle(el).transform);
  const box = (await page.locator(".map-viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(matrix).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page
    .getByRole("button", { name: "Збільшити карту", exact: true })
    .click();
  await expect(page.locator(".map-panel .map-legend")).toBeVisible();
  await expect(page.locator(".booking-page > .booking-legend")).toHaveCount(0);
  await page.waitForTimeout(400);
  const before = await matrix();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 - 70,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect.poll(matrix).not.toBe(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
