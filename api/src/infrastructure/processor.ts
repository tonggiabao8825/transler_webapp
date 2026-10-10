import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Config } from "../shared/config.js";
import { analysisView, apiError } from "../shared/contracts.js";
import { ServiceError } from "../shared/errors.js";
import { retryService } from "../shared/retries.js";

export class PDFProcessor {
  private readonly config: Config;
  private readonly logger: FastifyBaseLogger;
  constructor(config: Config, logger: FastifyBaseLogger) {
    this.config = config;
    this.logger = logger;
  }
  private async request(
    path: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<Response> {
    return retryService(this.logger, `processor.${path}`, async () => {
      let response: Response;
      try {
        response = await fetch(`${this.config.TRANSLER_PROCESSOR_URL}${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.TRANSLER_PROCESSOR_TOKEN}`,
            "Content-Type": contentType,
          },
          body: typeof body === "string" ? body : new Uint8Array(body),
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        });
      } catch (error) {
        if (error instanceof Error)
          throw new ServiceError(
            "PROCESSOR_UNAVAILABLE",
            `PDF processor ${path} failed: ${error.message}`,
            503,
          );
        throw error;
      }
      if (!response.ok) {
        const error = apiError.parse(await response.json());
        throw new ServiceError(error.code, error.message, response.status);
      }
      return response;
    });
  }
  async ready(): Promise<void> {
    await retryService(this.logger, "processor.ready", async () => {
      let response: Response;
      try {
        response = await fetch(
          `${this.config.TRANSLER_PROCESSOR_URL}/health/ready`,
          {
            headers: {
              Authorization: `Bearer ${this.config.TRANSLER_PROCESSOR_TOKEN}`,
            },
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
      } catch (error) {
        if (error instanceof Error)
          throw new ServiceError(
            "PROCESSOR_UNAVAILABLE",
            `PDF processor readiness failed: ${error.message}`,
            503,
          );
        throw error;
      }
      if (!response.ok) {
        const error = apiError.parse(await response.json());
        throw new ServiceError(error.code, error.message, response.status);
      }
      z.object({ status: z.literal("ready") }).parse(await response.json());
    });
  }
  async analyzeFile(
    content: Buffer,
    filename: string,
  ): Promise<{ source_format: string; mime_type: string; page_count: number }> {
    return z
      .object({
        source_format: z.string(),
        mime_type: z.string(),
        page_count: z.number().int().positive(),
      })
      .parse(
        await (
          await this.request(
            `/formats/analyze?filename=${encodeURIComponent(filename)}`,
            content,
            "application/octet-stream",
          )
        ).json(),
      );
  }
  async structure(content: Buffer): Promise<z.infer<typeof pdfStructure>> {
    return pdfStructure.parse(
      await (
        await this.request("/pdf/structure", content, "application/pdf")
      ).json(),
    );
  }
  async analyze(content: Buffer): Promise<z.infer<typeof analysisView>> {
    return analysisView.parse(
      await (await this.request("/analyze", content, "application/pdf")).json(),
    );
  }
  async import(url: string): Promise<{ filename: string; content: Buffer }> {
    const response = await this.request(
      "/import",
      JSON.stringify({ url }),
      "application/json",
    );
    const filename = response.headers.get("x-transler-filename");
    if (!filename)
      throw new ServiceError(
        "INVALID_IMPORT_RESPONSE",
        "Processor omitted the imported filename.",
        502,
      );
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > this.config.TRANSLER_MAX_UPLOAD_BYTES)
      throw new ServiceError(
        "FILE_TOO_LARGE",
        "Imported PDF exceeds the configured upload limit.",
        413,
      );
    return { filename: decodeURIComponent(filename), content };
  }
}

export const pdfStructure = z.array(
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
