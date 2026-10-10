import { z } from "zod";
import {
  checkoutSchema,
  optionsSchema,
  orderSchema,
  planSchema,
  type BillingCycle,
  type Checkout,
  type Order,
  type PaymentProvider,
  type Plan,
} from "./account-contracts";
import { request } from "./http";
export class BillingApi {
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
}
