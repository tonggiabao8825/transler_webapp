import { z } from "zod";
import type { SqlConnection } from "../database.js";
import { requireToolEnabled, type ToolId } from "./tools.js";

export const toolOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("advanced") }),
  z.object({ type: z.literal("format_translation") }),
  z.object({ type: z.literal("conversion"), target_format: z.string() }),
  z.object({
    type: z.literal("edit"),
    operations: z.array(z.object({ type: z.string() })),
  }),
  z.object({ type: z.literal("ocr") }),
  z.object({
    type: z.literal("pdf_tool"),
    tool: z.enum(["merge", "split", "compress", "protect", "unlock"]),
  }),
]);
function operationTools(
  operation: z.infer<typeof toolOperation>,
  inputMime: string,
): ToolId[] {
  switch (operation.type) {
    case "advanced":
      return ["translate"];
    case "format_translation":
      return ["documents"];
    case "ocr":
      return ["ocr"];
    case "pdf_tool":
      return [operation.tool];
    case "edit":
      return operation.operations.some(
        (item) => item.type === "retranslate_region",
      )
        ? ["editor", "translate"]
        : ["editor"];
    case "conversion":
      if (
        inputMime === "application/pdf" &&
        ["png", "jpg"].includes(operation.target_format)
      )
        return ["convert", "pdf_to_images"];
      if (inputMime.startsWith("image/") && operation.target_format === "pdf")
        return ["convert", "images_to_pdf"];
      return ["convert"];
  }
}
export async function requireOperationTools(
  connection: SqlConnection,
  operation: z.infer<typeof toolOperation>,
  inputMime: string,
): Promise<void> {
  for (const id of operationTools(operation, inputMime))
    await requireToolEnabled(connection, id);
}
