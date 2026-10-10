import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  LoaderCircle,
  PanelLeft,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/i18n";
import { PDFCanvas, usePDFDocument } from "./PDFCanvas";
import { PreviewPages } from "./PreviewPages";

type PDFPreviewProps = {
  artifactId: string;
  originalArtifactId: string | null;
  filename: string;
  onClose: () => void;
};

export function PDFPreview({
  artifactId,
  originalArtifactId,
  filename,
  onClose,
}: PDFPreviewProps): JSX.Element {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const { pdf, error } = usePDFDocument(artifactId);
  const { pdf: original, error: originalError } =
    usePDFDocument(originalArtifactId);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [comparison, setComparison] = useState(originalArtifactId !== null);
  const [pagesOpen, setPagesOpen] = useState(() => window.innerWidth > 700);
  const turnPage = useCallback((next: number) => {
    setPageNumber(next);
    surface.current?.scrollTo({ top: 0, left: 0 });
    if (window.innerWidth <= 700) setPagesOpen(false);
  }, []);
  useEffect(() => {
    const previous = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => {
      current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  const previewError =
    error ??
    (comparison ? originalError : null) ??
    (comparison && pdf && original && pdf.numPages !== original.numPages
      ? t("The original and translation have different page counts.")
      : null);
  const ready = pdf !== null && (!comparison || original !== null);
  return (
    <dialog
      ref={dialog}
      className="preview-modal"
      data-testid="pdf-preview"
      onCancel={onClose}
      aria-label={t("PDF preview")}
    >
      <header className="preview-header">
        <div className="preview-heading">
          <img src="/assets/brand/logo-symbol.svg" alt="" />
          <div>
            <strong>{t("Document preview")}</strong>
            <span title={filename}>{filename}</span>
          </div>
        </div>
        {originalArtifactId && (
          <div
            className="preview-modes"
            role="group"
            aria-label={t("Preview mode")}
          >
            <button
              data-testid="preview-comparison"
              aria-pressed={comparison}
              onClick={() => setComparison(true)}
            >
              <Columns2 size={16} />
              <span>{t("Bilingual comparison")}</span>
            </button>
            <button
              data-testid="preview-translation-only"
              aria-pressed={!comparison}
              onClick={() => setComparison(false)}
            >
              <FileText size={16} />
              <span>{t("Translation only")}</span>
            </button>
          </div>
        )}
        <div className="preview-downloads">
          {originalArtifactId && (
            <a
              className="preview-download-original"
              data-testid="preview-download-original"
              href={`/v1/artifacts/${originalArtifactId}/download`}
            >
              <Download size={16} />
              {t("Original PDF")}
            </a>
          )}
          <a
            className="preview-download-result"
            data-testid="preview-download-result"
            href={`/v1/artifacts/${artifactId}/download`}
          >
            <Download size={16} />
            {t(originalArtifactId ? "Translation PDF" : "Download")}
          </a>
        </div>
        <button
          className="preview-close"
          data-testid="close-preview"
          aria-label={t("Close preview")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="preview-toolbar">
        <button
          data-testid="preview-pages-toggle"
          aria-label={t("Document pages")}
          aria-expanded={pagesOpen}
          aria-controls="preview-workspace"
          onClick={() => setPagesOpen(!pagesOpen)}
        >
          <PanelLeft size={18} />
        </button>
        <div className="preview-page-controls">
          <button
            data-testid="previous-page"
            aria-label={t("Previous page")}
            disabled={pageNumber === 1}
            onClick={() => turnPage(pageNumber - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <label className="preview-page-number">
            <input
              data-testid="preview-page-input"
              aria-label={t("Page")}
              type="number"
              min={1}
              max={pdf?.numPages ?? 1}
              value={pageNumber}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (
                  pdf &&
                  Number.isInteger(next) &&
                  next >= 1 &&
                  next <= pdf.numPages
                )
                  turnPage(next);
              }}
            />
            <span data-testid="preview-page">/ {pdf?.numPages ?? "…"}</span>
          </label>
          <button
            data-testid="next-page"
            aria-label={t("Next page")}
            disabled={!pdf || pageNumber >= pdf.numPages}
            onClick={() => turnPage(pageNumber + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="preview-zoom-controls">
          <button
            data-testid="preview-zoom-out"
            aria-label={t("Zoom out")}
            disabled={zoom <= 0.5}
            onClick={() => setZoom(zoom - 0.25)}
          >
            <ZoomOut size={17} />
          </button>
          <span data-testid="preview-zoom">{Math.round(zoom * 100)}%</span>
          <button
            data-testid="preview-zoom-in"
            aria-label={t("Zoom in")}
            disabled={zoom >= 2.5}
            onClick={() => setZoom(zoom + 0.25)}
          >
            <ZoomIn size={17} />
          </button>
          <button
            data-testid="preview-fit"
            aria-label={t("Fit to width")}
            title={t("Fit to width")}
            onClick={() => setZoom(1)}
          >
            <Scan size={17} />
          </button>
        </div>
      </div>
      <div className="preview-workspace" id="preview-workspace">
        {pagesOpen && pdf && !previewError && (
          <PreviewPages
            pdf={pdf}
            original={comparison ? original : null}
            pageNumber={pageNumber}
            onSelect={turnPage}
          />
        )}
        <div
          ref={surface}
          className="preview-surface"
          data-testid="preview-surface"
        >
          {previewError ? (
            <p role="alert">
              {t("Unable to preview PDF:")} {previewError}
            </p>
          ) : ready && pdf ? (
            <div
              className={`preview-documents${comparison ? " is-comparison" : ""}`}
              style={{
                width: `${zoom * 100}%`,
                maxWidth: comparison ? "none" : `${850 * zoom}px`,
                minWidth: comparison ? `${520 * zoom}px` : 0,
              }}
            >
              {comparison && original && (
                <section
                  className="preview-document"
                  data-testid="preview-original"
                  aria-label={t("Original PDF")}
                >
                  <h2>{t("Original PDF")}</h2>
                  <PDFCanvas
                    pdf={original}
                    pageNumber={pageNumber}
                    zoom={1}
                    onRendered={null}
                  />
                </section>
              )}
              <section
                className="preview-document"
                data-testid="preview-translated"
                aria-label={t(
                  originalArtifactId ? "Translation PDF" : "PDF preview",
                )}
              >
                <h2>
                  {t(originalArtifactId ? "Translation PDF" : "PDF preview")}
                </h2>
                <PDFCanvas
                  pdf={pdf}
                  pageNumber={pageNumber}
                  zoom={1}
                  onRendered={null}
                />
              </section>
            </div>
          ) : (
            <div className="preview-loading" role="status">
              <LoaderCircle className="spin" />
              <span>{t("Loading document")}</span>
            </div>
          )}
        </div>
      </div>
      <footer className="preview-footer">
        {t("High-resolution browser preview · Original image data preserved")}
      </footer>
    </dialog>
  );
}
