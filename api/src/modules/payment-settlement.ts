import { z } from "zod";
import type { Context } from "../context.js";
import type { Order } from "../contracts.js";
import { accountView, orderRecord } from "../contracts.js";
import { audit, rows, transaction, type SqlConnection } from "../database.js";
import { ServiceError } from "../errors.js";

export async function activateOrder(
  connection: SqlConnection,
  order: Order,
  actor: string | null,
): Promise<void> {
  const [account] = await rows(
    connection,
    "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
    [order.account_id],
    accountView,
  );
  if (!account)
    throw new ServiceError(
      "ACCOUNT_NOT_FOUND",
      "Payment account no longer exists.",
      404,
    );
  const now = new Date();
  const base =
    account.plan_code === order.plan_code &&
    account.plan_expires_at &&
    account.plan_expires_at > now
      ? account.plan_expires_at
      : now;
  const expires = new Date(base.getTime() + order.duration_days * 86400_000);
  await connection.query(
    "UPDATE accounts SET plan_code=$1,plan_expires_at=$2 WHERE id=$3",
    [order.plan_code, expires, account.id],
  );
  await connection.query(
    "UPDATE payment_orders SET status='PAID',paid_at=NOW(),review_reason=NULL WHERE id=$1",
    [order.id],
  );
  await audit(
    connection,
    actor,
    "billing.activate",
    order.id,
    `Payment confirmed; ${order.plan_code} activated for ${order.duration_days} days.`,
  );
}
type Settlement = {
  provider: "sepay" | "stripe";
  eventId: string;
  reference: string | null;
  checkoutId: string | null;
  amount: number;
  currency: string;
  paidAt: Date;
  fingerprint: string;
};
export async function settle(
  context: Context,
  payment: Settlement,
): Promise<boolean> {
  return transaction(context.pool, async (connection) => {
    const created = await connection.query(
      "INSERT INTO payment_events(provider,event_id,order_id,fingerprint,outcome,received_at) VALUES($1,$2,NULL,$3,'received',NOW()) ON CONFLICT(provider,event_id) DO NOTHING RETURNING event_id",
      [payment.provider, payment.eventId, payment.fingerprint],
    );
    if (!created.rowCount) {
      const [previous] = await rows(
        connection,
        "SELECT fingerprint,outcome FROM payment_events WHERE provider=$1 AND event_id=$2",
        [payment.provider, payment.eventId],
        z.object({ fingerprint: z.string(), outcome: z.string() }),
      );
      if (!previous || previous.fingerprint !== payment.fingerprint)
        throw new ServiceError(
          "PAYMENT_EVENT_CONFLICT",
          "Gateway reused an event ID with different payment data.",
          409,
        );
      return ["paid", "already_paid"].includes(previous.outcome);
    }
    let [order] = payment.reference
      ? await rows(
          connection,
          "SELECT * FROM payment_orders WHERE reference=$1",
          [payment.reference],
          orderRecord,
        )
      : [];
    if (order) {
      await connection.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        order.account_id,
      ]);
      [order] = await rows(
        connection,
        "SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE",
        [order.id],
        orderRecord,
      );
    }
    let outcome = "unmatched_reference";
    if (order) {
      if (
        (payment.provider === "sepay" && order.provider !== "sepay") ||
        (payment.provider === "stripe" && order.provider === "sepay")
      )
        throw new ServiceError(
          "PAYMENT_PROVIDER_MISMATCH",
          "Payment provider does not match this order.",
          422,
        );
      if (
        payment.checkoutId !== null &&
        order.checkout_id !== null &&
        payment.checkoutId !== order.checkout_id
      )
        throw new ServiceError(
          "CHECKOUT_ID_MISMATCH",
          "Stripe Checkout ID does not match this order.",
          422,
        );
      if (order.status === "PAID") outcome = "already_paid";
      else if (order.status === "REVIEW") outcome = "review_required";
      else if (
        order.status === "CANCELLED" ||
        payment.amount !== order.amount ||
        payment.currency !== order.currency ||
        payment.paidAt > order.expires_at ||
        payment.paidAt.getTime() < order.created_at.getTime() - 300000
      ) {
        const reason = `Order status ${order.status}. Received ${payment.amount} ${payment.currency}; expected ${order.amount} ${order.currency}. Payment time ${payment.paidAt.toISOString()}; expires ${order.expires_at.toISOString()}.`;
        await connection.query(
          "UPDATE payment_orders SET status='REVIEW',review_reason=$1 WHERE id=$2",
          [reason.slice(0, 255), order.id],
        );
        await audit(connection, null, "billing.review", order.id, reason);
        outcome = "review_required";
      } else {
        await activateOrder(connection, order, null);
        outcome = "paid";
      }
    }
    await connection.query(
      "UPDATE payment_events SET order_id=$1,outcome=$2 WHERE provider=$3 AND event_id=$4",
      [order?.id ?? null, outcome, payment.provider, payment.eventId],
    );
    if (!["paid", "already_paid"].includes(outcome))
      context.logger.warn(
        {
          provider: payment.provider,
          event_id: payment.eventId,
          order_id: order?.id,
          outcome,
        },
        "Payment requires attention",
      );
    return ["paid", "already_paid"].includes(outcome);
  });
}
