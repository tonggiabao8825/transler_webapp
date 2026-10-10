"""Mixed PDF routing and source-index assembly; each engine owns reconstruction."""

import sys
from hashlib import sha256
from pathlib import Path
from typing import TYPE_CHECKING, cast

import pymupdf

from transler.core.errors import TranslerError
from transler.processing.pdf.native_engine import translate_native
from transler.processing.pdf.pdf_ir import PageIR, PDFManifest
from transler.processing.pdf.pdf_preflight import preflight
from transler.processing.progress import ProcessingProgress, write_progress
from transler.processing.translation.llm import Context
from transler.processing.translation.translation_gateway import TranslationConnector

if TYPE_CHECKING:
    from transler.processing.pdf.scan_engine import ScanPreparation


def translate_pdf(
    content: bytes,
    checkpoint: bytes | None,
    start_page: int,
    source: str,
    target: str,
    connector: TranslationConnector,
    directory: Path,
    translation_checksum: str,
) -> bytes:
    source_file = directory / "native-source.pdf"
    source_file.write_bytes(content)
    with pymupdf.open(stream=content, filetype="pdf") as original:
        classifications = preflight(original)
        manifest = PDFManifest(
            schema_version=1,
            source_checksum=sha256(content).hexdigest(),
            translation_checksum=translation_checksum,
            native_engine="babeldoc-0.6.4",
            scan_engine="paddleocr-3.3.2-opencv-4.10",
            pages=classifications,
            scan_pages=(),
        )
        existing_manifest = directory / "manifest.json"
        scan_ir: list[PageIR] = []
        if start_page:
            if not existing_manifest.is_file():
                raise TranslerError(
                    "PDF_CHECKPOINT_INCOMPATIBLE",
                    "This checkpoint predates the new PDF engines. Start a new translation job.",
                    409,
                )
            previous = PDFManifest.model_validate_json(existing_manifest.read_bytes())
            if (
                previous.source_checksum != sha256(content).hexdigest()
                or previous.translation_checksum != translation_checksum
            ):
                raise TranslerError(
                    "PDF_CHECKPOINT_INCOMPATIBLE",
                    "Checkpoint input or translation settings changed. Start a new job.",
                    409,
                )
            scan_ir = [page for page in previous.scan_pages if page.page_index < start_page]
        native_pages = tuple(
            page.page_index
            for page in classifications
            if page.kind == "native" and page.page_index >= start_page
        )
        scan_pages = tuple(
            page.page_index
            for page in classifications
            if page.kind == "scanned" and page.page_index >= start_page
        )
        prepared: dict[int, ScanPreparation] = {}
        if scan_pages:
            from transler.processing.pdf.scan_engine import ScanEngine

            scan_engine = ScanEngine(source)
            try:
                for index in scan_pages:
                    write_progress(
                        directory,
                        ProcessingProgress(
                            stage=f"Scan Engine: OCR page {index + 1}/{original.page_count}",
                            percent=3,
                            current=index,
                            total=original.page_count,
                        ),
                    )
                    with pymupdf.open() as page:
                        page.insert_pdf(original, from_page=index, to_page=index, links=False)
                        prepared[index] = scan_engine.recognize_page(page.tobytes(), index)
            finally:
                scan_engine.close()
        scan_sources = {page.page_index: page for page in scan_ir}
        scan_sources.update({index: preparation.ir for index, preparation in prepared.items()})
        document_context = "\n".join(
            " ".join(region.source_text for region in scan_sources[index].regions)
            if index in scan_sources
            else str(original[index].get_text())
            for index in range(original.page_count)
        )[:16000]
        connector.use_context(
            Context(document=document_context, section="", previous="", following="")
        )
        native = (
            translate_native(source_file, native_pages, source, target, connector, directory)
            if native_pages
            else None
        )
        with (
            pymupdf.open(
                stream=checkpoint if checkpoint is not None else content, filetype="pdf"
            ) as result,
            pymupdf.open(
                stream=native if native is not None else content, filetype="pdf"
            ) as translated_native,
        ):
            if (
                result.page_count != original.page_count
                or translated_native.page_count != original.page_count
            ):
                raise TranslerError(
                    "PDF_PAGE_MAPPING_FAILED",
                    "Engine output must retain the original PDF page count.",
                    502,
                )
            for classification in classifications[start_page:]:
                index = classification.page_index
                if classification.kind == "native":
                    result.delete_page(index)
                    result.insert_pdf(
                        translated_native,
                        from_page=index,
                        to_page=index,
                        start_at=index,
                        links=False,
                        final=0,
                    )
                    replacement = None
                elif classification.kind == "scanned":
                    from transler.processing.pdf.scan_engine import compose_scan_page

                    replacement, ir = compose_scan_page(prepared[index], connector)
                    scan_ir.append(ir)
                else:
                    replacement = None
                if replacement is not None:
                    with pymupdf.open(stream=replacement, filetype="pdf") as page:
                        result.delete_page(index)
                        result.insert_pdf(page, start_at=index, links=False)
                source_page = original[index]
                output_page = result[index]
                if (
                    output_page.rotation != source_page.rotation
                    or output_page.mediabox != source_page.mediabox
                    or output_page.cropbox != source_page.cropbox
                ):
                    raise TranslerError(
                        "PDF_PAGE_GEOMETRY_CHANGED",
                        f"Engine output changed page {index + 1} boxes or rotation.",
                        502,
                    )
                result.set_metadata(original.metadata)
                xml = original.get_xml_metadata()
                if xml:
                    result.set_xml_metadata(xml)
                result.set_toc(original.get_toc(simple=False))
                result.set_page_labels(original.get_page_labels())
                for navigation_index in range(original.page_count):
                    for link in result[navigation_index].get_links():
                        result[navigation_index].delete_link(link)
                    for link in original[navigation_index].get_links():
                        result[navigation_index].insert_link(
                            {key: value for key, value in link.items() if key not in {"xref", "id"}}
                        )
                manifest = manifest.model_copy(update={"scan_pages": tuple(scan_ir)})
                temporary_manifest = directory / "manifest.tmp"
                temporary_manifest.write_text(manifest.model_dump_json())
                temporary_manifest.replace(directory / "manifest.json")
                completed = index + 1
                temporary = directory / "page.tmp"
                # Compact only the final PDF: live graft and metadata xrefs must stay stable.
                result.save(temporary, deflate=True, garbage=0)
                temporary.replace(directory / f"page-{completed}.pdf")
                if sys.stdin.readline().strip() != str(completed):
                    raise ValueError(f"Checkpoint {completed} received an invalid acknowledgement.")
            return cast(bytes, result.tobytes(deflate=True, garbage=3))
