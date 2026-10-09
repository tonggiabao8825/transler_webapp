"""Explicit conversion adapters; validate all outputs and isolate office rendering."""

import html
import subprocess
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from zipfile import ZIP_DEFLATED, ZipFile

import pymupdf

from transler.errors import TranslerError
from transler.formats import FORMATS

MIME = {**FORMATS, "zip": "application/zip"}


def office_pdf(content: bytes, source_format: str) -> bytes:
    with TemporaryDirectory(prefix="transler-office-") as temporary:
        directory = Path(temporary)
        source = directory / f"source.{source_format}"
        source.write_bytes(content)
        try:
            process = subprocess.run(
                [
                    "libreoffice",
                    "-env:UserInstallation=" + (directory / "profile").as_uri(),
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(directory),
                    str(source),
                ],
                capture_output=True,
                timeout=90,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise TranslerError(
                "OFFICE_RENDER_TIMEOUT", "LibreOffice rendering exceeded 90 seconds.", 422
            ) from error
        target = directory / "source.pdf"
        if process.returncode or not target.is_file():
            raise TranslerError(
                "OFFICE_RENDER_FAILED",
                f"LibreOffice exited {process.returncode}: "
                f"{process.stderr.decode(errors='replace')[-1000:]}",
                422,
            )
        return target.read_bytes()


def image_pdf(content: bytes, source_format: str) -> bytes:
    with pymupdf.open(stream=content, filetype=source_format) as image:
        return cast(bytes, image.convert_to_pdf())


def text_pdf(content: bytes, source_format: str) -> bytes:
    from markdown_it import MarkdownIt
    from weasyprint import HTML, default_url_fetcher

    text = content.decode("utf-8")
    markup = (
        MarkdownIt().render(text)
        if source_format == "md"
        else text
        if source_format == "html"
        else "<pre>" + html.escape(text) + "</pre>"
    )

    import re

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(markup, "html.parser")
    resources = [str(tag.get("src")) for tag in soup.find_all(src=True)]
    resources.extend(str(tag.get("href")) for tag in soup.find_all("link", href=True))
    css = " ".join(str(tag.get("style", "")) for tag in soup.find_all(style=True))
    css += " ".join(tag.get_text() for tag in soup.find_all("style"))
    resources.extend(
        match.strip("\"' ") for match in re.findall(r"url\s*\(([^)]+)\)", css, re.IGNORECASE)
    )
    if any(not resource.startswith("data:") for resource in resources) or re.search(
        r"@import", css, re.IGNORECASE
    ):
        raise TranslerError(
            "EXTERNAL_HTML_RESOURCE",
            "Embed HTML resources as data URLs; "
            "external resource loading and CSS imports are forbidden.",
            422,
        )

    def fetch_resource(url: str) -> dict[str, bytes | str]:
        if not url.startswith("data:"):
            raise TranslerError(
                "EXTERNAL_HTML_RESOURCE", "Only embedded data URLs are permitted.", 422
            )
        return cast(dict[str, bytes | str], default_url_fetcher(url))

    rendered = HTML(string=markup, url_fetcher=fetch_resource).write_pdf()
    if rendered is None:
        raise TranslerError("HTML_RENDER_FAILED", "HTML renderer did not return PDF bytes.", 422)
    return cast(bytes, rendered)


def to_pdf(content: bytes, source_format: str) -> bytes:
    registry = {
        "docx": office_pdf,
        "pptx": office_pdf,
        "xlsx": office_pdf,
        "png": image_pdf,
        "jpg": image_pdf,
        "txt": text_pdf,
        "md": text_pdf,
        "html": text_pdf,
    }
    if source_format not in registry:
        raise TranslerError("UNSUPPORTED_CONVERSION", f"Cannot render {source_format} to PDF.", 422)
    result = registry[source_format](content, source_format)
    with pymupdf.open(stream=result, filetype="pdf") as checked:
        if checked.page_count < 1:
            raise TranslerError("EMPTY_CONVERSION", "Rendered PDF has no pages.", 422)
    return result


def pdf_to_docx(content: bytes) -> bytes:
    from pdf2docx import Converter

    with TemporaryDirectory(prefix="transler-word-") as temporary:
        source = Path(temporary) / "source.pdf"
        target = Path(temporary) / "result.docx"
        source.write_bytes(content)
        adapter = Converter(str(source))
        try:
            adapter.convert(str(target), start=0, end=None, multi_processing=False)
        finally:
            adapter.close()
        from docx import Document

        document = Document(str(target))
        if not document.paragraphs and not document.tables:
            raise TranslerError(
                "EMPTY_CONVERSION",
                "Word reconstruction found no text or tables. OCR scanned pages first.",
                422,
            )
        return target.read_bytes()


def pdf_to_pptx(content: bytes) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    with pymupdf.open(stream=content, filetype="pdf") as source:
        presentation.slide_width = Inches(source[0].rect.width / 72)
        presentation.slide_height = Inches(source[0].rect.height / 72)
        for page in source:
            slide = presentation.slides.add_slide(presentation.slide_layouts[6])
            image = page.get_pixmap(dpi=200, alpha=False).tobytes("png")
            slide.shapes.add_picture(
                BytesIO(image),
                0,
                0,
                width=presentation.slide_width,
                height=presentation.slide_height,
            )
    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


def pdf_to_xlsx(content: bytes) -> bytes:
    from openpyxl import Workbook, load_workbook

    workbook = Workbook()
    workbook.remove(workbook[workbook.sheetnames[0]])
    tables = 0
    with pymupdf.open(stream=content, filetype="pdf") as source:
        for page in source:
            for table in page.find_tables().tables:
                tables += 1
                sheet = workbook.create_sheet(f"Table {tables}")
                for row in table.extract():
                    sheet.append([value if value is not None else "" for value in row])
                    for cell in sheet[sheet.max_row]:
                        cell.data_type = "s"
    if not tables:
        raise TranslerError(
            "NO_TABLES_FOUND",
            "PDF contains no detectable tables. XLSX conversion requires tabular content.",
            422,
        )
    output = BytesIO()
    workbook.save(output)
    load_workbook(BytesIO(output.getvalue()))
    return output.getvalue()


def pdf_extract(content: bytes, target_format: str) -> bytes:
    with pymupdf.open(stream=content, filetype="pdf") as source:
        if target_format in {"png", "jpg"}:
            output = BytesIO()
            with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
                for index, page in enumerate(source):
                    archive.writestr(
                        f"page-{index + 1:03d}.{target_format}",
                        page.get_pixmap(dpi=200, alpha=False).tobytes(target_format),
                    )
            return output.getvalue()
        if target_format == "html":
            return (
                "<!doctype html><html><head><meta charset='utf-8'>"
                "<title>Converted document</title></head><body>"
                + "".join(page.get_text("html") for page in source)
                + "</body></html>"
            ).encode()
        text = "\n\n".join(page.get_text() for page in source)
        if not text.strip():
            raise TranslerError(
                "NO_TEXT_FOUND",
                "PDF contains no extractable text. Run OCR before text conversion.",
                422,
            )
        return text.encode()


def convert(content: bytes, source_format: str, target_format: str) -> tuple[bytes, str, str]:
    if source_format == target_format:
        raise TranslerError("SAME_FORMAT", "Choose a different output format.", 422)
    if target_format == "pdf":
        return to_pdf(content, source_format), "pdf", MIME["pdf"]
    if source_format != "pdf":
        raise TranslerError(
            "UNSUPPORTED_CONVERSION",
            "Office/image/text conversion target must be PDF; "
            f"requested {source_format} → {target_format}.",
            422,
        )
    registry = {"docx": pdf_to_docx, "pptx": pdf_to_pptx, "xlsx": pdf_to_xlsx}
    result = (
        registry[target_format](content)
        if target_format in registry
        else pdf_extract(content, target_format)
    )
    suffix = "zip" if target_format in {"png", "jpg"} else target_format
    return result, suffix, MIME[suffix]
