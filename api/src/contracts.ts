import { z } from "zod";

export const uuid = z.string().uuid();
export const timestamp = z.coerce
  .date()
  .meta({ type: "string", format: "date-time" });
export const nullableDate = timestamp.nullable();
export const pagination = z.object({
  offset: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(100),
});
export const accountView = z.object({
  id: uuid,
  workspace_id: uuid,
  email: z.string(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
  is_active: z.boolean(),
  plan_code: z.string(),
  plan_expires_at: nullableDate,
  created_at: timestamp,
});
export const accountRecord = accountView.extend({ password_hash: z.string() });
export type Account = z.infer<typeof accountView>;
export const planView = z.object({
  code: z.string(),
  name: z.string(),
  monthly_pages: z.number().int().positive(),
  document_limit: z.number().int().positive(),
  max_active_jobs: z.number().int().min(1).max(2),
  duration_days: z.number().int().positive(),
  price_vnd: z.number().int().positive().nullable(),
  price_usd_cents: z.number().int().positive().nullable(),
  yearly_price_vnd: z.number().int().positive().nullable(),
  yearly_price_usd_cents: z.number().int().positive().nullable(),
  enabled: z.boolean(),
});
export type Plan = z.infer<typeof planView>;
export const planUpdate = planView.omit({ code: true }).extend({
  monthly_pages: z.number().int().min(1).max(1_000_000),
  document_limit: z.number().int().min(1).max(10000),
  duration_days: z.number().int().min(1).max(366),
  price_vnd: z.number().int().min(1000).max(2_000_000_000).nullable(),
  price_usd_cents: z.number().int().min(50).max(100_000_000).nullable(),
  yearly_price_vnd: z.number().int().min(1000).max(2_000_000_000).nullable(),
  yearly_price_usd_cents: z.number().int().min(50).max(100_000_000).nullable(),
});
export const cleanName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => !/[\x00-\x1f]/.test(value),
    "Name cannot contain control characters.",
  );
export const registration = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  name: cleanName,
  password: z.string().min(12).max(128),
});
export const loginBody = registration
  .pick({ email: true })
  .extend({ password: z.string().min(1).max(128) });
export const accountUpdate = z
  .object({
    name: cleanName,
    role: z.enum(["user", "admin"]),
    is_active: z.boolean(),
    plan_code: z.string().min(1).max(24),
    plan_expires_at: nullableDate,
  })
  .refine(
    (value) => value.plan_code === "free" || value.plan_expires_at !== null,
    "Paid plans require an expiration date.",
  );
