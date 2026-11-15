import { pricing } from "./pricing-fixture";
import { test, expect } from "@playwright/test";
import catalog from "../apps/web/data/seats.json";

test("admin selects several places and opens or closes them together", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) => route.fulfill({ contentType: "application/javascript", body: "window.Telegram={WebApp:{initData:'test',ready(){},expand(){},onEvent(){},offEvent(){}}};" }));
  const enabled: Record<string, boolean> = { S001: false, S002: true };
  let changes = 0;
  await page.route("**/api/v1/admin/**", async (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().url()).toContain("/availability/batch");
      const body = route.request().postDataJSON();
      expect(body.expected_enabled).toEqual({ S001: enabled.S001, S002: enabled.S002 });
      enabled.S001 = body.enabled; enabled.S002 = body.enabled;
      changes++;
      await route.fulfill({ json: { enabled } });
    } else await route.fulfill({ json: { numbers: { S001: 1, S002: 2 }, enabled, ...pricing, map_version: catalog.source_sha256 } });
  });
  await page.goto("/admin/seats");
  const first = page.locator('[data-seat="S001"][role="button"][aria-disabled="false"]');
  const second = page.locator('[data-seat="S002"][role="button"][aria-disabled="false"]');
  await first.click(); await second.click();
  await expect(page.getByText("Вибрано місць: 2")).toBeVisible();
  await expect(page.getByLabel("Новий номер", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Відкрити вибрані", exact: true }).click();
  await expect(first).not.toHaveClass(/closed/);
  await expect(second).not.toHaveClass(/closed/);
  await page.getByRole("button", { name: "Закрити вибрані", exact: true }).click();
  await expect(first).toHaveClass(/closed/); await expect(second).toHaveClass(/closed/);
  await first.click();
  await expect(page.getByLabel("Новий номер", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Зняти вибір", exact: true }).click();
  await expect(page.locator('[data-seat][aria-pressed="true"]')).toHaveCount(0);
  expect(changes).toBe(2);
});
