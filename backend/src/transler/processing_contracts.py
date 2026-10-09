"""Validated operation contracts shared with the Node processing API."""

from typing import Annotated, Literal

from pydantic import Field

from transler.contracts import Contract, Language, SourceLanguage


class GlossaryTerm(Contract):
    source: str
    target: str


class AdvancedOptions(Contract):
    type: Literal["advanced"]
    source_language: SourceLanguage
    target_language: Language
    domain: str
    custom_instructions: str
    glossary: tuple[GlossaryTerm, ...]


class ConversionOptions(Contract):
    type: Literal["conversion"]
    target_format: Literal["pdf", "docx", "pptx", "xlsx", "png", "jpg", "html", "txt", "md"]


class FormatOptions(Contract):
    type: Literal["format_translation"]
    source_language: SourceLanguage
    target_language: Language
    domain: str
    custom_instructions: str
    glossary: tuple[GlossaryTerm, ...]


class EditOperation(Contract):
    type: Literal[
        "replace_text",
        "add_text",
        "delete_text",
        "move_block",
        "resize_block",
        "crop_page",
        "rotate_page",
        "delete_page",
        "reorder_pages",
        "add_annotation",
        "retranslate_region",
    ]
    page: int
    rect: tuple[float, float, float, float] | None
    destination: tuple[float, float, float, float] | None
    text: str | None
    font_size: float | None
    angle: int | None
    order: tuple[int, ...] | None
    target_language: Language | None
    source_language: SourceLanguage | None


class EditOptions(Contract):
    type: Literal["edit"]
    base_revision: int
    operations: tuple[EditOperation, ...]


class OCROptions(Contract):
    type: Literal["ocr"]
    language: str


class ToolOptions(Contract):
    type: Literal["pdf_tool"]
    tool: Literal["merge", "split", "compress", "protect", "unlock"]
    artifact_ids: tuple[str, ...]
    pages: tuple[int, ...]
    password: str | None


class BasicOptions(Contract):
    type: Literal["pdf_basic"] = "pdf_basic"


ProcessingOptions = Annotated[
    AdvancedOptions
    | ConversionOptions
    | FormatOptions
    | EditOptions
    | OCROptions
    | ToolOptions
    | BasicOptions,
    Field(discriminator="type"),
]


class RunnerRequest(Contract):
    source_format: str
    options: ProcessingOptions
    start_page: int


class RunnerResult(Contract):
    suffix: str
    mime_type: str


class RunnerError(Contract):
    code: str
    message: str
    status: int