export const sessionView = z.object({
  owner_id: uuid,
  expires_at: timestamp,
  page_limit: z.literal(30),
  upload_limit_bytes: z.number().int(),
  max_active_jobs: z.number().int(),
  account: accountView.nullable(),
});
export const documentView = z.object({
  id: uuid,
  filename: z.string(),
  source_format: z.string(),
  favorite: z.boolean(),
  deleted_at: nullableDate,
  page_count: z.number().int().positive(),
  size: z.number().int().positive(),
  checksum: z.string(),
  created_at: timestamp,
  artifact_id: uuid,
});
export type Document = z.infer<typeof documentView>;
export const artifactRecord = z.object({
  id: uuid,
  owner_id: uuid,
  document_id: uuid,
  storage_key: z.string(),
  filename: z.string(),
  size: z.number().int().positive(),
  checksum: z.string(),
  mime_type: z.string(),
  units: z.number().int().positive(),
});
export const jobView = z.object({
  id: uuid,
  document_id: uuid,
  kind: z.string(),
  total_units: z.number().int().positive(),
  llm_model: z.string().nullable(),
  source_language: z.string(),
  target_language: z.string(),
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
  completed_pages: z.number().int().min(0),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  created_at: timestamp,
  started_at: nullableDate,
  finished_at: nullableDate,
  artifact_id: uuid.nullable(),
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
export type Job = z.infer<typeof jobView>;
export const language = z.enum([
  "en",
  "vi",
  "zh",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
]);
export const translationBody = z
  .object({
    document_id: uuid,
    source_language: language.or(z.literal("auto")),
    target_language: language,
    mode: z.literal("basic"),
  })
  .refine(
    (value) => value.source_language !== value.target_language,
    "Source and target languages must differ.",
  );
export const analysisView = z.object({
  page_count: z.number().int().min(1).max(30),
  pages: z.array(
    z.object({
      number: z.number().int(),
      width: z.number().positive(),
      height: z.number().positive(),
      text_characters: z.number().int().min(0),
    }),
  ),
});
export const usageView = z.object({
  period_start: timestamp,
  period_end: timestamp,
  pages_used: z.number().int(),
  pages_reserved: z.number().int(),
  translations: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  documents: z.number().int(),
  storage_bytes: z.number().int(),
  active_jobs: z.number().int(),
});
export const dailyView = z.object({
  date: z.string(),
  completed_pages: z.number().int(),
  completed_jobs: z.number().int(),
  failed_jobs: z.number().int(),
});
export const profileView = z.object({
  account: accountView,
  plan: planView,
  usage: usageView,
  daily: z.array(dailyView),
});
export const auditView = z.object({
  id: uuid,
  actor_id: uuid.nullable(),
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  created_at: timestamp,
});
export const adminAccountView = z.object({
  account: accountView,
  usage: usageView,
});
export const adminOverview = z.object({
  accounts: z.number().int(),
  active_accounts: z.number().int(),
  paid_accounts: z.number().int(),
  documents: z.number().int(),
  jobs: z.number().int(),
  failed_jobs: z.number().int(),
  active_jobs: z.number().int(),
  revenue_vnd: z.number().int(),
  revenue_usd_cents: z.number().int(),
  daily: z.array(dailyView),
});
export const paymentProvider = z.enum(["sepay", "stripe", "card"]);
export const billingCycle = z.enum(["monthly", "yearly"]);
export const checkoutBody = z.object({
  plan_code: z.string().min(1).max(24),
  provider: paymentProvider,
  request_id: uuid,
  billing_cycle: billingCycle,
});
export const orderView = z.object({
  id: uuid,
  plan_code: z.string(),
  provider: paymentProvider,
  amount: z.number().int().positive(),
  currency: z.enum(["vnd", "usd"]),
  duration_days: z.number().int().positive(),
  billing_cycle: billingCycle,
  reference: z.string(),
  status: z.enum(["PENDING", "PAID", "EXPIRED", "REVIEW", "CANCELLED"]),
  created_at: timestamp,
  expires_at: timestamp,
  paid_at: nullableDate,
  checkout_url: z.string().url().nullable(),
  review_reason: z.string().nullable(),
});
export const adminOrderView = orderView.extend({
  account_id: uuid,
  account_email: z.string().email(),
  account_name: z.string(),
});
export const orderRecord = orderView.extend({
  account_id: uuid,
  request_id: uuid,
  checkout_id: z.string().nullable(),
});
export type Order = z.infer<typeof orderRecord>;
export const checkoutView = z.object({
  order: orderView,
  bank_code: z.string().nullable(),
  bank_account: z.string().nullable(),
  bank_name: z.string().nullable(),
  qr_url: z.string().url().nullable(),
});
export const billingOptions = z.object({
  sepay: z.boolean(),
  stripe: z.boolean(),
  card: z.boolean(),
});
export const sepayEvent = z.object({
  id: z.number().int().positive(),
  accountNumber: z.string().min(1),
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number().int().positive(),
  content: z.string(),
  transactionDate: z.string(),
});
export const stripeEnvelope = z.object({
  id: z.string().min(1),
  type: z.string(),
  created: z.number().int(),
});
export const stripePaymentEvent = stripeEnvelope.extend({
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      client_reference_id: uuid,
      amount_total: z.number().int().positive(),
      currency: z.string(),
      payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
    }),
  }),
});
export const paymentEventView = z.object({
  provider: z.string(),
  event_id: z.string(),
  order_id: uuid.nullable(),
  outcome: z.string(),
  received_at: timestamp,
});
export const apiError = z.object({ code: z.string(), message: z.string() });

export const artifactView = artifactRecord.pick({
  id: true,
  document_id: true,
  filename: true,
  size: true,
  mime_type: true,
  units: true,
});
