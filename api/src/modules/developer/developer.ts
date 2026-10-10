import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { audit, rows, transaction } from "../../infrastructure/database.js";
import { nullableDate, timestamp, uuid } from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { requireAccount, tokenHash } from "../identity/identity.js";
const keyView = z.object({
  id: uuid,
  name: z.string(),
  prefix: z.string(),
  created_at: timestamp,
  expires_at: timestamp,
  last_used_at: nullableDate,
});
export async function developerRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.get(
    "/v1/account/api-keys",
    { schema: { response: { 200: z.array(keyView) } } },
    async (request) => {
      const account = await requireAccount(context, request);
      return rows(
        context.pool,
        "SELECT * FROM api_keys WHERE account_id=$1 ORDER BY created_at DESC",
        [account.id],
        keyView,
      );
    },
  );
  app.post(
    "/v1/account/api-keys",
    {
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(80),
          expires_at: timestamp,
        }),
        response: { 201: z.object({ key: keyView, token: z.string() }) },
      },
    },
    async (request, reply) => {
      const account = await requireAccount(context, request);
      if (
        request.body.expires_at <= new Date() ||
        request.body.expires_at.getTime() > Date.now() + 366 * 86400000
      )
        throw new ServiceError(
          "INVALID_KEY_EXPIRATION",
          "API keys must expire within the next 366 days.",
          422,
        );
      const token = "tr_" + randomBytes(32).toString("base64url");
      const key = await transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
          [account.id],
        );
        const count = await rows(
          connection,
          "SELECT count(*)::int AS count FROM api_keys WHERE account_id=$1 AND expires_at>NOW()",
          [account.id],
          z.object({ count: z.number().int() }),
        );
        if (count[0] && count[0].count >= 10)
          throw new ServiceError(
            "API_KEY_LIMIT",
            "Revoke an existing key before creating another; maximum 10 active keys.",
            429,
          );
        const [next] = await rows(
          connection,
          "INSERT INTO api_keys(id,account_id,name,token_hash,prefix,created_at,expires_at) VALUES($1,$2,$3,$4,$5,NOW(),$6) RETURNING *",
          [
            randomUUID(),
            account.id,
            request.body.name,
            tokenHash(token),
            token.slice(0, 12),
            request.body.expires_at,
          ],
          keyView,
        );
        if (!next)
          throw new ServiceError(
            "API_KEY_CREATE_FAILED",
            "Database did not return the API key.",
            503,
          );
        await audit(
          connection,
          account.id,
          "api_key.create",
          next.id,
          next.name,
        );
        return next;
      });
      return reply.code(201).send({ key, token });
    },
  );
  app.delete(
    "/v1/account/api-keys/:id",
    { schema: { params: z.object({ id: uuid }) } },
    async (request, reply) => {
      const account = await requireAccount(context, request);
      const removed = await context.pool.query(
        "DELETE FROM api_keys WHERE id=$1 AND account_id=$2 RETURNING id",
        [request.params.id, account.id],
      );
      if (!removed.rowCount)
        throw new ServiceError(
          "API_KEY_NOT_FOUND",
          "API key does not exist in your account.",
          404,
        );
      return reply.code(204).send();
    },
  );
}
