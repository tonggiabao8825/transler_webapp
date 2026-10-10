import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Context } from "../../app/context.js";
import {
  rows,
  transaction,
  type SqlConnection,
} from "../../infrastructure/database.js";
import type { Document, Job } from "../../shared/contracts.js";
import {
  artifactRecord,
  documentView,
  jobView,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { reservedPages, scalarCount, workspacePlan } from "../usage/usage.js";

const documentRecord = documentView.extend({
  native_text: z.boolean().nullable(),
});
export async function ownedDocument(
  connection: SqlConnection,
  owner: string,
  id: string,
): Promise<z.infer<typeof documentRecord>> {
  const [document] = await rows(
    connection,
    "SELECT * FROM documents WHERE id=$1 AND owner_id=$2",
    [id, owner],
    documentRecord,
  );
  if (!document)
    throw new ServiceError(
      "DOCUMENT_NOT_FOUND",
      "Document does not exist in this workspace.",
      404,
    );
  return document;
}
export async function ownedArtifact(
  connection: SqlConnection,
  owner: string,
  id: string,
): Promise<z.infer<typeof artifactRecord>> {
  const [artifact] = await rows(
    connection,
    "SELECT * FROM artifacts WHERE id=$1 AND owner_id=$2",
    [id, owner],
    artifactRecord,
  );
  if (!artifact)
    throw new ServiceError(
      "ARTIFACT_NOT_FOUND",
      "File does not exist in this workspace.",
      404,
    );
  return artifact;
}
export async function ownedJob(
  connection: SqlConnection,
  owner: string,
  id: string,
): Promise<Job> {
  const [job] = await rows(
    connection,
    "SELECT * FROM jobs WHERE id=$1 AND owner_id=$2",
    [id, owner],
    jobView,
  );
  if (!job)
    throw new ServiceError(
      "JOB_NOT_FOUND",
      "Job does not exist in this workspace.",
      404,
    );
  return job;
}
export async function saveDocument(
  context: Context,
  owner: string,
  filename: string,
  content: Buffer,
): Promise<Document> {
  if (content.length > context.config.TRANSLER_MAX_UPLOAD_BYTES)
    throw new ServiceError(
      "FILE_TOO_LARGE",
      `PDF exceeds ${context.config.TRANSLER_MAX_UPLOAD_BYTES} bytes.`,
      413,
    );
  const clean = path.posix
    .basename(filename.replaceAll("\\", "/"))
    .slice(0, 240);
  if (!clean || /[\x00-\x1f]/.test(clean))
    throw new ServiceError(
      "INVALID_FILENAME",
      "PDF filename cannot be empty or contain control characters.",
      422,
    );
  const analysis =
    path.extname(clean).toLowerCase() === ".pdf"
      ? await context.processor.analyze(content)
      : null;
  const fileAnalysis = analysis
    ? {
        source_format: "pdf",
        mime_type: "application/pdf",
        page_count: analysis.page_count,
      }
    : await context.processor.analyzeFile(content, clean);
  if (fileAnalysis.page_count > 30)
    throw new ServiceError(
      "PAGE_LIMIT",
      "Documents support up to 30 pages or text units per upload.",
      422,
    );
  const native = analysis
    ? analysis.pages.every((page) => page.text_characters > 0)
    : true;
  const documentId = randomUUID();
  const artifactId = randomUUID();
  const key = `${owner}/${documentId}/source/${artifactId}.${fileAnalysis.source_format}`;
  const checksum = createHash("sha256").update(content).digest("hex");
  return transaction(context.pool, async (connection) => {
    await connection.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      owner,
    ]);
    const plan = await workspacePlan(connection, owner);
    const limit = plan?.document_limit ?? 100;
    if (
      (await scalarCount(
        connection,
        "SELECT COUNT(*) AS count FROM documents WHERE owner_id=$1",
        [owner],
      )) >= limit
    )
      throw new ServiceError(
        "DOCUMENT_LIMIT",
        `Workspace supports up to ${limit} documents; delete old files.`,
        429,
      );
    await context.storage.put(key, content);
    const [document] = await rows(
      connection,
      "INSERT INTO documents(id,owner_id,filename,page_count,size,checksum,created_at,artifact_id,native_text,source_format) VALUES($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9) RETURNING *",
      [
        documentId,
        owner,
        clean,
        fileAnalysis.page_count,
        content.length,
        checksum,
        artifactId,
        native,
        fileAnalysis.source_format,
      ],
      documentView,
    );
    if (!document)
      throw new ServiceError(
        "DOCUMENT_CREATE_FAILED",
        "Database did not return the uploaded document.",
        503,
      );
    await connection.query(
      "INSERT INTO artifacts(id,owner_id,document_id,storage_key,filename,size,checksum,mime_type,units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        artifactId,
        owner,
        documentId,
        key,
        clean,
        content.length,
        checksum,
        fileAnalysis.mime_type,
        fileAnalysis.page_count,
      ],
    );
    return document;
  });
}
export async function checkJobBudget(
  connection: SqlConnection,
  owner: string,
  pages: number,
): Promise<boolean> {
  const plan = await workspacePlan(connection, owner);
  if (
    (await scalarCount(
      connection,
      "SELECT COUNT(*) AS count FROM jobs WHERE owner_id=$1 AND status IN ('QUEUED','PROCESSING','RETRYING','CANCELLING')",
      [owner],
    )) >= (plan?.max_active_jobs ?? 2)
  )
    throw new ServiceError(
      "JOB_QUOTA_EXCEEDED",
      "Wait for an active job or cancel it first.",
      429,
    );
  if (
    plan &&
    (await reservedPages(connection, owner, new Date())) + pages >
      plan.monthly_pages
  )
    throw new ServiceError(
      "MONTHLY_PAGE_LIMIT",
      `${plan.name} allows ${plan.monthly_pages} pages per UTC calendar month, including active reservations. Upgrade or wait for the next month.`,
      429,
    );
  return plan !== null;
}
