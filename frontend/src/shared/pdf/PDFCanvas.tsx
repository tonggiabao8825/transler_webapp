import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/i18n";
GlobalWorkerOptions.workerSrc = workerUrl;
export function usePDFDocument(artifactId: string | null): {
  pdf: PDFDocumentProxy | null;
  error: string | null;
} {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPdf(null);
    setError(null);
    if (artifactId === null) return;
    const task = getDocument({ url: `/v1/artifacts/${artifactId}/preview` });
    let disposed = false;
    void task.promise
      .then((result) => {
        if (!disposed) setPdf(result);
      })
      .catch((failure: Error) => {
        if (!disposed) setError(failure.message);
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [artifactId]);
  return { pdf, error };
}
type PDFCanvasProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  onRendered: (() => void) | null;
};
export function PDFCanvas({
  pdf,
  pageNumber,
  zoom,
  onRendered,
}: PDFCanvasProps): JSX.Element {
  const { t } = useTranslation();

  const canvas = useRef<HTMLCanvasElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const parent = slot.current;
    if (!parent) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0)
        setWidth(entry.contentRect.width);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    setRendering(true);
    let disposed = false;
    let task: RenderTask | null = null;
    async function render(): Promise<void> {
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        const displayScale = (width / base.width) * zoom;
        const pixels = page.getViewport({
          scale: displayScale * window.devicePixelRatio,
        });
        const context = surface!.getContext("2d");
        if (!context)
          throw new Error("Canvas rendering is unavailable in this browser.");
        surface!.width = Math.ceil(pixels.width);
        surface!.height = Math.ceil(pixels.height);
        surface!.style.width = `${base.width * displayScale}px`;
        surface!.style.height = `${base.height * displayScale}px`;
        task = page.render({
          canvas: surface!,
          canvasContext: context,
          viewport: pixels,
        });
        await task.promise;
        if (!disposed) {
          setError(null);
          setRendering(false);
          onRendered?.();
        }
      } catch (failure) {
        if (!disposed)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    }
    void render();
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, width, zoom, onRendered]);
  return (
    <div ref={slot} className="pdf-page-slot" aria-busy={rendering}>
      {error && (
        <p role="alert">
          {t("Unable to render page:")} {error}
        </p>
      )}
      <canvas
        ref={canvas}
        data-testid="pdf-canvas"
        aria-label={`PDF page ${pageNumber}`}
      />
    </div>
  );
}
