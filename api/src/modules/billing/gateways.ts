import { z } from "zod";
import type { ApiApp, Context } from "../../app/context.js";
import { audit, rows, transaction } from "../../infrastructure/database.js";
import { decryptSecret, encryptSecret } from "../../infrastructure/secrets.js";
import { ServiceError } from "../../shared/errors.js";
import { requireAdmin } from "../identity/identity.js";
const provider = z.enum(["sepay", "stripe"]);
const settingsSchema = z.object({
  bank_code: z.string().nullable(),
  account_number: z.string().nullable(),
  account_name: z.string().nullable(),
});
const secretsSchema = z.object({
  secret_key: z.string().nullable(),
  webhook_key: z.string().nullable(),
});
const recordSchema = z.object({
  provider,
  enabled: z.boolean(),
  settings: settingsSchema,
  encrypted_secrets: z.string(),
  updated_at: z.coerce.date(),
});
const viewSchema = z.object({
  provider,
  enabled: z.boolean(),
  ready: z.boolean(),
  settings: settingsSchema,
  has_secret_key: z.boolean(),
  has_webhook_key: z.boolean(),
  updated_at: z.coerce.date().meta({ type: "string", format: "date-time" }),
});
const updateSchema = z.object({
  enabled: z.boolean(),
  settings: settingsSchema,
  secrets: z.object({
    secret_key: z.string().min(16).max(512).optional(),
    webhook_key: z.string().min(16).max(512).optional(),
  }),
});
export type Gateway = z.infer<typeof recordSchema> & {
  secrets: z.infer<typeof secretsSchema>;
};
function encrypt(
  context: Context,
  secrets: z.infer<typeof secretsSchema>,
): string {
  return encryptSecret(
    context.config.TRANSLER_SETTINGS_KEY,
    JSON.stringify(secrets),
  );
}
function decrypt(
  context: Context,
  encrypted: string,
): z.infer<typeof secretsSchema> {
  return secretsSchema.parse(
    JSON.parse(decryptSecret(context.config.TRANSLER_SETTINGS_KEY, encrypted)),
  );
}
function ready(gateway: Gateway): boolean {
  return (
    gateway.enabled &&
    Boolean(
      gateway.secrets.webhook_key &&
      (gateway.provider === "stripe"
        ? gateway.secrets.secret_key
        : gateway.settings.bank_code &&
          gateway.settings.account_number &&
          gateway.settings.account_name),
    )
  );
}
function view(gateway: Gateway): z.infer<typeof viewSchema> {
  return {
    provider: gateway.provider,
    enabled: gateway.enabled,
    ready: ready(gateway),
    settings: gateway.settings,
    has_secret_key: Boolean(gateway.secrets.secret_key),
    has_webhook_key: Boolean(gateway.secrets.webhook_key),
    updated_at: gateway.updated_at,
  };
}
export async function gateway(
  context: Context,
  name: z.infer<typeof provider>,
): Promise<Gateway> {
  const [record] = await rows(
    context.pool,
    "SELECT * FROM provider_settings WHERE provider=$1",
    [name],
    recordSchema,
  );
  if (!record)
    throw new ServiceError(
      "GATEWAY_NOT_FOUND",
      `Payment gateway ${name} is not provisioned.`,
      503,
    );
  return { ...record, secrets: decrypt(context, record.encrypted_secrets) };
}
export async function gatewayOptions(
  context: Context,
): Promise<{ sepay: boolean; stripe: boolean; card: boolean }> {
  const [sepay, stripe] = await Promise.all([
    gateway(context, "sepay"),
    gateway(context, "stripe"),
  ]);
  return { sepay: ready(sepay), stripe: ready(stripe), card: ready(stripe) };
}
export async function provisionGateways(context: Context): Promise<void> {
  const config = context.config;
  const values: Array<{
    provider: z.infer<typeof provider>;
    settings: z.infer<typeof settingsSchema>;
    secrets: z.infer<typeof secretsSchema>;
  }> = [
    {
      provider: "sepay",
      settings: {
        bank_code: config.TRANSLER_SEPAY_BANK_CODE ?? null,
        account_number: config.TRANSLER_SEPAY_ACCOUNT_NUMBER ?? null,
        account_name: config.TRANSLER_SEPAY_ACCOUNT_NAME ?? null,
      },
      secrets: {
        secret_key: null,
        webhook_key: config.TRANSLER_SEPAY_WEBHOOK_KEY ?? null,
      },
    },
    {
      provider: "stripe",
      settings: { bank_code: null, account_number: null, account_name: null },
      secrets: {
        secret_key: config.TRANSLER_STRIPE_SECRET_KEY ?? null,
        webhook_key: config.TRANSLER_STRIPE_WEBHOOK_SECRET ?? null,
      },
    },
  ];
  for (const value of values)
    await context.pool.query(
      "INSERT INTO provider_settings(provider,enabled,settings,encrypted_secrets,updated_at,updated_by) VALUES($1,$4,$2,$3,NOW(),NULL) ON CONFLICT(provider) DO NOTHING",
      [
        value.provider,
        JSON.stringify(value.settings),
        encrypt(context, value.secrets),
        Boolean(value.secrets.webhook_key),
      ],
    );
}
export async function gatewayRoutes(
  app: ApiApp,
  context: Context,
): Promise<void> {
  app.get(
    "/v1/admin/gateways",
    { schema: { response: { 200: z.array(viewSchema) } } },
    async (request) => {
      await requireAdmin(context, request);
      return Promise.all(
        (["sepay", "stripe"] as const).map(async (name) =>
          view(await gateway(context, name)),
        ),
      );
    },
  );
  app.put(
    "/v1/admin/gateways/:provider",
    {
      schema: {
        params: z.object({ provider }),
        body: updateSchema,
        response: { 200: viewSchema },
      },
    },
    async (request) => {
      const admin = await requireAdmin(context, request);
      return transaction(context.pool, async (connection) => {
        const [record] = await rows(
          connection,
          "SELECT * FROM provider_settings WHERE provider=$1 FOR UPDATE",
          [request.params.provider],
          recordSchema,
        );
        if (!record)
          throw new ServiceError(
            "GATEWAY_NOT_FOUND",
            "Payment gateway is not provisioned.",
            404,
          );
        const pending = await connection.query(
          "SELECT id FROM payment_orders WHERE provider=ANY($1::text[]) AND status='PENDING' AND expires_at>NOW() LIMIT 1",
          [
            request.params.provider === "stripe"
              ? ["stripe", "card"]
              : ["sepay"],
          ],
        );
        if (pending.rowCount)
          throw new ServiceError(
            "GATEWAY_HAS_PENDING_ORDERS",
            "Resolve or wait for pending orders to expire before changing this gateway, so existing checkout instructions remain valid.",
            409,
          );
        const current = decrypt(context, record.encrypted_secrets);
        const next = {
          ...record,
          enabled: request.body.enabled,
          settings: request.body.settings,
          secrets: {
            secret_key: request.body.secrets.secret_key ?? current.secret_key,
            webhook_key:
              request.body.secrets.webhook_key ?? current.webhook_key,
          },
        };
        if (next.enabled && !ready(next))
          throw new ServiceError(
            "GATEWAY_INCOMPLETE",
            "Enabled gateways require all receiving bank details or Stripe credentials and a webhook key.",
            422,
          );
        if (
          next.provider === "sepay" &&
          next.settings.account_number &&
          !/^[A-Za-z0-9]{1,19}$/.test(next.settings.account_number)
        )
          throw new ServiceError(
            "INVALID_BANK_ACCOUNT",
            "Receiving account must contain 1–19 letters or digits.",
            422,
          );
        await connection.query(
          "UPDATE provider_settings SET enabled=$1,settings=$2,encrypted_secrets=$3,updated_at=NOW(),updated_by=$4 WHERE provider=$5",
          [
            next.enabled,
            JSON.stringify(next.settings),
            encrypt(context, next.secrets),
            admin.id,
            next.provider,
          ],
        );
        await audit(
          connection,
          admin.id,
          "admin.gateway",
          next.provider,
          JSON.stringify({
            enabled: next.enabled,
            settings: next.settings,
            updated_secret_fields: Object.keys(request.body.secrets),
          }),
        );
        return view({ ...next, updated_at: new Date() });
      });
    },
  );
}
