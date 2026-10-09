import { useTranslation } from "./i18n";
import type { JSX } from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UploadCloud,
  X,
  Trash2,
} from "lucide-react";
import {
  TranslerApi,
  isActive,
  type Document,
  type Job,
  type Language,
  type Session,
  type SourceLanguage,
} from "./api";
import { readRoute, routes } from "./routes";
import { AccountApi } from "./account-api";
import { AuthScreen } from "./AuthScreen";
import { ProfileScreen } from "./ProfileScreen";
import { AdminScreen } from "./AdminScreen";
import { UploadPanel } from "./UploadPanel";
import { JobPanel } from "./JobPanel";
import { Sidebar, type Screen } from "./Sidebar";
import { HomeOverview } from "./HomeOverview";
import { TranslationSettings } from "./TranslationSettings";
import { DocumentList } from "./DocumentList";
import { RecentDocuments } from "./RecentDocuments";
import { AllTools } from "./Tools";
import { ToolDialog } from "./ToolDialog";
import { activePlanCode } from "./plan-state";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { Landing } from "./Landing";
import { PlannedFeature } from "./PlannedFeature";
import { SharedFiles, createShare } from "./SharedFiles";
import type { Artifact } from "./api";
import { DocumentTranslation } from "./DocumentTranslation";
import { PDFTools, type PDFToolKind } from "./PDFTools";
import { OperationPanel } from "./OperationPanel";
import { ConversionScreen } from "./ConversionScreen";
const PDFPreview = lazy(async () => ({
  default: (await import("./PDFPreview")).PDFPreview,
}));
const EditorScreen = lazy(async () => ({
  default: (await import("./EditorScreen")).EditorScreen,
}));

