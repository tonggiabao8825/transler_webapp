import { Select, SelectOption } from "./Select";
import { localizedLanguageName, useTranslation } from "./i18n";
import { useState, type JSX } from "react";
import {
  TranslerApi,
  type Document,
  type Artifact,
  type Job,
  type OperationOptions,
  type SourceLanguage,
  sourceLanguageSchema,
  languages,
} from "./api";
export type PDFToolKind =
  "ocr" | Extract<OperationOptions, { type: "pdf_tool" }>["tool"];
const toolNames: Readonly<Record<PDFToolKind, string>> = {
  ocr: "OCR",
  merge: "Merge PDF",
  split: "Split PDF",
  compress: "Compress PDF",
  protect: "Protect PDF",
  unlock: "Unlock PDF",
};
export function PDFTools({
  api,
  documents,
  artifacts,
  onJob,
  tool,
  onTool,
}: {
  api: TranslerApi;
  documents: Document[];
  artifacts: Artifact[];
  onJob: (job: Job) => void;
  tool: PDFToolKind;
  onTool: (tool: PDFToolKind) => void;
}): JSX.Element {
  const { t, language: displayLanguage } = useTranslation();

  const [id, setId] = useState("");
  const [input, setInput] = useState("");
  const [merge, setMerge] = useState<string[]>([]);
  const [pages, setPages] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<SourceLanguage>("auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pdfs = documents.filter((item) => item.source_format === "pdf");
  const document = pdfs.find((item) => item.id === id);
  async function run(): Promise<void> {
    if (!document) throw new Error("Choose a PDF.");
    setBusy(true);
    setError(null);
    try {
      const indices =
        tool === "split"
          ? pages.split(",").map((value) => {
              const page = Number(value.trim());
              if (!Number.isInteger(page) || page < 1)
                throw new Error(
                  "Enter page numbers separated by commas, starting at 1.",
                );
              return page - 1;
            })
          : [];
      onJob(
        await api.operation(
          document.id,
          input || document.artifact_id,
          tool === "ocr"
            ? { type: "ocr", language }
            : {
                type: "pdf_tool",
                tool,
                artifact_ids: merge,
                pages: indices,
                password: password || null,
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
      className="panel settings-panel pdf-tools-form"
      id="pdf-tools"
      data-testid="pdf-tools"
    >
      <h2>{t("PDF tools")} </h2>
      <p className="tools-form-intro">
        {t(
          "For scanned PDFs, run OCR to add a searchable text layer before translation. The original images are preserved.",
        )}{" "}
      </p>
      {error && <p role="alert">{error}</p>}
      <label>
        {t("Tool")}{" "}
        <Select
          data-testid="pdf-tool-kind"
          value={tool}
          onValueChange={(value) => {
            const next = value;
            if (
              ![
                "ocr",
                "merge",
                "split",
                "compress",
                "protect",
                "unlock",
              ].includes(next)
            )
              throw new Error("Invalid PDF tool.");
            onTool(next as PDFToolKind);
          }}
        >
          {(
            ["ocr", "merge", "split", "compress", "protect", "unlock"] as const
          ).map((value) => (
            <SelectOption key={value} value={value}>
              {t(toolNames[value])}
            </SelectOption>
          ))}
        </Select>
      </label>
      <label>
        {t("PDF")}{" "}
        <Select
          data-testid="pdf-tool-document"
          value={id}
          onValueChange={(value) => {
            setId(value);
            setInput("");
          }}
        >
          <SelectOption value="">{t("Choose PDF")} </SelectOption>
          {pdfs.map((item) => (
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
      {document && (
        <label>
          {t("Input version")}{" "}
          <Select
            data-testid="pdf-tool-input"
            value={input}
            onValueChange={(value) => setInput(value)}
          >
            <SelectOption value="">{t("Raw PDF")} </SelectOption>
            {artifacts
              .filter(
                (file) =>
                  file.document_id === id &&
                  file.id !== document.artifact_id &&
                  file.mime_type === "application/pdf",
              )
              .map((file) => (
                <SelectOption value={file.id} key={file.id}>
                  {file.filename}
                </SelectOption>
              ))}
          </Select>
        </label>
      )}
      {tool === "merge" && (
        <fieldset>
          <legend>{t("Add PDFs in library order")} </legend>
          {pdfs
            .filter((item) => item.id !== id)
            .map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={merge.includes(item.artifact_id)}
                  onChange={(event) =>
                    setMerge((current) =>
                      event.target.checked
                        ? [...current, item.artifact_id]
                        : current.filter((value) => value !== item.artifact_id),
                    )
                  }
                />
                {item.filename}
              </label>
            ))}
        </fieldset>
      )}
      {tool === "split" && (
        <label>
          {t("Pages to extract")}{" "}
          <input
            data-testid="pdf-tool-pages"
            value={pages}
            onChange={(event) => setPages(event.target.value)}
            placeholder="1, 3, 5"
          />
        </label>
      )}
      {["protect", "unlock"].includes(tool) && (
        <label>
          {t("PDF password")}{" "}
          <input
            data-testid="pdf-tool-password"
            type="password"
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      )}
      {tool === "ocr" && (
        <label>
          {t("OCR language")}{" "}
          <Select
            value={language}
            onValueChange={(value) =>
              setLanguage(sourceLanguageSchema.parse(value))
            }
          >
            <SelectOption value="auto">
              {t("English + Vietnamese")}{" "}
            </SelectOption>
            {languages.map(([code]) => (
              <SelectOption key={code} value={code}>
                {localizedLanguageName(displayLanguage, code)}
              </SelectOption>
            ))}
          </Select>
        </label>
      )}
      <button
        className="button primary"
        data-testid="pdf-tool-run"
        disabled={!document || busy}
        onClick={() => void run()}
      >
        {busy ? t("Starting…") : t("Process PDF")}
      </button>
    </section>
  );
}
