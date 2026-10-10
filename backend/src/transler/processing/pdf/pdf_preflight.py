"""Conservative routing of PDF pages without mistaking hidden OCR for native text."""

import pymupdf
from pydantic import Field

from transler.core.contracts import Contract
from transler.core.errors import TranslerError
from transler.processing.pdf.pdf_ir import PageClassification


class TextTrace(Contract):
    type: int
    bbox: tuple[float, float, float, float]
    opacity: float = Field(ge=0, le=1)


class ImagePlacement(Contract):
    bbox: tuple[float, float, float, float]


def classify_page(page: pymupdf.Page) -> PageClassification:
    traces = tuple(TextTrace.model_validate(item) for item in page.get_texttrace())
    visible = tuple(trace for trace in traces if trace.type != 3 and trace.opacity > 0)
    images = tuple(ImagePlacement.model_validate(item) for item in page.get_image_info())
    area = page.cropbox.width * page.cropbox.height
    image_area = max(
        (
            abs(
                pymupdf.Rect(image.bbox)
                & pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
            )
            for image in images
        ),
        default=0,
    )
    if image_area / area >= 0.65:
        if visible:
            raise TranslerError(
                "PDF_HYBRID_REVIEW_REQUIRED",
                f"Page {page.number + 1} combines a scan-sized image and visible native text. "
                "Region-level hybrid reconstruction requires review.",
                422,
            )
        kind = "scanned"
    elif visible:
        kind = "native"
    elif images:
        kind = "scanned"
    elif page.get_drawings():
        raise TranslerError(
            "PDF_VECTOR_REVIEW_REQUIRED",
            f"Page {page.number + 1} has vector content but no usable text layer. "
            "Outlined text and vector-only diagrams require review.",
            422,
        )
    else:
        kind = "blank"
    return PageClassification(page_index=page.number, kind=kind)


def preflight(document: pymupdf.Document) -> tuple[PageClassification, ...]:
    if document.is_encrypted:
        raise TranslerError("ENCRYPTED_PDF", "Unlock the PDF before translating.", 422)
    if document.is_form_pdf:
        raise TranslerError(
            "PDF_FORM_REVIEW_REQUIRED",
            "Interactive forms and signed PDFs require flattening before translation.",
            422,
        )
    if any(page.first_annot is not None for page in document):
        raise TranslerError(
            "PDF_ANNOTATION_REVIEW_REQUIRED",
            "Flatten PDF annotations before translation to preserve their appearance.",
            422,
        )
    return tuple(classify_page(page) for page in document)
