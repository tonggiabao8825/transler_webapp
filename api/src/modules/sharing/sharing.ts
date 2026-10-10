import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { rows } from "../../infrastructure/database.js";
import { timestamp, uuid } from "../../shared/contracts.js";
import { ServiceError } from "../../shared/errors.js";
import { ownedArtifact } from "../documents/document-service.js";
import { requireOwner, tokenHash } from "../identity/identity.js";
const shareView = z.object({
  id: uuid,
  artifact_id: uuid,
  filename: z.string(),
  created_at: timestamp,
  expires_at: timestamp,
});
export async function sharingRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.get(
    "/v1/shares",
    { schema: { response: { 200: z.array(shareView) } } },
    async (request) =>
      rows(
        context.pool,
        "SELECT s.*,a.filename FROM shared_artifacts s JOIN artifacts a ON a.id=s.artifact_id WHERE s.owner_id=$1 ORDER BY created_at DESC",
        [await requireOwner(context, request)],
        shareView,
      ),
  );
  app.post(
    "/v1/shares",
    {
      schema: {
        body: z.object({ artifact_id: uuid, expires_at: timestamp }),
        response: {
          201: z.object({ share: shareView, url: z.string().url() }),
        },
      },
    },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const artifact = await ownedArtifact(
        context.pool,
        owner,
        request.body.artifact_id,
      );
      if (
        request.body.expires_at <= new Date() ||
        request.body.expires_at.getTime() > Date.now() + 7 * 86400000
      )
        throw new ServiceError(
          "INVALID_SHARE_EXPIRATION",
          "Share links must expire within seven days.",
          422,
        );
      const token = randomBytes(32).toString("base64url");
      const [share] = await rows(
        context.pool,
        "INSERT INTO shared_artifacts(id,artifact_id,owner_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,NOW(),$5) RETURNING *, $6::text AS filename",
        [
          randomUUID(),
          artifact.id,
          owner,
          tokenHash(token),
          request.body.expires_at,
          artifact.filename,
        ],
        shareView,
      );
      if (!share)
        throw new ServiceError(
          "SHARE_CREATE_FAILED",
          "Database did not return the share link.",
          503,
        );
      return reply.code(201).send({
        share,
        url: `${context.config.TRANSLER_PUBLIC_URL}/v1/shared/${token}`,
      });
    },
  );
  app.delete(
    "/v1/shares/:id",
    { schema: { params: z.object({ id: uuid }) } },
    async (request, reply) => {
      const result = await context.pool.query(
        "DELETE FROM shared_artifacts WHERE id=$1 AND owner_id=$2 RETURNING id",
        [request.params.id, await requireOwner(context, request)],
      );
      if (!result.rowCount)
        throw new ServiceError(
          "SHARE_NOT_FOUND",
          "Share link does not exist in your workspace.",
          404,
        );
      return reply.code(204).send();
    },
  );
  app.get(
    "/v1/shared/:token",
    {
      schema: {
        params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
      },
    },
    async (request, reply) => {
      const [file] = await rows(
        context.pool,
        "SELECT a.* FROM shared_artifacts s JOIN artifacts a ON a.id=s.artifact_id JOIN documents d ON d.id=a.document_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND d.deleted_at IS NULL",
        [tokenHash(request.params.token)],
        z.object({
          filename: z.string(),
          storage_key: z.string(),
          mime_type: z.string(),
        }),
      );
      if (!file)
        throw new ServiceError(
          "SHARE_EXPIRED",
          "Shared file is unavailable; the link expired or was revoked.",
          404,
        );
      return reply
        .type(file.mime_type)
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        )
        .send(await context.storage.get(file.storage_key));
    },
  );
}
