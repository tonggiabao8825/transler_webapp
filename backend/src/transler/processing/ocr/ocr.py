"""Tesseract OCR yields a searchable layer without replacing source page images."""

from typing import cast

import pymupdf

from transler.core.errors import TranslerError

LANGUAGES = {
    "auto": "eng+vie",
    "en": "eng",
    "vi": "vie",
    "zh": "chi_sim",
    "ja": "jpn",
    "ko": "kor",
    "fr": "fra",
    "de": "deu",
    "es": "spa",
    "pt": "por",
    "ru": "rus",
}


def ocr_region(page: pymupdf.Page, rect: pymupdf.Rect, language: str) -> str:
    pixmap = page.get_pixmap(dpi=300, clip=rect, alpha=False)
    ocr = pixmap.pdfocr_tobytes(language=LANGUAGES[language], compress=True)
    with pymupdf.open(stream=ocr, filetype="pdf") as recognized:
        text = str(recognized[0].get_text()).strip()
    if not text:
        raise TranslerError(
            "OCR_NO_TEXT",
            "Tesseract found no text in the selected region. "
            "Select a readable text area or another OCR language.",
            422,
        )
    return text


def searchable_pdf(content: bytes, language: str) -> bytes:
    with pymupdf.open(stream=content, filetype="pdf") as source:
        for page in source:
            if str(page.get_text()).strip():
                continue
            ocr = page.get_pixmap(dpi=300, alpha=False).pdfocr_tobytes(
                language=LANGUAGES[language], compress=True
            )
            with pymupdf.open(stream=ocr, filetype="pdf") as recognized:
                if not str(recognized[0].get_text()).strip():
                    raise TranslerError(
                        "OCR_NO_TEXT", f"No text detected on page {page.number + 1}.", 422
                    )
                for image in recognized[0].get_images():
                    recognized[0].delete_image(image[0])
                page.show_pdf_page(page.rect, recognized, 0, overlay=True)
        source.subset_fonts(fallback=False)
        return cast(bytes, source.tobytes(deflate=True, garbage=3))
