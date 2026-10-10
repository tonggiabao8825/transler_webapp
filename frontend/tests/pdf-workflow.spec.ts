import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const fixture = fileURLToPath(
  new URL("./fixtures/research.pdf", import.meta.url),
);
const documentsSchema = z.array(
  z.object({ id: z.string().uuid(), artifact_id: z.string().uuid() }),
);

test("upload, preview, translate via the real queue, download, and delete", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/dashboard");
  await expect(page.getByTestId("hero-translate")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/overview-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("hero-translate").click();
  await page.screenshot({
    path: "../.runtime/upload-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("file-input").setInputFiles(fixture);
  await expect(page.getByTestId("start-translation")).toBeVisible();
  await page.getByTestId("preview-source").click();
  await expect(page.getByTestId("next-page")).toBeEnabled();
  await page.getByTestId("next-page").click();
  await expect(
    page.getByTestId("preview-translated").getByTestId("pdf-canvas"),
  ).toHaveAttribute("aria-label", "PDF page 2");
  await page.getByTestId("close-preview").click();
  await chooseOption(page, "target-language", "vi");
  await page.screenshot({
    path: "../.runtime/settings-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("start-translation").click();
  await expect(page.getByTestId("job-status")).toHaveText("completed", {
    timeout: 150_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-result").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) throw new Error("Browser did not save the downloaded PDF.");
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByTestId("result-thumbnail")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.screenshot({
    path: "../.runtime/completed-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("preview-result").click();
  await expect(page.getByTestId("preview-comparison")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const side of ["preview-original", "preview-translated"]) {
    await expect(
      page.getByTestId(side).locator(".pdf-page-slot"),
    ).toHaveAttribute("aria-busy", "false");
  }
  await page.getByTestId("preview-thumbnail-2").click();
  for (const side of ["preview-original", "preview-translated"]) {
    await expect(
      page.getByTestId(side).getByTestId("pdf-canvas"),
    ).toHaveAttribute("aria-label", "PDF page 2");
    await expect(
      page.getByTestId(side).locator(".pdf-page-slot"),
    ).toHaveAttribute("aria-busy", "false");
  }
  await page.getByTestId("preview-page-input").fill("1");
  await page.getByTestId("preview-zoom-in").click();
  await expect(page.getByTestId("preview-zoom")).toHaveText("125%");
  await page.getByTestId("preview-fit").click();
  await expect(page.getByTestId("preview-zoom")).toHaveText("100%");
  await page.getByTestId("preview-translation-only").click();
  await expect(page.getByTestId("preview-original")).toHaveCount(0);
  await page.getByTestId("preview-comparison").click();
  await expect(page.getByTestId("preview-original")).toBeVisible();
  await expect(page.getByTestId("preview-download-original")).toHaveAttribute(
    "href",
    /\/download$/,
  );
  await page
    .getByTestId("pdf-preview")
    .screenshot({ path: "../.runtime/preview-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("preview-pages-toggle").click();
  await expect(page.getByTestId("preview-pages")).toHaveCount(0);
  expect(
    await page
      .getByTestId("pdf-preview")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page
    .getByTestId("pdf-preview")
    .screenshot({ path: "../.runtime/preview-mobile.png" });
  await page.getByTestId("preview-pages-toggle").click();
  await page.getByTestId("preview-thumbnail-2").click();
  await expect(page.getByTestId("preview-pages")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pdf-preview")).toHaveCount(0);
  await expect(page.getByTestId("preview-result")).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId("edit-result")).toBeVisible();
  await expect(page.getByTestId("crop-result")).toBeVisible();
  await expect(page.getByTestId("delete-result")).toBeVisible();
  await expect(page.getByTestId("retranslate-result")).toBeVisible();
  await page.getByTestId("crop-result").click();
  await expect(page.getByTestId("editor-screen")).toBeVisible();
  await expect(page.getByTestId("editor-action")).toBeVisible();
  await page.getByTestId("nav-library").click();

  const response = await page.request.get("/v1/documents");
  const documents = documentsSchema.parse(await response.json());
  const document = documents[0];
  if (!document)
    throw new Error("Uploaded document is missing from the real library.");
  await expect(page.getByTestId(`raw-${document.id}`)).toBeVisible();
  await expect(page.locator('[data-testid^="processed-"]')).toHaveCount(1);
  const processed = await page.request.get("/v1/jobs");
  const completedJobs = z
    .array(z.object({ id: z.string().uuid(), status: z.string() }))
    .parse(await processed.json());
  const completed = completedJobs.find((item) => item.status === "COMPLETED");
  if (!completed)
    throw new Error("Completed translation is missing from the library.");
  await page.getByTestId(`open-job-${completed.id}`).click();
  await page.getByTestId("save-result").click();
  await expect(page.getByTestId("notice-banner")).toBeVisible();
  await page.reload();
  await page.getByTestId("nav-library").click();
  await expect(page.getByTestId(`raw-${document.id}`)).toBeVisible();
  await expect(page.getByTestId(`processed-${completed.id}`)).toBeVisible();
  await page.screenshot({
    path: "../.runtime/library-desktop.png",
    fullPage: true,
  });
  await page.getByTestId(`delete-${document.id}`).click();
  await expect(page.getByTestId(`document-${document.id}`)).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("mobile layout and invalid PDF show an actionable error", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("hero-translate")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/overview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByTestId("nav-translate").click();
  await page.getByTestId("file-input").setInputFiles({
    name: "invalid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid PDF"),
  });
  await expect(page.getByTestId("error-banner")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "../.runtime/upload-mobile.png",
    fullPage: true,
  });
});

test("landing and processing tools are navigable", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("landing-start")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/landing-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("landing-start").click();
  await page.getByTestId("nav-tools").click();
  await expect(page.getByTestId("tool-documents")).toBeVisible();
  await expect(page.getByTestId("pdf-tool-kind")).toHaveCount(0);
  await expect(page.getByTestId("document-translation")).toHaveCount(0);
  await page.screenshot({
    path: "../.runtime/tools-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("planned-split-pdf").click();
  await expect(page.getByTestId("pdf-tool-kind")).toHaveAttribute(
    "data-value",
    "split",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tool-dialog")).toHaveCount(0);
  await expect(page.getByTestId("planned-split-pdf")).toBeFocused();
  await page.getByTestId("planned-ocr").click();
  await expect(page.getByTestId("pdf-tool-kind")).toHaveAttribute(
    "data-value",
    "ocr",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/tool-dialog-mobile.png",
    fullPage: true,
  });
  await page.getByTestId("tool-dialog-close").click();
  await page.screenshot({
    path: "../.runtime/tools-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("tool-documents").click();
  await expect(page.getByTestId("document-translation")).toBeVisible();
  await page.getByTestId("tool-dialog-close").click();
  await page.getByTestId("nav-editor").click();
  await expect(page.getByTestId("editor-action")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/editor-skeleton-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("nav-convert").click();
  await page.getByTestId("format-pptx").click();
  await expect(page.getByTestId("format-pptx")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("start-conversion")).toBeDisabled();
  await page.screenshot({
    path: "../.runtime/conversion-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/conversion-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const collection of ["favorites", "shared", "trash"]) {
    await page.getByTestId(`nav-${collection}`).click();
    await expect(page).toHaveURL(new RegExp(`/${collection}$`));
  }
});
