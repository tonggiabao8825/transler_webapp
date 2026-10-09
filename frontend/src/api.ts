import { z } from "zod";
import { accountSchema } from "./account-contracts";

export const languages = [
  ["en", "English"],
  ["vi", "Vietnamese (Tiếng Việt)"],
  ["zh", "Chinese (中文)"],
  ["ja", "Japanese (日本語)"],
  ["ko", "Korean (한국어)"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
] as const;
export type Language = (typeof languages)[number][0];
export type SourceLanguage = Language | "auto";
export const languageSchema = z.enum([
  languages[0][0],
  ...languages.slice(1).map(([code]) => code),
] as const);
export const sourceLanguageSchema = languageSchema.or(z.literal("auto"));

const documentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  source_format: z.string(),
  favorite: z.boolean(),
  deleted_at: z.string().nullable(),
  page_count: z.number().int(),
  size: z.number().int(),
  checksum: z.string(),
  created_at: z.string().datetime(),
  artifact_id: z.string().uuid(),
});
export const jobSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  kind: z.string(),
  total_units: z.number().int().positive(),
  llm_model: z.string().nullable(),
  source_language: sourceLanguageSchema,
  target_language: languageSchema,
  provider: z.enum(["bing", "google", "azure", "deepl", "groq"]),
  status: z.enum([
    "QUEUED",
    "PROCESSING",
    "RETRYING",
    "COMPLETED",
    "FAILED",
    "CANCELLING",
    "CANCELLED",
  ]),
  stage: z.string(),
  progress: z.number().int().min(0).max(100),
  completed_pages: z.number().int(),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  artifact_id: z.string().uuid().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  quality_report: z
    .object({
      page_count: z.number().int(),
      pages_with_text: z.number().int(),
      overflow_count: z.number().int(),
      warnings: z.array(
        z.object({
          code: z.string(),
          page: z.number().int(),
          message: z.string(),
        }),
      ),
      assessment: z.literal("heuristic"),
    })
    .nullable(),
});
const sessionSchema = z.object({
  account: accountSchema.nullable(),
  owner_id: z.string().uuid(),
  expires_at: z.string().datetime(),
  page_limit: z.literal(30),
  upload_limit_bytes: z.number().int(),
  max_active_jobs: z.number().int(),
});
const errorSchema = z.object({ code: z.string(), message: z.string() });
export type Document = z.infer<typeof documentSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Session = z.infer<typeof sessionSchema>;

export async function readResponse<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.infer<T>> {
  const body = await response.json();
  if (!response.ok) {
    const error = errorSchema.parse(body);
    throw new Error(
      `${error.message} (${error.code}, HTTP ${response.status})`,
    );
  }
  return schema.parse(body);
}

export class TranslerApi {
  private sessionRequest: Promise<Session> | null = null;

  resetSession(): void {
    this.sessionRequest = null;
  }

  session(): Promise<Session> {
    this.sessionRequest ??= this.startSession();
    return this.sessionRequest;
  }

  private async startSession(): Promise<Session> {
    return readResponse(
      await fetch("/v1/session", { method: "POST" }),
      sessionSchema,
    );
  }

