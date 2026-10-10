import { createHash } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { rows, transaction } from "../../infrastructure/database.js";
import {
  adminOrderView,
  billingOptions,
  checkoutBody,
  checkoutView,
  orderRecord,
  orderView,
  pagination,
  paymentEventView,
  sepayEvent,
  stripeEnvelope,
  stripePaymentEvent,
  uuid,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import {
  rateLimit,
  requireAccount,
  requireAdmin,
  sameSecret,
} from "../identity/identity.js";

import {
  createCheckout,
  instructions,
  options,
  ownedOrder,
  sepayConfig,
} from "./checkout.js";
import { gateway } from "./gateways.js";
import { cancelOrder } from "./payment-orders.js";
import { activateOrder, settle } from "./payment-settlement.js";
function fingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
export async function billingRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.get(
    "/v1/billing/options",
    { schema: { response: { 200: billingOptions } } },
    async () => options(context),
  );
  app.post(
    "/v1/billing/checkout",
    { schema: { body: checkoutBody, response: { 201: checkoutView } } },
    async (request, reply) => {
      const account = await requireAccount(context, request);
      await rateLimit(context, `rate:checkout:${account.id}`, 10);
      return reply
        .code(201)
        .send(await createCheckout(context, account, request.body));
    },
  );
  app.get(
    "/v1/billing/orders",
    { schema: { response: { 200: z.array(orderView) } } },
    async (request) => {
      const account = await requireAccount(context, request);
      await context.pool.query(
        "UPDATE payment_orders SET status='EXPIRED' WHERE account_id=$1 AND status='PENDING' AND expires_at<NOW()",
        [account.id],
      );
      return rows(
        context.pool,
        "SELECT * FROM payment_orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [account.id],
        orderView,
      );
    },
  );
  app.get(
    "/v1/billing/orders/:id",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: { 200: checkoutView },
      },
    },
    async (request) => {
      const account = await requireAccount(context, request);
      await context.pool.query(
        "UPDATE payment_orders SET status='EXPIRED' WHERE id=$1 AND account_id=$2 AND status='PENDING' AND expires_at<NOW()",
        [request.params.id, account.id],
      );
      return instructions(
        context,
        await ownedOrder(context.pool, account.id, request.params.id),
      );
    },
  );
  app.post(
    "/v1/billing/orders/:id/cancel",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: { 200: checkoutView },
      },
    },
    async (request) => {
      const account = await requireAccount(context, request);
      return instructions(
        context,
        await cancelOrder(context, account.id, request.params.id),
      );
    },
  );
  // Raw-body parsing is scoped to webhook routes to retain Stripe's exact signed bytes.
  await app.register(async (webhook) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhook.post("/v1/billing/webhooks/sepay", async (request) => {
      const bank = await sepayConfig(context);
      if (
        !sameSecret(
          String(request.headers.authorization ?? ""),
          `Apikey ${bank.secret}`,
        )
      )
        throw new ServiceError(
          "WEBHOOK_AUTH_FAILED",
          "SePay webhook API key authentication failed.",
          401,
        );
      const raw = z.instanceof(Buffer).parse(request.body);
      const event = sepayEvent.parse(JSON.parse(raw.toString("utf8")));
      if (event.accountNumber !== bank.account)
        throw new ServiceError(
          "BANK_ACCOUNT_MISMATCH",
          "SePay transfer account differs from the configured receiving account.",
          422,
        );
      if (event.transferType === "out")
        return { success: true, processed: false };
      const refs =
        event.content.toUpperCase().match(/\bTL[A-F0-9]{32}\b/g) ?? [];
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(event.transactionDate))
        throw new ServiceError(
          "INVALID_PAYMENT_DATE",
          "SePay transactionDate must be YYYY-MM-DD HH:MM:SS in Vietnam time.",
          422,
        );
      const paidAt = new Date(
        event.transactionDate.replace(" ", "T") + "+07:00",
      );
      if (Number.isNaN(paidAt.getTime()))
        throw new ServiceError(
          "INVALID_PAYMENT_DATE",
          "SePay transactionDate is invalid.",
          422,
        );
      return {
        success: true,
        processed: await settle(context, {
          provider: "sepay",
          eventId: String(event.id),
          reference: refs.length === 1 ? (refs[0] ?? null) : null,
          checkoutId: null,
          amount: event.transferAmount,
          currency: "vnd",
          paidAt,
          fingerprint: fingerprint(JSON.stringify(event)),
        }),
      };
    });
    webhook.post("/v1/billing/webhooks/stripe", async (request) => {
      const configured = await gateway(context, "stripe");
      const secret = configured.enabled ? configured.secrets.webhook_key : null;
      if (!secret)
        throw new ServiceError(
          "STRIPE_NOT_CONFIGURED",
          "Configure TRANSLER_STRIPE_WEBHOOK_SECRET.",
          503,
        );
      const raw = z.instanceof(Buffer).parse(request.body);
      const signature = z.string().parse(request.headers["stripe-signature"]);
      try {
        Stripe.webhooks.constructEvent(raw, signature, secret, 300);
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeSignatureVerificationError ||
          error instanceof SyntaxError
        )
          throw new ServiceError(
            "WEBHOOK_SIGNATURE_FAILED",
            "Stripe webhook signature verification failed.",
            400,
          );
        throw error;
      }
      const envelope = stripeEnvelope.parse(JSON.parse(raw.toString("utf8")));
      if (
        ![
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(envelope.type)
      )
        return { success: true, processed: false };
      const event = stripePaymentEvent.parse(JSON.parse(raw.toString("utf8")));
      const payment = event.data.object;
      if (payment.payment_status !== "paid")
        return { success: true, processed: false };
      return {
        success: true,
        processed: await settle(context, {
          provider: "stripe",
          eventId: event.id,
          reference:
            "TL" +
            payment.client_reference_id.replaceAll("-", "").toUpperCase(),
          checkoutId: payment.id,
          amount: payment.amount_total,
          currency: payment.currency,
          paidAt: new Date(event.created * 1000),
          fingerprint: fingerprint(JSON.stringify(event)),
        }),
      };
    });
  });
  app.get(
    "/v1/admin/orders",
    {
      schema: {
        querystring: pagination,
        response: { 200: z.array(adminOrderView) },
      },
    },
    async (request) => {
      await requireAdmin(context, request);
      return rows(
        context.pool,
        "SELECT o.*,a.email AS account_email,a.name AS account_name FROM payment_orders o JOIN accounts a ON a.id=o.account_id ORDER BY o.created_at DESC OFFSET $1 LIMIT $2",
        [request.query.offset, request.query.limit],
        adminOrderView,
      );
    },
  );
  app.get(
    "/v1/admin/payment-events",
    {
      schema: {
        querystring: pagination,
        response: { 200: z.array(paymentEventView) },
      },
    },
    async (request) => {
      await requireAdmin(context, request);
      return rows(
        context.pool,
        "SELECT * FROM payment_events ORDER BY received_at DESC OFFSET $1 LIMIT $2",
        [request.query.offset, request.query.limit],
        paymentEventView,
      );
    },
  );
  app.post(
    "/v1/admin/orders/:id/confirm",
    {
      schema: { params: z.object({ id: uuid }), response: { 200: orderView } },
    },
    async (request) => {
      const admin = await requireAdmin(context, request);
      return transaction(context.pool, async (connection) => {
        const [owner] = await rows(
          connection,
          "SELECT account_id FROM payment_orders WHERE id=$1",
          [request.params.id],
          z.object({ account_id: uuid }),
        );
        if (!owner)
          throw new ServiceError(
            "ORDER_NOT_FOUND",
            "Payment order does not exist.",
            404,
          );
        await connection.query(
          "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
          [owner.account_id],
        );
        const [order] = await rows(
          connection,
          "SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE",
          [request.params.id],
          orderRecord,
        );
        if (!order)
          throw new ServiceError(
            "ORDER_NOT_FOUND",
            "Payment order does not exist.",
            404,
          );
        if (order.status !== "REVIEW")
          throw new ServiceError(
            "ORDER_NOT_REVIEWABLE",
            "Only payments marked for review can be manually confirmed.",
            409,
          );
        await activateOrder(connection, order, admin.id);
        return orderView.parse(
          await ownedOrder(connection, order.account_id, order.id),
        );
      });
    },
  );
}
