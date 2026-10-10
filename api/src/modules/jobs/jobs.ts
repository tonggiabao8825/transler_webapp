import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { rows, transaction } from "../../infrastructure/database.js";
import { jobView, translationBody, uuid } from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { requireOwner } from "../identity/identity.js";
import {
  requireOperationTools,
  toolOperation,
} from "../operations/operation-tools.js";
import { requireToolEnabled } from "../tools/tools.js";

import {
  checkJobBudget,
  ownedDocument,
  ownedJob,
} from "../documents/document-service.js";
export async function jobRoutes(app: ApiApp, context: Context): Promise<void> {
  app.post(
    "/v1/translations",
    { schema: { body: translationBody, response: { 202: jobView } } },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const body = request.body;
      const key = z
        .string()
        .min(8)
        .max(128)
        .parse(request.headers["idempotency-key"]);
      const document = await ownedDocument(
        context.pool,
        owner,
        body.document_id,
      );
      if (document.deleted_at)
        throw new ServiceError(
          "DOCUMENT_TRASHED",
          "Restore this document before translating.",
          409,
        );
      if (document.source_format !== "pdf")
        throw new ServiceError(
          "PDF_REQUIRED",
          "Basic translation requires a PDF file.",
          422,
        );
      await requireToolEnabled(context.pool, "translate");
      const job = await transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM sessions WHERE id=$1 FOR UPDATE",
          [owner],
        );
        await requireToolEnabled(connection, "translate");
        await ownedDocument(connection, owner, document.id);
        const [previous] = await rows(
          connection,
          "SELECT * FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
          [owner, key],
          jobView,
        );
        if (previous) {
          if (
            previous.kind !== "pdf_basic" ||
            previous.document_id !== body.document_id ||
            previous.source_language !== body.source_language ||
            previous.target_language !== body.target_language
          )
            throw new ServiceError(
              "IDEMPOTENCY_CONFLICT",
              "Key was used for a different translation request.",
              409,
            );
          return previous;
        }
        const tracked = await checkJobBudget(
          connection,
          owner,
          document.page_count,
        );
        const id = randomUUID();
        const [next] = await rows(
          connection,
          "INSERT INTO jobs(id,owner_id,document_id,idempotency_key,source_language,target_language,provider,total_units,status,stage,progress,completed_pages,attempt_count,max_attempts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED','Waiting for worker',0,0,0,3,NOW()) RETURNING *",
          [
            id,
            owner,
            document.id,
            key,
            body.source_language,
            body.target_language,
            context.config.TRANSLER_BASIC_PROVIDER,
            document.page_count,
          ],
          jobView,
        );
        if (!next)
          throw new ServiceError(
            "JOB_CREATE_FAILED",
            "Database did not return the translation job.",
            503,
          );
        if (tracked)
          await connection.query(
            "INSERT INTO usage_ledger(job_id,owner_id,pages,status,created_at) VALUES($1,$2,$3,'RESERVED',NOW())",
            [id, owner, document.page_count],
          );
        return next;
      });
      return reply.code(202).send(job);
    },
  );
  app.get(
    "/v1/jobs",
    { schema: { response: { 200: z.array(jobView) } } },
    async (request) =>
      rows(
        context.pool,
        "SELECT * FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
        [await requireOwner(context, request)],
        jobView,
      ),
  );
  app.get(
    "/v1/jobs/:id",
    { schema: { params: z.object({ id: uuid }), response: { 200: jobView } } },
    async (request) =>
      ownedJob(
        context.pool,
        await requireOwner(context, request),
        request.params.id,
      ),
  );
  app.post(
    "/v1/jobs/:id/cancel",
    { schema: { params: z.object({ id: uuid }), response: { 200: jobView } } },
    async (request) => {
      const owner = await requireOwner(context, request);
      return transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [request.params.id, owner],
        );
        const job = await ownedJob(connection, owner, request.params.id);
        if (["QUEUED", "RETRYING"].includes(job.status)) {
          await connection.query(
            "UPDATE jobs SET status='CANCELLED',stage='Cancelled',finished_at=NOW() WHERE id=$1",
            [job.id],
          );
          await connection.query(
            "UPDATE usage_ledger SET status='RELEASED' WHERE job_id=$1",
            [job.id],
          );
        } else if (job.status === "PROCESSING")
          await connection.query(
            "UPDATE jobs SET status='CANCELLING',stage='Cancelling' WHERE id=$1",
            [job.id],
          );
        else if (!["CANCELLED", "CANCELLING"].includes(job.status))
          throw new ServiceError(
            "JOB_NOT_CANCELLABLE",
            `Cannot cancel a ${job.status} job.`,
            409,
          );
        return ownedJob(connection, owner, job.id);
      });
    },
  );
  app.post(
    "/v1/jobs/:id/retry",
    { schema: { params: z.object({ id: uuid }), response: { 202: jobView } } },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const job = await transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM sessions WHERE id=$1 FOR UPDATE",
          [owner],
        );
        const previous = await ownedJob(connection, owner, request.params.id);
        if (previous.kind === "pdf_basic")
          await requireToolEnabled(connection, "translate");
        else {
          const [operation] = await rows(
            connection,
            "SELECT j.options,a.mime_type FROM jobs j JOIN artifacts a ON a.id=j.input_artifact_id WHERE j.id=$1",
            [previous.id],
            z.object({ options: toolOperation, mime_type: z.string() }),
          );
          if (!operation)
            throw new ServiceError(
              "JOB_INPUT_MISSING",
              `Job ${previous.id} has no operation input artifact.`,
              409,
            );
          await requireOperationTools(
            connection,
            operation.options,
            operation.mime_type,
          );
        }
        if (previous.status !== "FAILED")
          throw new ServiceError(
            "JOB_NOT_RETRYABLE",
            "Only failed jobs can be retried.",
            409,
          );
        const document = await ownedDocument(
          connection,
          owner,
          previous.document_id,
        );
        if (document.deleted_at)
          throw new ServiceError(
            "DOCUMENT_TRASHED",
            "Restore this document before retrying its jobs.",
            409,
          );
        if (await checkJobBudget(connection, owner, previous.total_units))
          await connection.query(
            "INSERT INTO usage_ledger(job_id,owner_id,pages,status,created_at) VALUES($1,$2,$3,'RESERVED',NOW()) ON CONFLICT(job_id) DO UPDATE SET status='RESERVED',created_at=NOW()",
            [previous.id, owner, previous.total_units],
          );
        await connection.query(
          "UPDATE jobs SET status='QUEUED',stage='Waiting for worker',attempt_count=0,error=NULL,finished_at=NULL,run_token=NULL,lease_until=NULL WHERE id=$1",
          [previous.id],
        );
        return ownedJob(connection, owner, previous.id);
      });
      return reply.code(202).send(job);
    },
  );
}
