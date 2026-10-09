import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type pg from "pg";
import type { RedisClientType } from "redis";
import type { Config } from "./config.js";
import type { PDFProcessor } from "./processor.js";
import type { ObjectStorage } from "./storage.js";

export type ApiApp = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
export type Context = {
  config: Config;
  pool: pg.Pool;
  redis: RedisClientType<{}, {}, {}, 3, {}>;
  storage: ObjectStorage;
  processor: PDFProcessor;
  logger: FastifyBaseLogger;
};
