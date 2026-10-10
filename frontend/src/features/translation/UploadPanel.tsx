import {
  ArrowRight,
  FileText,
  Languages,
  Link2,
  LoaderCircle,
  LockKeyhole,
  UploadCloud,
} from "lucide-react";
import type { JSX } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "../../shared/i18n/i18n";

type UploadPanelProps = {
  maxBytes: number;
  busy: boolean;
  onUpload: (file: File) => void;
  onImport: (url: string) => void;
};

export function UploadPanel({
  maxBytes,
  busy,
  onUpload,
  onImport,
}: UploadPanelProps): JSX.Element {
  const { t } = useTranslation();

  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);

  function selectFiles(files: FileList): void {
    if (files.length !== 1 || !files[0]) {
      setSelectionError("Choose one PDF at a time.");
      return;
    }
    setSelectionError(null);
    onUpload(files[0]);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"></div>
          <h1>{t("Translate PDF")} </h1>
          <p>{t("Upload a PDF file or enter a link to get started.")} </p>
        </div>
        <span className="heading-label">
          <LockKeyhole size={14} />
          {t("Only visible to you")}{" "}
        </span>
      </div>
      <div className="upload-layout">
        <section className="panel upload-panel">
          <div className="upload-panel-heading">
            <span className="step-badge">01</span>
            <div>
              <h2>{t("Add your document")} </h2>
              <p>{t("A paper, a report, a whole new possibility.")} </p>
            </div>
            <span className="file-type-tag">{t("PDF")} </span>
          </div>
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${busy ? "loading" : ""}`}
            data-testid="dropzone"
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (!busy) selectFiles(event.dataTransfer.files);
            }}
          >
            <div className="upload-cloud">
              {busy ? (
                <LoaderCircle size={35} className="spin" />
              ) : (
                <UploadCloud size={35} strokeWidth={1.5} />
              )}
            </div>
            <h3>
              {busy ? t("Preparing your document…") : t("Drop your PDF here")}
            </h3>
            <p>{t("or choose a file from your computer")} </p>
            <button
              className="button secondary"
              data-testid="choose-file"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <FileText size={16} />
              {t("Choose file")}{" "}
            </button>
            <input
              ref={input}
              type="file"
              data-testid="file-input"
              accept=".pdf,application/pdf"
              aria-label={t("Upload PDF")}
              hidden
              disabled={busy}
              onChange={(event) => {
                if (event.target.files) selectFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <span className="upload-limit">
              {t("PDF only · Up to 30 pages · Maximum")}{" "}
              {maxBytes / 1024 / 1024} {t("MB")}{" "}
            </span>
          </div>
          {selectionError && (
            <p className="field-error" role="alert">
              {selectionError}
            </p>
          )}
          <div className="or-divider">
            <span />
            {t("or import from a link")} <span />
          </div>
          <form
            className="import-form"
            onSubmit={(event) => {
              event.preventDefault();
              onImport(url);
            }}
          >
            <label className="url-input">
              <Link2 size={17} />
              <input
                type="url"
                data-testid="import-url"
                aria-label={t("HTTPS PDF URL")}
                placeholder={t("https://example.com/document.pdf")}
                required
                pattern="https://.*"
                value={url}
                disabled={busy}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <button
              className="button secondary"
              data-testid="import-submit"
              disabled={busy || !url}
            >
              {t("Import")} <ArrowRight size={15} />
            </button>
          </form>
          <p className="import-note">
            {t("Use a public HTTPS link pointing directly to a PDF.")}{" "}
          </p>
        </section>
        <aside className="upload-aside">
          <div className="mascot-note">
            <img
              src="/assets/mascot/holding-document.svg"
              alt="Your Transler translation companion"
            />
            <div className="handwritten">
              {t("Drag & drop")} <br />
              {t("your document ↘")}{" "}
            </div>
          </div>
        </aside>
      </div>
      <div className="upload-benefits">
        <div>
          <span className="stat-icon blue">
            <Languages size={19} />
          </span>
          <div>
            <strong>{t("Secure & Private")} </strong>
            <p>{t("Your files are protected.")} </p>
          </div>
        </div>
        <div>
          <span className="stat-icon green">
            <FileText size={19} />
          </span>
          <div>
            <strong>{t("High Quality")} </strong>
            <p>{t("Original image data retained.")} </p>
          </div>
        </div>
        <div>
          <span className="stat-icon purple">
            <LockKeyhole size={19} />
          </span>
          <div>
            <strong>{t("Fast Processing")} </strong>
            <p>{t("Progress saved after each page.")} </p>
          </div>
        </div>
      </div>
      <p className="scope-note">
        {t(
          "Basic translation requires selectable text. For scanned pages, run OCR from All Tools first.",
        )}{" "}
      </p>
    </>
  );
}
