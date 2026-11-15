import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import catalog from "../apps/web/data/seats.json";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/pool/**", (route) =>
    route.fulfill({
      json: {
        enabled: {},
        numbers: {},
        reserved: [],
        today: "2026-11-14",
        ...pricing, map_version: catalog.source_sha256,
      },
    }),
  );
});
test("Single-page booking, logo and map zoom work without Telegram", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Browser fallback: Telegram SDK unavailable.
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const image = page.locator(".pool-map");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("status")).toHaveCount(0);
  const asset = await page.request.get("/maps/pool-map.svg");
  expect(await asset.body()).toEqual(
    fs.readFileSync("assets/maps/pool-map.svg"),
  );
  const content = page.locator(".map-content");
  await page
    .getByRole("button", { name: "Збільшити карту", exact: true })
    .click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.getByRole("button", { name: "Показати всю карту" }).click();
  await expect
    .poll(() => content.evaluate((el) => getComputedStyle(el).transform))
    .toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-pool.png`,
    fullPage: true,
  });
  await expect(page.locator("header .brand-logo")).toBeVisible();
  await expect(page.locator("header .brand-name")).toHaveText("WELLNESS");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Ваш день біля басейну" }),
  ).toHaveCount(1);
  await expect(page.getByLabel("Дата відвідування")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("source SVG is a valid browser document", async ({ page }) => {
  await page.goto("/maps/pool-map.svg");
  expect(await page.locator("svg").getAttribute("viewBox")).toBe(
    "0 0 932.37 1208.5",
  );
  expect(await page.locator("parsererror").count()).toBe(0);
  expect(await page.locator("path").count()).toBe(7482);
});

test("wheel and drag or touch pinch move the viewport", async ({
  page,
  context,
}, info) => {
  await page.route("https://telegram.org/**", (route) => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toHaveCount(0);
  const viewport = page.locator(".map-viewport");
  const matrix = () =>
    page
      .locator(".map-content")
      .evaluate((el) => getComputedStyle(el).transform);
  const box = (await viewport.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (info.project.name === "mobile") {
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, d: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x: x - d, y, id: 1 },
                { x: x + d, y, id: 2 },
              ],
      });
    await touch("touchStart", 30);
    await touch("touchMove", 35);
    await touch("touchMove", 65);
    await touch("touchMove", 90);
    await touch("touchEnd", 0);
    await expect.poll(matrix).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  } else {
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    await expect.poll(matrix).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
    // Let wheel animation settle before testing a separate drag.
    await page.waitForTimeout(500);
    const before = await matrix();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 50, { steps: 10 });
    await page.mouse.up();
    await expect.poll(matrix).not.toBe(before);
  }
});

test("Telegram SDK lifecycle updates viewport and safe areas", async ({
  page,
}) => {
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    window.sdkCalls=[]; window.sdkEvents={};
    window.Telegram={WebApp:{viewportStableHeight:760,safeAreaInset:{top:12,bottom:8},contentSafeAreaInset:{top:4,bottom:2},ready(){sdkCalls.push('ready')},expand(){sdkCalls.push('expand')},setHeaderColor(){},setBackgroundColor(){},onEvent(e,f){sdkEvents[e]=f},offEvent(e){delete sdkEvents[e]}}};
  `,
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--app-height"),
      ),
    )
    .toBe("760px");
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--tg-top"),
    ),
  ).toBe("16px");
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--tg-bottom"),
    ),
  ).toBe("10px");
  expect(await page.evaluate(() => (window as any).sdkCalls)).toEqual([
    "ready",
    "expand",
  ]);
  await page.evaluate(() => {
    window.Telegram!.WebApp!.viewportStableHeight = 700;
    (window as any).sdkEvents.viewportChanged();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--app-height"),
      ),
    )
    .toBe("700px");
});
