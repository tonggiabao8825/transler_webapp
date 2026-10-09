import type { FastifyBaseLogger } from "fastify";
import { ServiceError } from "./errors.js";

export async function retryService<T>(
  logger: FastifyBaseLogger,
  operation: string,
  call: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        !(error.status === 429 || error.status >= 500) ||
        attempt === 3
      )
        throw error;
      logger.warn(
        {
          operation,
          attempt,
          error_code: error.code,
          error_message: error.message,
        },
        "External service request will retry",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Retry loop for ${operation} ended without a result.`);
}
