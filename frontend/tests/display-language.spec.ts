import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";

test("display language persists across pages and supports all six languages", async ({
  page,
}) => {
  await page.goto("/tools");
  const languages = ["vi", "zh", "ja", "ko", "ru", "en"] as const;
  for (const language of languages) {
    await chooseOption(page, "display-language", language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByTestId("tool-translate")).toBeVisible();
    if (language !== "en")
      await expect(page.getByTestId("tool-translate")).not.toContainText(
        "Translate PDF",
      );
    if (language === "ru") {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "../.runtime/tools-russian-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.getByTestId("planned-ocr").click();
    await expect(page.getByTestId("pdf-tool-kind")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("nav-trash").click();
    await expect(page.getByTestId("trash-screen")).toBeVisible();
    await page.getByTestId("nav-shared").click();
    await expect(page.getByTestId("shared-screen")).toBeVisible();
    await page.getByTestId("nav-tools").click();
  }
  await chooseOption(page, "display-language", "vi");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByTestId("display-language")).toHaveAttribute(
    "data-value",
    "vi",
  );
  await page.screenshot({
    path: "../.runtime/tools-vietnamese.png",
    fullPage: true,
  });
  await page.getByTestId("nav-trash").click();
  await page.screenshot({
    path: "../.runtime/trash-vietnamese.png",
    fullPage: true,
  });
  await page.getByTestId("nav-shared").click();
  await page.screenshot({
    path: "../.runtime/shared-vietnamese.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/shared-vietnamese-mobile.png",
    fullPage: true,
  });
});

test("automatic language follows the user's region until manually selected", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser test base URL is not configured.");
  const context = await browser.newContext({
    baseURL,
    locale: "en-US",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
    await expect(page.getByTestId("display-language")).toHaveAttribute(
      "data-value",
      "auto",
    );
    await chooseOption(page, "display-language", "ja");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await chooseOption(page, "display-language", "auto");
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  } finally {
    await context.close();
  }
});
