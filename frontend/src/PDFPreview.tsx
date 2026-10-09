import { useTranslation } from "./i18n";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PDFCanvas, usePDFDocument } from "./PDFCanvas";
type PDFPreviewProps = { artifactId: string; onClose: () => void };
export function PDFPreview({
  artifactId,
  onClose,
}: PDFPreviewProps): JSX.Element {
  const { t } = useTranslation();

  const dialog = useRef<HTMLDialogElement>(null);
  const { pdf, error } = usePDFDocument(artifactId);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(true);
  const rendered = useCallback(() => setRendering(false), []);
  useEffect(() => {
    const previous = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => {
      current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  function turnPage(next: number): void {
    setRendering(true);
    setPageNumber(next);
  }
  return (
    <dialog
      ref={dialog}
      className="preview-modal"
      onCancel={onClose}
      aria-label={t("PDF preview")}
    >
      <header>
        <strong>{t("Document preview")} </strong>
        <a
          className="text-button"
          href={`/v1/artifacts/${artifactId}/download`}
        >
          <Download size={16} />
          {t("Download")}{" "}
        </a>
        <button
          data-testid="close-preview"
          aria-label={t("Close preview")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="preview-toolbar">
        <button
          data-testid="previous-page"
          aria-label={t("Previous page")}
          disabled={pageNumber === 1 || rendering}
          onClick={() => turnPage(pageNumber - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span data-testid="preview-page">
          {t("Page")} {pageNumber} {t("of")} {pdf?.numPages ?? "…"}
        </span>
        <button
          data-testid="next-page"
          aria-label={t("Next page")}
          disabled={!pdf || pageNumber >= pdf.numPages || rendering}
          onClick={() => turnPage(pageNumber + 1)}
        >
          <ChevronRight size={18} />
        </button>
        <span className="toolbar-divider" />
        <button
          data-testid="preview-zoom-out"
          aria-label={t("Zoom out")}
          disabled={zoom <= 0.5}
          onClick={() => setZoom((value) => value - 0.25)}
        >
          <ZoomOut size={17} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          data-testid="preview-zoom-in"
          aria-label={t("Zoom in")}
          disabled={zoom >= 2.5}
          onClick={() => setZoom((value) => value + 0.25)}
        >
          <ZoomIn size={17} />
        </button>
      </div>
      <div className="preview-surface">
        {error ? (
          <p role="alert">
            {t("Unable to preview PDF:")} {error}
          </p>
        ) : pdf ? (
          <PDFCanvas
            pdf={pdf}
            pageNumber={pageNumber}
            zoom={zoom}
            onRendered={rendered}
          />
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
      <p>
        {t(
          "High-resolution browser preview · Original image data preserved",
        )}{" "}
      </p>
    </dialog>
  );
}
