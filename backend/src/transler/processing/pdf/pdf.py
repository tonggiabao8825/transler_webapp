"""PDF input/output validation independent of the translation engine."""

import os
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import psutil
import pymupdf
from pydantic import ValidationError

from transler.core.contracts import (
    ApiError,
    DocumentAnalysis,
    PageView,
    QualityReport,
    QualityWarning,
)
from transler.core.errors import TranslerError


def analyze_pdf(content: bytes) -> DocumentAnalysis:
    """Validate untrusted input in a child process with CPU/memory limits."""
    with TemporaryDirectory(prefix="transler-parse-") as temporary:
        source = Path(temporary) / "source.pdf"
        source.write_bytes(content)
        return run_parser(source)


def run_parser(source: Path) -> DocumentAnalysis:
    process = subprocess.Popen(
        [sys.executable, "-m", "transler.processing.runners.parser_runner", str(source)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={
            key: value
            for key, value in os.environ.items()
            if key in {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"}
        },
    )
    deadline = time.monotonic() + 20
    try:
        while True:
            try:
                stdout, stderr = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                if time.monotonic() > deadline:
                    raise TranslerError(
                        "PDF_PARSE_TIMEOUT", "PDF validation exceeded 20 seconds.", 422
                    ) from None
                try:
                    memory_bytes = psutil.Process(process.pid).memory_info().rss
                except psutil.NoSuchProcess:
                    stdout, stderr = process.communicate(timeout=1)
                    break
                if memory_bytes > 1024 * 1024 * 1024:
                    raise TranslerError(
                        "PDF_MEMORY_LIMIT", "PDF validation exceeded 1 GiB memory.", 422
                    ) from None
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    if process.returncode == 2:
        error = ApiError.model_validate_json(stdout)
        raise TranslerError(error.code, error.message, 422)
    if process.returncode != 0:
        raise TranslerError(
            "PDF_PARSE_FAILED",
            f"PDF validator exited {process.returncode}: {stderr.decode(errors='replace')[-2000:]}",
            422,
        )
    try:
        return DocumentAnalysis.model_validate_json(stdout)
    except ValidationError as error:
        raise TranslerError(
            "PDF_PARSE_FAILED", f"Invalid PDF validation response: {error}", 422
        ) from error


def analyze_pdf_native(content: bytes) -> DocumentAnalysis:
    """Native inspection runs only in the parser process or isolated PDF worker."""
    if not content.startswith(b"%PDF-"):
        raise TranslerError("INVALID_PDF", "File magic bytes do not identify a PDF.", 422)
    try:
        with pymupdf.open(stream=content, filetype="pdf") as document:
            if document.needs_pass:
                raise TranslerError(
                    "ENCRYPTED_PDF", "Remove the PDF password before uploading.", 422
                )
            if document.is_repaired:
                raise TranslerError("DAMAGED_PDF", "PDF required repair; upload a valid PDF.", 422)
            if not 1 <= document.page_count <= 30:
                raise TranslerError(
                    "PAGE_LIMIT_EXCEEDED",
                    f"Free Public requires 1–30 pages; received {document.page_count} pages.",
                    422,
                )
            pages = tuple(
                PageView(
                    number=index + 1,
                    width=page.rect.width,
                    height=page.rect.height,
                    text_characters=len(page.get_text("text").strip()),
                )
                for index, page in enumerate(document)
            )
            if any(
                page.width <= 0 or page.height <= 0 or page.width * page.height > 20_000_000
                for page in pages
            ):
                raise TranslerError(
                    "UNSAFE_PAGE_SIZE", "PDF page exceeds the safe rendering area.", 422
                )
            return DocumentAnalysis(page_count=document.page_count, pages=pages)
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise TranslerError("INVALID_PDF", f"PDF parser rejected the file: {error}", 422) from error


def inspect_page_output(
    original: pymupdf.Page, result: pymupdf.Page, page_number: int
) -> tuple[QualityWarning, ...]:
    if (
        abs(original.rect.width - result.rect.width) > 1
        or abs(original.rect.height - result.rect.height) > 1
    ):
        raise TranslerError("INVALID_OUTPUT", f"Page {page_number} changed dimensions.", 502)
    if (
        original.rotation != result.rotation
        or original.cropbox != result.cropbox
        or original.mediabox != result.mediabox
    ):
        raise TranslerError(
            "INVALID_OUTPUT", f"Page {page_number} changed rotation or page boxes.", 502
        )
    text = result.get_text("text").strip()
    if "\x00" in text:
        raise TranslerError(
            "PDF_TEXT_ENCODING_INVALID",
            f"Page {page_number} contains NUL characters in extracted text. "
            "Its font encoding or resource references are corrupt; regenerate the PDF.",
            502,
        )
    if text and not result.get_fonts(full=True):
        raise TranslerError(
            "PDF_FONT_RESOURCES_INVALID",
            f"Page {page_number} contains text without resolvable font resources. "
            "Regenerate the PDF before publishing it.",
            502,
        )
    if not text:
        if (
            not original.get_text("text").strip()
            and not original.get_image_info()
            and not original.get_drawings()
        ):
            return ()
        raise TranslerError("INVALID_OUTPUT", f"Page {page_number} lost all text.", 502)
    if "IRREPARABLE TRANSLATION ERROR" in text:
        raise TranslerError("PROVIDER_REJECTED", "Translation provider rejected a segment.", 502)
    warnings: list[QualityWarning] = []
    bounds = pymupdf.Rect(0, 0, result.cropbox.width, result.cropbox.height)
    if any(not bounds.contains(pymupdf.Rect(word[:4])) for word in result.get_text("words")):
        warnings.append(
            QualityWarning(
                code="PAGE_OVERFLOW",
                page=page_number,
                message="Text extends beyond the page boundary; review this page.",
            )
        )
    if len(text) < len(original.get_text("text").strip()) * 0.6:
        warnings.append(
            QualityWarning(
                code="TEXT_REDUCTION",
                page=page_number,
                message=(
                    "Extracted text is substantially shorter than the source; review this page."
                ),
            )
        )
    return tuple(warnings)


def validate_checkpoint(source: bytes, result: bytes, page_number: int) -> None:
    """Validate the newly completed page; the final report inspects every page once."""
    with (
        pymupdf.open(stream=source, filetype="pdf") as original,
        pymupdf.open(stream=result, filetype="pdf") as checkpoint,
    ):
        if checkpoint.page_count != original.page_count:
            raise TranslerError("INVALID_OUTPUT", "Translation changed the PDF page count.", 502)
        inspect_page_output(original[page_number - 1], checkpoint[page_number - 1], page_number)


def inspect_output(source: bytes, result: bytes) -> QualityReport:
    actual = analyze_pdf_native(result)
    with (
        pymupdf.open(stream=source, filetype="pdf") as original,
        pymupdf.open(stream=result, filetype="pdf") as translated,
    ):
        if translated.page_count != original.page_count:
            raise TranslerError("INVALID_OUTPUT", "Translation changed the PDF page count.", 502)
        warnings = tuple(
            warning
            for index, page in enumerate(translated)
            for warning in inspect_page_output(original[index], page, index + 1)
        )
    return QualityReport(
        page_count=actual.page_count,
        pages_with_text=sum(p.text_characters > 0 for p in actual.pages),
        overflow_count=sum(w.code == "PAGE_OVERFLOW" for w in warnings),
        warnings=warnings,
        assessment="heuristic",
    )
