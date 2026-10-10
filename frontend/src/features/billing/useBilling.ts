import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BillingCycle,
  Checkout,
  Order,
  PaymentProvider,
} from "../../shared/api/account-contracts";
import { billingPrice } from "./billing-pricing";
import { BillingProps, Catalog } from "./model";
export function useBilling({
  api,
  onPaid,
}: Pick<BillingProps, "api" | "onPaid">) {
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
  const currency: "vnd" | "usd" = method === "sepay" ? "vnd" : "usd";
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
  return {
    cycle,
    setCycle,
    selectedCode,
    setSelectedCode,
    method,
    setMethod,
    catalog,
    checkout,
    setCheckout,
    error,
    busy,
    purchase,
    start,
    open,
    selected,
    amount,
    currency,
    cancel,
  };
}
