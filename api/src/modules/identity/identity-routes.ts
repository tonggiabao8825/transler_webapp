import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { audit, rows, transaction } from "../../infrastructure/database.js";
import {
  accountRecord,
  accountView,
  cleanName,
  loginBody,
  profileView,
  registration,
  sessionView,
  uuid,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { effectivePlan, profile } from "../usage/usage.js";

import {
  authenticated,
  encodePassword,
  guestRecord,
  issueLogin,
  rateLimit,
  registerAccount,
  requireAccount,
  requireOwner,
  sessionResponse,
  tokenHash,
} from "./identity.js";
export async function identityRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.post(
    "/v1/session",
    { schema: { response: { 200: sessionView } } },
    async (request, reply) => {
      await rateLimit(context, `rate:session:${request.ip}`, 30);
      const account = await authenticated(context, request);
      if (account)
        return sessionResponse(
          context,
          account.workspace_id,
          account.login_expires_at,
          accountView.parse(account),
          await effectivePlan(context.pool, account, new Date()),
        );
      const token = request.cookies.transler_session;
      const [existing] = token
        ? await rows(
            context.pool,
            "SELECT id,expires_at FROM sessions WHERE token_hash=$1 AND expires_at>NOW() AND NOT EXISTS(SELECT 1 FROM accounts WHERE workspace_id=sessions.id)",
            [tokenHash(token)],
            guestRecord,
          )
        : [];
      if (existing)
        return sessionResponse(
          context,
          existing.id,
          existing.expires_at,
          null,
          null,
        );
      const id = randomUUID();
      const nextToken = randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + 7 * 86400_000);
      await context.pool.query(
        "INSERT INTO sessions(id,token_hash,expires_at) VALUES($1,$2,$3)",
        [id, tokenHash(nextToken), expires],
      );
      reply.setCookie("transler_session", nextToken, {
        httpOnly: true,
        secure: context.config.TRANSLER_SECURE_COOKIE === "true",
        sameSite: "strict",
        maxAge: 7 * 86400,
        path: "/",
      });
      return sessionResponse(context, id, expires, null, null);
    },
  );
  app.post(
    "/v1/auth/register",
    { schema: { body: registration, response: { 201: accountView } } },
    async (request, reply) => {
      await rateLimit(context, `rate:register:${request.ip}`, 10);
      const owner = await requireOwner(context, request);
      const account = await transaction(context.pool, (connection) =>
        registerAccount(connection, owner, request.body),
      );
      await issueLogin(context, account.id, reply);
      return reply.code(201).send(account);
    },
  );
  app.post(
    "/v1/auth/login",
    { schema: { body: loginBody, response: { 200: accountView } } },
    async (request, reply) => {
      await rateLimit(context, `rate:login:${request.ip}`, 10);
      await rateLimit(
        context,
        `rate:email:${tokenHash(request.body.email)}`,
        10,
      );
      const [account] = await rows(
        context.pool,
        "SELECT * FROM accounts WHERE email=$1",
        [request.body.email],
        accountRecord,
      );
      if (!account) {
        await encodePassword(request.body.password);
        throw new ServiceError(
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
          401,
        );
      }
      if (!(await argon2.verify(account.password_hash, request.body.password)))
        throw new ServiceError(
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
          401,
        );
      if (!account.is_active)
        throw new ServiceError(
          "ACCOUNT_DISABLED",
          "This account is disabled. Contact an administrator.",
          403,
        );
      await issueLogin(context, account.id, reply);
      return accountView.parse(account);
    },
  );
  app.post("/v1/auth/logout", async (request, reply) => {
    await rateLimit(context, `rate:logout:${request.ip}`, 30);
    const token = request.cookies.transler_auth;
    if (token) {
      const revoked = await rows(
        context.pool,
        "DELETE FROM auth_sessions WHERE token_hash=$1 RETURNING account_id",
        [tokenHash(token)],
        z.object({ account_id: uuid }),
      );
      const owner = revoked[0];
      if (owner)
        await audit(
          context.pool,
          owner.account_id,
          "account.logout",
          owner.account_id,
          "Current session revoked.",
        );
    }
    return reply.clearCookie("transler_auth", { path: "/" }).code(204).send();
  });
  app.get(
    "/v1/account",
    { schema: { response: { 200: profileView } } },
    async (request) =>
      profile(context.pool, await requireAccount(context, request), new Date()),
  );
  app.patch(
    "/v1/account",
    {
      schema: {
        body: z.object({ name: cleanName }),
        response: { 200: accountView },
      },
    },
    async (request) => {
      const account = await requireAccount(context, request);
      return transaction(context.pool, async (connection) => {
        const [next] = await rows(
          connection,
          "UPDATE accounts SET name=$1 WHERE id=$2 RETURNING *",
          [request.body.name, account.id],
          accountView,
        );
        if (!next)
          throw new ServiceError(
            "ACCOUNT_NOT_FOUND",
            "Account no longer exists.",
            404,
          );
        await audit(
          connection,
          account.id,
          "account.profile",
          account.id,
          "Display name updated.",
        );
        return next;
      });
    },
  );
  app.post(
    "/v1/account/password",
    {
      schema: {
        body: z.object({
          current_password: z.string().min(1).max(128),
          new_password: z.string().min(12).max(128),
        }),
      },
    },
    async (request, reply) => {
      const account = await requireAccount(context, request);
      await rateLimit(context, `rate:password:${account.id}`, 5);
      await transaction(context.pool, async (connection) => {
        const [current] = await rows(
          connection,
          "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
          [account.id],
          accountRecord,
        );
        if (!current)
          throw new ServiceError(
            "ACCOUNT_NOT_FOUND",
            "Account no longer exists.",
            404,
          );
        if (
          !(await argon2.verify(
            current.password_hash,
            request.body.current_password,
          ))
        )
          throw new ServiceError(
            "INVALID_PASSWORD",
            "Current password is incorrect.",
            403,
          );
        await connection.query(
          "UPDATE accounts SET password_hash=$1 WHERE id=$2",
          [await encodePassword(request.body.new_password), account.id],
        );
        await connection.query(
          "DELETE FROM auth_sessions WHERE account_id=$1",
          [account.id],
        );
        await audit(
          connection,
          account.id,
          "account.password",
          account.id,
          "Password changed; all login sessions revoked.",
        );
      });
      return reply.clearCookie("transler_auth", { path: "/" }).code(204).send();
    },
  );
}
