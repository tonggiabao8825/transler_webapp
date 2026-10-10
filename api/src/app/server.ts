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
import { createClient } from "redis";
import { database } from "../infrastructure/database.js";
import { PDFProcessor } from "../infrastructure/processor.js";
import { ObjectStorage } from "../infrastructure/storage.js";
import { adminRoutes } from "../modules/admin/admin.js";
import { billingRoutes } from "../modules/billing/billing.js";
import {
  gatewayRoutes,
  provisionGateways,
} from "../modules/billing/gateways.js";
import { developerRoutes } from "../modules/developer/developer.js";
import { documentRoutes } from "../modules/documents/documents.js";
import { identityRoutes } from "../modules/identity/identity-routes.js";
import { ensureOrigin } from "../modules/identity/identity.js";
import { jobRoutes } from "../modules/jobs/jobs.js";
import { operationRoutes } from "../modules/operations/operations.js";
import { sharingRoutes } from "../modules/sharing/sharing.js";
import { toolRoutes } from "../modules/tools/tools.js";
import type { Config } from "../shared/config.js";
import type { ApiApp, Context } from "./context.js";
import { registerErrorHandler } from "./http-errors.js";

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
  registerErrorHandler(app);
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
