import Stripe from "stripe";
import type { Context } from "../context.js";
import type { Order } from "../contracts.js";
import { orderRecord } from "../contracts.js";
import { audit, rows, transaction } from "../database.js";
import { ServiceError } from "../errors.js";
import { retryService } from "../retries.js";
import { stripeClient } from "./checkout.js";

export async function cancelOrder(
  context: Context,
  accountId: string,
  orderId: string,
): Promise<Order> {
  return transaction(context.pool, async (connection) => {
    await connection.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
      accountId,
    ]);
    const [order] = await rows(
      connection,
      "SELECT * FROM payment_orders WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [orderId, accountId],
      orderRecord,
    );
    if (!order)
      throw new ServiceError(
        "ORDER_NOT_FOUND",
        "Payment order does not exist in this account.",
        404,
      );
    if (order.status === "CANCELLED" || order.status === "EXPIRED")
      return order;
    if (order.status !== "PENDING")
      throw new ServiceError(
        "ORDER_NOT_CANCELLABLE",
        `Order ${order.id} is ${order.status}; only pending payments can be cancelled.`,
        409,
      );
    if (order.provider !== "sepay" && order.checkout_id !== null) {
      const stripe = await stripeClient(context);
      await retryService(context.logger, "stripe.cancel_checkout", async () => {
        try {
          const session = await stripe.checkout.sessions.retrieve(
            order.checkout_id!,
          );
          if (session.status === "expired") return;
          if (session.status !== "open")
            throw new ServiceError(
              "CHECKOUT_ALREADY_COMPLETED",
              `Stripe session for order ${order.id} is ${session.status}. Wait for payment verification before creating another order.`,
              409,
            );
          await stripe.checkout.sessions.expire(session.id);
        } catch (error) {
          if (error instanceof Stripe.errors.StripeError)
            throw new ServiceError(
              "STRIPE_CANCEL_FAILED",
              `Unable to cancel order ${order.id}; Stripe HTTP ${error.statusCode ?? 503}: ${error.message}`,
              error.statusCode ?? 503,
            );
          throw error;
        }
      });
    }
    const [cancelled] = await rows(
      connection,
      "UPDATE payment_orders SET status='CANCELLED' WHERE id=$1 RETURNING *",
      [order.id],
      orderRecord,
    );
    if (!cancelled)
      throw new ServiceError(
        "ORDER_CANCEL_FAILED",
        `Database did not return cancelled payment order ${order.id}.`,
        503,
      );
    await audit(
      connection,
      accountId,
      "billing.cancel",
      order.id,
      "Pending payment cancelled by its owner.",
    );
    return cancelled;
  });
}
