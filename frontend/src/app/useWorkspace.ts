import { useCallback, useEffect, useRef, useState } from "react";
import { type PDFToolKind } from "../features/tools/PDFTools";
import { AccountApi } from "../shared/api/account-api";
import { AdminApi } from "../shared/api/admin-api";
import { TranslerApi } from "../shared/api/api";
import { BillingApi } from "../shared/api/billing-api";
import {
  isActive,
  type Artifact,
  type Document,
  type Job,
  type Language,
  type Session,
  type SourceLanguage,
} from "../shared/api/contracts";
import type { Screen } from "../shared/navigation";
import { useNavigation } from "./useNavigation";

export function useWorkspace() {
  const [accountApi] = useState(() => new AccountApi());
  const [billingApi] = useState(() => new BillingApi());
  const [adminApi] = useState(() => new AdminApi());
  const [api] = useState(() => new TranslerApi());
  const [session, setSession] = useState<Session | null>(null);
  const { screen, setScreen, authMode, setAuthMode, route } = useNavigation();
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
  return {
    billingApi,
    adminApi,
    accountApi,
    api,
    session,
    screen,
    authMode,
    setAuthMode,
    route,
    documents,
    artifacts,
    shareLink,
    setShareLink,
    jobs,
    document,
    job,
    setJob,
    source,
    setSource,
    target,
    setTarget,
    search,
    setSearch,
    error,
    setError,
    busy,
    initializing,
    preview,
    setPreview,
    editorArtifact,
    toolDialog,
    setToolDialog,
    pdfTool,
    setPDFTool,
    planned,
    setPlanned,
    notice,
    setNotice,
    closePreview,
    requestKey,
    refresh,
    uploadAny,
    operationJob,
    perform,
    reloadIdentity,
    authenticated,
    loggedOut,
    accountNavigation,
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
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
