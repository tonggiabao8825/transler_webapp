import type { Account } from "./api/account-contracts";
export function activePlanCode(account: Account | null, now: Date): string {
  if (!account || account.plan_code === "free" || !account.plan_expires_at)
    return "free";
  return new Date(account.plan_expires_at) > now ? account.plan_code : "free";
}
