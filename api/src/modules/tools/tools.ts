import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import {
  audit,
  rows,
  transaction,
  type SqlConnection,
} from "../../infrastructure/database.js";
import { ServiceError } from "../../shared/errors.js";
import { requireAdmin } from "../identity/identity.js";

export const toolId = z.enum([
  "translate",
  "editor",
  "convert",
  "documents",
  "ocr",
  "merge",
  "split",
  "compress",
  "pdf_to_images",
  "images_to_pdf",
  "protect",
  "unlock",
]);
export type ToolId = z.infer<typeof toolId>;
const toolView = z.object({ id: toolId, enabled: z.boolean() });

export async function requireToolEnabled(
  connection: SqlConnection,
  id: ToolId,
): Promise<void> {
  const [tool] = await rows(
    connection,
    "SELECT code AS id,enabled FROM tool_settings WHERE code=$1 FOR SHARE",
    [id],
    toolView,
  );
  if (!tool)
    throw new ServiceError(
      "TOOL_CONFIGURATION_MISSING",
      `Tool ${id} has no platform configuration. Run the database migrations.`,
      503,
    );
  if (!tool.enabled)
    throw new ServiceError(
      "TOOL_DISABLED",
      `Tool ${id} is disabled by the administrator.`,
      403,
    );
}

export async function toolRoutes(app: ApiApp, context: Context): Promise<void> {
  app.get(
    "/v1/tools",
    { schema: { response: { 200: z.array(toolView) } } },
    async () =>
      rows(
        context.pool,
        "SELECT code AS id,enabled FROM tool_settings ORDER BY code",
        [],
        toolView,
      ),
  );
  app.put(
    "/v1/admin/tools/:id",
    {
      schema: {
        params: z.object({ id: toolId }),
        body: z.object({ enabled: z.boolean() }),
        response: { 200: toolView },
      },
    },
    async (request) => {
      const admin = await requireAdmin(context, request);
      return transaction(context.pool, async (connection) => {
        const [tool] = await rows(
          connection,
          "UPDATE tool_settings SET enabled=$1 WHERE code=$2 RETURNING code AS id,enabled",
          [request.body.enabled, request.params.id],
          toolView,
        );
        if (!tool)
          throw new ServiceError(
            "TOOL_CONFIGURATION_MISSING",
            `Tool ${request.params.id} has no platform configuration. Run the database migrations.`,
            503,
          );
        await audit(
          connection,
          admin.id,
          "admin.tool",
          tool.id,
          JSON.stringify({ enabled: tool.enabled }),
        );
        return tool;
      });
    },
  );
}
