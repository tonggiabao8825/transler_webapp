import argon2 from "argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Context } from "../context.js";
import type { Account, Plan } from "../contracts.js";
import {
  accountRecord,
  accountView,
  registration,
  sessionView,
  uuid,
} from "../contracts.js";
import { audit, rows, transaction, type SqlConnection } from "../database.js";
import { ServiceError } from "../errors.js";
import { retryService } from "../retries.js";

const loginRecord = accountRecord.extend({ login_expires_at: z.coerce.date() });
export const guestRecord = z.object({ id: uuid, expires_at: z.coerce.date() });
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function ensureOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  let originHost: string | null = null;
  if (origin) {
    try {
      originHost = new URL(origin).host;
    } catch (error) {
      if (error instanceof TypeError)
        throw new ServiceError(
          "INVALID_ORIGIN",
          "Origin must be a valid same-origin URL.",
          403,
        );
      throw error;
    }
  }
  if (
    request.headers["sec-fetch-site"] === "cross-site" ||
    (originHost !== null && originHost !== request.headers.host)
  )
    throw new ServiceError(
      "CROSS_ORIGIN_DENIED",
      "Use Transler from the same origin as its API.",
      403,
    );
}
export async function rateLimit(
  context: Context,
  key: string,
  limit: number,
): Promise<void> {
  const value = await retryService(
    context.logger,
    "redis.rate_limit",
    async () => {
      try {
        return await context.redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
          { keys: [key], arguments: [] },
        );
      } catch (error) {
        if (error instanceof Error)
          throw new ServiceError(
            "RATE_LIMIT_UNAVAILABLE",
            `Redis rate limit failed: ${error.message}`,
            503,
          );
        throw error;
      }
    },
  );
  if (typeof value !== "number")
    throw new ServiceError(
      "INVALID_RATE_RESPONSE",
      "Redis rate-limit response must be an integer.",
      503,
    );
  if (value > limit)
    throw new ServiceError(
      "RATE_LIMIT_EXCEEDED",
      "Too many requests; retry in 60 seconds.",
      429,
    );
}
export async function authenticated(
  context: Context,
  request: FastifyRequest,
): Promise<z.infer<typeof loginRecord> | null> {
  const token = request.cookies.transler_auth;
  if (!token) return null;
  const [account] = await rows(
    context.pool,
    "SELECT a.*,s.expires_at AS login_expires_at FROM accounts a JOIN auth_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
    [tokenHash(token)],
    loginRecord,
  );
  if (!account)
    throw new ServiceError(
      "LOGIN_EXPIRED",
      "Your login has expired. Sign in again.",
      401,
    );
  if (!account.is_active)
    throw new ServiceError(
      "ACCOUNT_DISABLED",
      "This account is disabled. Contact an administrator.",
      403,
    );
  return account;
}
export async function requireAccount(
  context: Context,
  request: FastifyRequest,
): Promise<Account> {
  const account = await authenticated(context, request);
  if (!account)
    throw new ServiceError(
      "LOGIN_REQUIRED",
      "Sign in to access your account.",
      401,
    );
  await rateLimit(context, `rate:account:${account.id}`, 180);
  return accountView.parse(account);
}
export async function requireAdmin(
  context: Context,
  request: FastifyRequest,
): Promise<Account> {
  const account = await requireAccount(context, request);
  if (account.role !== "admin")
    throw new ServiceError(
      "ADMIN_REQUIRED",
      "Administrator access is required.",
      403,
    );
  return account;
}
export async function requireOwner(
  context: Context,
  request: FastifyRequest,
): Promise<string> {
  const authorization = request.headers.authorization;
  if (authorization) {
    if (!authorization.startsWith("Bearer tr_"))
      throw new ServiceError(
        "INVALID_API_TOKEN",
        "Use Authorization: Bearer <Transler API key>.",
        401,
      );
    const [key] = await rows(
      context.pool,
      "SELECT k.id,a.workspace_id,a.is_active FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.token_hash=$1 AND k.expires_at>NOW()",
      [tokenHash(authorization.slice(7))],
      z.object({ id: uuid, workspace_id: uuid, is_active: z.boolean() }),
    );
    if (!key)
      throw new ServiceError(
        "API_KEY_INVALID",
        "API key is invalid, revoked or expired.",
        401,
      );
    if (!key.is_active)
      throw new ServiceError(
        "ACCOUNT_DISABLED",
        "API key account is disabled.",
        403,
      );
    await rateLimit(context, `rate:owner:${key.workspace_id}`, 180);
    await context.pool.query(
      "UPDATE api_keys SET last_used_at=NOW() WHERE id=$1",
      [key.id],
    );
    return key.workspace_id;
  }
  const account = await authenticated(context, request);
  if (account) {
    await rateLimit(context, `rate:owner:${account.workspace_id}`, 180);
    return account.workspace_id;
  }
  const token = request.cookies.transler_session;
  if (!token)
    throw new ServiceError(
      "SESSION_REQUIRED",
      "Start a guest session before using Transler.",
      401,
    );
  const [guest] = await rows(
    context.pool,
    "SELECT id,expires_at FROM sessions WHERE token_hash=$1 AND expires_at>NOW() AND NOT EXISTS(SELECT 1 FROM accounts WHERE workspace_id=sessions.id)",
    [tokenHash(token)],
    guestRecord,
  );
  if (!guest)
    throw new ServiceError(
      "SESSION_EXPIRED",
      "Guest session expired; start a new session.",
      401,
    );
  await rateLimit(context, `rate:owner:${guest.id}`, 180);
  return guest.id;
}
export async function encodePassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 2,
  });
}
export async function issueLogin(
  context: Context,
  accountId: string,
  reply: FastifyReply,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await transaction(context.pool, async (connection) => {
    const [account] = await rows(
      connection,
      "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
      [accountId],
      accountView,
    );
    if (!account?.is_active)
      throw new ServiceError(
        "ACCOUNT_DISABLED",
        "This account is disabled.",
        403,
      );
    await connection.query("DELETE FROM auth_sessions WHERE expires_at<NOW()");
    await connection.query(
      "INSERT INTO auth_sessions(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 days')",
      [randomUUID(), accountId, tokenHash(token)],
    );
    await audit(
      connection,
      accountId,
      "account.login",
      accountId,
      "Authenticated session issued.",
    );
  });
  reply
    .setCookie("transler_auth", token, {
      httpOnly: true,
      secure: context.config.TRANSLER_SECURE_COOKIE === "true",
      sameSite: "strict",
      maxAge: 30 * 86400,
      path: "/",
    })
    .clearCookie("transler_session", { path: "/" });
}
export async function registerAccount(
  connection: SqlConnection,
  owner: string,
  body: z.infer<typeof registration>,
): Promise<Account> {
  const [workspace] = await rows(
    connection,
    "SELECT id,expires_at FROM sessions WHERE id=$1 AND expires_at>NOW() FOR UPDATE",
    [owner],
    guestRecord,
  );
  if (!workspace)
    throw new ServiceError(
      "SESSION_EXPIRED",
      "Start a new workspace before registering.",
      401,
    );
  const existing = await rows(
    connection,
    "SELECT * FROM accounts WHERE workspace_id=$1 OR email=$2",
    [owner, body.email],
    accountView,
  );
  if (existing.length)
    throw new ServiceError(
      "ACCOUNT_EXISTS",
      "This email or workspace already has an account. Sign in instead.",
      409,
    );
  const id = randomUUID();
  const passwordHash = await encodePassword(body.password);
  const [account] = await rows(
    connection,
    "INSERT INTO accounts(id,workspace_id,email,name,password_hash,role,is_active,plan_code,plan_expires_at,created_at) VALUES($1,$2,$3,$4,$5,'user',TRUE,'free',NULL,NOW()) RETURNING *",
    [id, owner, body.email, body.name, passwordHash],
    accountView,
  );
  if (!account)
    throw new ServiceError(
      "ACCOUNT_CREATE_FAILED",
      "Database did not return the newly registered account.",
      503,
    );
  await connection.query(
    "UPDATE sessions SET token_hash=$1,expires_at='2100-01-01T00:00:00Z' WHERE id=$2",
    [tokenHash(randomBytes(32).toString("hex")), owner],
  );
  const history = await connection.query(
    "SELECT j.id,j.status,j.created_at,j.total_units AS page_count FROM jobs j WHERE j.owner_id=$1 AND j.status IN ('COMPLETED','QUEUED','PROCESSING','RETRYING','CANCELLING') FOR UPDATE OF j",
    [owner],
  );
  const entries = z
    .array(
      z.object({
        id: uuid,
        status: z.string(),
        created_at: z.coerce.date(),
        page_count: z.number().int(),
      }),
    )
    .parse(history.rows);
  for (const entry of entries)
    await connection.query(
      "INSERT INTO usage_ledger(job_id,owner_id,pages,status,created_at) VALUES($1,$2,$3,$4,$5)",
      [
        entry.id,
        owner,
        entry.page_count,
        entry.status === "COMPLETED" ? "CONSUMED" : "RESERVED",
        entry.created_at,
      ],
    );
  await audit(
    connection,
    id,
    "account.register",
    id,
    "Existing guest documents retained by their registered owner.",
  );
  return account;
}
export function sessionResponse(
  context: Context,
  owner: string,
  expires: Date,
  account: Account | null,
  plan: Plan | null,
): z.infer<typeof sessionView> {
  return {
    owner_id: owner,
    expires_at: expires,
    page_limit: 30,
    upload_limit_bytes: context.config.TRANSLER_MAX_UPLOAD_BYTES,
    max_active_jobs: plan?.max_active_jobs ?? 2,
    account,
  };
}
