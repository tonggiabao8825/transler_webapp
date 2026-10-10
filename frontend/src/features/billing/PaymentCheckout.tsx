import {
  Check,
  Clock,
  Copy,
  CreditCard,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";
import type { Checkout } from "../../shared/api/account-contracts";
import { money } from "../../shared/formatting";
import { useTranslation } from "../../shared/i18n/i18n";

type Props = {
  checkout: Checkout;
  busy: boolean;
  onCancel: () => void;
  onBack: () => void;
  onRefresh: () => void;
};

export function PaymentCheckout({
  checkout,
  busy,
  onCancel,
  onBack,
  onRefresh,
}: Props): JSX.Element {
  const { t, language } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [qrLoaded, setQrLoaded] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { order } = checkout;
  const pending = order.status === "PENDING";
  const remaining = Math.max(
    0,
    Math.ceil((new Date(order.expires_at).getTime() - now) / 1000),
  );
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [order.id]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [order.id, pending]);
  async function copy(value: string): Promise<void> {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <section className="payment-checkout" data-testid="checkout-details">
      <header className="payment-checkout-heading">
        <span
          className={`payment-checkout-symbol ${order.status === "PAID" ? "paid" : ""}`}
        >
          {order.status === "PAID" ? (
            <Check size={26} />
          ) : pending ? (
            <QrCode size={26} />
          ) : (
            <Clock size={26} />
          )}
        </span>
        <h2 ref={heading} tabIndex={-1}>
          {pending
            ? t("Complete your payment")
            : `${t("Order")} ${t(order.status.toLowerCase())}`}
        </h2>
        <p aria-live="polite">
          {pending
            ? t(
                "Your order is reserved. Complete or cancel it before starting another payment.",
              )
            : order.status === "PAID"
              ? t("Your payment is verified. Your plan is active.")
              : order.status === "CANCELLED"
                ? t(
                    "This payment order was cancelled. You can choose a new plan.",
                  )
                : order.status === "EXPIRED"
                  ? t(
                      "This order expired. Create a new order before transferring.",
                    )
                  : t("This payment needs administrator review.")}
        </p>
      </header>
      <div className="payment-checkout-summary">
        <span>
          <strong>{order.plan_code}</strong>
          <small>
            {order.billing_cycle === "yearly"
              ? t("Yearly · 365 days")
              : t("Monthly · 30 days")}
          </small>
        </span>
        <strong>{money(order.amount, order.currency)}</strong>
      </div>
      {pending && (
        <>
          <div
            className={`payment-countdown ${remaining <= 60 ? "ending" : ""}`}
          >
            <Clock size={16} />
            <span>{t("Time remaining")}</span>
            <strong
              data-testid="payment-countdown"
              role="timer"
              aria-label={t("Time remaining")}
            >
              {countdown}
            </strong>
          </div>
          {remaining > 0 ? (
            checkout.qr_url ? (
              <>
                <div
                  className="payment-qr"
                  aria-busy={
                    qrLoaded !== checkout.qr_url && qrFailed !== checkout.qr_url
                  }
                >
                  {qrLoaded !== checkout.qr_url &&
                    qrFailed !== checkout.qr_url && (
                      <LoaderCircle
                        className="spin payment-qr-loader"
                        size={24}
                        aria-label={t("Loading…")}
                      />
                    )}
                  <img
                    data-testid="payment-qr"
                    src={checkout.qr_url}
                    onLoad={() => setQrLoaded(checkout.qr_url)}
                    onError={() => setQrFailed(checkout.qr_url)}
                    alt={t("Bank transfer QR code")}
                    width={240}
                    height={240}
                  />
                </div>
                {qrFailed === checkout.qr_url && (
                  <p className="account-error" role="alert">
                    {t(
                      "Unable to load the payment QR code. Refresh this page to try again.",
                    )}
                  </p>
                )}
                <p className="payment-qr-caption">
                  {t("Scan with your banking app to pay.")}
                </p>
                <dl className="payment-bank-details">
                  <div>
                    <dt>{t("Bank")}</dt>
                    <dd>{checkout.bank_code}</dd>
                  </div>
                  <div>
                    <dt>{t("Account holder")}</dt>
                    <dd>{checkout.bank_name}</dd>
                  </div>
                  <div>
                    <dt>{t("Account")}</dt>
                    <dd>
                      {checkout.bank_account}
                      <button
                        className="billing-copy"
                        aria-label={t("Copy bank account")}
                        onClick={() => {
                          if (checkout.bank_account)
                            void copy(checkout.bank_account);
                        }}
                      >
                        <Copy size={14} />
                      </button>
                    </dd>
                  </div>
                  <div className="payment-reference">
                    <dt>{t("Transfer reference (required)")}</dt>
                    <dd>
                      <code>{order.reference}</code>
                      <button
                        className="billing-copy"
                        aria-label={t("Copy transfer reference")}
                        onClick={() => void copy(order.reference)}
                      >
                        <Copy size={14} />
                      </button>
                    </dd>
                  </div>
                </dl>
              </>
            ) : order.checkout_url ? (
              <a
                className="button primary payment-stripe-link"
                data-testid="payment-secure-checkout"
                href={order.checkout_url}
              >
                <CreditCard size={18} />
                {t("Continue secure checkout")}
              </a>
            ) : (
              <p role="status">{t("Creating order…")}</p>
            )
          ) : (
            <p className="payment-verifying" role="status">
              {t("Checking order expiry. Please do not transfer money.")}
            </p>
          )}
          <p className="payment-verifying">
            <span className="payment-live-dot" />
            {t("Waiting for payment verification…")}
          </p>
          <div className="payment-checkout-actions">
            <button
              className="button secondary"
              data-testid="payment-refresh"
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={15} />
              {t("Refresh status")}
            </button>
            <button
              className="button payment-cancel"
              data-testid="payment-cancel"
              disabled={busy}
              onClick={onCancel}
            >
              <X size={15} />
              {busy ? t("Cancelling…") : t("Cancel payment")}
            </button>
          </div>
        </>
      )}
      {!pending && (
        <button
          className="button primary payment-back"
          data-testid="payment-back"
          onClick={onBack}
        >
          {t("Back to plans")}
        </button>
      )}
      {order.status === "REVIEW" && <p role="status">{order.review_reason}</p>}
      {copied && (
        <p className="payment-feedback" role="status">
          {t("Copied to clipboard.")}
        </p>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <ShieldCheck size={14} />
        {t("Your plan activates after payment verification.")}
        <small>
          {t("Expires")} {new Date(order.expires_at).toLocaleString(language)}
        </small>
      </footer>
    </section>
  );
}
