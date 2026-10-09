import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import pg from "pg";
import { createClient } from "redis";
import { z } from "zod";
import type { Config } from "./config.js";
import type { ApiApp, Context } from "./context.js";
import { database } from "./database.js";
import { ServiceError } from "./errors.js";
import { sharingRoutes } from "./modules/sharing.js";
import { developerRoutes } from "./modules/developer.js";
import { adminRoutes } from "./modules/admin.js";
import { billingRoutes } from "./modules/billing.js";
import { documentRoutes } from "./modules/documents.js";
import { gatewayRoutes, provisionGateways } from "./modules/gateways.js";
import { identityRoutes } from "./modules/identity-routes.js";
import { ensureOrigin } from "./modules/identity.js";
import { operationRoutes } from "./modules/operations.js";
import { toolRoutes } from "./modules/tools.js";
import { jobRoutes } from "./modules/jobs.js";
import { PDFProcessor } from "./processor.js";
import { ObjectStorage } from "./storage.js";

export async function createApp(config: Config): Promise<ApiApp> {
  const app = Fastify({
    bodyLimit: config.TRANSLER_MAX_UPLOAD_BYTES + 65536,
    logger: {
      level: "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.url",
        'req.headers["stripe-signature"]',
      ],
    },
    trustProxy: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const pool = database(config);
  const redis = createClient({
    url: config.TRANSLER_REDIS_URL,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  redis.on("error", (error) =>
    app.log.error({ err: error }, "Redis connector failed"),
  );
  await redis.connect();
  const context: Context = {
    config,
    pool,
    redis,
    storage: new ObjectStorage(config, app.log),
    processor: new PDFProcessor(config, app.log),
    logger: app.log,
  };
  app.addHook("onClose", async () => {
    context.storage.close();
    await pool.end();
    if (redis.isOpen) await redis.quit();
  });
  app.addHook("onRequest", async (request) => {
    if (
      !request.url.startsWith("/v1/billing/webhooks/") &&
      !(request.method === "GET" && request.url.startsWith("/v1/shared/"))
    )
      ensureOrigin(request);
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff");
    return payload;
  });
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
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.TRANSLER_MAX_UPLOAD_BYTES },
  });
  await app.register(swagger, {
    openapi: { info: { title: "Transler API", version: "0.2.0" } },
    transform: createJsonSchemaTransform({}),
    transformObject: createJsonSchemaTransformObject({}),
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });
  app.get("/openapi.json", async () => app.swagger());
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await pool.query("SELECT 1");
    await redis.ping();
    await context.storage.ready();
    await context.processor.ready();
    return { status: "ready" };
  });
  await provisionGateways(context);
  await gatewayRoutes(app, context);
  await identityRoutes(app, context);
  await documentRoutes(app, context);
  await jobRoutes(app, context);
  await operationRoutes(app, context);
  await sharingRoutes(app, context);
  await developerRoutes(app, context);
  await adminRoutes(app, context);
  await toolRoutes(app, context);
  await billingRoutes(app, context);
  return app;
}
