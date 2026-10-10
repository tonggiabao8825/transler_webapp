import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { z } from "zod";
import { readResponse } from "../../shared/api/http";
import { useTranslation } from "../../shared/i18n/i18n";
const schema = z.object({
  provider: z.enum(["sepay", "stripe"]),
  enabled: z.boolean(),
  ready: z.boolean(),
  settings: z.object({
    bank_code: z.string().nullable(),
    account_number: z.string().nullable(),
    account_name: z.string().nullable(),
  }),
  has_secret_key: z.boolean(),
  has_webhook_key: z.boolean(),
  updated_at: z.string().datetime(),
});
type Gateway = z.infer<typeof schema>;
export function GatewayPanel(): JSX.Element {
  const { t } = useTranslation();

  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (): Promise<void> =>
      setGateways(
        await readResponse(await fetch("/v1/admin/gateways"), z.array(schema)),
      ),
    [],
  );
  useEffect(() => {
    void load().catch((failure) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, [load]);
  async function save(
    event: FormEvent<HTMLFormElement>,
    item: Gateway,
  ): Promise<void> {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const secret = String(form.get("secret") ?? "");
    const webhook = String(form.get("webhook") ?? "");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await readResponse(
        await fetch(`/v1/admin/gateways/${item.provider}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: form.get("enabled") === "on",
            settings: {
              bank_code: form.get("bank") ? String(form.get("bank")) : null,
              account_number: form.get("account")
                ? String(form.get("account"))
                : null,
              account_name: form.get("name") ? String(form.get("name")) : null,
            },
            secrets: {
              ...(secret ? { secret_key: secret } : {}),
              ...(webhook ? { webhook_key: webhook } : {}),
            },
          }),
        }),
        schema,
      );
      element.reset();
      await load();
      setNotice("Gateway configuration saved. Secret values remain hidden.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-testid="admin-gateways">
      <h2>{t("Payment gateways")} </h2>
      <p>
        {t(
          "Secrets are encrypted in PostgreSQL and never returned to the browser. New orders use the saved configuration.",
        )}{" "}
      </p>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice-banner" role="status">
          {notice}
        </p>
      )}
      <div className="plan-catalog">
        {gateways.map((item) => (
          <section className="panel pricing-card" key={item.provider}>
            <h2>
              {item.provider === "stripe"
                ? t("Stripe & card")
                : t("SePay bank transfer")}
            </h2>
            <span className="account-badge">
              {item.ready
                ? t("Ready to accept payments")
                : t("Configuration required")}
            </span>
            <form
              key={item.updated_at}
              onSubmit={(event) => void save(event, item)}
            >
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={item.enabled}
                />
                {t("Enable gateway")}{" "}
              </label>
              {item.provider === "sepay" ? (
                <>
                  <label>
                    {t("Bank code")}{" "}
                    <input
                      name="bank"
                      defaultValue={item.settings.bank_code ?? ""}
                      maxLength={24}
                      placeholder={t("MB, VCB, ...")}
                    />
                  </label>
                  <label>
                    {t("Receiving account")}{" "}
                    <input
                      name="account"
                      defaultValue={item.settings.account_number ?? ""}
                      maxLength={19}
                    />
                  </label>
                  <label>
                    {t("Account holder")}{" "}
                    <input
                      name="name"
                      defaultValue={item.settings.account_name ?? ""}
                      maxLength={80}
                    />
                  </label>
                </>
              ) : (
                <label>
                  {t("Stripe secret key")}{" "}
                  <input
                    name="secret"
                    type="password"
                    autoComplete="off"
                    maxLength={512}
                    placeholder={
                      item.has_secret_key
                        ? t("Configured · leave empty to retain")
                        : t("Secret key required")
                    }
                  />
                </label>
              )}
              <label>
                {item.provider === "stripe"
                  ? t("Webhook signing secret")
                  : t("Webhook API key")}
                <input
                  name="webhook"
                  type="password"
                  autoComplete="off"
                  maxLength={512}
                  placeholder={
                    item.has_webhook_key
                      ? t("Configured · leave empty to retain")
                      : t("Webhook key required")
                  }
                />
              </label>
              <label>
                {t("Webhook endpoint")}{" "}
                <input
                  readOnly
                  value={`${window.location.origin}/v1/billing/webhooks/${item.provider}`}
                />
              </label>
              <small>
                {t(
                  "Use a reachable HTTPS endpoint for provider delivery. Set prices in Plans before accepting checkout.",
                )}{" "}
              </small>
              <button
                className="button primary"
                data-testid={`save-gateway-${item.provider}`}
                disabled={busy}
              >
                {t("Save gateway")}{" "}
              </button>
            </form>
          </section>
        ))}
      </div>
    </section>
  );
}
