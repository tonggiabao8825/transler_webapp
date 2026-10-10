import pg from "pg";
import { z } from "zod";
import { ServiceError } from "../shared/errors.js";
import type { ApiApp } from "./context.js";
export function registerErrorHandler(app: ApiApp): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ServiceError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply.code(422).send({
        code: "INVALID_REQUEST",
        message: error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
    if (error instanceof pg.DatabaseError && error.code === "23505")
      return reply.code(409).send({
        code: "DUPLICATE_RECORD",
        message:
          "This email, payment reference or request identifier already exists.",
      });
    if (error instanceof SyntaxError)
      return reply.code(422).send({
        code: "INVALID_JSON",
        message: "Request body must contain valid JSON.",
      });
    const frameworkError = z
      .object({
        statusCode: z.number().int(),
        code: z.string(),
        message: z.string(),
      })
      .safeParse(error);
    if (frameworkError.success && frameworkError.data.statusCode < 500) {
      const failure = frameworkError.data;
      return reply
        .code(failure.code === "FST_ERR_VALIDATION" ? 422 : failure.statusCode)
        .send({
          code:
            failure.code === "FST_ERR_VALIDATION"
              ? "INVALID_REQUEST"
              : failure.code,
          message: failure.message,
        });
    }
    request.log.error(
      { err: error, request_id: request.id },
      "API request failed",
    );
    return reply.code(503).send({
      code: "REQUEST_FAILED",
      message: `Request ${request.id} failed. Check API service logs for the recorded cause.`,
    });
  });
}
