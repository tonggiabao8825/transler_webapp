import { useTranslation } from "./i18n";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  Check,
  ShieldCheck,
  CreditCard,
  Landmark,
  ArrowRight,
  Receipt,
  Sparkles,
  Clock,
} from "lucide-react";
import { PaymentCheckout } from "./PaymentCheckout";
import { billingPrice, yearlySaving } from "./billing-pricing";
import { AccountApi, money } from "./account-api";
import type {
  Checkout,
  Order,
  PaymentProvider,
  Plan,
  Profile,
  BillingCycle,
} from "./account-contracts";
type Props = { api: AccountApi; onPaid: () => Promise<void>; profile: Profile };
type Catalog = {
  plans: Plan[];
  options: Record<PaymentProvider, boolean>;
  orders: Order[];
};
export function BillingPanel({ api, onPaid, profile }: Props): JSX.Element {
  const { t, language } = useTranslation();

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentProvider>("sepay");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const purchase = useRef<{
    plan: string;
    provider: PaymentProvider;
    cycle: BillingCycle;
    id: string;
  } | null>(null);
  const load = useCallback(async (): Promise<Order[]> => {
    const [plans, options, orders] = await Promise.all([
      api.plans(),
      api.options(),
      api.orders(),
    ]);
    setCatalog({ plans, options, orders });
    return orders;
  }, [api]);
  useEffect(() => {
    let active = true;
    void load()
      .then(async (orders) => {
        const id = new URLSearchParams(window.location.search).get("payment");
        const pending = orders.find((order) => order.status === "PENDING");
        const activeId = pending?.id ?? id;
        if (activeId && active) {
          const result = await api.order(activeId);
          if (active) setCheckout(result);
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      active = false;
    };
  }, [api, load]);
  useEffect(() => {
    if (!checkout || checkout.order.status !== "PENDING") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = checkout.order.id;
    async function poll(): Promise<void> {
      try {
        const result = await api.order(id);
        if (!active) return;
        setCheckout(result);
        if (result.order.status === "PENDING")
          timer = setTimeout(() => void poll(), 5000);
        else {
          await load();
          if (result.order.status === "PAID") await onPaid();
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    }
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    api,
    checkout?.order.id,
    checkout?.order.status,
    load,
    onPaid,
    pollRevision,
  ]);
  async function start(plan: string, provider: PaymentProvider): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (
        purchase.current?.plan !== plan ||
        purchase.current.provider !== provider ||
        purchase.current.cycle !== cycle
      )
        purchase.current = { plan, provider, cycle, id: crypto.randomUUID() };
      const result = await api.checkout(
        plan,
        provider,
        purchase.current.id,
        cycle,
      );
      setCheckout(result);
      purchase.current = null;
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      try {
        const orders = await load();
        const pending = orders.find((order) => order.status === "PENDING");
        if (pending) setCheckout(await api.order(pending.id));
      } catch (restoreFailure) {
        setError(
          `${failure instanceof Error ? failure.message : String(failure)}; Unable to reload the current payment order: ${restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)}`,
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string): Promise<void> {
    setError(null);
    try {
      const result = await api.order(id);
      setCheckout(result);
      if (result.order.status !== "PENDING") {
        await load();
        if (result.order.status === "PAID") await onPaid();
      }
      setPollRevision((revision) => revision + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  const selected =
    catalog?.plans.find((plan) => plan.code === selectedCode) ?? null;
  const amount = selected ? billingPrice(selected, cycle, method) : null;
  const currency = method === "sepay" ? "vnd" : "usd";
  async function cancel(): Promise<void> {
    if (!checkout) throw new Error("Select a payment order before cancelling.");
    setBusy(true);
    setError(null);
    try {
      const result = await api.cancelOrder(checkout.order.id);
      purchase.current = null;
      const orders = await load();
      const pending = orders.find((order) => order.status === "PENDING");
      setCheckout(pending ? await api.order(pending.id) : result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="billing-workspace" data-testid="billing-panel">
      <header className="billing-heading">
        <div>
          <span className="billing-eyebrow">{t("PLANS & BILLING")} </span>
          <h2>{t("More room for your ideas.")} </h2>
          <p>
            {t(
              "Choose your plan. Keep your documents and workflow in one place.",
            )}{" "}
          </p>
        </div>
        <span className="billing-secure">
          <ShieldCheck size={17} /> {t("Secure checkout")}{" "}
        </span>
      </header>
      <div className="billing-current-plan">
        <div className="billing-plan-symbol">
          <Sparkles size={23} />
        </div>
        <div>
          <span>{t("Your current plan")} </span>
          <strong>{profile.plan.name}</strong>
          <small>
            {profile.plan.code === "free"
              ? t("Monthly free allowance")
              : `${t("Active until")} ${new Date(profile.account.plan_expires_at!).toLocaleDateString(language)}`}
          </small>
        </div>
        <div className="billing-current-usage">
          <strong>
            {profile.usage.pages_used.toLocaleString(language)}{" "}
            <span>/ {profile.plan.monthly_pages.toLocaleString(language)}</span>
          </strong>
          <small>{t("pages used this calendar month")} </small>
        </div>
      </div>
      {!checkout && (
        <div className="billing-cycle-row">
          <div
            className="billing-cycle-switch"
            role="group"
            aria-label={t("Billing cycle")}
          >
            {(["monthly", "yearly"] as const).map((value) => (
              <button
                data-testid={`billing-cycle-${value}`}
                key={value}
                aria-pressed={cycle === value}
                disabled={busy}
                onClick={() => {
                  setCycle(value);
                  purchase.current = null;
                }}
              >
                {value === "monthly" ? t("Monthly") : t("Yearly")}
              </button>
            ))}
          </div>
          <p>{t("Prepaid access · No automatic renewal")} </p>
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {!catalog ? (
        <div className="billing-loading" role="status">
          {t("Loading your plans…")}{" "}
        </div>
      ) : checkout ? (
        <PaymentCheckout
          checkout={checkout}
          busy={busy}
          onCancel={() => void cancel()}
          onBack={() => {
            setCheckout(null);
            setSelectedCode(null);
          }}
          onRefresh={() => void open(checkout.order.id)}
        />
      ) : (
        <>
          <div className="billing-plan-grid">
            {catalog.plans.map((plan) => {
              const price = billingPrice(plan, cycle, method);
              const saving = yearlySaving(plan, method);
              const current = plan.code === profile.plan.code;
              return (
                <article
                  key={plan.code}
                  className={`billing-plan-card ${selectedCode === plan.code ? "selected" : ""} ${current ? "current" : ""}`}
                >
                  <div className="billing-card-top">
                    <h3>{plan.name}</h3>
                    {current ? (
                      <span className="billing-current-badge">
                        {t("Current plan")}{" "}
                      </span>
                    ) : cycle === "yearly" && saving !== null && saving > 0 ? (
                      <span className="billing-saving">
                        {t("Save")} {saving}
                        {t("% vs 12 monthly purchases")}{" "}
                      </span>
                    ) : null}
                  </div>
                  <div className="billing-price">
                    <strong>
                      {price === null
                        ? t("Not available")
                        : plan.code === "free"
                          ? t("Free")
                          : money(price, currency)}
                    </strong>
                    {plan.code !== "free" && price !== null && (
                      <span>
                        {" "}
                        / {cycle === "yearly" ? t("year") : t("month")}
                      </span>
                    )}
                  </div>
                  <p className="billing-price-caption">
                    {plan.code === "free"
                      ? t("A free place to start.")
                      : price === null
                        ? t(
                            "An administrator must configure this cycle's price.",
                          )
                        : `${cycle === "yearly" ? "365" : "30"} ${t("days of access")} · ${cycle === "yearly" ? t("Paid once per year") : t("Paid once per term")}`}
                  </p>
                  <ul>
                    {[
                      `${plan.monthly_pages.toLocaleString(language)} ${t("pages each calendar month")}`,
                      `${plan.document_limit.toLocaleString(language)} ${t("saved documents")}`,
                      `${plan.max_active_jobs} ${t("concurrent processing jobs")}`,
                      t("Original files and processed versions"),
                    ].map((feature) => (
                      <li key={feature}>
                        <Check size={16} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <button
                    className={`button ${selectedCode === plan.code ? "primary" : "secondary"}`}
                    data-testid={`choose-plan-${plan.code}`}
                    disabled={plan.code === "free" || busy}
                    aria-pressed={selectedCode === plan.code}
                    onClick={() => {
                      setSelectedCode(plan.code);
                      purchase.current = null;
                    }}
                  >
                    {plan.code === "free"
                      ? current
                        ? t("Your current plan")
                        : t("Free plan")
                      : selectedCode === plan.code
                        ? t("Selected")
                        : current
                          ? t("Extend your plan")
                          : t("Choose plan")}
                    {plan.code !== "free" && <ArrowRight size={16} />}
                  </button>
                </article>
              );
            })}
          </div>
          <section
            className="billing-payment-layout"
            aria-label={t("Payment method and order summary")}
          >
            <div className="billing-methods">
              <h3>{t("How would you like to pay?")} </h3>
              <p>{t("Bank transfer in VND, or Stripe checkout in USD.")} </p>
              <div
                className="billing-method-options"
                role="group"
                aria-label={t("Payment method")}
              >
                {(["sepay", "card", "stripe"] as const).map((provider) => (
                  <button
                    key={provider}
                    data-testid={`buy-${provider}`}
                    aria-pressed={method === provider}
                    disabled={busy}
                    onClick={() => {
                      setMethod(provider);
                      purchase.current = null;
                    }}
                    className={method === provider ? "selected" : ""}
                  >
                    {provider === "sepay" ? (
                      <Landmark size={21} />
                    ) : (
                      <CreditCard size={21} />
                    )}
                    <span>
                      <strong>
                        {provider === "sepay"
                          ? t("Bank transfer")
                          : provider === "card"
                            ? t("Credit or debit card")
                            : t("Stripe")}
                      </strong>
                      <small>
                        {provider === "sepay"
                          ? t("SePay · VND")
                          : t("Stripe secure checkout · USD")}
                        {!catalog.options[provider] &&
                          ` · ${t("Not configured")}`}
                      </small>
                    </span>
                    <span className="billing-radio">
                      {method === provider && <Check size={12} />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <aside className="billing-order-summary">
              <span className="billing-eyebrow">{t("ORDER SUMMARY")} </span>
              <h3>{selected?.name ?? t("Choose plan")}</h3>
              <dl>
                <div>
                  <dt>{t("Access")} </dt>
                  <dd>
                    {cycle === "yearly"
                      ? t("Yearly · 365 days")
                      : selected
                        ? t("Monthly · 30 days")
                        : t("Monthly")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Payment")} </dt>
                  <dd>
                    {method === "sepay"
                      ? t("Bank transfer")
                      : method === "card"
                        ? t("Card")
                        : t("Stripe")}
                  </dd>
                </div>
                <div className="billing-total">
                  <dt>{t("Total due")} </dt>
                  <dd data-testid="billing-total">
                    {amount === null ? "—" : money(amount, currency)}
                  </dd>
                </div>
              </dl>
              <button
                className="button primary"
                data-testid="billing-continue"
                disabled={
                  busy ||
                  !selected ||
                  amount === null ||
                  !catalog.options[method]
                }
                onClick={() => {
                  if (!selected)
                    throw new Error("Select a plan before checkout.");
                  void start(selected.code, method);
                }}
              >
                {busy ? t("Creating order…") : t("Continue to payment")}
                <ArrowRight size={16} />
              </button>
              <small>
                <ShieldCheck size={13} />{" "}
                {t("Your plan activates after payment verification.")}{" "}
              </small>
            </aside>
          </section>
          {!catalog.options[method] && (
            <p className="billing-setup-notice">
              <Clock size={16} />
              {t(
                "This payment method is not configured yet. Contact the administrator or choose another method.",
              )}{" "}
            </p>
          )}
          <section className="billing-history">
            <header>
              <div>
                <h3>{t("Payment history")} </h3>
                <p>{t("Your purchases, all in one place.")} </p>
              </div>
              <Receipt size={20} />
            </header>
            <div className="account-table-wrap">
              <table className="account-table" data-testid="payment-history">
                <thead>
                  <tr>
                    <th>{t("Plan")} </th>
                    <th>{t("Cycle")} </th>
                    <th>{t("Method")} </th>
                    <th>{t("Amount")} </th>
                    <th>{t("Status")} </th>
                    <th>{t("Created")} </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {catalog.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.plan_code}</td>
                      <td>{order.billing_cycle}</td>
                      <td>{order.provider}</td>
                      <td>{money(order.amount, order.currency)}</td>
                      <td>
                        <span
                          className={`billing-status status-${order.status.toLowerCase()}`}
                        >
                          {t(order.status.toLowerCase())}
                        </span>
                      </td>
                      <td>
                        {new Date(order.created_at).toLocaleDateString(
                          language,
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          data-testid={`payment-details-${order.id}`}
                          onClick={() => void open(order.id)}
                        >
                          {t("Details")}{" "}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {catalog.orders.length === 0 && (
                <div className="billing-empty-history">
                  <Receipt size={25} />
                  <strong>{t("No payments yet")} </strong>
                  <p>
                    {t(
                      "Completed and pending purchases will appear here.",
                    )}{" "}
                  </p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
