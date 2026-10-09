import { useTranslation } from "./i18n";
import { AdminToolsPanel } from "./AdminToolsPanel";
import { CreatePlan } from "./CreatePlan";
import {
  useCallback,
  useEffect,
  useState,
  type JSX,
  type FormEvent,
} from "react";
import { z } from "zod";
import { GatewayPanel } from "./GatewayPanel";
import { AdminAccountsPanel } from "./AdminAccountsPanel";
import { AdminPlansPanel } from "./AdminPlansPanel";
import { AccountApi, money } from "./account-api";
import {
  accountSchema,
  adminAccountSchema,
  auditSchema,
  overviewSchema,
  paymentEventSchema,
  type Account,
  type AdminOrder,
  type Order,
  type Plan,
} from "./account-contracts";
type Tab =
  | "overview"
  | "accounts"
  | "plans"
  | "payments"
  | "audit"
  | "gateways"
  | "tools";
type Data = {
  overview: z.infer<typeof overviewSchema>;
  accounts: Array<z.infer<typeof adminAccountSchema>>;
  plans: Plan[];
  payments: AdminOrder[];
  events: Array<z.infer<typeof paymentEventSchema>>;
  audit: Array<z.infer<typeof auditSchema>>;
};
type Props = { api: AccountApi; onChanged: () => Promise<void> };
export function AdminScreen({ api, onChanged }: Props): JSX.Element {
  const { t, language } = useTranslation();

  const [tab, setTab] = useState<Tab>("overview");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [review, setReview] = useState<Order | null>(null);
  const load = useCallback(async (): Promise<void> => {
    const [overview, accounts, plans, payments, events, audit] =
      await Promise.all([
        api.overview(),
        api.accounts(offset),
        api.adminPlans(),
        api.payments(offset),
        api.events(offset),
        api.audit(offset),
      ]);
    setData({ overview, accounts, plans, payments, events, audit });
  }, [api, offset]);
  useEffect(() => {
    void load().catch((failure) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, [load]);
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function saveAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!account) throw new Error("Select an account before saving.");
    const form = new FormData(event.currentTarget);
    const role = accountSchema.shape.role.parse(form.get("role"));
    const expiry = String(form.get("expiry"));
    const target = account.id;
    await perform(async () => {
      await api.updateAccount(target, {
        name: String(form.get("name")),
        role,
        is_active: form.get("active") === "on",
        plan_code: String(form.get("plan")),
        plan_expires_at: expiry ? new Date(expiry).toISOString() : null,
      });
      setAccount(null);
    });
  }
  async function savePlan(
    event: FormEvent<HTMLFormElement>,
    plan: Plan,
  ): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      await api.updatePlan({
        ...plan,
        name: String(form.get("name")),
        monthly_pages: Number(form.get("pages")),
        document_limit: Number(form.get("documents")),
        max_active_jobs: Number(form.get("parallel")),
        duration_days: plan.duration_days,
        price_vnd: form.get("vnd") ? Number(form.get("vnd")) : null,
        price_usd_cents: form.get("usd") ? Number(form.get("usd")) : null,
        yearly_price_vnd: form.get("yearly_vnd")
          ? Number(form.get("yearly_vnd"))
          : null,
        yearly_price_usd_cents: form.get("yearly_usd")
          ? Number(form.get("yearly_usd"))
          : null,
        enabled: plan.code === "free" || form.get("enabled") === "on",
      });
    });
  }
  return (
    <section className="admin-screen" data-testid="admin-screen">
      <div className="page-heading">
        <div>
          <h1>{t("Administration")} </h1>
          <p>{t("Accounts, plans, payments and platform activity.")} </p>
        </div>
        <a
          href="/v1/admin/report"
          className="button secondary"
          data-testid="admin-report"
        >
          {t("Export report")}{" "}
        </a>
      </div>
      <div className="account-tabs">
        {(
          [
            "overview",
            "accounts",
            "plans",
            "gateways",
            "tools",
            "payments",
            "audit",
          ] as const
        ).map((value) => (
          <button
            key={value}
            data-testid={`admin-tab-${value}`}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setOffset(0);
              setAccount(null);
            }}
          >
            {t(value)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="account-error" data-testid="admin-error">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">{t("Loading administration…")} </p>
      ) : (
        <>
          {tab === "tools" && <AdminToolsPanel api={api} onSaved={load} />}
          {tab === "gateways" && <GatewayPanel />}
          {tab === "overview" && (
            <>
              <div className="account-metrics">
                {(
                  [
                    ["Accounts", data.overview.accounts],
                    ["Active accounts", data.overview.active_accounts],
                    ["Paid accounts", data.overview.paid_accounts],
                    ["Documents", data.overview.documents],
                    ["Translations", data.overview.jobs],
                    ["Active jobs", data.overview.active_jobs],
                    ["Failed jobs", data.overview.failed_jobs],
                    [
                      "Verified VND revenue",
                      money(data.overview.revenue_vnd, "vnd"),
                    ],
                    [
                      "Verified USD revenue",
                      money(data.overview.revenue_usd_cents, "usd"),
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <article className="panel metric" key={label}>
                    <span>{t(label)}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
              <section className="panel">
                <h2>{t("Daily activity")} </h2>
                <div className="account-table-wrap">
                  <table className="account-table">
                    <thead>
                      <tr>
                        <th>{t("UTC date")} </th>
                        <th>{t("Pages completed")} </th>
                        <th>{t("Completed jobs")} </th>
                        <th>{t("Failed jobs")} </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overview.daily.map((day) => (
                        <tr key={day.date}>
                          <td>{day.date}</td>
                          <td>{day.completed_pages}</td>
                          <td>{day.completed_jobs}</td>
                          <td>{day.failed_jobs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {tab === "accounts" && (
            <AdminAccountsPanel
              accounts={data.accounts}
              plans={data.plans}
              account={account}
              busy={busy}
              onSelect={setAccount}
              onSave={saveAccount}
            />
          )}
          {tab === "plans" && (
            <>
              <AdminPlansPanel
                plans={data.plans}
                busy={busy}
                onSave={savePlan}
              />
              <CreatePlan onCreated={load} />
            </>
          )}
          {tab === "payments" && (
            <>
              <div className="panel account-table-wrap">
                <h2>{t("Orders")} </h2>
                <table className="account-table">
                  <thead>
                    <tr>
                      <th>{t("Reference")} </th>
                      <th>{t("Plan / provider")} </th>
                      <th>{t("Amount")} </th>
                      <th>{t("Status")} </th>
                      <th>{t("Review")} </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <code>{order.reference}</code>
                          <small>
                            {order.account_name} · {order.account_email}
                          </small>
                          <small>
                            {new Date(order.created_at).toLocaleString(
                              language,
                            )}
                          </small>
                        </td>
                        <td>
                          {order.plan_code} / {order.provider}
                        </td>
                        <td>{money(order.amount, order.currency)}</td>
                        <td>{t(order.status.toLowerCase())}</td>
                        <td>
                          {order.review_reason}
                          {order.status === "REVIEW" && (
                            <button
                              className="text-button"
                              onClick={() => setReview(order)}
                            >
                              {t("Review payment")}{" "}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.payments.length === 0 && <p>{t("No orders yet.")} </p>}
              </div>
              <div className="panel account-table-wrap">
                <h2>{t("Webhook events")} </h2>
                <table className="account-table">
                  <thead>
                    <tr>
                      <th>{t("Gateway / event")} </th>
                      <th>{t("Order")} </th>
                      <th>{t("Outcome")} </th>
                      <th>{t("Received")} </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={`${event.provider}:${event.event_id}`}>
                        <td>
                          {event.provider} / {event.event_id}
                        </td>
                        <td>{event.order_id ?? "Unmatched"}</td>
                        <td>{event.outcome}</td>
                        <td>
                          {new Date(event.received_at).toLocaleString(language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {review && (
                <section
                  className="panel account-error"
                  data-testid="payment-review"
                >
                  <h2>{t("Confirm a verified payment")} </h2>
                  <p>
                    {review.reference} · {money(review.amount, review.currency)}{" "}
                    · {review.plan_code} · {review.duration_days}{" "}
                    {t("days")}{" "}
                  </p>
                  <p>{review.review_reason}</p>
                  <p>
                    {t(
                      "Verify the bank or Stripe transaction before confirming. This activates the plan and records your administrator ID in the audit log.",
                    )}{" "}
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.confirm(review.id);
                        setReview(null);
                      })
                    }
                  >
                    {t("Confirm verified payment")}{" "}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setReview(null)}
                  >
                    {t("Cancel")}{" "}
                  </button>
                </section>
              )}
            </>
          )}
          {tab === "audit" && (
            <div className="panel account-table-wrap">
              <table className="account-table">
                <thead>
                  <tr>
                    <th>{t("Time")} </th>
                    <th>{t("Action")} </th>
                    <th>{t("Actor")} </th>
                    <th>{t("Target / details")} </th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {new Date(event.created_at).toLocaleString(language)}
                      </td>
                      <td>{event.action}</td>
                      <td>{event.actor_id ?? "System"}</td>
                      <td>
                        {event.target}
                        <small>{event.detail}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {["accounts", "payments", "audit"].includes(tab) && (
            <div className="account-actions">
              <button
                className="button secondary"
                disabled={offset === 0}
                onClick={() => setOffset(offset - 50)}
              >
                {t("Previous")}{" "}
              </button>
              <span>
                {t("Page")} {offset / 50 + 1}
              </span>
              <button
                className="button secondary"
                disabled={
                  (tab === "accounts"
                    ? data.accounts.length
                    : tab === "payments"
                      ? Math.max(data.payments.length, data.events.length)
                      : data.audit.length) < 50
                }
                onClick={() => setOffset(offset + 50)}
              >
                {t("Next")}{" "}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
