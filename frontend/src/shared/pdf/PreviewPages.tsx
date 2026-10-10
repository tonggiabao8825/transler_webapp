import type { PDFDocumentProxy } from "pdfjs-dist";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/i18n";
import { PDFCanvas } from "./PDFCanvas";

type PreviewPagesProps = {
  pdf: PDFDocumentProxy;
  original: PDFDocumentProxy | null;
  pageNumber: number;
  onSelect: (page: number) => void;
};

function PreviewPage({
  pdf,
  original,
  page,
  selected,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  original: PDFDocumentProxy | null;
  page: number;
  selected: boolean;
  onSelect: (page: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "150px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selected) button.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <button
      ref={button}
      className="preview-page-button"
      data-testid={`preview-thumbnail-${page}`}
      aria-label={`${t("Page")} ${page}`}
      aria-current={selected ? "page" : undefined}
      onClick={() => onSelect(page)}
    >
      <span className="preview-page-miniatures">
        {visible && (
          <>
            {original && (
              <PDFCanvas
                pdf={original}
                pageNumber={page}
                zoom={1}
                onRendered={null}
              />
            )}
            <PDFCanvas pdf={pdf} pageNumber={page} zoom={1} onRendered={null} />
          </>
        )}
      </span>
      <span>{page}</span>
    </button>
  );
}

export function PreviewPages({
  pdf,
  original,
  pageNumber,
  onSelect,
}: PreviewPagesProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav
      className="preview-pages"
      aria-label={t("Document pages")}
      data-testid="preview-pages"
    >
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PreviewPage
          key={index}
          pdf={pdf}
          original={original}
          page={index + 1}
          selected={pageNumber === index + 1}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
