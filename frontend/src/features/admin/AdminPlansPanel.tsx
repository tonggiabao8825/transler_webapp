import type { FormEvent, JSX } from "react";
import type { Plan } from "../../shared/api/account-contracts";
import { useTranslation } from "../../shared/i18n/i18n";
type Props = {
  plans: Plan[];
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, plan: Plan) => Promise<void>;
};
export function AdminPlansPanel({ plans, busy, onSave }: Props): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="plan-catalog admin-plan-catalog">
      {plans.map((plan) => (
        <section className="panel" key={plan.code}>
          <header className="admin-plan-heading">
            <span className="account-badge">{plan.code}</span>
            <h2>{plan.name}</h2>
            <p>{t("Manage limits and prices for each billing cycle.")} </p>
          </header>
          <form
            className="admin-form"
            onSubmit={(event) => void onSave(event, plan)}
          >
            <label>
              {t("Name")}{" "}
              <input
                name="name"
                defaultValue={plan.name}
                required
                maxLength={80}
              />
            </label>
            <label>
              {t("Pages per calendar month")}{" "}
              <input
                name="pages"
                type="number"
                defaultValue={plan.monthly_pages}
                min={1}
                max={1000000}
                required
              />
            </label>
            <label>
              {t("Document limit")}{" "}
              <input
                name="documents"
                type="number"
                defaultValue={plan.document_limit}
                min={1}
                max={10000}
                required
              />
            </label>
            <label>
              {t("Concurrent jobs")}{" "}
              <input
                name="parallel"
                type="number"
                defaultValue={plan.max_active_jobs}
                min={1}
                max={2}
                required
              />
            </label>
            <label>
              {t("Monthly access (days)")}{" "}
              <input
                type="number"
                value={30}
                readOnly
                min={1}
                max={30}
                required
              />
            </label>
            <fieldset className="plan-price-fields">
              <legend>{t("Monthly")} </legend>
              <label>
                {t("SePay price (VND)")}{" "}
                <input
                  name="vnd"
                  type="number"
                  defaultValue={plan.price_vnd ?? ""}
                  min={1000}
                  max={2000000000}
                  disabled={plan.code === "free"}
                />
              </label>
              <label>
                {t("Stripe price (USD cents)")}{" "}
                <input
                  name="usd"
                  type="number"
                  defaultValue={plan.price_usd_cents ?? ""}
                  min={50}
                  max={100000000}
                  disabled={plan.code === "free"}
                />
                <small>
                  {t("100 cents = 1 USD. Empty means unavailable.")}{" "}
                </small>
              </label>
            </fieldset>
            <fieldset className="plan-price-fields">
              <legend>{t("Yearly · 365 days")} </legend>
              <label>
                {t("SePay price (VND)")}{" "}
                <input
                  name="yearly_vnd"
                  type="number"
                  min={1000}
                  max={2000000000}
                  defaultValue={plan.yearly_price_vnd ?? ""}
                  disabled={plan.code === "free"}
                />
              </label>
              <label>
                {t("Stripe price (USD cents)")}{" "}
                <input
                  name="yearly_usd"
                  type="number"
                  min={50}
                  max={100000000}
                  defaultValue={plan.yearly_price_usd_cents ?? ""}
                  disabled={plan.code === "free"}
                />
                <small>
                  {t(
                    "Empty prices disable checkout for that cycle and currency.",
                  )}{" "}
                </small>
              </label>
            </fieldset>
            <label className="checkbox-label">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={plan.enabled}
                disabled={plan.code === "free"}
              />
              {t("Enabled")}{" "}
            </label>
            <button
              className="button primary"
              data-testid={`save-plan-${plan.code}`}
              disabled={busy}
            >
              {t("Save plan")}{" "}
            </button>
          </form>
        </section>
      ))}
    </div>
  );
}
