import { z } from "zod";
import type { Context } from "../../app/context.js";
import { audit, rows, transaction } from "../../infrastructure/database.js";
import type { Account } from "../../shared/contracts.js";
import {
  accountUpdate,
  accountView,
  planView,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { scalarCount } from "../usage/usage.js";
export async function updateManagedAccount(
  context: Context,
  adminId: string,
  accountId: string,
  body: z.infer<typeof accountUpdate>,
): Promise<Account> {
  return transaction(context.pool, async (connection) => {
    await connection.query(
      "SELECT id FROM accounts WHERE role='admin' ORDER BY id FOR UPDATE",
    );
    const [current] = await rows(
      connection,
      "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
      [accountId],
      accountView,
    );
    if (!current)
      throw new ServiceError(
        "ACCOUNT_NOT_FOUND",
        "Account does not exist.",
        404,
      );
    if (
      current.role === "admin" &&
      current.is_active &&
      (body.role !== "admin" || !body.is_active) &&
      (await scalarCount(
        connection,
        "SELECT COUNT(*) AS count FROM accounts WHERE role='admin' AND is_active=TRUE",
        [],
      )) === 1
    )
      throw new ServiceError(
        "LAST_ADMIN",
        "Keep at least one active administrator.",
        409,
      );
    const [plan] = await rows(
      connection,
      "SELECT * FROM plans WHERE code=$1",
      [body.plan_code],
      planView,
    );
    if (!plan)
      throw new ServiceError("PLAN_NOT_FOUND", "Select an existing plan.", 404);
    const [next] = await rows(
      connection,
      "UPDATE accounts SET name=$1,role=$2,is_active=$3,plan_code=$4,plan_expires_at=$5 WHERE id=$6 RETURNING *",
      [
        body.name,
        body.role,
        body.is_active,
        body.plan_code,
        body.plan_expires_at,
        accountId,
      ],
      accountView,
    );
    if (!next)
      throw new ServiceError(
        "ACCOUNT_NOT_FOUND",
        "Account disappeared during update.",
        404,
      );
    if (!body.is_active)
      await connection.query("DELETE FROM auth_sessions WHERE account_id=$1", [
        next.id,
      ]);
    await audit(
      connection,
      adminId,
      "admin.account",
      next.id,
      JSON.stringify(body),
    );
    return next;
  });
}
