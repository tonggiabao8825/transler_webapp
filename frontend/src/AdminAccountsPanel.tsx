import { Select, SelectOption } from "./Select";
import { useTranslation } from "./i18n";
import type { JSX, FormEvent } from "react";
import type { z } from "zod";
import {
  adminAccountSchema,
  type Account,
  type Plan,
} from "./account-contracts";
type Props = {
  accounts: Array<z.infer<typeof adminAccountSchema>>;
  plans: Plan[];
  account: Account | null;
  busy: boolean;
  onSelect: (account: Account | null) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};
export function AdminAccountsPanel({
  accounts,
  plans,
  account,
  busy,
  onSelect,
  onSave,
}: Props): JSX.Element {
  const { t, language } = useTranslation();

  return (
    <>
      <div className="account-table-wrap panel">
        <table className="account-table" data-testid="admin-accounts">
          <thead>
            <tr>
              <th>{t("Account")} </th>
              <th>{t("Role")} </th>
              <th>{t("Plan")} </th>
              <th>{t("Usage")} </th>
              <th>{t("Status")} </th>
              <th>{t("Action")} </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((entry) => (
              <tr key={entry.account.id}>
                <td>
                  <strong>{entry.account.name}</strong>
                  <small>{entry.account.email}</small>
                </td>
                <td>{t(entry.account.role)}</td>
                <td>
                  {entry.account.plan_code}
                  {entry.account.plan_expires_at && (
                    <small>
                      {t("Expires")}{" "}
                      {new Date(entry.account.plan_expires_at).toLocaleString(
                        language,
                      )}
                    </small>
                  )}
                </td>
                <td>
                  {entry.usage.pages_used} {t("used ·")}{" "}
                  {entry.usage.pages_reserved} {t("reserved")}{" "}
                </td>
                <td>{entry.account.is_active ? t("Active") : t("Disabled")}</td>
                <td>
                  <button
                    className="text-button"
                    data-testid={`edit-account-${entry.account.id}`}
                    onClick={() => onSelect(entry.account)}
                  >
                    {t("Edit")}{" "}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {account && (
        <section className="panel" data-testid="admin-account-editor">
          <h2>
            {t("Edit")} {account.email}
          </h2>
          <form
            className="admin-form"
            key={account.id}
            onSubmit={(event) => void onSave(event)}
          >
            <label>
              {t("Name")}{" "}
              <input
                name="name"
                defaultValue={account.name}
                required
                maxLength={80}
              />
            </label>
            <label>
              {t("Role")}{" "}
              <Select name="role" defaultValue={account.role}>
                <SelectOption value="user">{t("User")} </SelectOption>
                <SelectOption value="admin">{t("Administrator")} </SelectOption>
              </Select>
            </label>
            <label>
              {t("Plan")}{" "}
              <Select name="plan" defaultValue={account.plan_code}>
                {plans.map((plan) => (
                  <SelectOption value={plan.code} key={plan.code}>
                    {plan.name}
                  </SelectOption>
                ))}
              </Select>
            </label>
            <label>
              {t("Plan expiration (local time)")}{" "}
              <input
                name="expiry"
                type="datetime-local"
                defaultValue={
                  account.plan_expires_at
                    ? localDate(account.plan_expires_at)
                    : ""
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                name="active"
                type="checkbox"
                defaultChecked={account.is_active}
              />
              {t("Account active")}{" "}
            </label>
            <div className="account-actions">
              <button className="button primary" disabled={busy}>
                {t("Save account")}{" "}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => onSelect(null)}
              >
                {t("Cancel")}{" "}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
function localDate(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
