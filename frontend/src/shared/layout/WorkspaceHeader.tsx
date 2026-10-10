import { Bell, ChevronDown, Search } from "lucide-react";
import type { JSX } from "react";
import type { Account } from "../api/account-contracts";
import { isActive, type Document, type Job } from "../api/contracts";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { useTranslation } from "../i18n/i18n";
import { activePlanCode } from "../plan-state";
type WorkspaceHeaderProps = {
  account: Account | null;
  documents: Document[];
  jobs: Job[];
  search: string;
  onSearch: (search: string) => void;
  onJob: (job: Job) => void;
  onAccount: () => void;
};
export function WorkspaceHeader({
  account,
  documents,
  jobs,
  search,
  onSearch,
  onJob,
  onAccount,
}: WorkspaceHeaderProps): JSX.Element {
  const { t } = useTranslation();

  const planCode = activePlanCode(account, new Date());
  return (
    <header className="topbar">
      <label className="search-box">
        <Search size={15} />
        <input
          data-testid="document-search"
          aria-label={t("Search your documents")}
          placeholder={t("Search your documents...")}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <LanguagePicker />
      <details className="notification-menu">
        <summary aria-label={t("Notifications")} data-testid="notifications">
          <Bell size={19} />
          {jobs.some(isActive) && <span className="notification-dot" />}
        </summary>
        <div className="notification-dropdown">
          <strong>{t("Recent activity")} </strong>
          {jobs.length ? (
            jobs.slice(0, 5).map((item) => (
              <button key={item.id} onClick={() => onJob(item)}>
                {documents.find((doc) => doc.id === item.document_id)?.filename}
                <small>
                  {t(item.status.toLowerCase())} · {item.completed_pages}{" "}
                  {t("pages")}{" "}
                </small>
              </button>
            ))
          ) : (
            <p>{t("No translation activity yet.")} </p>
          )}
        </div>
      </details>
      <button
        className="top-profile"
        data-testid="profile-menu"
        onClick={onAccount}
      >
        <img src="/assets/icons/user.svg" alt="" />
        <span>
          <strong>{account?.name ?? t("Guest workspace")}</strong>
          <small className="plan-code">
            {planCode === "free" ? t("Free") : planCode}
          </small>
        </span>
        <ChevronDown size={13} />
      </button>
    </header>
  );
}
