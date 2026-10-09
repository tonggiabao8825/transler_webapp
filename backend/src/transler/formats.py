"""Bounded format inspection and Office XML validation; source bytes remain immutable."""

import math
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from lxml import etree
from pydantic import Field

from transler.contracts import Contract
from transler.errors import TranslerError
from transler.pdf import analyze_pdf

FORMATS = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "html": "text/html",
    "txt": "text/plain",
    "md": "text/markdown",
}


OFFICE_TEXT_TAGS = {
    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t",
    "{http://schemas.openxmlformats.org/drawingml/2006/main}t",
    "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t",
}


class FormatAnalysis(Contract):
    source_format: str
    mime_type: str
    page_count: int = Field(ge=1)


def office_files(content: bytes) -> tuple[tuple[str, bytes], ...]:
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 5000 or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
                raise TranslerError(
                    "OFFICE_LIMIT", "Office archive exceeds 5,000 entries or 100 MB unpacked.", 422
                )
            if any(
                ".." in PurePosixPath(entry.filename).parts
                or entry.filename.startswith("/")
                or "vbaproject" in entry.filename.lower()
                or "/embeddings/" in entry.filename
                for entry in entries
            ):
                raise TranslerError(
                    "UNSAFE_OFFICE",
                    "Office archive contains unsafe paths, macros or embedded executable objects.",
                    422,
                )
            files = tuple((entry.filename, archive.read(entry)) for entry in entries)
            for name, data in files:
                if name.endswith(".rels"):
                    root = xml_root(data)
                    for relation in root:
                        if relation.get("TargetMode") == "External" and not str(
                            relation.get("Type")
                        ).endswith("/hyperlink"):
                            raise TranslerError(
                                "EXTERNAL_OFFICE_RESOURCE",
                                "External Office image/data resources are not allowed. "
                                "Embed resources before uploading.",
                                422,
                            )
            return files
    except BadZipFile as error:
        raise TranslerError(
            "INVALID_OFFICE", "Office file is not a valid ZIP archive.", 422
        ) from error


def xml_root(data: bytes) -> etree._Element:
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise TranslerError(
            "UNSAFE_XML", "Document XML must not contain DTD or entity declarations.", 422
        )
    return etree.fromstring(
        data, parser=etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
    )


def analyze_file(content: bytes, filename: str) -> FormatAnalysis:
    suffix = filename.rsplit(".", 1)[-1].lower()
    if suffix not in FORMATS:
        raise TranslerError(
            "UNSUPPORTED_FORMAT",
            f"Unsupported format {suffix}. Choose PDF, Office, PNG/JPEG, HTML, TXT or Markdown.",
            422,
        )
    mime = FORMATS[suffix]
    kind = "jpg" if suffix == "jpeg" else suffix
    if kind == "pdf":
        analysis = analyze_pdf(content)
        return FormatAnalysis(source_format=kind, mime_type=mime, page_count=analysis.page_count)
    if kind in {"docx", "pptx", "xlsx"}:
        files = office_files(content)
        required = {
            "docx": "word/document.xml",
            "pptx": "ppt/presentation.xml",
            "xlsx": "xl/workbook.xml",
        }[kind]
        if required not in dict(files):
            raise TranslerError(
                "OFFICE_FORMAT_MISMATCH", f"The file does not contain {required} for {kind}.", 422
            )
        characters = sum(
            len(str(element.text))
            for name, data in files
            if name.endswith(".xml")
            and (
                name.startswith("word/") or name.startswith("ppt/slides/") or name.startswith("xl/")
            )
            for element in xml_root(data).iter()
            if element.tag in OFFICE_TEXT_TAGS and element.text
        )
        units = max(1, math.ceil(characters / 2000))
        if kind == "pptx":
            units = sum(
                name.startswith("ppt/slides/slide") and name.endswith(".xml") for name, _ in files
            )
        return FormatAnalysis(source_format=kind, mime_type=mime, page_count=max(1, units))
    if kind in {"png", "jpg"}:
        import pymupdf

        with pymupdf.open(stream=content, filetype=kind) as image:
            if image.page_count != 1:
                raise TranslerError("INVALID_IMAGE", "Image must contain exactly one frame.", 422)
        return FormatAnalysis(source_format=kind, mime_type=mime, page_count=1)
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise TranslerError(
            "INVALID_ENCODING", "Text, Markdown and HTML uploads must use UTF-8.", 422
        ) from error
    if not decoded.strip() or "\x00" in decoded:
        raise TranslerError(
            "INVALID_TEXT", "Document must contain non-empty UTF-8 text without NUL bytes.", 422
        )
    return FormatAnalysis(
        source_format=kind, mime_type=mime, page_count=max(1, math.ceil(len(decoded) / 2000))
    )
