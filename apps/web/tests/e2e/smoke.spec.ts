import { expect, test } from "@playwright/test";

test("the home page responds and renders a <main> element", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("main")).toHaveCount(1);
});
