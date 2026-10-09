import type { BillingCycle, PaymentProvider, Plan } from "./account-contracts";
export function billingPrice(
  plan: Plan,
  cycle: BillingCycle,
  provider: PaymentProvider,
): number | null {
  if (plan.code === "free") return 0;
  if (cycle === "yearly")
    return provider === "sepay"
      ? plan.yearly_price_vnd
      : plan.yearly_price_usd_cents;
  return provider === "sepay" ? plan.price_vnd : plan.price_usd_cents;
}
export function yearlySaving(
  plan: Plan,
  provider: PaymentProvider,
): number | null {
  const monthly = billingPrice(plan, "monthly", provider);
  const yearly = billingPrice(plan, "yearly", provider);
  if (
    monthly === null ||
    yearly === null ||
    monthly <= 0 ||
    yearly >= monthly * 12
  )
    return null;
  return Math.floor((1 - yearly / (monthly * 12)) * 100);
}
