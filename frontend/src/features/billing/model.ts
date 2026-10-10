import type {
  Order,
  PaymentProvider,
  Plan,
  Profile,
} from "../../shared/api/account-contracts";
import { BillingApi } from "../../shared/api/billing-api";
export type BillingProps = {
  api: BillingApi;
  onPaid: () => Promise<void>;
  profile: Profile;
};
export type Catalog = {
  plans: Plan[];
  options: Record<PaymentProvider, boolean>;
  orders: Order[];
};
