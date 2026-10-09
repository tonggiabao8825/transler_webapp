import type { JSX } from "react";
import { useCallback, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PDFCanvas, usePDFDocument } from "./PDFCanvas";
export function PDFThumbnail({
  artifactId,
}: {
  artifactId: string;
}): JSX.Element {
  const { pdf, error } = usePDFDocument(artifactId);
  const [rendering, setRendering] = useState(true);
  const rendered = useCallback(() => setRendering(false), []);
  return (
    <div
      className="pdf-thumbnail"
      data-testid="result-thumbnail"
      aria-busy={rendering}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : pdf ? (
        <PDFCanvas pdf={pdf} pageNumber={1} zoom={1} onRendered={rendered} />
      ) : (
        <LoaderCircle className="spin" />
      )}
    </div>
  );
}
