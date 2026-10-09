import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const fixture = fileURLToPath(
  new URL("./fixtures/research.pdf", import.meta.url),
);
const documentSchema = z.object({
  id: z.string().uuid(),
  artifact_id: z.string().uuid(),
});
test("edit revision, convert through worker, favorite and restore", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("editor-empty-state")).toBeVisible();
  await expect(page.getByTestId("nav-library")).toBeVisible();
  await expect(page.getByTestId("editor-tool-add")).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "../.runtime/editor-integrated-empty-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../.runtime/editor-integrated-empty-mobile.png",
  });
  expect(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("editor-upload").setInputFiles(fixture);
  await expect(page.getByTestId("editor-page-2")).toBeVisible();
  const [document] = z
    .array(documentSchema)
    .parse(await (await page.request.get("/v1/documents")).json());
  if (!document) throw new Error("Uploaded PDF is missing.");
  await page.goto(
    `/editor?document=${document.id}&artifact=${document.artifact_id}`,
  );
  await page.setViewportSize({ width: 2048, height: 989 });
  await expect(page.getByTestId("editor-page-2")).toBeVisible();
  await page.getByTestId("editor-pages-toggle").click();
  await expect(page.getByTestId("editor-page-2")).not.toBeVisible();
  await page.getByTestId("editor-pages-toggle").click();
  await expect(page.getByTestId("editor-page-2")).toBeVisible();
  await page.getByTestId("editor-more").click();
  await expect(page.getByTestId("editor-rotate")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("editor-rotate")).not.toBeVisible();
  await page.getByTestId("editor-next-page").click();
  await expect(page.getByTestId("editor-page-2")).toHaveClass("selected");
  await page.getByTestId("editor-previous-page").click();
  await page.getByTestId("editor-zoom-in").click();
  await expect(page.getByTestId("editor-zoom")).toHaveAttribute(
    "data-value",
    "1.25",
  );
  await page.getByTestId("editor-zoom-out").click();
  await expect(page.getByTestId("editor-zoom")).toHaveAttribute(
    "data-value",
    "1",
  );
  await page.screenshot({ path: "../.runtime/editor-reference-desktop.png" });
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.screenshot({ path: "../.runtime/editor-integrated-tablet.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("editor-pages-toggle").click();
  await expect(page.getByTestId("editor-page-2")).toBeVisible();
  await page.getByTestId("editor-page-2").click();
  await expect(page.getByTestId("editor-page-2")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../.runtime/editor-reference-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await chooseOption(page, "editor-action", "rotate_page");
  await expect(page.getByTestId("editor-stage")).toBeEnabled();
  await page.getByTestId("editor-stage").click();
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("job-status")).toHaveText("completed", {
    timeout: 90000,
  });
  const original = await page.request.get(
    `/v1/artifacts/${document.artifact_id}/download`,
  );
  expect(await original.body()).toEqual(await readFile(fixture));
  await page.getByTestId("nav-convert").click();
  await chooseOption(page, "conversion-document", document.id);
  await page.getByTestId("format-png").click();
  await page.getByTestId("start-conversion").click();
  await expect(page.getByTestId("job-status")).toHaveText("completed", {
    timeout: 90000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-result").click();
  const downloaded = await downloadPromise;
  const path = await downloaded.path();
  if (!path) throw new Error("Conversion download is missing.");
  expect((await readFile(path)).subarray(0, 2).toString()).toBe("PK");
  await page.getByTestId("share-result").click();
  await expect(page.getByTestId("share-link")).toBeVisible();
  const shareUrl = await page.getByTestId("share-link").inputValue();
  expect((await page.request.get(shareUrl)).status()).toBe(200);
  await page.getByTestId("close-share-link").click();
  await page.getByTestId("nav-shared").click();
  const [share] = z
    .array(z.object({ id: z.string().uuid() }))
    .parse(await (await page.request.get("/v1/shares")).json());
  if (!share) throw new Error("Created share link is missing.");
  await page.screenshot({
    path: "../.runtime/shared-with-file.png",
    fullPage: true,
  });
  await page.getByTestId(`revoke-share-${share.id}`).click();
  await expect(page.getByTestId(`revoke-share-${share.id}`)).toHaveCount(0);
  expect((await page.request.get(shareUrl)).status()).toBe(404);
  await page.getByTestId("nav-library").click();
  await page.getByTestId(`favorite-${document.id}`).click();
  await expect(page.getByTestId(`favorite-${document.id}`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("nav-favorites").click();
  await expect(page.getByTestId(`document-${document.id}`)).toBeVisible();
  await page.getByTestId(`trash-${document.id}`).click();
  await expect(page.getByTestId(`document-${document.id}`)).toHaveCount(0);
  await page.getByTestId("nav-trash").click();
  await page.screenshot({
    path: "../.runtime/trash-with-file.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/trash-with-file-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId(`trash-${document.id}`).click();
  await expect(page.getByTestId(`document-${document.id}`)).toHaveCount(0);
  await page.getByTestId("nav-library").click();
  await expect(page.getByTestId(`document-${document.id}`)).toBeVisible();
  await page.getByTestId(`delete-${document.id}`).click();
  await expect(page.getByTestId(`document-${document.id}`)).toHaveCount(0);
});
test("translate a Markdown upload using configured Groq", async ({ page }) => {
  await page.goto("/tools");
  await page.getByTestId("tool-documents").click();
  await page.getByTestId("document-translation-upload").setInputFiles({
    name: "browser.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Research\n\nThe model uses 30 samples.\n\n```python\nfit(X)\n```\n",
    ),
  });
  await expect(page.getByTestId("document-translation-start")).toBeEnabled();
  await page.getByTestId("document-translation-start").click();
  await expect(page.getByTestId("job-status")).toHaveText("completed", {
    timeout: 90000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-result").click();
  const downloaded = await downloadPromise;
  const path = await downloaded.path();
  if (!path) throw new Error("Translated Markdown download is missing.");
  const content = await readFile(path, "utf8");
  expect(content).toContain("30");
  expect(content).toContain("```python\nfit(X)\n```");
  expect(content).not.toContain("The model uses");
  const [document] = z
    .array(documentSchema)
    .parse(await (await page.request.get("/v1/documents")).json());
  if (!document) throw new Error("Markdown document is missing.");
  await page.request.delete(`/v1/documents/${document.id}`);
});
