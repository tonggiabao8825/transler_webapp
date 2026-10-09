import { z } from "zod";
import {
  toolSettingSchema,
  toolSettingsSchema,
  type ToolId,
  type ToolSetting,
} from "./tool-contracts";
import { readResponse } from "./api";
import {
  accountSchema,
  adminOrderSchema,
  type AdminOrder,
  type BillingCycle,
  profileSchema,
  planSchema,
  optionsSchema,
  checkoutSchema,
  orderSchema,
  overviewSchema,
  adminAccountSchema,
  auditSchema,
  paymentEventSchema,
  type Account,
  type Profile,
  type Plan,
  type Checkout,
  type Order,
  type PaymentProvider,
  type AccountEdit,
} from "./account-contracts";
async function request<T extends z.ZodType>(
  path: string,
  method: string,
  body: object | null,
  schema: T,
): Promise<z.infer<T>> {
  return readResponse(
    await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : null,
    }),
    schema,
  );
}
async function emptyRequest(path: string, body: object | null): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : null,
  });
  if (!response.ok) await readResponse(response, z.never());
}
export class AccountApi {
  async login(email: string, password: string): Promise<Account> {
    return request(
      "/v1/auth/login",
      "POST",
      { email, password },
      accountSchema,
    );
  }
  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<Account> {
    return request(
      "/v1/auth/register",
      "POST",
      { name, email, password },
      accountSchema,
    );
  }
  async logout(): Promise<void> {
    await emptyRequest("/v1/auth/logout", null);
  }
  async profile(): Promise<Profile> {
    return request("/v1/account", "GET", null, profileSchema);
  }
  async rename(name: string): Promise<Account> {
    return request("/v1/account", "PATCH", { name }, accountSchema);
  }
  async password(
    current_password: string,
    new_password: string,
  ): Promise<void> {
    await emptyRequest("/v1/account/password", {
      current_password,
      new_password,
    });
  }
  async tools(): Promise<ToolSetting[]> {
    return request("/v1/tools", "GET", null, toolSettingsSchema);
  }
  async updateTool(id: ToolId, enabled: boolean): Promise<ToolSetting> {
    return request(
      `/v1/admin/tools/${id}`,
      "PUT",
      { enabled },
      toolSettingSchema,
    );
  }
  async plans(): Promise<Plan[]> {
    return request("/v1/plans", "GET", null, z.array(planSchema));
  }
  async options(): Promise<z.infer<typeof optionsSchema>> {
    return request("/v1/billing/options", "GET", null, optionsSchema);
  }
  async checkout(
    plan_code: string,
    provider: PaymentProvider,
    request_id: string,
    billing_cycle: BillingCycle,
  ): Promise<Checkout> {
    return request(
      "/v1/billing/checkout",
      "POST",
      { plan_code, provider, request_id, billing_cycle },
      checkoutSchema,
    );
  }
  async orders(): Promise<Order[]> {
    return request("/v1/billing/orders", "GET", null, z.array(orderSchema));
  }
  async order(id: string): Promise<Checkout> {
    return request(`/v1/billing/orders/${id}`, "GET", null, checkoutSchema);
  }
  async cancelOrder(id: string): Promise<Checkout> {
    return request(
      `/v1/billing/orders/${id}/cancel`,
      "POST",
      null,
      checkoutSchema,
    );
  }
  async overview(): Promise<z.infer<typeof overviewSchema>> {
    return request("/v1/admin/overview", "GET", null, overviewSchema);
  }
  async accounts(
    offset: number,
  ): Promise<Array<z.infer<typeof adminAccountSchema>>> {
    return request(
      `/v1/admin/accounts?offset=${offset}&limit=50`,
      "GET",
      null,
      z.array(adminAccountSchema),
    );
  }
  async updateAccount(id: string, body: AccountEdit): Promise<Account> {
    return request(`/v1/admin/accounts/${id}`, "PATCH", body, accountSchema);
  }
  async adminPlans(): Promise<Plan[]> {
    return request("/v1/admin/plans", "GET", null, z.array(planSchema));
  }
  async updatePlan(plan: Plan): Promise<Plan> {
    const { code, ...body } = plan;
    return request(`/v1/admin/plans/${code}`, "PUT", body, planSchema);
  }
  async audit(offset: number): Promise<Array<z.infer<typeof auditSchema>>> {
    return request(
      `/v1/admin/audit?offset=${offset}&limit=50`,
      "GET",
      null,
      z.array(auditSchema),
    );
  }
  async payments(offset: number): Promise<AdminOrder[]> {
    return request(
      `/v1/admin/orders?offset=${offset}&limit=50`,
      "GET",
      null,
      z.array(adminOrderSchema),
    );
  }
  async events(
    offset: number,
  ): Promise<Array<z.infer<typeof paymentEventSchema>>> {
    return request(
      `/v1/admin/payment-events?offset=${offset}&limit=50`,
      "GET",
      null,
      z.array(paymentEventSchema),
    );
  }
  async confirm(id: string): Promise<Order> {
    return request(`/v1/admin/orders/${id}/confirm`, "POST", null, orderSchema);
  }
}
export function money(amount: number, currency: "vnd" | "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(currency === "usd" ? amount / 100 : amount);
}
