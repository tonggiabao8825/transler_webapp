export function money(amount: number, currency: "vnd" | "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(currency === "usd" ? amount / 100 : amount);
}
