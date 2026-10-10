import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { audit, rows, transaction } from "../../infrastructure/database.js";
import {
  accountUpdate,
  accountView,
  adminAccountView,
  adminOverview,
  auditView,
  pagination,
  planUpdate,
  planView,
  uuid,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { requireAccount, requireAdmin } from "../identity/identity.js";
import { dailyUsage, translationReport, usage } from "../usage/usage.js";
import { updateManagedAccount } from "./accounts-service.js";

export async function adminRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.get(
    "/v1/plans",
    { schema: { response: { 200: z.array(planView) } } },
    async () =>
      rows(
        context.pool,
        "SELECT * FROM plans WHERE enabled=TRUE ORDER BY monthly_pages",
        [],
        planView,
      ),
  );
  app.get(
    "/v1/admin/overview",
    { schema: { response: { 200: adminOverview } } },
    async (request) => {
      await requireAdmin(context, request);
      const aggregate = z.object({
        accounts: z.coerce.number().int(),
        active_accounts: z.coerce.number().int(),
        paid_accounts: z.coerce.number().int(),
        documents: z.coerce.number().int(),
        jobs: z.coerce.number().int(),
        failed_jobs: z.coerce.number().int(),
        active_jobs: z.coerce.number().int(),
        revenue_vnd: z.coerce.number().int(),
        revenue_usd_cents: z.coerce.number().int(),
      });
      const result = await context.pool.query(
        `SELECT (SELECT COUNT(*) FROM accounts) AS accounts,(SELECT COUNT(*) FROM accounts WHERE is_active=TRUE) AS active_accounts,(SELECT COUNT(*) FROM accounts WHERE plan_code<>'free' AND plan_expires_at>NOW()) AS paid_accounts,(SELECT COUNT(*) FROM documents) AS documents,(SELECT COUNT(*) FROM jobs) AS jobs,(SELECT COUNT(*) FROM jobs WHERE status='FAILED') AS failed_jobs,(SELECT COUNT(*) FROM jobs WHERE status IN ('QUEUED','PROCESSING','RETRYING','CANCELLING')) AS active_jobs,(SELECT COALESCE(SUM(amount),0) FROM payment_orders WHERE status='PAID' AND currency='vnd') AS revenue_vnd,(SELECT COALESCE(SUM(amount),0) FROM payment_orders WHERE status='PAID' AND currency='usd') AS revenue_usd_cents`,
      );
      const [record] = z.array(aggregate).parse(result.rows);
      if (!record)
        throw new ServiceError(
          "ADMIN_STATS_FAILED",
          "Database did not return administration statistics.",
          503,
        );
      return adminOverview.parse({
        ...record,
        daily: await dailyUsage(context.pool, null, new Date()),
      });
    },
  );
  app.get(
    "/v1/admin/accounts",
    {
      schema: {
        querystring: pagination,
        response: { 200: z.array(adminAccountView) },
      },
    },
    async (request) => {
      await requireAdmin(context, request);
      const accounts = await rows(
        context.pool,
        "SELECT * FROM accounts ORDER BY created_at DESC OFFSET $1 LIMIT $2",
        [request.query.offset, request.query.limit],
        accountView,
      );
      return Promise.all(
        accounts.map(async (account) => ({
          account,
          usage: await usage(context.pool, account.workspace_id, new Date()),
        })),
      );
    },
  );
  app.patch(
    "/v1/admin/accounts/:id",
    {
      schema: {
        params: z.object({ id: uuid }),
        body: accountUpdate,
        response: { 200: accountView },
      },
    },
    async (request) => {
      const admin = await requireAdmin(context, request);
      return updateManagedAccount(
        context,
        admin.id,
        request.params.id,
        request.body,
      );
    },
  );
  app.get(
    "/v1/admin/plans",
    { schema: { response: { 200: z.array(planView) } } },
    async (request) => {
      await requireAdmin(context, request);
      return rows(
        context.pool,
        "SELECT * FROM plans ORDER BY code",
        [],
        planView,
      );
    },
  );
  app.post(
    "/v1/admin/plans",
    {
      schema: {
        body: planUpdate.extend({
          code: z.string().regex(/^[a-z][a-z0-9_-]{1,23}$/),
        }),
        response: { 201: planView },
      },
    },
    async (request, reply) => {
      const admin = await requireAdmin(context, request);
      const body = request.body;
      const plan = await transaction(context.pool, async (connection) => {
        const [next] = await rows(
          connection,
          "INSERT INTO plans(code,name,monthly_pages,document_limit,max_active_jobs,duration_days,price_vnd,price_usd_cents,enabled,yearly_price_vnd,yearly_price_usd_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            body.code,
            body.name,
            body.monthly_pages,
            body.document_limit,
            body.max_active_jobs,
            body.duration_days,
            body.price_vnd,
            body.price_usd_cents,
            body.enabled,
            body.yearly_price_vnd,
            body.yearly_price_usd_cents,
          ],
          planView,
        );
        if (!next)
          throw new ServiceError(
            "PLAN_CREATE_FAILED",
            "Database did not return the plan.",
            503,
          );
        await audit(
          connection,
          admin.id,
          "admin.plan.create",
          next.code,
          JSON.stringify(body),
        );
        return next;
      });
      return reply.code(201).send(plan);
    },
  );
  app.put(
    "/v1/admin/plans/:code",
    {
      schema: {
        params: z.object({ code: z.string().min(1).max(24) }),
        body: planUpdate,
        response: { 200: planView },
      },
    },
    async (request) => {
      const admin = await requireAdmin(context, request);
      const body = request.body;
      if (
        request.params.code === "free" &&
        (!body.enabled ||
          body.price_vnd !== null ||
          body.price_usd_cents !== null)
      )
        throw new ServiceError(
          "INVALID_FREE_PLAN",
          "Free must remain enabled and have no payment price.",
          422,
        );
      return transaction(context.pool, async (connection) => {
        const [plan] = await rows(
          connection,
          "UPDATE plans SET name=$1,monthly_pages=$2,document_limit=$3,max_active_jobs=$4,duration_days=$5,price_vnd=$6,price_usd_cents=$7,enabled=$8,yearly_price_vnd=$10,yearly_price_usd_cents=$11 WHERE code=$9 RETURNING *",
          [
            body.name,
            body.monthly_pages,
            body.document_limit,
            body.max_active_jobs,
            body.duration_days,
            body.price_vnd,
            body.price_usd_cents,
            body.enabled,
            request.params.code,
            body.yearly_price_vnd,
            body.yearly_price_usd_cents,
          ],
          planView,
        );
        if (!plan)
          throw new ServiceError("PLAN_NOT_FOUND", "Plan does not exist.", 404);
        await audit(
          connection,
          admin.id,
          "admin.plan",
          plan.code,
          JSON.stringify(body),
        );
        return plan;
      });
    },
  );
  app.get(
    "/v1/admin/audit",
    {
      schema: {
        querystring: pagination,
        response: { 200: z.array(auditView) },
      },
    },
    async (request) => {
      await requireAdmin(context, request);
      return rows(
        context.pool,
        "SELECT * FROM audit_events ORDER BY created_at DESC OFFSET $1 LIMIT $2",
        [request.query.offset, request.query.limit],
        auditView,
      );
    },
  );
  app.get("/v1/admin/report", async (request, reply) => {
    await requireAdmin(context, request);
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="transler-platform-report.csv"',
      )
      .send(await translationReport(context.pool, null));
  });
  app.get("/v1/account/report", async (request, reply) => {
    const account = await requireAccount(context, request);
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="transler-usage.csv"',
      )
      .send(await translationReport(context.pool, account.workspace_id));
  });
}
