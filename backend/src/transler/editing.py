"""Replay validated PDF edit operations into a new artifact with bounded geometry."""

import html
from typing import cast

import pymupdf

from transler.config import LLMConfig
from transler.errors import TranslerError
from transler.llm import Context, LLMTranslation
from transler.ocr import ocr_region
from transler.processing_contracts import EditOptions


def checked_rect(
    page: pymupdf.Page, values: tuple[float, float, float, float] | None
) -> pymupdf.Rect:
    if values is None:
        raise TranslerError(
            "EDIT_RECT_REQUIRED", "This operation requires a PDF point rectangle.", 422
        )
    rect = pymupdf.Rect(values)
    if rect.is_empty or rect.is_infinite or not page.rect.contains(rect):
        raise TranslerError(
            "EDIT_RECT_INVALID",
            f"Rectangle {values} is outside page bounds {tuple(page.rect)}.",
            422,
        )
    return rect


def erase_text(page: pymupdf.Page, rect: pymupdf.Rect) -> None:
    page.add_redact_annot(rect, fill=False)
    page.apply_redactions(images=0, graphics=0, text=0)


def draw_text(page: pymupdf.Page, rect: pymupdf.Rect, text: str, font_size: float) -> None:
    if not 4 <= font_size <= 100:
        raise TranslerError("INVALID_FONT_SIZE", "Font size must be between 4 and 100 points.", 422)
    spare, scale = page.insert_htmlbox(
        rect,
        "<div>" + html.escape(text).replace("\n", "<br>") + "</div>",
        css=f"* {{font-family:sans-serif;font-size:{font_size}pt;margin:0;padding:0;}}",
        scale_low=1,
    )
    if spare < 0 or scale < 1:
        raise TranslerError(
            "TEXT_OVERFLOW",
            "Text does not fit the selected rectangle. Enlarge it or reduce font size.",
            422,
        )


def edit_pdf(content: bytes, options: EditOptions, llm: LLMConfig) -> bytes:
    with pymupdf.open(stream=content, filetype="pdf") as document:
        for operation in options.operations:
            if operation.type == "reorder_pages":
                if operation.order is None or sorted(operation.order) != list(
                    range(document.page_count)
                ):
                    raise TranslerError(
                        "INVALID_PAGE_ORDER",
                        "Page order must contain every current zero-based page index exactly once.",
                        422,
                    )
                document.select(list(operation.order))
                continue
            if not 0 <= operation.page < document.page_count:
                raise TranslerError(
                    "PAGE_NOT_FOUND",
                    f"Page {operation.page + 1} does not exist in this revision.",
                    422,
                )
            page = document[operation.page]
            if operation.type == "delete_page":
                if document.page_count == 1:
                    raise TranslerError("LAST_PAGE", "A PDF must retain at least one page.", 422)
                document.delete_page(operation.page)
                continue
            if operation.type == "rotate_page":
                if operation.angle not in {90, 180, 270}:
                    raise TranslerError(
                        "INVALID_ROTATION", "Rotation must be 90, 180 or 270 degrees.", 422
                    )
                page.set_rotation((page.rotation + operation.angle) % 360)
                continue
            rect = checked_rect(page, operation.rect)
            if operation.type == "crop_page":
                page.set_cropbox(rect)
                continue
            if operation.type == "add_annotation":
                if not operation.text:
                    raise TranslerError(
                        "ANNOTATION_TEXT_REQUIRED", "Annotation requires text.", 422
                    )
                page.add_text_annot(rect.tl, operation.text)
                continue
            if operation.type == "delete_text":
                erase_text(page, rect)
                continue
            text = operation.text
            if operation.type in {"move_block", "resize_block"}:
                text = str(page.get_textbox(rect))
                erase_text(page, rect)
                rect = checked_rect(page, operation.destination)
            if operation.type == "retranslate_region":
                if operation.source_language is None or operation.target_language is None:
                    raise TranslerError(
                        "REGION_LANGUAGE_REQUIRED",
                        "Region translation requires source and target languages.",
                        422,
                    )
                source = str(page.get_textbox(rect)).strip()
                if not source:
                    source = ocr_region(page, rect, operation.source_language)
                translator = LLMTranslation(
                    llm,
                    operation.source_language,
                    operation.target_language,
                    "",
                    "",
                    (),
                    Context(
                        document=str(document[0].get_text())[:2000],
                        section=str(page.get_text())[:4000],
                        previous="",
                        following="",
                    ),
                    {},
                    None,
                )
                try:
                    text = translator.translate(source)
                finally:
                    translator.close()
                page.add_redact_annot(rect, fill=(1, 1, 1))
                page.apply_redactions(images=2, graphics=0, text=0)
            elif operation.type == "replace_text":
                erase_text(page, rect)
            if not text:
                raise TranslerError(
                    "EDIT_TEXT_REQUIRED",
                    "Text operation requires non-empty text or a selectable source block.",
                    422,
                )
            draw_text(
                page, rect, text, operation.font_size if operation.font_size is not None else 12
            )
        document.subset_fonts(fallback=False)
        result = cast(bytes, document.tobytes(deflate=True, garbage=3))
    with pymupdf.open(stream=result, filetype="pdf") as checked:
        if not checked.page_count:
            raise TranslerError("INVALID_REVISION", "Edited PDF has no pages.", 422)
    return result
