import { z } from "zod";
import { rows, type SqlConnection } from "../../infrastructure/database.js";
import type { Account, Plan } from "../../shared/contracts.js";
import {
  accountView,
  dailyView,
  planView,
  profileView,
  usageView,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";

export function monthBounds(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
export async function effectivePlan(
  connection: SqlConnection,
  account: Account,
  now: Date,
): Promise<Plan> {
  const code =
    account.plan_expires_at && account.plan_expires_at > now
      ? account.plan_code
      : "free";
  const [plan] = await rows(
    connection,
    "SELECT * FROM plans WHERE code=$1",
    [code],
    planView,
  );
  if (!plan)
    throw new ServiceError(
      "PLAN_NOT_FOUND",
      `Assigned plan ${code} does not exist.`,
      503,
    );
  return plan;
}
export async function workspacePlan(
  connection: SqlConnection,
  owner: string,
): Promise<Plan | null> {
  const [account] = await rows(
    connection,
    "SELECT * FROM accounts WHERE workspace_id=$1",
    [owner],
    accountView,
  );
  return account ? effectivePlan(connection, account, new Date()) : null;
}
const counts = z.object({ count: z.coerce.number().int().min(0) });
export async function scalarCount(
  connection: SqlConnection,
  sql: string,
  values: ReadonlyArray<string | Date>,
): Promise<number> {
  const [result] = await rows(connection, sql, values, counts);
  if (!result)
    throw new ServiceError(
      "INVALID_DATABASE_RESULT",
      "Database omitted the requested aggregate.",
      503,
    );
  return result.count;
}
export async function reservedPages(
  connection: SqlConnection,
  owner: string,
  now: Date,
): Promise<number> {
  const { start, end } = monthBounds(now);
  return scalarCount(
    connection,
    "SELECT COALESCE(SUM(pages),0) AS count FROM usage_ledger WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status IN ('RESERVED','CONSUMED')",
    [owner, start, end],
  );
}
export async function usage(
  connection: SqlConnection,
  owner: string,
  now: Date,
): Promise<z.infer<typeof usageView>> {
  const { start, end } = monthBounds(now);
  const [row] = await rows(
    connection,
    `SELECT
 (SELECT COALESCE(SUM(pages),0) FROM usage_ledger WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status='CONSUMED') AS pages_used,
 (SELECT COALESCE(SUM(pages),0) FROM usage_ledger WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status='RESERVED') AS pages_reserved,
 (SELECT COUNT(*) FROM jobs WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3) AS translations,
 (SELECT COUNT(*) FROM jobs WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status='COMPLETED') AS completed,
 (SELECT COUNT(*) FROM jobs WHERE owner_id=$1 AND created_at>=$2 AND created_at<$3 AND status='FAILED') AS failed,
 (SELECT COUNT(*) FROM documents WHERE owner_id=$1) AS documents,
 (SELECT COALESCE(SUM(size),0) FROM artifacts WHERE owner_id=$1) AS storage_bytes,
 (SELECT COUNT(*) FROM jobs WHERE owner_id=$1 AND status IN ('QUEUED','PROCESSING','RETRYING','CANCELLING')) AS active_jobs`,
    [owner, start, end],
    z.object({
      pages_used: z.coerce.number().int(),
      pages_reserved: z.coerce.number().int(),
      translations: z.coerce.number().int(),
      completed: z.coerce.number().int(),
      failed: z.coerce.number().int(),
      documents: z.coerce.number().int(),
      storage_bytes: z.coerce.number().int(),
      active_jobs: z.coerce.number().int(),
    }),
  );
  if (!row)
    throw new ServiceError(
      "USAGE_QUERY_FAILED",
      "Database did not return account usage.",
      503,
    );
  return { period_start: start, period_end: end, ...row };
}
export async function dailyUsage(
  connection: SqlConnection,
  owner: string | null,
  now: Date,
): Promise<Array<z.infer<typeof dailyView>>> {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29),
  );
  const data = await rows(
    connection,
    `SELECT TO_CHAR(finished_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,COALESCE(SUM(completed_pages) FILTER(WHERE status='COMPLETED'),0) AS completed_pages,COUNT(*) FILTER(WHERE status='COMPLETED') AS completed_jobs,COUNT(*) FILTER(WHERE status='FAILED') AS failed_jobs FROM jobs WHERE finished_at >=$1 AND finished_at<=$2 AND ($3::uuid IS NULL OR owner_id=$3) GROUP BY 1`,
    [start, now, owner],
    z.object({
      date: z.string(),
      completed_pages: z.coerce.number().int(),
      completed_jobs: z.coerce.number().int(),
      failed_jobs: z.coerce.number().int(),
    }),
  );
  return Array.from({ length: 30 }, (_, offset) => {
    const date = new Date(start.getTime() + offset * 86400_000)
      .toISOString()
      .slice(0, 10);
    return (
      data.find((entry) => entry.date === date) ?? {
        date,
        completed_pages: 0,
        completed_jobs: 0,
        failed_jobs: 0,
      }
    );
  });
}
export async function profile(
  connection: SqlConnection,
  account: Account,
  now: Date,
): Promise<z.infer<typeof profileView>> {
  return {
    account,
    plan: await effectivePlan(connection, account, now),
    usage: await usage(connection, account.workspace_id, now),
    daily: await dailyUsage(connection, account.workspace_id, now),
  };
}
function csvCell(value: string): string {
  const protectedValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}
export async function translationReport(
  connection: SqlConnection,
  owner: string | null,
): Promise<string> {
  const data = await rows(
    connection,
    "SELECT d.filename,j.id,j.status,j.source_language,j.target_language,j.completed_pages,j.created_at,j.finished_at FROM jobs j JOIN documents d ON d.id=j.document_id WHERE ($1::uuid IS NULL OR j.owner_id=$1) ORDER BY j.created_at DESC",
    [owner],
    z.object({
      filename: z.string(),
      id: z.string(),
      status: z.string(),
      source_language: z.string(),
      target_language: z.string(),
      completed_pages: z.number().int(),
      created_at: z.coerce.date(),
      finished_at: z.coerce.date().nullable(),
    }),
  );
  return (
    "\ufeff" +
    [
      [
        "Document",
        "Job ID",
        "Status",
        "Source",
        "Target",
        "Completed pages",
        "Created UTC",
        "Finished UTC",
      ]
        .map(csvCell)
        .join(","),
      ...data.map((row) =>
        [
          row.filename,
          row.id,
          row.status,
          row.source_language,
          row.target_language,
          String(row.completed_pages),
          row.created_at.toISOString(),
          row.finished_at?.toISOString() ?? "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n")
  );
}
