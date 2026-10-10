import { useState, type JSX } from "react";
import { TranslerApi } from "../../shared/api/api";
import {
  languages,
  languageSchema,
  sourceLanguageSchema,
  type Document,
  type Job,
  type Language,
  type SourceLanguage,
} from "../../shared/api/contracts";
import { localizedLanguageName, useTranslation } from "../../shared/i18n/i18n";
import { Select, SelectOption } from "../../shared/ui/Select";
import { GlossaryEditor } from "./GlossaryEditor";
export function DocumentTranslation({
  api,
  documents,
  onUpload,
  onJob,
}: {
  api: TranslerApi;
  documents: Document[];
  onUpload: (file: File) => Promise<Document>;
  onJob: (job: Job) => void;
}): JSX.Element {
  const { t, language: displayLanguage } = useTranslation();

  const [id, setId] = useState("");
  const [target, setTarget] = useState<Language>("vi");
  const [source, setSource] = useState<SourceLanguage>("auto");
  const [domain, setDomain] = useState("");
  const [glossary, setGlossary] = useState<
    { source: string; target: string }[]
  >([]);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const document = documents.find((item) => item.id === id);
  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setId((await onUpload(file)).id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function start(): Promise<void> {
    if (!document) throw new Error("Choose a document.");
    setBusy(true);
    setError(null);
    try {
      onJob(
        await api.operation(
          document.id,
          document.artifact_id,
          {
            type: "format_translation",
            source_language: source,
            target_language: target,
            domain,
            custom_instructions: instructions,
            glossary,
          },
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
    <section
      className="document-translation-form"
      data-testid="document-translation"
    >
      <div className="page-heading">
        <div>
          <h2>{t("Translate documents")} </h2>
          <p>
            {t(
              "Translate Office and text while preserving structure, formulas, code and links.",
            )}{" "}
          </p>
        </div>
      </div>
      <div className="panel settings-panel">
        {error && <p role="alert">{error}</p>}
        <label>
          {t("Document")}{" "}
          <Select
            data-testid="document-translation-select"
            value={id}
            onValueChange={(value) => setId(value)}
          >
            <SelectOption value="">{t("Choose a document")} </SelectOption>
            {documents
              .filter((item) =>
                ["docx", "pptx", "xlsx", "txt", "md", "html"].includes(
                  item.source_format,
                ),
              )
              .map((item) => (
                <SelectOption
                  key={item.id}
                  value={item.id}
                  description={`${item.page_count} ${t("pages ·")} ${(item.size / 1024 / 1024).toFixed(2)} MB · ${new Date(item.created_at).toLocaleString(displayLanguage)}`}
                >
                  {item.filename}
                </SelectOption>
              ))}
          </Select>
        </label>
        <label className="button secondary">
          {t("Upload Office or text")}{" "}
          <input
            hidden
            data-testid="document-translation-upload"
            type="file"
            accept=".docx,.pptx,.xlsx,.txt,.md,.html"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        <div className="language-fields">
          <label>
            {t("Source")}{" "}
            <Select
              value={source}
              onValueChange={(value) =>
                setSource(sourceLanguageSchema.parse(value))
              }
            >
              <SelectOption value="auto">{t("Auto detect")} </SelectOption>
              {languages.map(([code]) => (
                <SelectOption key={code} value={code}>
                  {localizedLanguageName(displayLanguage, code)}
                </SelectOption>
              ))}
            </Select>
          </label>
          <label>
            {t("Target")}{" "}
            <Select
              data-testid="document-translation-target"
              value={target}
              onValueChange={(value) => setTarget(languageSchema.parse(value))}
            >
              {languages.map(([code]) => (
                <SelectOption key={code} value={code}>
                  {localizedLanguageName(displayLanguage, code)}
                </SelectOption>
              ))}
            </Select>
          </label>
        </div>
        <label>
          {t("Domain")}{" "}
          <input
            value={domain}
            maxLength={100}
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
        <label>
          {t("Custom instructions")}{" "}
          <textarea
            value={instructions}
            maxLength={2000}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        <GlossaryEditor value={glossary} onChange={setGlossary} />
        <button
          className="button primary"
          data-testid="document-translation-start"
          disabled={
            !document ||
            busy ||
            source === target ||
            glossary.some((term) => !term.source.trim() || !term.target.trim())
          }
          onClick={() => void start()}
        >
          {busy ? t("Starting…") : t("Translate document")}
        </button>
      </div>
    </section>
  );
}