export function App(): JSX.Element {
  const { t } = useTranslation();

  const [accountApi] = useState(() => new AccountApi());
  const [api] = useState(() => new TranslerApi());
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>(() =>
    readRoute(window.location.pathname),
  );
  const [authMode, setAuthMode] = useState<"login" | "register">(
    window.location.pathname === "/register" ? "register" : "login",
  );
  const route = useCallback((next: Screen): void => {
    if (next === "auth") setAuthMode("login");
    window.history.pushState(null, "", routes[next]);
    setScreen(next);
  }, []);
  useEffect(() => {
    if (window.location.pathname === "/welcome")
      window.history.replaceState(null, "", "/");
    const pop = (): void => {
      setScreen(readRoute(window.location.pathname));
      setAuthMode(
        window.location.pathname === "/register" ? "register" : "login",
      );
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [document, setDocument] = useState<Document | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [source, setSource] = useState<SourceLanguage>("auto");
  const [target, setTarget] = useState<Language>("vi");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [editorArtifact, setEditorArtifact] = useState<string | null>(null);
  const [toolDialog, setToolDialog] = useState<"documents" | "pdf" | null>(
    null,
  );
  const [pdfTool, setPDFTool] = useState<PDFToolKind>("ocr");
  useEffect(() => {
    if (screen !== "tools") setToolDialog(null);
  }, [screen]);
  const [planned, setPlanned] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const requestKey = useRef<string>(crypto.randomUUID());
  const refresh = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const [loadedDocuments, loadedJobs, loadedArtifacts] = await Promise.all([
        api.documents(signal),
        api.jobs(signal),
        api.artifacts(signal),
      ]);
      setDocuments(loadedDocuments);
      setJobs(loadedJobs);
      setArtifacts(loadedArtifacts);
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    async function initialize(): Promise<void> {
      try {
        const nextSession = await api.session();
        if (controller.signal.aborted) return;
        setSession(nextSession);
        await refresh(controller.signal);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (!controller.signal.aborted) setInitializing(false);
      }
    }
    void initialize();
    return () => controller.abort();
  }, [api, refresh]);
  useEffect(() => {
    if (initializing) return;
    const params = new URLSearchParams(window.location.search);
    const docId = params.get("document");
    const jobId = params.get("job");
    const artifact = params.get("artifact");
    if (screen === "settings" && document === null) {
      const selected = documents.find((item) => item.id === docId);
      if (selected) setDocument(selected);
      else route("translate");
    }
    if (screen === "job" && job === null) {
      const selected = jobs.find((item) => item.id === jobId);
      const associated = documents.find(
        (item) => item.id === selected?.document_id,
      );
      if (selected && associated) {
        setJob(selected);
        setDocument(associated);
      } else route("library");
    }
    if (screen === "editor" && document === null) {
      const selected = documents.find((item) => item.id === docId);
      if (selected) {
        setDocument(selected);
        setEditorArtifact(artifact || selected.artifact_id);
      }
    }
    if ((screen === "admin" || screen === "account") && !session?.account)
      route("auth");
  }, [initializing, screen, documents, jobs, document, job, session, route]);
  async function uploadAny(file: File): Promise<Document> {
    const next = await api.upload(file);
    await refresh(new AbortController().signal);
    return next;
  }
  function operationJob(next: Job): void {
    setJob(next);
    const associated = documents.find((item) => item.id === next.document_id);
    if (associated) setDocument(associated);
    window.history.pushState(null, "", `/translations?job=${next.id}`);
    setScreen("job");
  }
  const activeId = job && isActive(job) ? job.id : null;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const next = await api.job(activeId!, controller.signal);
        setJob(next);
        if (isActive(next)) timer = setTimeout(() => void poll(), 2000);
        else await refresh(controller.signal);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeId, api, refresh]);
  async function perform(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  const reloadIdentity = useCallback(async (): Promise<void> => {
    setError(null);
    api.resetSession();
    const next = await api.session();
    setSession(next);
    await refresh(new AbortController().signal);
  }, [api, refresh]);
  useEffect(() => {
    function syncWorkspace(): void {
      if (window.document.visibilityState !== "visible") return;
      void reloadIdentity().catch((failure: Error) =>
        setError(failure.message),
      );
    }
    window.addEventListener("focus", syncWorkspace);
    return () => window.removeEventListener("focus", syncWorkspace);
  }, [reloadIdentity]);
  const authenticated = useCallback(async (): Promise<void> => {
    setDocument(null);
    setJob(null);
    setPreview(null);
    setEditorArtifact(null);
    setDocuments([]);
    setJobs([]);
    await reloadIdentity();
    route("home");
  }, [reloadIdentity, route]);
  const loggedOut = useCallback(async (): Promise<void> => {
    setDocument(null);
    setJob(null);
    setPreview(null);
    setEditorArtifact(null);
    setDocuments([]);
    setJobs([]);
    await reloadIdentity();
    route("auth");
  }, [reloadIdentity, route]);
  function accountNavigation(): void {
    route(session?.account ? "account" : "auth");
  }
  function showFeature(feature: string): void {
    if (
      feature === "Pro plans" ||
      feature.includes("sign in") ||
      feature.includes("Sign in")
    )
      accountNavigation();
    else setPlanned(feature);
  }
  function navigate(next: Screen): void {
    route(next === "account" && !session?.account ? "auth" : next);
    if (next === "editor" && editorArtifact === null) {
      const selected =
        document?.source_format === "pdf"
          ? document
          : documents.find(
              (item) =>
                item.source_format === "pdf" && item.deleted_at === null,
            );
      if (selected) {
        setDocument(selected);
        setEditorArtifact(selected.artifact_id);
      }
    }
    setError(null);
    setNotice(null);
    void perform(() => refresh(new AbortController().signal));
  }
  function chooseDocument(next: Document): void {
    if (next.source_format !== "pdf") {
      route("tools");
      return;
    }
    setDocument(next);
    requestKey.current = crypto.randomUUID();
    window.history.pushState(
      null,
      "",
      `/translate/settings?document=${next.id}`,
    );
    setScreen("settings");
  }
  async function upload(file: File): Promise<void> {
    if (!session)
      throw new Error("Guest session is not ready. Reload the page.");
    if (!file.name.toLowerCase().endsWith(".pdf"))
      throw new Error("Choose a PDF document.");
    if (file.size > session.upload_limit_bytes)
      throw new Error(
        `PDF exceeds the ${session.upload_limit_bytes / 1024 / 1024} MB upload limit.`,
      );
    chooseDocument(await api.upload(file));
    await refresh(new AbortController().signal);
  }
  function viewJob(next: Job): void {
    const associated = documents.find((item) => item.id === next.document_id);
    if (!associated)
      throw new Error(
        "The document for this job is missing. Reload the library.",
      );
    setDocument(associated);
    setJob(next);
    window.history.pushState(null, "", `/translations?job=${next.id}`);
    setScreen("job");
  }
  function editDocument(next: Document, artifactId: string): void {
    setDocument(next);
    setEditorArtifact(artifactId);
    window.history.pushState(
      null,
      "",
      `/editor?document=${next.id}&artifact=${artifactId}`,
    );
    setScreen("editor");
  }
  function cropDocument(next: Document, artifactId: string): void {
    editDocument(next, artifactId);
    window.history.replaceState(
      null,
      "",
      window.location.href + "&action=retranslate_region",
    );
  }
  async function deleteDocument(id: string): Promise<void> {
    await api.deleteDocument(id);
    await refresh(new AbortController().signal);
    setJob(null);
    setDocument(null);
    route("library");
  }
  const listProps = {
    jobs,
    artifacts,
    onFavorite: (next: Document): void => {
      void perform(async () => {
        await api.updateDocument(next.id, {
          favorite: !next.favorite,
          trashed: false,
        });
        await refresh(new AbortController().signal);
      });
    },
    onTrash: (next: Document): void => {
      void perform(async () => {
        await api.updateDocument(next.id, {
          favorite: next.favorite,
          trashed: next.deleted_at === null,
        });
        await refresh(new AbortController().signal);
      });
    },
    onTranslate: chooseDocument,
    onJob: viewJob,
    onPreview: setPreview,
    onEdit: editDocument,
    onCrop: cropDocument,
    onDelete: (id: string): void => {
      void perform(() => deleteDocument(id));
    },
  };
  const filtered = documents.filter(
    (item) =>
      item.deleted_at === null &&
      item.filename.toLowerCase().includes(search.toLowerCase()),
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
                      api={accountApi}
                      onChanged={reloadIdentity}
                      onLoggedOut={loggedOut}
                    />
                  )}
                  {screen === "admin" && session.account?.role !== "admin" && (
                    <section className="empty-state">
                      <h1>{t("Administrator access required")} </h1>
                      <p>{t("This account cannot open administration.")} </p>
                      <button
                        className="button primary"
                        onClick={() => navigate("home")}
                      >
                        {t("Return to dashboard")}{" "}
                      </button>
                    </section>
                  )}
                  {screen === "admin" && session.account?.role === "admin" && (
                    <AdminScreen api={accountApi} onChanged={reloadIdentity} />
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
                          void perform(async () =>
                            setJob(await api.cancel(job.id)),
                          )
                        }
                        onRetry={() =>
                          void perform(async () =>
                            setJob(await api.retry(job.id)),
                          )
                        }
                        onPreview={setPreview}
                        onNew={() => navigate("translate")}
                        onRefresh={() =>
                          void perform(async () =>
                            setJob(
                              await api.job(
                                job.id,
                                new AbortController().signal,
                              ),
                            ),
                          )
                        }
                        onEdit={() => editDocument(document, job.artifact_id!)}
                        onCrop={() => cropDocument(document, job.artifact_id!)}
                        onDelete={() =>
                          void perform(() => deleteDocument(document.id))
                        }
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
                        onDelete={() =>
                          void perform(() => deleteDocument(document.id))
                        }
                        job={job}
                        document={document}
                        onCancel={() =>
                          void perform(async () =>
                            setJob(await api.cancel(job.id)),
                          )
                        }
                        onRetry={() =>
                          void perform(async () =>
                            setJob(await api.retry(job.id)),
                          )
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
                            throw new Error(
                              "Choose a PDF document for the editor.",
                            );
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
                    <section
                      className="trash-screen"
                      data-testid="trash-screen"
                    >
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
                          documents={documents.filter(
                            (item) => item.deleted_at !== null,
                          )}
                          {...listProps}
                        />
                      ) : (
                        <div className="collection-empty">
                          <span>
                            <Trash2 size={30} />
                          </span>
                          <h2>{t("Your trash is empty")} </h2>
                          <p>
                            {t(
                              "Documents you move to Trash will appear here.",
                            )}{" "}
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                  {screen === "library" && (
                    <>
                      <div className="page-heading">
                        <div>
                          <h1>{t("My Documents")} </h1>
                          <p>
                            {t(
                              "Your raw files and processed versions, together.",
                            )}{" "}
                          </p>
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
          <PDFPreview artifactId={preview} onClose={closePreview} />
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
