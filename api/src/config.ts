import { z } from "zod";

const optionalSecret = z.string().min(16).optional();
const configSchema = z.object({
  LLM_MODEL: z.string().min(1).max(128),
  TRANSLER_SETTINGS_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  TRANSLER_DATABASE_URL: z.string().min(1),
  TRANSLER_REDIS_URL: z.string().url(),
  TRANSLER_S3_ENDPOINT: z.string().url(),
  TRANSLER_S3_ACCESS_KEY: z.string().min(1),
  TRANSLER_S3_SECRET_KEY: z.string().min(1),
  TRANSLER_S3_BUCKET: z.string().min(1),
  TRANSLER_SECURE_COOKIE: z.enum(["true", "false"]),
  TRANSLER_MAX_UPLOAD_BYTES: z.coerce.number().int().positive(),
  TRANSLER_BASIC_PROVIDER: z.enum(["bing", "google", "azure", "deepl"]),
  TRANSLER_PROCESSOR_URL: z.string().url(),
  TRANSLER_PROCESSOR_TOKEN: z.string().min(32),
  TRANSLER_PUBLIC_URL: z.string().url(),
  TRANSLER_API_PORT: z.coerce.number().int().min(1).max(65535),
  TRANSLER_STRIPE_SECRET_KEY: optionalSecret,
  TRANSLER_STRIPE_WEBHOOK_SECRET: optionalSecret,
  TRANSLER_SEPAY_WEBHOOK_KEY: optionalSecret,
  TRANSLER_SEPAY_BANK_CODE: z.string().min(1).optional(),
  TRANSLER_SEPAY_ACCOUNT_NUMBER: z
    .string()
    .regex(/^[A-Za-z0-9]{1,19}$/)
    .optional(),
  TRANSLER_SEPAY_ACCOUNT_NAME: z.string().min(1).max(80).optional(),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig(): Config {
  const config = configSchema.parse(process.env);
  if (
    config.TRANSLER_SECURE_COOKIE &&
    config.TRANSLER_SECURE_COOKIE === "true" &&
    new URL(config.TRANSLER_PUBLIC_URL).protocol !== "https:"
  )
    throw new Error(
      "TRANSLER_PUBLIC_URL must use HTTPS when secure cookies are enabled.",
    );
  return config;
}
