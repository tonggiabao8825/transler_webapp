import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chooseOption } from "./select-helper";

const fixture = fileURLToPath(
  new URL("./fixtures/research.pdf", import.meta.url),
);

test("selection menus support long files, keyboard, mobile and tool dialogs", async ({
  page,
}) => {
  await page.goto("/editor");
  const upload = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/documents") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("editor-upload").setInputFiles({
    name: "Machine_learning_waveform_preprocessing_and_feature_extraction_methods_for_classification.pdf",
    mimeType: "application/pdf",
    buffer: await readFile(fixture),
  });
  const document = z
    .object({ id: z.string().uuid() })
    .parse(await (await upload).json());
  try {
    await page.getByTestId("nav-convert").click();
    const trigger = page.getByTestId("conversion-document");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("data-value", document.id);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.screenshot({ path: "../.runtime/select-desktop.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    const bounds = await page.getByRole("listbox").boundingBox();
    if (!bounds) throw new Error("Document menu has no visible bounds.");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: "../.runtime/select-mobile.png" });
    await page.keyboard.press("Escape");
    await page.getByTestId("nav-tools").click();
    await page.getByTestId("planned-ocr").click();
    await chooseOption(page, "pdf-tool-document", document.id);
    await page.getByTestId("pdf-tool-kind").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tool-dialog")).toBeVisible();
    await expect(page.getByTestId("pdf-tool-kind")).toBeFocused();
    await chooseOption(page, "pdf-tool-kind", "split");
    await expect(page.getByTestId("pdf-tool-pages")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tool-dialog")).not.toBeVisible();
  } finally {
    const response = await page.request.delete(`/v1/documents/${document.id}`);
    expect(response.ok()).toBe(true);
  }
});
