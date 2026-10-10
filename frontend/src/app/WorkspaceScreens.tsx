import { LoaderCircle, LockKeyhole, Trash2, UploadCloud } from "lucide-react";
import type { JSX } from "react";
import { Suspense, lazy } from "react";
import { ProfileScreen } from "../features/account/ProfileScreen";
import { AdminScreen } from "../features/admin/AdminScreen";
import { DocumentList } from "../features/documents/DocumentList";
import { SharedFiles, createShare } from "../features/documents/SharedFiles";
import { HomeOverview } from "../features/home/HomeOverview";
import { RecentDocuments } from "../features/home/RecentDocuments";
import { JobPanel } from "../features/jobs/JobPanel";
import { OperationPanel } from "../features/jobs/OperationPanel";
import { ConversionScreen } from "../features/tools/ConversionScreen";
import { PDFTools } from "../features/tools/PDFTools";
import { ToolDialog } from "../features/tools/ToolDialog";
import { AllTools } from "../features/tools/Tools";
import { DocumentTranslation } from "../features/translation/DocumentTranslation";
import { TranslationSettings } from "../features/translation/TranslationSettings";
import { UploadPanel } from "../features/translation/UploadPanel";
import { type Session } from "../shared/api/contracts";
import { useTranslation } from "../shared/i18n/i18n";

const EditorScreen = lazy(async () => ({
  default: (await import("../features/editor/EditorScreen")).EditorScreen,
}));

import type { WorkspaceState } from "./useWorkspace";

