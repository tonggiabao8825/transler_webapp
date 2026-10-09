import { chooseOption } from "./select-helper";
import { test, expect } from "@playwright/test";
import { readFile, appendFile } from "node:fs/promises";
import { z } from "zod";
const password = "Transler-e2e-password-2026";
test("register, profile, report, billing, logout and login", async ({
  page,
  browser,
}) => {
  const email = `browser-${crypto.randomUUID()}@example.com`;
  await page.goto("/login");
  await page.getByTestId("auth-register-tab").click();
  await page.getByTestId("auth-name").fill("Browser User");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-confirm").fill(password);
  await page.screenshot({
    path: "../.runtime/auth-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/");
  await expect(page.getByTestId("landing-login")).toHaveCount(0);
  await expect(page.getByTestId("landing-start")).toHaveText("Go to dashboard");
  await page.getByTestId("landing-start").click();
  await page.getByTestId("profile-menu").click();
  await expect(page.getByTestId("account-screen")).toBeVisible();
  await expect(page.getByTestId("account-upgrade")).toBeVisible();
  await appendFile(
    "../.runtime/browser-test-accounts.jsonl",
    JSON.stringify({ email }) + "\n",
  );
  await expect(page.getByTestId("nav-admin")).toHaveCount(0);
  await page.screenshot({
    path: "../.runtime/account-desktop.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("account-report").click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "transler-usage.csv",
  );
  await page.getByTestId("account-tab-security").click();
  await page.screenshot({
    path: "../.runtime/profile-settings-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/profile-settings-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("profile-name").fill("Updated Browser User");
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-menu")).toContainText(
    "Updated Browser User",
  );
  await page.getByTestId("account-tab-billing").click();
  await expect(page.getByTestId("billing-panel")).toBeVisible();
  await expect(page.getByTestId("payment-history")).toBeVisible();
  await page.getByTestId("billing-cycle-yearly").click();
  await expect(page.getByTestId("billing-cycle-yearly")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("choose-plan-pro").click();
  await page.getByTestId("buy-card").click();
  await expect(page.getByTestId("buy-card")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("billing-continue")).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => window.document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/billing-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("billing-cycle-monthly").click();

  await page.screenshot({
    path: "../.runtime/billing-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("auth-screen")).toBeVisible();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByTestId("profile-menu").click();
  await expect(page.getByTestId("account-screen")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../.runtime/account-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const credentials = z
    .object({ email: z.string(), password: z.string() })
    .parse(
      JSON.parse(await readFile("../.runtime/admin-credentials.json", "utf8")),
    );
  const admin = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const signedIn = await admin.request.post("/v1/auth/login", {
      data: credentials,
    });
    expect(signedIn.status()).toBe(200);
    const profile = z
      .object({
        account: z.object({
          id: z.string().uuid(),
          name: z.string(),
          role: z.string(),
          is_active: z.boolean(),
        }),
      })
      .parse(await (await page.request.get("/v1/account")).json());
    const planUpdate = {
      ...profile.account,
      plan_code: "pro",
      plan_expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    const activated = await admin.request.patch(
      `/v1/admin/accounts/${profile.account.id}`,
      { data: planUpdate },
    );
    expect(activated.status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("upgrade-plan")).toHaveText("Manage plan");
    await expect(page.getByTestId("account-upgrade")).toHaveText("Manage plan");
    await page.getByTestId("nav-home").click();
    const entitlement = z
      .object({
        plan: z.object({ name: z.string(), monthly_pages: z.number().int() }),
        usage: z.object({
          pages_used: z.number().int(),
          pages_reserved: z.number().int(),
        }),
      })
      .parse(await (await page.request.get("/v1/account")).json());
    await expect(page.getByTestId("home-plan-name")).toContainText(
      entitlement.plan.name,
    );
    await expect(page.getByTestId("home-plan-usage")).toContainText(
      `${entitlement.usage.pages_used + entitlement.usage.pages_reserved}/${entitlement.plan.monthly_pages}`,
    );
    await page.screenshot({
      path: "../.runtime/home-plan-live.png",
      fullPage: true,
    });
    const expired = await admin.request.patch(
      `/v1/admin/accounts/${profile.account.id}`,
      {
        data: {
          ...planUpdate,
          plan_expires_at: new Date(Date.now() - 86400000).toISOString(),
        },
      },
    );
    expect(expired.status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("upgrade-plan")).toHaveText("Upgrade");
  } finally {
    await admin.close();
  }
});
test("administrator overview, users, plans, payments and audit", async ({
  page,
}) => {
  const credentials = z
    .object({ email: z.string().email(), password: z.string() })
    .parse(
      JSON.parse(await readFile("../.runtime/admin-credentials.json", "utf8")),
    );
  await page.goto("/login");
  await page.getByTestId("auth-email").fill(credentials.email);
  await page.getByTestId("auth-password").fill(credentials.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("nav-admin")).toBeVisible();
  await page.getByTestId("nav-admin").click();
  await expect(page.getByTestId("admin-screen")).toBeVisible();
  await chooseOption(page, "display-language", "vi");
  await page.getByTestId("admin-tab-accounts").click();
  await expect(page.getByTestId("admin-accounts")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/admin-accounts-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("admin-tab-plans").click();
  await expect(page.getByTestId("save-plan-free")).toBeVisible();
  await page.getByTestId("save-plan-free").click();
  await expect(page.getByTestId("admin-error")).toHaveCount(0);
  await page.screenshot({
    path: "../.runtime/admin-plans-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("admin-tab-gateways").click();
  await expect(page.getByTestId("admin-gateways")).toBeVisible();
  await page.screenshot({
    path: "../.runtime/admin-gateways-desktop.png",
    fullPage: true,
  });
  await page.getByTestId("admin-tab-payments").click();
  await page.getByTestId("admin-tab-audit").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.runtime/admin-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId("admin-tab-overview").click();
  await page.screenshot({
    path: "../.runtime/admin-overview-desktop.png",
    fullPage: true,
  });
});
