import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "../../app/context.js";
import { rows, transaction } from "../../infrastructure/database.js";
import { decryptSecret, encryptSecret } from "../../infrastructure/secrets.js";
import { jobView, uuid } from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import {
  checkJobBudget,
  ownedArtifact,
  ownedDocument,
} from "../documents/document-service.js";
import { bodySchema, operationOptions } from "./contracts.js";
import { requireOperationTools, toolOperation } from "./operation-tools.js";
export async function createOperation(
  context: Context,
  owner: string,
  body: z.infer<typeof bodySchema>,
  key: string,
): Promise<z.infer<typeof jobView>> {
  return transaction(context.pool, async (connection) => {
    await connection.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      owner,
    ]);
    const document = await ownedDocument(connection, owner, body.document_id);
    const artifact = await ownedArtifact(
      connection,
      owner,
      body.input_artifact_id,
    );
    if (artifact.document_id !== document.id)
      throw new ServiceError(
        "DOCUMENT_ARTIFACT_MISMATCH",
        "Input file belongs to another document.",
        422,
      );
    if (document.deleted_at)
      throw new ServiceError(
        "DOCUMENT_TRASHED",
        "Restore this document before processing.",
        409,
      );
    const options = body.options;
    await requireOperationTools(
      connection,
      toolOperation.parse(options),
      artifact.mime_type,
    );
    const needsPDF = ["advanced", "edit", "ocr", "pdf_tool"].includes(
      options.type,
    );
    if (needsPDF && artifact.mime_type !== "application/pdf")
      throw new ServiceError(
        "PDF_REQUIRED",
        "This operation requires a PDF input file.",
        422,
      );
    if (options.type === "advanced" || options.type === "format_translation") {
      if (options.source_language === options.target_language)
        throw new ServiceError(
          "LANGUAGE_CONFLICT",
          "Source and target languages must differ.",
          422,
        );
      if (
        options.type === "format_translation" &&
        !/\.(docx|pptx|xlsx|txt|md|html)$/i.test(artifact.filename)
      )
        throw new ServiceError(
          "UNSUPPORTED_TRANSLATION_FORMAT",
          "Choose DOCX, PPTX, XLSX, TXT, Markdown or HTML.",
          422,
        );
    }
    const mergeInputs =
      options.type === "pdf_tool" && options.tool === "merge"
        ? await Promise.all(
            options.artifact_ids.map((id) =>
              ownedArtifact(connection, owner, id),
            ),
          )
        : [];
    if (mergeInputs.some((input) => input.mime_type !== "application/pdf"))
      throw new ServiceError(
        "PDF_REQUIRED",
        "Merge inputs must all be PDFs.",
        422,
      );
    const operationUnits = mergeInputs.reduce(
      (total, input) => total + input.units,
      artifact.units,
    );
    const [existing] = await rows(
      connection,
      "SELECT * FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
      [owner, key],
      jobView,
    );
    if (existing && existing.kind !== options.type)
      throw new ServiceError(
        "IDEMPOTENCY_CONFLICT",
        "Request key belongs to another operation kind.",
        409,
      );
    const previousSchema = jobView.extend({
      options: operationOptions,
      input_artifact_id: uuid,
    });
    const [previous] = await rows(
      connection,
      "SELECT * FROM jobs WHERE owner_id=$1 AND idempotency_key=$2",
      [owner, key],
      previousSchema,
    );
    if (previous) {
      if (
        previous.document_id !== document.id ||
        previous.input_artifact_id !== artifact.id ||
        JSON.stringify(
          previous.options.type === "pdf_tool" && previous.options.password
            ? {
                ...previous.options,
                password: decryptSecret(
                  context.config.TRANSLER_SETTINGS_KEY,
                  previous.options.password,
                ),
              }
            : previous.options,
        ) !== JSON.stringify(options)
      )
        throw new ServiceError(
          "IDEMPOTENCY_CONFLICT",
          "Request key belongs to a different operation.",
          409,
        );
      return jobView.parse(previous);
    }
    if (options.type === "edit") {
      const revision = await connection.query(
        "SELECT COALESCE(MAX(revision),0)::int AS revision FROM document_revisions WHERE document_id=$1",
        [document.id],
      );
      const current = z
        .object({ revision: z.number().int() })
        .parse(revision.rows[0]);
      if (current.revision !== options.base_revision)
        throw new ServiceError(
          "REVISION_CONFLICT",
          "A newer revision exists. Reload the editor before saving.",
          409,
        );
    }
    const tracked = await checkJobBudget(connection, owner, operationUnits);
    const id = randomUUID();
    const [next] = await rows(
      connection,
      "INSERT INTO jobs(id,owner_id,document_id,idempotency_key,source_language,target_language,provider,kind,options,input_artifact_id,total_units,llm_model,status,stage,progress,completed_pages,attempt_count,max_attempts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'QUEUED','Waiting for worker',0,0,0,3,NOW()) RETURNING *",
      [
        id,
        owner,
        document.id,
        key,
        "source_language" in options ? options.source_language : "auto",
        "target_language" in options ? options.target_language : "en",
        ["advanced", "format_translation", "edit"].includes(options.type)
          ? "groq"
          : context.config.TRANSLER_BASIC_PROVIDER,
        options.type,
        JSON.stringify(
          options.type === "pdf_tool" && options.password
            ? {
                ...options,
                password: encryptSecret(
                  context.config.TRANSLER_SETTINGS_KEY,
                  options.password,
                ),
              }
            : options,
        ),
        artifact.id,
        operationUnits,
        context.config.LLM_MODEL,
      ],
      jobView,
    );
    if (!next)
      throw new ServiceError(
        "JOB_CREATE_FAILED",
        "Database did not return the operation job.",
        503,
      );
    if (options.type === "edit")
      await connection.query(
        "INSERT INTO document_revisions(id,document_id,revision,job_id,base_artifact_id,created_at) VALUES($1,$2,$3,$4,$5,NOW())",
        [randomUUID(), document.id, options.base_revision + 1, id, artifact.id],
      );
    if (tracked)
      await connection.query(
        "INSERT INTO usage_ledger(job_id,owner_id,pages,status,created_at) VALUES($1,$2,$3,'RESERVED',NOW())",
        [id, owner, operationUnits],
      );
    return next;
  });
}