export function WorkspaceScreens({
  workspace,
}: {
  workspace: WorkspaceState & { session: Session };
}): JSX.Element {
  const { t } = useTranslation();
  const {
    billingApi,
    adminApi,
    accountApi,
    api,
    session,
    screen,
    documents,
    artifacts,
    setShareLink,
    jobs,
    document,
    job,
    setJob,
    source,
    setSource,
    target,
    setTarget,
    busy,
    setPreview,
    editorArtifact,
    toolDialog,
    setToolDialog,
    pdfTool,
    setPDFTool,
    setNotice,
    requestKey,
    refresh,
    uploadAny,
    operationJob,
    perform,
    reloadIdentity,
    loggedOut,
    showFeature,
    navigate,
    chooseDocument,
    upload,
    viewJob,
    editDocument,
    cropDocument,
    deleteDocument,
    listProps,
    filtered,
  } = workspace;
  return (
    <>
      {screen === "notfound" && (
        <section className="empty-state">
          <h1>{t("Page not found")} </h1>
          <a className="button primary" href="/">
            {t("Return to Transler")}{" "}
          </a>
        </section>
      )}
      {screen === "account" && session.account && (
        <ProfileScreen
          billingApi={billingApi}
          api={accountApi}
          onChanged={reloadIdentity}
          onLoggedOut={loggedOut}
        />
      )}
      {screen === "admin" && session.account?.role !== "admin" && (
        <section className="empty-state">
          <h1>{t("Administrator access required")} </h1>
          <p>{t("This account cannot open administration.")} </p>
          <button className="button primary" onClick={() => navigate("home")}>
            {t("Return to dashboard")}{" "}
          </button>
        </section>
      )}
      {screen === "admin" && session.account?.role === "admin" && (
        <AdminScreen api={adminApi} onChanged={reloadIdentity} />
      )}
      {screen === "home" && (
        <HomeOverview
          api={accountApi}
          pageLimit={session.page_limit}
          maxActiveJobs={session.max_active_jobs}
          account={session.account}
          documents={documents}
          jobs={jobs}
          onNavigate={navigate}
          onPlanned={showFeature}
        >
          <RecentDocuments
            documents={documents}
            jobs={jobs}
            onDocument={chooseDocument}
            onJob={viewJob}
          />
        </HomeOverview>
      )}
      {screen === "tools" && (
        <div className="tools-workspace">
          <AllTools
            onNavigate={(next) => {
              if (next === "tools") setToolDialog("documents");
              else navigate(next);
            }}
            onPlanned={showFeature}
            onPDFTool={(tool) => {
              setPDFTool(tool);
              setToolDialog("pdf");
            }}
          />
          {toolDialog && (
            <ToolDialog
              title={
                toolDialog === "documents"
                  ? t("Translate documents")
                  : t("PDF tools")
              }
              onClose={() => setToolDialog(null)}
            >
              <div className="tools-forms">
                {toolDialog === "documents" ? (
                  <DocumentTranslation
                    api={api}
                    documents={documents}
                    onUpload={uploadAny}
                    onJob={operationJob}
                  />
                ) : (
                  <PDFTools
                    tool={pdfTool}
                    onTool={setPDFTool}
                    artifacts={artifacts}
                    api={api}
                    documents={documents}
                    onJob={operationJob}
                  />
                )}
              </div>
            </ToolDialog>
          )}
        </div>
      )}
      {screen === "translate" && (
        <UploadPanel
          maxBytes={session.upload_limit_bytes}
          busy={busy}
          onUpload={(file) => void perform(() => upload(file))}
          onImport={(url) =>
            void perform(async () => {
              chooseDocument(await api.importUrl(url));
              await refresh(new AbortController().signal);
            })
          }
        />
      )}
      {screen === "settings" && document && (
        <TranslationSettings
          document={document}
          source={source}
          target={target}
          busy={busy}
          onBack={() => navigate("translate")}
          onSource={(next) => {
            setSource(next);
            requestKey.current = crypto.randomUUID();
          }}
          onTarget={(next) => {
            setTarget(next);
            requestKey.current = crypto.randomUUID();
          }}
          onPreview={setPreview}
          onStart={(options) =>
            void perform(async () => {
              const next = options
                ? await api.operation(
                    document.id,
                    document.artifact_id,
                    { type: "advanced", ...options },
                    requestKey.current,
                  )
                : await api.translate(
                    document.id,
                    source,
                    target,
                    requestKey.current,
                  );
              operationJob(next);
            })
          }
        />
      )}
      {screen === "job" &&
        document &&
        job &&
        (["pdf_basic", "advanced"].includes(job.kind) ? (
          <JobPanel
            job={job}
            document={document}
            busy={busy}
            onCancel={() =>
              void perform(async () => setJob(await api.cancel(job.id)))
            }
            onRetry={() =>
              void perform(async () => setJob(await api.retry(job.id)))
            }
            onPreview={setPreview}
            onNew={() => navigate("translate")}
            onRefresh={() =>
              void perform(async () =>
                setJob(await api.job(job.id, new AbortController().signal)),
              )
            }
            onEdit={() => editDocument(document, job.artifact_id!)}
            onCrop={() => cropDocument(document, job.artifact_id!)}
            onDelete={() => void perform(() => deleteDocument(document.id))}
            onSave={() => {
              navigate("library");
              setNotice(
                session.account
                  ? "Saved: your raw PDF and processed versions are stored in your private account library."
                  : "Saved: your raw PDF and processed versions are stored together in My Documents for 7 days.",
              );
            }}
            onTranslate={() => {
              requestKey.current = crypto.randomUUID();
              setSource(job.source_language);
              setTarget(job.target_language);
              chooseDocument(document);
            }}
            onShare={() =>
              void perform(async () =>
                setShareLink(await createShare(job.artifact_id!)),
              )
            }
          />
        ) : (
          <OperationPanel
            outputIsPDF={
              artifacts.find((file) => file.id === job.artifact_id)
                ?.mime_type === "application/pdf"
            }
            onPreview={() => setPreview(job.artifact_id!)}
            onEdit={() => editDocument(document, job.artifact_id!)}
            onCrop={() => cropDocument(document, job.artifact_id!)}
            onShare={() =>
              void perform(async () =>
                setShareLink(await createShare(job.artifact_id!)),
              )
            }
            onDelete={() => void perform(() => deleteDocument(document.id))}
            job={job}
            document={document}
            onCancel={() =>
              void perform(async () => setJob(await api.cancel(job.id)))
            }
            onRetry={() =>
              void perform(async () => setJob(await api.retry(job.id)))
            }
            onLibrary={() => navigate("library")}
          />
        ))}
      {screen === "editor" && (
        <Suspense
          fallback={
            <div className="initializing">
              <LoaderCircle className="spin" />
              {"Opening PDF workspace…"}{" "}
            </div>
          }
        >
          <EditorScreen
            key={editorArtifact}
            api={api}
            onJob={operationJob}
            document={document}
            artifactId={editorArtifact}
            onChoose={() => navigate("library")}
            onTools={() => navigate("tools")}
            onUpload={async (file) => {
              if (!file.name.toLowerCase().endsWith(".pdf"))
                throw new Error("Choose a PDF document for the editor.");
              const next = await uploadAny(file);
              editDocument(next, next.artifact_id);
            }}
          />
        </Suspense>
      )}
      {screen === "convert" && (
        <ConversionScreen
          api={api}
          documents={documents}
          jobs={jobs}
          onJob={operationJob}
          onUpload={uploadAny}
        />
      )}
      {screen === "favorites" && (
        <>
          <h1>{t("Favorites")} </h1>
          <DocumentList
            documents={filtered.filter((item) => item.favorite)}
            {...listProps}
          />
        </>
      )}
      {screen === "shared" && <SharedFiles />}
      {screen === "trash" && (
        <section className="trash-screen" data-testid="trash-screen">
          <div className="page-heading">
            <div>
              <h1>{t("Trash")} </h1>
              <p>
                {t(
                  "Restore a document or permanently delete it and all versions.",
                )}{" "}
              </p>
            </div>
          </div>
          <div className="collection-notice">
            <Trash2 size={18} />
            <p>
              {t(
                "Deleted documents stay here until you restore or permanently delete them.",
              )}{" "}
            </p>
          </div>
          {documents.some((item) => item.deleted_at !== null) ? (
            <DocumentList
              documents={documents.filter((item) => item.deleted_at !== null)}
              {...listProps}
            />
          ) : (
            <div className="collection-empty">
              <span>
                <Trash2 size={30} />
              </span>
              <h2>{t("Your trash is empty")} </h2>
              <p>{t("Documents you move to Trash will appear here.")} </p>
            </div>
          )}
        </section>
      )}
      {screen === "library" && (
        <>
          <div className="page-heading">
            <div>
              <h1>{t("My Documents")} </h1>
              <p>{t("Your raw files and processed versions, together.")} </p>
            </div>
            <button
              data-testid="library-upload"
              className="button primary"
              onClick={() => navigate("translate")}
            >
              <UploadCloud size={16} />
              {t("Upload PDF")}{" "}
            </button>
          </div>
          <div className="library-info">
            <LockKeyhole size={16} />
            <span>
              {session.account
                ? t(
                    "Private account library · Raw & processed files saved automatically",
                  )
                : t(
                    "Private guest workspace · Saved automatically · Available for 7 days",
                  )}
            </span>
          </div>
          <DocumentList documents={filtered} {...listProps} />
        </>
      )}
    </>
  );
}
