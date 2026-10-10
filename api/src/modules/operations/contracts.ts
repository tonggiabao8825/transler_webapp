import { z } from "zod";
import { language, uuid } from "../../shared/contracts.js";
const source = language.or(z.literal("auto"));
const translation = {
  source_language: source,
  target_language: language,
  domain: z.string().max(100),
  custom_instructions: z.string().max(2000),
  glossary: z
    .array(
      z.object({
        source: z.string().trim().min(1).max(100),
        target: z.string().trim().min(1).max(100),
      }),
    )
    .max(100),
};
const rect = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const editOperation = z.object({
  type: z.enum([
    "replace_text",
    "add_text",
    "delete_text",
    "move_block",
    "resize_block",
    "crop_page",
    "rotate_page",
    "delete_page",
    "reorder_pages",
    "add_annotation",
    "retranslate_region",
  ]),
  page: z.number().int().min(0),
  rect: rect.nullable(),
  destination: rect.nullable(),
  text: z.string().max(10000).nullable(),
  font_size: z.number().min(4).max(100).nullable(),
  angle: z.union([z.literal(90), z.literal(180), z.literal(270)]).nullable(),
  order: z.array(z.number().int().min(0)).max(500).nullable(),
  source_language: source.nullable(),
  target_language: language.nullable(),
});
export const operationOptions = z.discriminatedUnion("type", [
  z.object({ type: z.literal("advanced"), ...translation }),
  z.object({ type: z.literal("format_translation"), ...translation }),
  z.object({
    type: z.literal("conversion"),
    target_format: z.enum([
      "pdf",
      "docx",
      "pptx",
      "xlsx",
      "png",
      "jpg",
      "html",
      "txt",
      "md",
    ]),
  }),
  z.object({
    type: z.literal("edit"),
    base_revision: z.number().int().min(0),
    operations: z.array(editOperation).min(1).max(100),
  }),
  z.object({ type: z.literal("ocr"), language: source }),
  z.object({
    type: z.literal("pdf_tool"),
    tool: z.enum(["merge", "split", "compress", "protect", "unlock"]),
    artifact_ids: z.array(uuid).max(20),
    pages: z.array(z.number().int().min(0)).max(500),
    password: z.string().max(128).nullable(),
  }),
]);
export const bodySchema = z.object({
  document_id: uuid,
  input_artifact_id: uuid,
  options: operationOptions,
});
