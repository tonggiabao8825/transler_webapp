import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { rows } from "../../infrastructure/database.js";
import { jobView, uuid } from "../../shared/contracts.js";
import { ownedDocument } from "../documents/document-service.js";
import { requireOwner } from "../identity/identity.js";
import { bodySchema } from "./contracts.js";
import { createOperation } from "./service.js";
export async function operationRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.post(
    "/v1/operations",
    { schema: { body: bodySchema, response: { 202: jobView } } },
    async (request, reply) => {
      const owner = await requireOwner(context, request);
      const body = request.body;
      const key = z.string().uuid().parse(request.headers["idempotency-key"]);
      const job = await createOperation(context, owner, body, key);
      return reply.code(202).send(job);
    },
  );
  app.get(
    "/v1/documents/:id/revisions",
    {
      schema: {
        params: z.object({ id: uuid }),
        response: {
          200: z.array(z.object({ revision: z.number().int(), job: jobView })),
        },
      },
    },
    async (request) => {
      const owner = await requireOwner(context, request);
      await ownedDocument(context.pool, owner, request.params.id);
      return rows(
        context.pool,
        "SELECT r.revision,row_to_json(j) AS job FROM document_revisions r JOIN jobs j ON j.id=r.job_id WHERE r.document_id=$1 ORDER BY revision DESC",
        [request.params.id],
        z.object({ revision: z.number().int(), job: jobView }),
      );
    },
  );
}