  async artifacts(signal: AbortSignal): Promise<Artifact[]> {
    return readResponse(
      await fetch("/v1/artifacts", { signal }),
      z.array(artifactSchema),
    );
  }
  async updateDocument(
    id: string,
    body: { favorite: boolean; trashed: boolean },
  ): Promise<Document> {
    return readResponse(
      await fetch(`/v1/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      documentSchema,
    );
  }
  async documents(signal: AbortSignal): Promise<Document[]> {
    return readResponse(
      await fetch("/v1/documents", { signal }),
      z.array(documentSchema),
    );
  }

  async jobs(signal: AbortSignal): Promise<Job[]> {
    return readResponse(
      await fetch("/v1/jobs", { signal }),
      z.array(jobSchema),
    );
  }

  async upload(file: File): Promise<Document> {
    const body = new FormData();
    body.append("file", file);
    return readResponse(
      await fetch("/v1/documents", { method: "POST", body }),
      documentSchema,
    );
  }

  async importUrl(url: string): Promise<Document> {
    return readResponse(
      await fetch("/v1/documents/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }),
      documentSchema,
    );
  }

  async translate(
    documentId: string,
    source: SourceLanguage,
    target: Language,
    key: string,
  ): Promise<Job> {
    return readResponse(
      await fetch("/v1/translations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          document_id: documentId,
          source_language: source,
          target_language: target,
          mode: "basic",
        }),
      }),
      jobSchema,
    );
  }

  async operation(
    documentId: string,
    artifactId: string,
    options: OperationOptions,
    key: string,
  ): Promise<Job> {
    return readResponse(
      await fetch("/v1/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          document_id: documentId,
          input_artifact_id: artifactId,
          options,
        }),
      }),
      jobSchema,
    );
  }
  async structure(
    id: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof structureSchema>> {
    return readResponse(
      await fetch(`/v1/artifacts/${id}/structure`, { signal }),
      structureSchema,
    );
  }
  async revisions(
    id: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof revisionsSchema>> {
    return readResponse(
      await fetch(`/v1/documents/${id}/revisions`, { signal }),
      revisionsSchema,
    );
  }
  async job(id: string, signal: AbortSignal): Promise<Job> {
    return readResponse(await fetch(`/v1/jobs/${id}`, { signal }), jobSchema);
  }

  async cancel(id: string): Promise<Job> {
    return readResponse(
      await fetch(`/v1/jobs/${id}/cancel`, { method: "POST" }),
      jobSchema,
    );
  }

  async retry(id: string): Promise<Job> {
    return readResponse(
      await fetch(`/v1/jobs/${id}/retry`, { method: "POST" }),
      jobSchema,
    );
  }

  async deleteDocument(id: string): Promise<void> {
    const response = await fetch(`/v1/documents/${id}`, { method: "DELETE" });
    if (!response.ok) await readResponse(response, z.never());
  }
}

export function isActive(job: Job): boolean {
  return ["QUEUED", "PROCESSING", "RETRYING", "CANCELLING"].includes(
    job.status,
  );
}

export function languageLabel(code: string): string {
  if (code === "auto") return "Auto detect";
  const match = languages.find(([value]) => value === code);
  if (!match) throw new Error(`Unsupported language returned by API: ${code}`);
  return match[1];
}

export type Rect = readonly [number, number, number, number];
export type EditOperation = {
  type:
    | "replace_text"
    | "add_text"
    | "delete_text"
    | "move_block"
    | "resize_block"
    | "crop_page"
    | "rotate_page"
    | "delete_page"
    | "reorder_pages"
    | "add_annotation"
    | "retranslate_region";
  page: number;
  rect: Rect | null;
  destination: Rect | null;
  text: string | null;
  font_size: number | null;
  angle: 90 | 180 | 270 | null;
  order: number[] | null;
  source_language: SourceLanguage | null;
  target_language: Language | null;
};
export type TranslationOptions = {
  source_language: SourceLanguage;
  target_language: Language;
  domain: string;
  custom_instructions: string;
  glossary: { source: string; target: string }[];
};
export type OperationOptions =
  | ({ type: "advanced" | "format_translation" } & TranslationOptions)
  | {
      type: "conversion";
      target_format:
        | "pdf"
        | "docx"
        | "pptx"
        | "xlsx"
        | "png"
        | "jpg"
        | "html"
        | "txt"
        | "md";
    }
  | { type: "edit"; base_revision: number; operations: EditOperation[] }
  | { type: "ocr"; language: SourceLanguage }
  | {
      type: "pdf_tool";
      tool: "merge" | "split" | "compress" | "protect" | "unlock";
      artifact_ids: string[];
      pages: number[];
      password: string | null;
    };
export const structureSchema = z.array(
  z.object({
    index: z.number().int(),
    width: z.number().positive(),
    height: z.number().positive(),
    blocks: z.array(
      z.object({
        rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        text: z.string(),
      }),
    ),
  }),
);
export const revisionsSchema = z.array(
  z.object({ revision: z.number().int(), job: jobSchema }),
);

const artifactSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  filename: z.string(),
  size: z.number().int(),
  mime_type: z.string(),
  units: z.number().int().positive(),
});
export type Artifact = z.infer<typeof artifactSchema>;
