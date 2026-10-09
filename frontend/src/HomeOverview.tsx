import { useTranslation } from "./i18n";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { CheckCircle2, ArrowRight } from "lucide-react";
import type { Document, Job } from "./api";
import type { Screen } from "./Sidebar";
import { ToolCards } from "./Tools";
import { activePlanCode } from "./plan-state";
import type { Account, Profile } from "./account-contracts";
import type { AccountApi } from "./account-api";
type HomeOverviewProps = {
  account: Account | null;
  api: AccountApi;
  pageLimit: number;
  maxActiveJobs: number;
  documents: Document[];
  jobs: Job[];
  children: ReactNode;
  onNavigate: (screen: Screen) => void;
  onPlanned: (feature: string) => void;
};
export function HomeOverview({
  account,
  api,
  pageLimit,
  maxActiveJobs,
  documents,
  jobs,
  children,
  onNavigate,
  onPlanned,
}: HomeOverviewProps): JSX.Element {
  const { t } = useTranslation();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    function load(): void {
      void api
        .profile()
        .then((next) => {
          if (!cancelled) {
            setProfile(next);
            setError(null);
          }
        })
        .catch((failure: Error) => {
          if (!cancelled) setError(failure.message);
        });
    }
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [api, account, jobs]);
  const translated = jobs.filter((job) => job.status === "COMPLETED").length;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {t("Hello,")} {account?.name ?? t("Guest")}!{" "}
            <span className="greeting-wave"></span>
          </h1>
          <p>{t("What would you like to do today?")} </p>
        </div>
        <button
          className="text-button"
          data-testid="hero-translate"
          onClick={() => onNavigate("translate")}
        >
          {t("New translation")} <ArrowRight size={15} />
        </button>
      </div>
      <ToolCards onNavigate={onNavigate} onPlanned={onPlanned} />
      <div className="home-grid">
        <section>
          <div className="section-heading">
            <h2>{t("Recent documents")} </h2>
            <button
              data-testid="view-library"
              className="text-button"
              onClick={() => onNavigate("library")}
            >
              {t("View all")}{" "}
            </button>
          </div>
          {children}
          <div className="library-stat">
            {documents.length} {t("documents ·")} {translated}{" "}
            {t("translations completed")}{" "}
          </div>
        </section>
        <aside className="panel home-plan">
          <h3>{t("Your plan")} </h3>
          {error ? (
            <p role="alert" className="account-error">
              {error}
            </p>
          ) : account && !profile ? (
            <p role="status">{t("Loading plan…")} </p>
          ) : (
            <>
              <strong data-testid="home-plan-name">
                {profile?.plan.name ?? t("Free")}
              </strong>
              <p>
                {t("Up to")} {pageLimit} {t("pages per file")}{" "}
              </p>
              {profile && (
                <>
                  <div className="plan-meter">
                    <span
                      style={{
                        width: `${Math.min(((profile.usage.pages_used + profile.usage.pages_reserved) / profile.plan.monthly_pages) * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <small data-testid="home-plan-usage">
                    {profile.usage.pages_used + profile.usage.pages_reserved}/
                    {profile.plan.monthly_pages} {t("pages this month")}{" "}
                  </small>
                </>
              )}
              <button
                className="button secondary"
                data-testid="home-manage-plan"
                onClick={() => onPlanned("Pro plans")}
              >
                {activePlanCode(account, new Date()) === "free"
                  ? t("Upgrade Plan")
                  : t("Manage Plan")}
              </button>
              {[
                `${profile?.plan.max_active_jobs ?? maxActiveJobs} ${t("concurrent processing jobs")}`,
                t("Raw & processed files"),
                profile
                  ? `${profile.usage.documents}/${profile.plan.document_limit} ${t("saved documents")}`
                  : t("File history (7 days)"),
              ].map((text) => (
                <p className="plan-feature" key={text}>
                  <CheckCircle2 size={15} />
                  {text}
                </p>
              ))}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
