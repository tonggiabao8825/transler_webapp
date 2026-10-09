import { useTranslation } from "./i18n";
import { useState, type JSX, type FormEvent } from "react";
import { readResponse } from "./api";
import { planSchema } from "./account-contracts";
export function CreatePlan({
  onCreated,
}: {
  onCreated: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setBusy(true);
    setError(null);
    try {
      await readResponse(
        await fetch("/v1/admin/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: String(form.get("code")),
            name: String(form.get("name")),
            monthly_pages: Number(form.get("pages")),
            document_limit: Number(form.get("documents")),
            max_active_jobs: Number(form.get("parallel")),
            duration_days: 30,
            price_vnd: form.get("vnd") ? Number(form.get("vnd")) : null,
            price_usd_cents: form.get("usd") ? Number(form.get("usd")) : null,
            yearly_price_vnd: form.get("yearly_vnd")
              ? Number(form.get("yearly_vnd"))
              : null,
            yearly_price_usd_cents: form.get("yearly_usd")
              ? Number(form.get("yearly_usd"))
              : null,
            enabled: form.get("enabled") === "on",
          }),
        }),
        planSchema,
      );
      element.reset();
      await onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t("Create plan")} </h2>
      {error && <p role="alert">{error}</p>}
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        {[
          { name: "code", label: "Code", type: "text", min: 0, max: 24 },
          { name: "name", label: "Name", type: "text", min: 0, max: 80 },
          {
            name: "pages",
            label: "Monthly pages",
            type: "number",
            min: 1,
            max: 1000000,
          },
          {
            name: "documents",
            label: "Document limit",
            type: "number",
            min: 1,
            max: 10000,
          },
          {
            name: "parallel",
            label: "Concurrent jobs",
            type: "number",
            min: 1,
            max: 2,
          },
        ].map((field) => (
          <label key={field.name}>
            {t(field.label)}
            <input
              data-testid={`new-plan-${field.name}`}
              name={field.name}
              type={field.type}
              min={field.min}
              max={field.max}
              maxLength={field.max}
              required
            />
          </label>
        ))}
        <label>
          {t("VND price")}{" "}
          <input name="vnd" type="number" min={1000} max={2000000000} />
        </label>
        <label>
          {t("USD price (cents)")}{" "}
          <input name="usd" type="number" min={50} max={100000000} />
        </label>
        <fieldset className="plan-price-fields">
          <legend>{t("Yearly · 365 days")} </legend>
          <label>
            {t("SePay price (VND)")}{" "}
            <input
              name="yearly_vnd"
              type="number"
              min={1000}
              max={2000000000}
            />
          </label>
          <label>
            {t("Stripe price (USD cents)")}{" "}
            <input name="yearly_usd" type="number" min={50} max={100000000} />
          </label>
        </fieldset>
        <label>
          <input name="enabled" type="checkbox" defaultChecked />
          {t("Enabled")}{" "}
        </label>
        <button
          className="button primary"
          data-testid="create-plan"
          disabled={busy}
        >
          {t("Create plan")}{" "}
        </button>
      </form>
    </section>
  );
}
