"""Isolated operation runner publishes acknowledged checkpoints and validated artifacts."""

import faulthandler
import logging
import sys
from pathlib import Path
from typing import cast
from zipfile import ZipFile

import httpx
import pymupdf
from pydantic import TypeAdapter

from transler.core.config import LLMConfig
from transler.core.errors import TranslerError
from transler.processing.ocr.ocr import searchable_pdf
from transler.processing.operations.conversion import MIME, convert
from transler.processing.operations.editing import edit_pdf
from transler.processing.operations.formats import analyze_file
from transler.processing.operations.multiformat import office_context, translate_file
from transler.processing.processing_contracts import (
    AdvancedOptions,
    BasicOptions,
    ConversionOptions,
    EditOptions,
    FormatOptions,
    OCROptions,
    RunnerError,
    RunnerRequest,
    RunnerResult,
    ToolOptions,
)
from transler.processing.translation.bing import ProviderExhaustedError
from transler.processing.translation.llm import Context, LLMTranslation


def pdf_tool(content: bytes, options: ToolOptions, directory: Path) -> bytes:
    with pymupdf.open(stream=content, filetype="pdf") as source:
        if options.tool == "unlock":
            if not options.password or not source.authenticate(options.password):
                raise TranslerError("INVALID_PDF_PASSWORD", "PDF password is incorrect.", 422)
        elif source.is_encrypted:
            raise TranslerError("ENCRYPTED_PDF", "Unlock this PDF before processing.", 422)
        if options.tool == "merge":
            for index, _artifact in enumerate(options.artifact_ids):
                with pymupdf.open(directory / f"extra-{index}.pdf") as extra:
                    if extra.is_encrypted:
                        raise TranslerError(
                            "ENCRYPTED_PDF", "Unlock every PDF before merging.", 422
                        )
                    source.insert_pdf(extra)
        elif options.tool == "split":
            if not options.pages or any(
                page < 0 or page >= source.page_count for page in options.pages
            ):
                raise TranslerError(
                    "INVALID_PAGE_SELECTION", "Choose existing zero-based page indices.", 422
                )
            source.select(list(options.pages))
        if options.tool == "protect":
            if not options.password or len(options.password) < 8:
                raise TranslerError(
                    "PDF_PASSWORD_REQUIRED",
                    "PDF protection requires at least 8 password characters.",
                    422,
                )
            return cast(
                bytes,
                source.tobytes(
                    encryption=pymupdf.PDF_ENCRYPT_AES_256,
                    user_pw=options.password,
                    owner_pw=options.password,
                    permissions=pymupdf.PDF_PERM_PRINT,
                ),
            )
        return cast(
            bytes, source.tobytes(deflate=True, garbage=4, encryption=pymupdf.PDF_ENCRYPT_NONE)
        )


def advanced_pdf(
    content: bytes, request: RunnerRequest, options: AdvancedOptions, directory: Path
) -> bytes:
    from hashlib import sha256

    from transler.processing.pdf.pdf_pipeline import translate_pdf

    settings = LLMConfig()
    with pymupdf.open(stream=content, filetype="pdf") as original:
        document_context = "\n".join(str(page.get_text())[:1000] for page in list(original)[:6])[
            :5000
        ]
    translator = LLMTranslation(
        settings,
        options.source_language,
        options.target_language,
        options.domain,
        options.custom_instructions,
        options.glossary,
        Context(document=document_context, section="", previous="", following=""),
        TypeAdapter(dict[str, str]).validate_json((directory / "cache.json").read_bytes()),
        directory / "cache.json",
    )
    checkpoint = directory / "checkpoint.pdf"
    try:
        return translate_pdf(
            content,
            checkpoint.read_bytes() if checkpoint.exists() else None,
            request.start_page,
            options.source_language,
            options.target_language,
            translator,
            directory,
            sha256((options.model_dump_json() + settings.llm_model).encode()).hexdigest(),
        )
    finally:
        translator.close()


