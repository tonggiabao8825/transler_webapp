import { Select, SelectOption } from "./Select";
import { useTranslation } from "./i18n";
import { useState, type JSX } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  UploadCloud,
  ShieldCheck,
} from "lucide-react";
import {
  TranslerApi,
  type Document,
  type Job,
  type OperationOptions,
} from "./api";
type Props = {
  api: TranslerApi;
  documents: Document[];
  jobs: Job[];
  onJob: (job: Job) => void;
  onUpload: (file: File) => Promise<Document>;
};
type Target = Extract<
  OperationOptions,
  { type: "conversion" }
>["target_format"];
const formats: readonly {
  id: Target;
  name: string;
  description: string;
  color: string;
}[] = [
  { id: "pdf", name: "PDF", description: "Portable document", color: "red" },
  { id: "docx", name: "Word", description: "Editable text", color: "blue" },
  {
    id: "pptx",
    name: "PowerPoint",
    description: "Pages as slides",
    color: "orange",
  },
  { id: "xlsx", name: "Excel", description: "Extract tables", color: "green" },
  { id: "png", name: "PNG", description: "Lossless images", color: "purple" },
  { id: "jpg", name: "JPEG", description: "Compact images", color: "orange" },
  { id: "html", name: "HTML", description: "Web document", color: "blue" },
  { id: "txt", name: "Text", description: "Plain text", color: "gray" },
  {
    id: "md",
    name: "Markdown",
    description: "Structured text",
    color: "purple",
  },
];
export function ConversionScreen({
  api,
  documents,
  jobs,
  onJob,
  onUpload,
}: Props): JSX.Element {
  const { t, language } = useTranslation();

  const [id, setId] = useState(documents[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target>("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const document = documents.find((item) => item.id === id);
  const results = jobs.filter(
    (job) =>
      job.document_id === id && job.status === "COMPLETED" && job.artifact_id,
  );
  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await onUpload(file);
      setId(next.id);
      setInput("");
      setTarget(next.source_format === "pdf" ? "docx" : "pdf");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function convert(): Promise<void> {
    if (!document) throw new Error("Choose a document before converting.");
    setBusy(true);
    setError(null);
    try {
      onJob(
        await api.operation(
          document.id,
          input || document.artifact_id,
          { type: "conversion", target_format: target },
          crypto.randomUUID(),
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="conversion-screen" data-testid="conversion-screen">
      <div className="page-heading">
        <div>
          <h1>{t("Convert documents")} </h1>
          <p>{t("A new format. The same possibilities.")} </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="conversion-layout panel">
        <div className="conversion-source-panel">
          <span className="workspace-eyebrow">
            {t("01 · SOURCE DOCUMENT")}{" "}
          </span>
          <h2>{t("Start with your file")} </h2>
          <p>{t("Choose from your library or upload a new document.")} </p>
          <label>
            {t("Document")}{" "}
            <Select
              data-testid="conversion-document"
              value={id}
              onValueChange={(value) => {
                setId(value);
                setInput("");
              }}
            >
              <SelectOption value="">{t("Choose a document")} </SelectOption>
              {documents.map((item) => (
                <SelectOption
                  key={item.id}
                  value={item.id}
                  description={`${item.page_count} ${t("pages ·")} ${(item.size / 1024 / 1024).toFixed(2)} MB · ${new Date(item.created_at).toLocaleString(language)}`}
                >
                  {item.filename}
                </SelectOption>
              ))}
            </Select>
          </label>
          <label className="button secondary conversion-upload">
            <UploadCloud size={16} />
            {t("Upload document")}{" "}
            <input
              data-testid="conversion-upload"
              className="conversion-file-input"
              aria-label={t("Upload document")}
              type="file"
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.html,.txt,.md"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          {document ? (
            <div className="document-summary">
              <FileText size={36} />
              <strong>{document.filename}</strong>
              <p>
                {document.source_format.toUpperCase()} · {document.page_count}{" "}
                {t("pages / units")}{" "}
              </p>
            </div>
          ) : (
            <div className="conversion-empty">
              <FileText size={40} />
              <strong>{t("Your document goes here")} </strong>
              <p>{t("PDF, Office, images or text")} </p>
            </div>
          )}
          <label>
            {t("Input version")}{" "}
            <Select
              data-testid="conversion-input"
              value={input}
              onValueChange={(value) => setInput(value)}
            >
              <SelectOption value="">{t("Raw document")} </SelectOption>
              {results.map((job) => (
                <SelectOption key={job.id} value={job.artifact_id!}>
                  {job.kind} ·{" "}
                  {new Date(job.created_at).toLocaleString(language)}
                </SelectOption>
              ))}
            </Select>
          </label>
        </div>
        <span className="conversion-direction" aria-hidden="true">
          <ArrowRight size={22} />
        </span>
        <div className="conversion-output-panel">
          <span className="workspace-eyebrow">{t("02 · OUTPUT FORMAT")} </span>
          <h2>{t("Make it yours")} </h2>
          <p>{t("Select the format that fits your next step.")} </p>
          <div className="conversion-options">
            {formats.map((format) => (
              <button
                data-testid={`format-${format.id}`}
                key={format.id}
                aria-pressed={target === format.id}
                className={`conversion-option ${target === format.id ? "selected" : ""}`}
                onClick={() => setTarget(format.id)}
              >
                <span className={`conversion-format-icon ${format.color}`}>
                  {format.id.toUpperCase()}
                </span>
                <span>
                  <strong>{t(format.name)}</strong>
                  <small>{t(format.description)}</small>
                </span>
                {target === format.id && (
                  <Check className="conversion-selected-check" size={16} />
                )}
              </button>
            ))}
          </div>
          <p className="conversion-format-note">
            {t(
              "PowerPoint preserves page appearance as images. XLSX extracts detected tables. Image exports contain one file per page in a ZIP.",
            )}{" "}
          </p>
          <button
            className="button primary conversion-submit"
            data-testid="start-conversion"
            disabled={busy || !document}
            onClick={() => void convert()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ArrowRight size={16} />
            )}
            {busy
              ? t("Preparing conversion…")
              : `Convert to ${target.toUpperCase()}`}
          </button>
        </div>
      </div>
      <p className="conversion-privacy">
        <ShieldCheck size={16} />{" "}
        {t("Your original file stays in your private library.")}{" "}
      </p>
    </section>
  );
}
