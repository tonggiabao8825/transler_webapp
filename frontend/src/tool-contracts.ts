import { z } from "zod";

export const toolIdSchema = z.enum([
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
export type ToolId = z.infer<typeof toolIdSchema>;
export const toolSettingSchema = z.object({
  id: toolIdSchema,
  enabled: z.boolean(),
});
export type ToolSetting = z.infer<typeof toolSettingSchema>;
export const toolSettingsSchema = z
  .array(toolSettingSchema)
  .length(toolIdSchema.options.length)
  .refine(
    (tools) =>
      new Set(tools.map((tool) => tool.id)).size ===
      toolIdSchema.options.length,
    "Tool catalog must contain every tool exactly once.",
  );

export function toolEnabled(
  settings: ToolSetting[] | null,
  id: ToolId,
): boolean {
  if (settings === null) return false;
  const tool = settings.find((item) => item.id === id);
  if (!tool)
    throw new Error(`Tool ${id} is missing from the platform catalog.`);
  return tool.enabled;
}

export function toolAvailable(
  settings: ToolSetting[] | null,
  id: ToolId,
): boolean {
  return (
    toolEnabled(settings, id) &&
    (!["pdf_to_images", "images_to_pdf"].includes(id) ||
      toolEnabled(settings, "convert"))
  );
}
