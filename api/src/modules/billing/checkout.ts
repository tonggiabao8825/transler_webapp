import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { Context } from "../../app/context.js";
import {
  audit,
  rows,
  transaction,
  type SqlConnection,
} from "../../infrastructure/database.js";
import type { Account, Order } from "../../shared/contracts.js";
import {
  billingOptions,
  checkoutBody,
  checkoutView,
  orderRecord,
  orderView,
  planView,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { retryService } from "../../shared/retries.js";
import { gateway, gatewayOptions } from "./gateways.js";

export async function options(
  context: Context,
): Promise<z.infer<typeof billingOptions>> {
  return gatewayOptions(context);
}
export async function sepayConfig(
  context: Context,
): Promise<{ bank: string; account: string; name: string; secret: string }> {
  const configured = await gateway(context, "sepay");
  if (
    !configured.enabled ||
    !configured.settings.bank_code ||
    !configured.settings.account_number ||
    !configured.settings.account_name ||
    !configured.secrets.webhook_key
  )
    throw new ServiceError(
      "SEPAY_NOT_CONFIGURED",
      "Enable and configure SePay in Administration → Payment gateways.",
      503,
    );
  return {
    bank: configured.settings.bank_code,
    account: configured.settings.account_number,
    name: configured.settings.account_name,
    secret: configured.secrets.webhook_key,
  };
}
export async function stripeClient(context: Context): Promise<Stripe> {
  const configured = await gateway(context, "stripe");
  if (
    !configured.enabled ||
    !configured.secrets.secret_key ||
    !configured.secrets.webhook_key
  )
    throw new ServiceError(
      "STRIPE_NOT_CONFIGURED",
      "Enable and configure Stripe in Administration → Payment gateways.",
      503,
    );
  return new Stripe(configured.secrets.secret_key, {
    maxNetworkRetries: 0,
    timeout: 30000,
  });
}
export async function ownedOrder(
  connection: SqlConnection,
  account: string,
  id: string,
): Promise<Order> {
  const [order] = await rows(
    connection,
    "SELECT * FROM payment_orders WHERE id=$1 AND account_id=$2",
    [id, account],
    orderRecord,
  );
  if (!order)
    throw new ServiceError(
      "ORDER_NOT_FOUND",
      "Payment order does not exist in this account.",
      404,
    );
  return order;
}
export async function instructions(
  context: Context,
  order: Order,
): Promise<z.infer<typeof checkoutView>> {
  const publicOrder = orderView.parse(order);
  if (order.provider !== "sepay" || order.status !== "PENDING")
    return {
      order: publicOrder,
      bank_code: null,
      bank_account: null,
      bank_name: null,
      qr_url: null,
    };
  const bank = await sepayConfig(context);
  const params = new URLSearchParams({
    bank: bank.bank,
    acc: bank.account,
    holder: bank.name,
    amount: String(order.amount),
    des: order.reference,
    template: "compact",
  });
  return {
    order: publicOrder,
    bank_code: bank.bank,
    bank_account: bank.account,
    bank_name: bank.name,
    qr_url: `https://vietqr.app/img?${params}`,
  };
}
export async function createCheckout(
  context: Context,
  account: Account,
  body: z.infer<typeof checkoutBody>,
): Promise<z.infer<typeof checkoutView>> {
  if (body.provider === "sepay") await sepayConfig(context);
  else await stripeClient(context);
  let order = await transaction(context.pool, async (connection) => {
    await connection.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
      account.id,
    ]);
    const [existing] = await rows(
      connection,
      "SELECT * FROM payment_orders WHERE account_id=$1 AND request_id=$2",
      [account.id, body.request_id],
      orderRecord,
    );
    if (existing) {
      if (
        existing.plan_code !== body.plan_code ||
        existing.provider !== body.provider ||
        existing.billing_cycle !== body.billing_cycle
      )
        throw new ServiceError(
          "CHECKOUT_CONFLICT",
          "Request ID was already used for another plan or payment method.",
          409,
        );
      return existing;
    }
    await connection.query(
      "UPDATE payment_orders SET status='EXPIRED' WHERE account_id=$1 AND status='PENDING' AND expires_at<=NOW()",
      [account.id],
    );
    const [pending] = await rows(
      connection,
      "SELECT * FROM payment_orders WHERE account_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1",
      [account.id],
      orderRecord,
    );
    if (pending)
      throw new ServiceError(
        "PAYMENT_ORDER_PENDING",
        `Payment order ${pending.id} is still pending until ${pending.expires_at.toISOString()}. Complete or cancel it before creating another order.`,
        409,
      );
    const [plan] = await rows(
      connection,
      "SELECT * FROM plans WHERE code=$1 AND enabled=TRUE",
      [body.plan_code],
      planView,
    );
    if (!plan || plan.code === "free")
      throw new ServiceError(
        "PLAN_NOT_PURCHASABLE",
        "Choose an enabled paid plan.",
        422,
      );
    const amount =
      body.billing_cycle === "yearly"
        ? body.provider === "sepay"
          ? plan.yearly_price_vnd
          : plan.yearly_price_usd_cents
        : body.provider === "sepay"
          ? plan.price_vnd
          : plan.price_usd_cents;
    if (amount === null)
      throw new ServiceError(
        "PLAN_PRICE_REQUIRED",
        "An administrator must configure the selected billing cycle and currency price before checkout.",
        503,
      );
    const id = randomUUID();
    const reference = "TL" + id.replaceAll("-", "").toUpperCase();
    const [next] = await rows(
      connection,
      "INSERT INTO payment_orders(id,account_id,request_id,plan_code,provider,amount,currency,duration_days,reference,checkout_id,checkout_url,status,created_at,expires_at,paid_at,review_reason,billing_cycle) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,'PENDING',NOW(),NOW()+INTERVAL '1 hour',NULL,NULL,$10) RETURNING *",
      [
        id,
        account.id,
        body.request_id,
        plan.code,
        body.provider,
        amount,
        body.provider === "sepay" ? "vnd" : "usd",
        body.billing_cycle === "yearly" ? 365 : 30,
        reference,
        body.billing_cycle,
      ],
      orderRecord,
    );
    if (!next)
      throw new ServiceError(
        "CHECKOUT_CREATE_FAILED",
        "Database did not return the payment order.",
        503,
      );
    await audit(
      connection,
      account.id,
      "billing.checkout",
      next.id,
      `${next.amount} ${next.currency}; ${next.provider}; ${next.plan_code}.`,
    );
    return next;
  });
  if (
    order.status === "EXPIRED" ||
    (order.status === "PENDING" && order.expires_at <= new Date())
  )
    throw new ServiceError(
      "ORDER_EXPIRED",
      "Checkout expired. Create a new payment order.",
      410,
    );
  if (
    order.provider !== "sepay" &&
    order.checkout_url === null &&
    order.status === "PENDING"
  ) {
    order = await transaction(context.pool, async (connection) => {
      await connection.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        account.id,
      ]);
      const current = await ownedOrder(connection, account.id, order.id);
      if (current.status !== "PENDING" || current.checkout_url !== null)
        return current;
      const client = await stripeClient(context);
      const publicUrl = context.config.TRANSLER_PUBLIC_URL.replace(/\/$/, "");
      const parameters: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        client_reference_id: order.id,
        customer_email: account.email,
        success_url: `${publicUrl}/account?payment=${order.id}`,
        cancel_url: `${publicUrl}/account`,
        expires_at: Math.floor(order.expires_at.getTime() / 1000),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: order.amount,
              product_data: {
                name: `Transler ${order.plan_code} — ${order.duration_days} days`,
              },
            },
          },
        ],
      };
      if (order.provider === "card")
        parameters.allowed_payment_method_types = ["card"];
      const result = await retryService(
        context.logger,
        "stripe.checkout",
        async () => {
          try {
            return await client.checkout.sessions.create(parameters, {
              idempotencyKey: order.id,
            });
          } catch (error) {
            if (error instanceof Stripe.errors.StripeError)
              throw new ServiceError(
                "STRIPE_CHECKOUT_FAILED",
                `Stripe Checkout order=${order.id}, HTTP ${error.statusCode ?? 503}: ${error.message}`,
                error.statusCode ?? 503,
              );
            throw error;
          }
        },
      );
      if (!result.url || new URL(result.url).hostname !== "checkout.stripe.com")
        throw new ServiceError(
          "INVALID_CHECKOUT_URL",
          "Stripe omitted a valid Checkout URL.",
          502,
        );
      await connection.query(
        "UPDATE payment_orders SET checkout_id=$1,checkout_url=$2 WHERE id=$3",
        [result.id, result.url, order.id],
      );
      return ownedOrder(connection, account.id, order.id);
    });
  }
  return instructions(context, order);
}