def basic_pdf(
    content: bytes, request: RunnerRequest, options: BasicOptions, directory: Path
) -> bytes:
    from hashlib import sha256

    from transler.processing.pdf.pdf_pipeline import translate_pdf
    from transler.processing.translation.translation_gateway import BasicTranslation

    translator = BasicTranslation(
        options.provider,
        options.source_language,
        options.target_language,
        TypeAdapter(dict[str, str]).validate_json((directory / "cache.json").read_bytes()),
        directory / "cache.json",
    )
    checkpoint = directory / "checkpoint.pdf"
    try:
        return translate_pdf(
            content,
            checkpoint.read_bytes() if checkpoint.exists() else None,
            request.start_page,
            options.source_language,
            options.target_language,
            translator,
            directory,
            sha256(options.model_dump_json().encode()).hexdigest(),
        )
    finally:
        translator.close()


def main() -> None:
    directory = Path(sys.argv[1])
    request = RunnerRequest.model_validate_json((directory / "request.json").read_bytes())
    content = (directory / "source").read_bytes()
    options = request.options
    if isinstance(options, BasicOptions):
        result = basic_pdf(content, request, options, directory)
        suffix = "pdf"
    elif isinstance(options, AdvancedOptions):
        result = advanced_pdf(content, request, options, directory)
        suffix = "pdf"
    elif isinstance(options, ConversionOptions):
        result, suffix, _mime = convert(content, request.source_format, options.target_format)
    elif isinstance(options, EditOptions):
        result = edit_pdf(content, options, LLMConfig())
        suffix = "pdf"
    elif isinstance(options, OCROptions):
        result = searchable_pdf(content, options.language)
        suffix = "pdf"
    elif isinstance(options, FormatOptions):
        context = Context(
            document=content.decode("utf-8", errors="replace")[:4000]
            if request.source_format in {"txt", "md", "html"}
            else office_context(content),
            section="",
            previous="",
            following="",
        )
        translator = LLMTranslation(
            LLMConfig(),
            options.source_language,
            options.target_language,
            options.domain,
            options.custom_instructions,
            options.glossary,
            context,
            TypeAdapter(dict[str, str]).validate_json((directory / "cache.json").read_bytes()),
            directory / "cache.json",
        )
        try:
            result = translate_file(content, request.source_format, translator)
        finally:
            translator.close()
        suffix = request.source_format
    elif isinstance(options, ToolOptions):
        result = pdf_tool(content, options, directory)
        suffix = "pdf"
    else:
        raise ValueError("Basic PDF jobs must use their dedicated engine runner.")
    if suffix == "pdf":
        with pymupdf.open(stream=result, filetype="pdf") as checked:
            if checked.is_encrypted and isinstance(options, ToolOptions) and options.password:
                checked.authenticate(options.password)
            if checked.page_count < 1:
                raise ValueError("Processing produced an empty PDF.")
    elif suffix == "zip":
        from io import BytesIO

        with ZipFile(BytesIO(result)) as archive:
            if not archive.namelist():
                raise ValueError("Image export archive is empty.")
    else:
        analyze_file(result, "result." + suffix)
    (directory / "result").write_bytes(result)
    temporary = directory / "done.tmp"
    temporary.write_text(RunnerResult(suffix=suffix, mime_type=MIME[suffix]).model_dump_json())
    temporary.replace(directory / "done.json")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    faulthandler.enable()
    faulthandler.dump_traceback_later(120, repeat=True)
    try:
        main()
    except TranslerError as error:
        (Path(sys.argv[1]) / "error.json").write_text(
            RunnerError(
                code=error.code, message=error.message, status=error.status
            ).model_dump_json()
        )
        raise
    except ProviderExhaustedError as error:
        (Path(sys.argv[1]) / "error.json").write_text(
            RunnerError(
                code="TRANSLATION_PROVIDER_FAILED", message=str(error), status=502
            ).model_dump_json()
        )
        raise
    except httpx.HTTPError as error:
        (Path(sys.argv[1]) / "error.json").write_text(
            RunnerError(code="LLM_SERVICE_FAILED", message=str(error), status=502).model_dump_json()
        )
        raise
    except ValueError as error:
        (Path(sys.argv[1]) / "error.json").write_text(
            RunnerError(
                code="PROCESSING_VALIDATION_FAILED", message=str(error), status=422
            ).model_dump_json()
        )
        raise
    finally:
        faulthandler.cancel_dump_traceback_later()
