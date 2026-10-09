import { test, expect } from "@playwright/test";
import { z } from "zod";

const isolatedUrl = process.env.TRANSLER_BILLING_TEST_URL;
test.use({ baseURL: isolatedUrl });

test("pending payment QR restores on reload and blocks new orders until cancelled", async ({
  page,
}) => {
  test.skip(
    !isolatedUrl,
    "Requires an isolated billing integration API with SePay configured.",
  );
  await page.goto("/login");
  await page.getByTestId("auth-register-tab").click();
  await page.getByTestId("auth-name").fill("Billing Browser");
  await page
    .getByTestId("auth-email")
    .fill(`billing-browser-${crypto.randomUUID()}@example.com`);
  await page
    .getByTestId("auth-password")
    .fill("Transler-billing-test-password-2026");
  await page
    .getByTestId("auth-confirm")
    .fill("Transler-billing-test-password-2026");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByTestId("profile-menu").click();
  await page.getByTestId("account-tab-billing").click();
  try {
    await page.getByTestId("choose-plan-pro").click();
    await page.getByTestId("billing-continue").click();
    await expect(page.getByTestId("payment-qr")).toBeVisible();
    const before = await page.getByTestId("payment-countdown").textContent();
    await expect(page.getByTestId("payment-countdown")).not.toHaveText(before!);
    await expect(page.getByTestId("billing-continue")).toHaveCount(0);
    const [order] = z
      .array(z.object({ id: z.string().uuid(), status: z.string() }))
      .parse(await (await page.request.get("/v1/billing/orders")).json());
    if (!order) throw new Error("Checkout did not create a payment order.");
    await expect
      .poll(() =>
        page
          .getByTestId("payment-qr")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: "../.runtime/payment-qr-desktop.png",
      fullPage: true,
    });
    await page.reload();
    await page.getByTestId("account-tab-billing").click();
    await expect(page.getByTestId("payment-qr")).toBeVisible();
    const blocked = await page.request.post("/v1/billing/checkout", {
      data: {
        plan_code: "pro",
        provider: "sepay",
        billing_cycle: "yearly",
        request_id: crypto.randomUUID(),
      },
    });
    expect(blocked.status()).toBe(409);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        page
          .getByTestId("payment-qr")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: "../.runtime/payment-qr-mobile.png",
      fullPage: true,
    });
    await page.getByTestId("payment-cancel").click();
    await expect(page.getByTestId("payment-back")).toBeVisible();
    const cancelled = await page.request.get(`/v1/billing/orders/${order.id}`);
    expect((await cancelled.json()).order.status).toBe("CANCELLED");
    await expect(page.getByTestId("payment-qr")).toHaveCount(0);
    await page.getByTestId("payment-back").click();
    await page.getByTestId("choose-plan-pro").click();
    await page.getByTestId("billing-continue").click();
    await expect(page.getByTestId("payment-qr")).toBeVisible();
    await page.getByTestId("payment-cancel").click();
    await expect(page.getByTestId("payment-back")).toBeVisible();
  } finally {
    const orders = z
      .array(z.object({ id: z.string().uuid(), status: z.string() }))
      .parse(await (await page.request.get("/v1/billing/orders")).json());
    for (const pending of orders.filter(
      (entry) => entry.status === "PENDING",
    )) {
      expect(
        (
          await page.request.post(`/v1/billing/orders/${pending.id}/cancel`)
        ).ok(),
      ).toBe(true);
    }
  }
});
