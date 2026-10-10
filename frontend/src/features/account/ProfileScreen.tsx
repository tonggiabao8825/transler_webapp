import {
  Download,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { AccountApi } from "../../shared/api/account-api";
import type { Profile } from "../../shared/api/account-contracts";
import type { BillingApi } from "../../shared/api/billing-api";
import { useTranslation } from "../../shared/i18n/i18n";
import { BillingPanel } from "../billing/BillingPanel";
type Props = {
  api: AccountApi;
  billingApi: BillingApi;
  onChanged: () => Promise<void>;
  onLoggedOut: () => Promise<void>;
};
export function ProfileScreen({
  api,
  billingApi,
  onChanged,
  onLoggedOut,
}: Props): JSX.Element {
  const { t, language } = useTranslation();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<"overview" | "billing" | "security">(
    new URLSearchParams(window.location.search).has("payment")
      ? "billing"
      : "overview",
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (): Promise<void> => setProfile(await api.profile()),
    [api],
  );
  useEffect(() => {
    function reloadProfile(): void {
      void load().catch((failure: Error) => setError(failure.message));
    }
    reloadProfile();
    window.addEventListener("focus", reloadProfile);
    return () => window.removeEventListener("focus", reloadProfile);
  }, [load]);
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const paid = useCallback(async (): Promise<void> => {
    await load();
    await onChanged();
  }, [load, onChanged]);
  async function rename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    await perform(async () => {
      await api.rename(name);
      await paid();
      setNotice("Profile saved.");
    });
  }
  async function password(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await perform(async () => {
      const next = String(data.get("new"));
      if (next !== String(data.get("confirm")))
        throw new Error("Passwords must match.");
      await api.password(String(data.get("current")), next);
      await onLoggedOut();
    });
  }
  return (
    <section className="account-screen" data-testid="account-screen">
      <div className="page-heading">
        <div>
          <h1>{t("My account")} </h1>
          <p>{t("Your plan, usage and private workspace.")} </p>
        </div>
        <button
          className="button secondary"
          data-testid="account-logout"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await api.logout();
              await onLoggedOut();
            })
          }
        >
          <LogOut size={16} />
          {t("Sign out")}{" "}
        </button>
      </div>
      <div className="account-tabs">
        {(["overview", "billing", "security"] as const).map((value) => (
          <button
            data-testid={`account-tab-${value}`}
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setNotice(null);
            }}
          >
            {value === "overview"
              ? t("Overview & usage")
              : value === "billing"
                ? t("Plans & billing")
                : t("Profile & security")}
          </button>
        ))}
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice-banner">
          {notice}
        </p>
      )}
      {!profile ? (
        <p role="status">{t("Loading account…")} </p>
      ) : (
        <>
          {tab === "overview" && (
            <>
              <div className="account-summary panel">
                <div className="account-identity">
                  <span className="account-avatar" aria-hidden="true">
                    <UserRound size={28} />
                  </span>
                  <div>
                    <span className="account-badge">
                      {t(profile.account.role)}
                    </span>
                    <h2>{profile.account.name}</h2>
                    <p>{profile.account.email}</p>
                  </div>
                </div>
                <div>
                  <h3>
                    <Sparkles size={16} /> {profile.plan.name} {t("plan")}{" "}
                  </h3>
                  <p>
                    {profile.plan.code === "free"
                      ? t("Monthly free allowance")
                      : `${t("Active until")} ${new Date(profile.account.plan_expires_at!).toLocaleDateString(language)}`}
                  </p>
                  <button
                    className="button primary"
                    data-testid="account-upgrade"
                    onClick={() => setTab("billing")}
                  >
                    {profile.plan.code === "free"
                      ? t("Upgrade plan")
                      : t("Manage plan")}
                  </button>
                </div>
              </div>
              <div className="account-metrics">
                {(
                  [
                    ["Pages translated", profile.usage.pages_used],
                    ["Pages reserved", profile.usage.pages_reserved],
                    ["Saved documents", profile.usage.documents],
                    ["Completed jobs", profile.usage.completed],
                    ["Failed jobs", profile.usage.failed],
                    [
                      "Storage",
                      `${(profile.usage.storage_bytes / 1024 / 1024).toFixed(1)} MB`,
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <article className="panel metric" key={label}>
                    <span>{t(label)}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
              <section className="panel usage-panel">
                <div className="section-heading">
                  <h2>{t("Monthly page allowance")} </h2>
                  <a
                    className="text-button"
                    data-testid="account-report"
                    href="/v1/account/report"
                  >
                    <Download size={16} />
                    {t("Download CSV report")}{" "}
                  </a>
                </div>
                <p>
                  {profile.usage.pages_used + profile.usage.pages_reserved} /{" "}
                  {profile.plan.monthly_pages} {t("pages ·")}{" "}
                  {new Date(profile.usage.period_start).toLocaleDateString(
                    language,
                  )}{" "}
                  –{" "}
                  {new Date(profile.usage.period_end).toLocaleDateString(
                    language,
                  )}{" "}
                  {t("(UTC)")}{" "}
                </p>
                <progress
                  aria-label={t("Monthly page allowance")}
                  value={
                    profile.usage.pages_used + profile.usage.pages_reserved
                  }
                  max={profile.plan.monthly_pages}
                />
                <p>
                  {t(
                    "Reserved pages belong to active translations. Failed or cancelled jobs release their reservation.",
                  )}{" "}
                </p>
                <h3>{t("Translation activity · last 30 days")} </h3>
                <div
                  className="activity-chart"
                  role="img"
                  aria-label={t("Daily translated pages over the last 30 days")}
                >
                  {profile.daily.map((day) => (
                    <div
                      key={day.date}
                      title={`${day.date}: ${day.completed_pages} pages, ${day.completed_jobs} completed, ${day.failed_jobs} failed`}
                    >
                      <span
                        style={{
                          height: `${(day.completed_pages / Math.max(1, ...profile.daily.map((item) => item.completed_pages))) * 100}%`,
                        }}
                      />
                      <small>{day.date.slice(8)}</small>
                    </div>
                  ))}
                </div>
                <details>
                  <summary>{t("View daily statistics")} </summary>
                  <div className="account-statistics-table">
                    <table className="account-table">
                      <thead>
                        <tr>
                          <th>{t("Date (UTC)")} </th>
                          <th>{t("Pages")} </th>
                          <th>{t("Completed")} </th>
                          <th>{t("Failed")} </th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.daily.map((day) => (
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
                </details>
              </section>
            </>
          )}
          {tab === "billing" && profile && (
            <BillingPanel api={billingApi} onPaid={paid} profile={profile} />
          )}
          {tab === "security" && (
            <div className="security-grid">
              <section
                className="panel profile-settings"
                data-testid="profile-settings"
              >
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <UserRound size={22} />
                  </span>
                  <div>
                    <h2>{t("Personal information")} </h2>
                    <p>{t("Your name and account details.")} </p>
                  </div>
                </div>
                <form onSubmit={(event) => void rename(event)}>
                  <label>
                    {t("Display name")}{" "}
                    <input
                      key={profile.account.name}
                      name="name"
                      data-testid="profile-name"
                      defaultValue={profile.account.name}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    {t("Email")}{" "}
                    <input
                      value={profile.account.email}
                      readOnly
                      type="email"
                    />
                  </label>
                  <button
                    className="button primary"
                    data-testid="profile-save"
                    disabled={busy}
                  >
                    {t("Save profile")}{" "}
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <ShieldCheck size={22} />
                  </span>
                  <div>
                    <h2>{t("Account security")} </h2>
                    <p>{t("Keep your workspace protected.")} </p>
                  </div>
                </div>
                <p>
                  {t(
                    "Changing your password signs out all sessions. Sign in again with the new password.",
                  )}{" "}
                </p>
                <form onSubmit={(event) => void password(event)}>
                  <label>
                    {t("Current password")}{" "}
                    <input
                      name="current"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </label>
                  <label>
                    {t("New password")}{" "}
                    <input
                      name="new"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                  <label>
                    {t("Confirm new password")}{" "}
                    <input
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    {t("Change password")}{" "}
                  </button>
                </form>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
