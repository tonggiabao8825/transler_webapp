import { z } from "zod";
import {
  accountSchema,
  adminAccountSchema,
  adminOrderSchema,
  auditSchema,
  orderSchema,
  overviewSchema,
  paymentEventSchema,
  planSchema,
  type Account,
  type AccountEdit,
  type AdminOrder,
  type Order,
  type Plan,
} from "./account-contracts";
import { request } from "./http";
export class AdminApi {
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
