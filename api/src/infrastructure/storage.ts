import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../shared/config.js";
import { ServiceError } from "../shared/errors.js";
import { retryService } from "../shared/retries.js";

export class ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly logger: FastifyBaseLogger;
  constructor(config: Config, logger: FastifyBaseLogger) {
    this.client = new S3Client({
      endpoint: config.TRANSLER_S3_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.TRANSLER_S3_ACCESS_KEY,
        secretAccessKey: config.TRANSLER_S3_SECRET_KEY,
      },
      maxAttempts: 1,
    });
    this.bucket = config.TRANSLER_S3_BUCKET;
    this.logger = logger;
  }
  private async request<T>(
    operation: string,
    call: () => Promise<T>,
  ): Promise<T> {
    return retryService(this.logger, operation, async () => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof Error)
          throw new ServiceError(
            "STORAGE_FAILED",
            `${operation} bucket=${this.bucket}: ${error.message}`,
            503,
          );
        throw error;
      }
    });
  }
  async ready(): Promise<void> {
    await this.request("s3.head_bucket", () =>
      this.client.send(new HeadBucketCommand({ Bucket: this.bucket })),
    );
  }
  async get(key: string): Promise<Buffer> {
    return this.request("s3.get", async () => {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body)
        throw new ServiceError(
          "EMPTY_STORAGE_RESPONSE",
          `S3 omitted file body for key=${key}.`,
          502,
        );
      return Buffer.from(await result.Body.transformToByteArray());
    });
  }
  async put(key: string, content: Buffer): Promise<void> {
    await this.request("s3.put", () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: content,
          ContentType: "application/pdf",
        }),
      ),
    );
  }
  async delete(keys: ReadonlyArray<string>): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const batch = keys.slice(offset, offset + 1000);
      await this.request("s3.delete", async () => {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        );
        if (result.Errors?.length)
          throw new ServiceError(
            "STORAGE_DELETE_FAILED",
            `S3 refused keys=${batch.join(",")}: ${JSON.stringify(result.Errors)}`,
            503,
          );
      });
    }
  }
  close(): void {
    this.client.destroy();
  }
}
