import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { rows, transaction } from "../../infrastructure/database.js";
import { pdfStructure } from "../../infrastructure/processor.js";
import {
  analysisView,
  artifactView,
  documentView,
  jobView,
  uuid,
} from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { requireOwner } from "../identity/identity.js";

import {
  ownedArtifact,
  ownedDocument,
  saveDocument,
} from "./document-service.js";
export async function documentRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.post(
    "/v1/documents",
    { schema: { response: { 201: documentView } } },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const file = await request.file({
        limits: {
          fileSize: context.config.TRANSLER_MAX_UPLOAD_BYTES,
          files: 1,
        },
      });
      if (!file)
        throw new ServiceError(
          "FILENAME_REQUIRED",
          "Upload requires a PDF file.",
          422,
        );
      return reply
        .code(201)
        .send(
          await saveDocument(
            context,
            owner,
            file.filename,
            await file.toBuffer(),
          ),
        );
    },
  );
  app.post(
    "/v1/documents/import-url",
    {
      schema: {
        body: z.object({ url: z.string().url() }),
        response: { 201: documentView },
      },
    },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const imported = await context.processor.import(request.body.url);
      return reply
        .code(201)
        .send(
          await saveDocument(
            context,
            owner,
            imported.filename,
            imported.content,
          ),
        );
    },
  );
  app.get(
    "/v1/documents",
    { schema: { response: { 200: z.array(documentView) } } },
    async (request) =>
      rows(
        context.pool,
        "SELECT * FROM documents WHERE owner_id=$1 ORDER BY created_at DESC",
        [await requireOwner(context, request)],
        documentView,
      ),
  );
  app.get(
    "/v1/documents/:id",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: { 200: documentView },
      },
    },
    async (request) =>
      documentView.parse(
        await ownedDocument(
          context.pool,
          await requireOwner(context, request),
          request.params.id,
        ),
      ),
  );
  app.get(
    "/v1/documents/:id/pages",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: { 200: analysisView.shape.pages },
      },
    },
    async (request) => {
      const owner = await requireOwner(context, request);
      const document = await ownedDocument(
        context.pool,
        owner,
        request.params.id,
      );
      const artifact = await ownedArtifact(
        context.pool,
        owner,
        document.artifact_id,
      );
      return (
        await context.processor.analyze(
          await context.storage.get(artifact.storage_key),
        )
      ).pages;
    },
  );
  app.get(
    "/v1/artifacts",
    { schema: { response: { 200: z.array(artifactView) } } },
    async (request) =>
      rows(
        context.pool,
        "SELECT * FROM artifacts WHERE owner_id=$1",
        [await requireOwner(context, request)],
        artifactView,
      ),
  );
  app.patch(
    "/v1/documents/:id",
    {
      schema: {
        params: z.object({ id: uuid }),
        body: z.object({ favorite: z.boolean(), trashed: z.boolean() }),
        response: { 200: documentView },
      },
    },
    async (request) => {
      const owner = await requireOwner(context, request);
      return transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM sessions WHERE id=$1 FOR UPDATE",
          [owner],
        );
        await ownedDocument(connection, owner, request.params.id);
        const active = await connection.query(
          "SELECT id FROM jobs WHERE document_id=$1 AND status IN ('QUEUED','PROCESSING','RETRYING','CANCELLING') LIMIT 1",
          [request.params.id],
        );
        if (request.body.trashed && active.rowCount)
          throw new ServiceError(
            "DOCUMENT_BUSY",
            "Cancel active jobs before moving this document to Trash.",
            409,
          );
        const [next] = await rows(
          connection,
          "UPDATE documents SET favorite=$1,deleted_at=CASE WHEN $2 THEN COALESCE(deleted_at,NOW()) ELSE NULL END WHERE id=$3 AND owner_id=$4 RETURNING *",
          [
            request.body.favorite,
            request.body.trashed,
            request.params.id,
            owner,
          ],
          documentView,
        );
        if (!next)
          throw new ServiceError(
            "DOCUMENT_NOT_FOUND",
            "Document does not exist.",
            404,
          );
        return next;
      });
    },
  );
  app.delete(
    "/v1/documents/:id",
    { schema: { params: z.object({ id: uuid }) } },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      await transaction(context.pool, async (connection) => {
        await connection.query(
          "SELECT id FROM sessions WHERE id=$1 FOR UPDATE",
          [owner],
        );
        const document = await ownedDocument(
          connection,
          owner,
          request.params.id,
        );
        const running = await rows(
          connection,
          "SELECT * FROM jobs WHERE document_id=$1 AND status IN ('QUEUED','PROCESSING','RETRYING','CANCELLING')",
          [document.id],
          jobView,
        );
        if (running.length)
          throw new ServiceError(
            "DOCUMENT_BUSY",
            "Cancel active jobs before deleting this document.",
            409,
          );
        const keys = await rows(
          connection,
          "SELECT storage_key FROM artifacts WHERE document_id=$1 UNION ALL SELECT checkpoint_key AS storage_key FROM jobs WHERE document_id=$1 AND checkpoint_key IS NOT NULL UNION ALL SELECT pipeline_manifest_key AS storage_key FROM jobs WHERE document_id=$1 AND pipeline_manifest_key IS NOT NULL",
          [document.id],
          z.object({ storage_key: z.string() }),
        );
        await context.storage.delete(keys.map((row) => row.storage_key));
        await connection.query(
          "DELETE FROM shared_artifacts WHERE artifact_id IN (SELECT id FROM artifacts WHERE document_id=$1)",
          [document.id],
        );
        await connection.query(
          "DELETE FROM document_revisions WHERE document_id=$1",
          [request.params.id],
        );
        await connection.query("DELETE FROM jobs WHERE document_id=$1", [
          document.id,
        ]);
        await connection.query("DELETE FROM artifacts WHERE document_id=$1", [
          document.id,
        ]);
        await connection.query("DELETE FROM documents WHERE id=$1", [
          document.id,
        ]);
      });
      return reply.code(204).send();
    },
  );
  app.get(
    "/v1/artifacts/:id/download",
    { schema: { params: z.object({ id: uuid }) } },
    async (request, reply) => {
      const artifact = await ownedArtifact(
        context.pool,
        await requireOwner(context, request),
        request.params.id,
      );
      return reply
        .type(artifact.mime_type)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
        )
        .send(await context.storage.get(artifact.storage_key));
    },
  );
  app.get(
    "/v1/artifacts/:id/structure",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: { 200: pdfStructure },
      },
    },
    async (request) => {
      const artifact = await ownedArtifact(
        context.pool,
        await requireOwner(context, request),
        request.params.id,
      );
      if (artifact.mime_type !== "application/pdf")
        throw new ServiceError(
          "PDF_REQUIRED",
          "Editor requires a PDF file.",
          422,
        );
      return context.processor.structure(
        await context.storage.get(artifact.storage_key),
      );
    },
  );
  app.get(
    "/v1/artifacts/:id/preview",
    { schema: { params: z.object({ id: uuid }) } },
    async (request, reply) => {
      const artifact = await ownedArtifact(
        context.pool,
        await requireOwner(context, request),
        request.params.id,
      );
      if (artifact.mime_type !== "application/pdf")
        throw new ServiceError(
          "PDF_PREVIEW_REQUIRED",
          "Download this file to view its native format.",
          422,
        );
      return reply
        .type(artifact.mime_type)
        .send(await context.storage.get(artifact.storage_key));
    },
  );
  app.get("/v1/providers", async (request) => {
    await requireOwner(context, request);
    return [
      {
        id: context.config.TRANSLER_BASIC_PROVIDER,
        name: `${context.config.TRANSLER_BASIC_PROVIDER} (BabelDOC / Scan Engine Basic)`,
        mode: "basic",
      },
    ];
  });
}
