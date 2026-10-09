import { test, expect } from "@playwright/test";
import { z } from "zod";

const isolatedUrl = process.env.TRANSLER_TOOLS_TEST_URL;
test.use({ baseURL: isolatedUrl });

test("admin tool switches persist and disabled All Tools cards are dimmed", async ({
  page,
}) => {
  test.skip(!isolatedUrl, "Requires an isolated tool administration API.");
  const credentials = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .parse({
      email: process.env.TRANSLER_TOOLS_TEST_EMAIL,
      password: process.env.TRANSLER_TOOLS_TEST_PASSWORD,
    });
  await page.goto("/login");
  await page.getByTestId("auth-email").fill(credentials.email);
  await page.getByTestId("auth-password").fill(credentials.password);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByTestId("nav-admin").click();
  await page.getByTestId("admin-tab-tools").click();
  await expect(page.getByTestId("admin-tools")).toBeVisible();
  const toggle = page.getByTestId("admin-tool-ocr");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  try {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.screenshot({
      path: "../.runtime/admin-tools-desktop.png",
      fullPage: true,
    });
    await page.getByTestId("nav-tools").click();
    const card = page.getByTestId("planned-ocr");
    await expect(card).toBeVisible();
    await expect(card).toBeDisabled();
    await expect(card).toHaveCSS("opacity", "0.42");
    await page.screenshot({
      path: "../.runtime/tools-disabled-desktop.png",
      fullPage: true,
    });
    await page.reload();
    await expect(card).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "../.runtime/tools-disabled-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByTestId("nav-admin").click();
    await page.getByTestId("admin-tab-tools").click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.screenshot({
      path: "../.runtime/admin-tools-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("nav-tools").click();
    await expect(card).toBeEnabled();
    await card.click();
    await expect(page.getByTestId("tool-dialog")).toBeVisible();
  } finally {
    expect(
      (
        await page.request.put("/v1/admin/tools/ocr", {
          data: { enabled: true },
        })
      ).ok(),
    ).toBe(true);
  }
});
