import { z } from "zod";
const date = z.string().datetime();
export const accountSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
  is_active: z.boolean(),
  plan_code: z.string(),
  plan_expires_at: date.nullable(),
  created_at: date,
});
export const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  monthly_pages: z.number().int(),
  document_limit: z.number().int(),
  max_active_jobs: z.number().int(),
  duration_days: z.number().int(),
  price_vnd: z.number().int().nullable(),
  price_usd_cents: z.number().int().nullable(),
  yearly_price_vnd: z.number().int().nullable(),
  yearly_price_usd_cents: z.number().int().nullable(),
  enabled: z.boolean(),
});
export const usageSchema = z.object({
  period_start: date,
  period_end: date,
  pages_used: z.number().int(),
  pages_reserved: z.number().int(),
  translations: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  documents: z.number().int(),
  storage_bytes: z.number().int(),
  active_jobs: z.number().int(),
});
export const dailySchema = z.object({
  date: z.string(),
  completed_pages: z.number().int(),
  completed_jobs: z.number().int(),
  failed_jobs: z.number().int(),
});
export const profileSchema = z.object({
  account: accountSchema,
  plan: planSchema,
  usage: usageSchema,
  daily: z.array(dailySchema),
});
export type BillingCycle = "monthly" | "yearly";
export const orderSchema = z.object({
  id: z.string().uuid(),
  plan_code: z.string(),
  provider: z.enum(["sepay", "stripe", "card"]),
  amount: z.number().int(),
  currency: z.enum(["vnd", "usd"]),
  duration_days: z.number().int(),
  billing_cycle: z.enum(["monthly", "yearly"]),
  reference: z.string(),
  status: z.enum(["PENDING", "PAID", "EXPIRED", "REVIEW", "CANCELLED"]),
  created_at: date,
  expires_at: date,
  paid_at: date.nullable(),
  checkout_url: z.string().url().nullable(),
  review_reason: z.string().nullable(),
});
export const checkoutSchema = z.object({
  order: orderSchema,
  bank_code: z.string().nullable(),
  bank_account: z.string().nullable(),
  bank_name: z.string().nullable(),
  qr_url: z.string().url().nullable(),
});
export const optionsSchema = z.object({
  sepay: z.boolean(),
  stripe: z.boolean(),
  card: z.boolean(),
});
export const overviewSchema = z.object({
  accounts: z.number().int(),
  active_accounts: z.number().int(),
  paid_accounts: z.number().int(),
  documents: z.number().int(),
  jobs: z.number().int(),
  failed_jobs: z.number().int(),
  active_jobs: z.number().int(),
  revenue_vnd: z.number().int(),
  revenue_usd_cents: z.number().int(),
  daily: z.array(dailySchema),
});
export const auditSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  created_at: date,
});
export const paymentEventSchema = z.object({
  provider: z.string(),
  event_id: z.string(),
  order_id: z.string().uuid().nullable(),
  outcome: z.string(),
  received_at: date,
});
export const adminAccountSchema = z.object({
  account: accountSchema,
  usage: usageSchema,
});
export type Account = z.infer<typeof accountSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export type PaymentProvider = Order["provider"];
export type AccountEdit = Pick<
  Account,
  "name" | "role" | "is_active" | "plan_code" | "plan_expires_at"
>;

export const adminOrderSchema = orderSchema.extend({
  account_id: z.string().uuid(),
  account_email: z.string().email(),
  account_name: z.string(),
});
export type AdminOrder = z.infer<typeof adminOrderSchema>;
