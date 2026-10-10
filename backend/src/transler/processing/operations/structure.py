"""Typed PDF text geometry for the editor, measured in unrotated PDF points."""

import pymupdf

from transler.core.contracts import Contract
from transler.core.errors import TranslerError


class TextBlock(Contract):
    rect: tuple[float, float, float, float]
    text: str


class PageStructure(Contract):
    index: int
    width: float
    height: float
    blocks: tuple[TextBlock, ...]


class ExtractedBlock(Contract):
    bbox: tuple[float, float, float, float]
    type: int
    lines: tuple["ExtractedLine", ...] = ()


class ExtractedLine(Contract):
    spans: tuple["ExtractedSpan", ...]


class ExtractedSpan(Contract):
    text: str


class ExtractedPage(Contract):
    blocks: tuple[ExtractedBlock, ...]


def pdf_structure(content: bytes) -> tuple[PageStructure, ...]:
    with pymupdf.open(stream=content, filetype="pdf") as pdf:
        if pdf.is_encrypted:
            raise TranslerError("ENCRYPTED_PDF", "Unlock the PDF before opening the editor.", 422)
        pages: list[PageStructure] = []
        for page in pdf:
            extracted = ExtractedPage.model_validate(page.get_text("dict"))
            blocks = tuple(
                TextBlock(
                    rect=block.bbox,
                    text="\n".join(
                        "".join(span.text for span in line.spans) for line in block.lines
                    ),
                )
                for block in extracted.blocks
                if block.type == 0
            )
            pages.append(
                PageStructure(
                    index=page.number, width=page.rect.width, height=page.rect.height, blocks=blocks
                )
            )
        return tuple(pages)
