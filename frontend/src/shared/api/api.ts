import { z } from "zod";
import {
  Artifact,
  Document,
  Job,
  Language,
  OperationOptions,
  Session,
  SourceLanguage,
  artifactSchema,
  documentSchema,
  jobSchema,
  revisionsSchema,
  sessionSchema,
  structureSchema,
} from "./contracts";
import { readResponse } from "./http";
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
