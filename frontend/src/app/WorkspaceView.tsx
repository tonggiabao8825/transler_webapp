import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { JSX } from "react";
import { Suspense, lazy } from "react";
import { AuthScreen } from "../features/auth/AuthScreen";
import { Landing } from "../features/landing/Landing";
import { useTranslation } from "../shared/i18n/i18n";
import { Sidebar } from "../shared/layout/Sidebar";
import { WorkspaceHeader } from "../shared/layout/WorkspaceHeader";
import { activePlanCode } from "../shared/plan-state";
import { PlannedFeature } from "../shared/ui/PlannedFeature";
import { WorkspaceScreens } from "./WorkspaceScreens";
const PDFPreview = lazy(async () => ({
  default: (await import("../shared/pdf/PDFPreview")).PDFPreview,
}));

import type { WorkspaceState } from "./useWorkspace";

export function WorkspaceView({
  workspace,
}: {
  workspace: WorkspaceState;
}): JSX.Element {
  const { t } = useTranslation();
  const {
    accountApi,
    session,
    screen,
    authMode,
    setAuthMode,
    route,
    documents,
    shareLink,
    setShareLink,
    jobs,
    search,
    setSearch,
    error,
    setError,
    initializing,
    preview,
    planned,
    setPlanned,
    notice,
    setNotice,
    closePreview,
    authenticated,
    accountNavigation,
    showFeature,
    navigate,
    viewJob,
  } = workspace;
  const previewJob = [workspace.job, ...jobs].find(
    (item) =>
      item?.artifact_id === preview &&
      (item.kind === "pdf_basic" || item.kind === "advanced"),
  );
  const previewDocument = documents.find(
    (item) =>
      item.id === previewJob?.document_id || item.artifact_id === preview,
  );
  const previewArtifact = workspace.artifacts.find(
    (item) => item.id === preview,
  );
  return (
    <>
      {screen === "landing" ? (
        <Landing
          authenticated={
            session?.account !== null && session?.account !== undefined
          }
          ready={!initializing}
          onStart={() => navigate("home")}
          onPlanned={showFeature}
        />
      ) : screen === "auth" ? (
        <div className="auth-page">
          <a className="brand auth-brand" href="/">
            <img src="/assets/brand/logo-symbol.svg" alt="" />
            Transler.
          </a>
          <AuthScreen
            api={accountApi}
            mode={authMode}
            onMode={(mode) => {
              setAuthMode(mode);
              window.history.pushState(
                null,
                "",
                mode === "login" ? "/login" : "/register",
              );
            }}
            onAuthenticated={authenticated}
          />
          <a className="auth-back" href="/">
            {t("← Back to Transler")}{" "}
          </a>
        </div>
      ) : (
        <div className="app-shell">
          <Sidebar
            isAdmin={session?.account?.role === "admin"}
            planCode={activePlanCode(session?.account ?? null, new Date())}
            screen={screen}
            documentCount={documents.length}
            onNavigate={navigate}
            onUpgrade={accountNavigation}
          />
          <div className="main-shell">
            <WorkspaceHeader
              account={session?.account ?? null}
              documents={documents}
              jobs={jobs}
              search={search}
              onSearch={(next) => {
                setSearch(next);
                route("library");
              }}
              onJob={viewJob}
              onAccount={accountNavigation}
            />
            <main className={screen === "editor" ? "editor-main" : ""}>
              {error && (
                <div
                  className="error-banner"
                  role="alert"
                  data-testid="error-banner"
                >
                  <div>
                    <strong>{t("We couldn't finish that request")} </strong>
                    <p>{error}</p>
                  </div>
                  <button
                    aria-label={t("Dismiss error")}
                    onClick={() => setError(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {notice && (
                <div
                  className="notice-banner"
                  role="status"
                  data-testid="notice-banner"
                >
                  <ShieldCheck size={17} />
                  <span>{notice}</span>
                  <button
                    aria-label={t("Dismiss notice")}
                    onClick={() => setNotice(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {initializing ? (
                <div className="initializing">
                  <LoaderCircle className="spin" />
                  {t("Opening your private workspace…")}{" "}
                </div>
              ) : !session ? (
                <div className="empty-state">
                  <ShieldCheck size={32} />
                  <h2>{t("Workspace unavailable")} </h2>
                  <p>
                    {t(
                      "Check that the Transler API and its services are running, then reload.",
                    )}{" "}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => window.location.reload()}
                  >
                    {t("Reload workspace")}{" "}
                  </button>
                </div>
              ) : (
                <>
                  <WorkspaceScreens workspace={{ ...workspace, session }} />
                </>
              )}
              {screen !== "editor" && (
                <footer>
                  {t("Made for understanding.")}{" "}
                  <span>{t("Transler · Private document workspace")} </span>
                </footer>
              )}
            </main>
          </div>
        </div>
      )}
      {preview && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <LoaderCircle className="spin" />
            </div>
          }
        >
          <PDFPreview
            key={preview}
            artifactId={preview}
            originalArtifactId={
              previewJob && previewDocument?.source_format === "pdf"
                ? previewDocument.artifact_id
                : null
            }
            filename={
              previewArtifact?.filename ??
              previewDocument?.filename ??
              t("PDF preview")
            }
            onClose={closePreview}
          />
        </Suspense>
      )}
      {shareLink && (
        <div className="modal-backdrop">
          <section
            className="panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("Share document")}
          >
            <h2>{t("Share link")} </h2>
            <p>
              {t(
                "Anyone with this link can download this version for 24 hours. Revoke it from Shared.",
              )}{" "}
            </p>
            <input data-testid="share-link" value={shareLink} readOnly />
            <button
              className="button primary"
              data-testid="close-share-link"
              onClick={() => setShareLink(null)}
            >
              {t("Done")}{" "}
            </button>
          </section>
        </div>
      )}
      {planned && (
        <PlannedFeature feature={planned} onClose={() => setPlanned(null)} />
      )}
    </>
  );
}
