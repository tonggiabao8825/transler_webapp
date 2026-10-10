"""Pinned BabelDOC connector; one full-document invocation preserves native context."""

from ast import literal_eval
from pathlib import Path
from threading import Lock
from typing import cast

import onnxruntime
import pymupdf
from babeldoc.assets.assets import (
    EMBEDDING_FONT_METADATA,
    get_doclayout_onnx_model_path,
    get_font_and_metadata,
)
from babeldoc.docvision.doclayout import OnnxModel
from babeldoc.format.pdf.document_il.backend.pdf_creater import parse_tounicode_cmap
from babeldoc.format.pdf.high_level import do_translate, get_translation_stage
from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
from babeldoc.progress_monitor import ProgressMonitor
from pydantic import Field, TypeAdapter

from transler.core.contracts import Contract
from transler.core.errors import TranslerError
from transler.processing.progress import ProcessingProgress, write_progress
from transler.processing.translation.bing import ProviderExhaustedError
from transler.processing.translation.translation_gateway import (
    TranslationConnector,
    validate_pdf_tokens,
)


class LayoutMetadata(Contract):
    stride: int = Field(gt=0)
    names: dict[int, str] = Field(min_length=1)


class NativeLayoutModel(OnnxModel):  # type: ignore[misc]
    """Load the pinned vendor model once with the worker's CPU thread budget."""

    def __init__(self, model_path: str) -> None:
        self.model_path = model_path
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        self.model = onnxruntime.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        metadata = self.model.get_modelmeta().custom_metadata_map
        layout = LayoutMetadata.model_validate(
            {"stride": literal_eval(metadata["stride"]), "names": literal_eval(metadata["names"])}
        )
        self._stride = layout.stride
        self._names = layout.names
        self.lock = Lock()


class NativeProgress(Contract):
    stage: str
    stage_current: int = Field(ge=0)
    stage_total: int = Field(ge=0)
    overall_progress: float = Field(ge=0, le=100, allow_inf_nan=False)


class NativeTranslationBridge:
    """Keep vendor error suppression from publishing a partly untranslated result."""

    def __init__(self, connector: TranslationConnector, source: str, target: str) -> None:
        self.connector = connector
        self.lang_in = source
        self.lang_out = target
        self.name = "transler"
        self.model = "gateway"
        self.lock = Lock()
        self.failure: ProviderExhaustedError | None = None

    def translate(self, text: str, **parameters: object) -> str:
        try:
            return validate_pdf_tokens(text, self.connector.translate(text))
        except (OSError, ValueError) as error:
            failure = ProviderExhaustedError(str(error))
            with self.lock:
                self.failure = failure
            raise failure from error
        except ProviderExhaustedError as error:
            with self.lock:
                self.failure = error
            raise

    def do_llm_translate(self, text: str | None, **parameters: object) -> str:
        raise NotImplementedError("The gateway accepts translation units, not vendor prompts.")

    def get_formular_placeholder(self, identifier: int | str) -> tuple[str, str]:
        return f"{{v{identifier}}}", rf"\{{v{identifier}\}}"

    def get_rich_text_left_placeholder(self, identifier: int | str) -> tuple[str, str]:
        return f"<b{identifier}>", f"<b{identifier}>"

    def get_rich_text_right_placeholder(self, identifier: int | str) -> tuple[str, str]:
        return f"</b{identifier}>", f"</b{identifier}>"

    def raise_failure(self) -> None:
        with self.lock:
            failure = self.failure
        if failure is not None:
            raise failure


def translate_native(
    source_file: Path,
    pages: tuple[int, ...],
    source: str,
    target: str,
    connector: TranslationConnector,
    directory: Path,
) -> bytes:
    if not pages:
        raise ValueError("BabelDOC requires at least one selected native page.")
    bridge = NativeTranslationBridge(connector, source, target)
    model = NativeLayoutModel(str(get_doclayout_onnx_model_path()))
    config = TranslationConfig(
        translator=bridge,
        input_file=source_file,
        lang_in=source,
        lang_out=target,
        doc_layout_model=model,
        pages=",".join(str(index + 1) for index in pages),
        output_dir=directory / "native-output",
        working_dir=directory / "native-work",
        no_dual=True,
        no_mono=False,
        watermark_output_mode=WatermarkOutputMode.NoWatermark,
        only_include_translated_page=False,
        skip_scanned_detection=True,
        ocr_workaround=False,
        auto_enable_ocr_workaround=False,
        auto_extract_glossary=False,
        save_auto_extracted_glossary=False,
        use_rich_pbar=False,
        pool_max_workers=4,
        qps=4,
        min_text_length=1,
        disable_same_text_fallback=True,
        primary_font_family="sans-serif",
    )
    progress_lock = Lock()

    def report_progress(**parameters: object) -> None:
        if parameters.get("type") not in {"progress_start", "progress_update", "progress_end"}:
            return
        event = NativeProgress.model_validate(parameters)
        with progress_lock:
            write_progress(
                directory,
                ProcessingProgress(
                    stage=f"BabelDOC: {event.stage}",
                    percent=5 + round(event.overall_progress * 0.7),
                    current=event.stage_current,
                    total=event.stage_total,
                ),
            )

    with ProgressMonitor(
        get_translation_stage(config), progress_change_callback=report_progress, report_interval=1
    ) as monitor:
        result = do_translate(monitor, config)
    bridge.raise_failure()
    output = cast(Path | None, result.mono_pdf_path)
    if output is None or not output.is_file():
        raise TranslerError(
            "BABELDOC_OUTPUT_MISSING", "BabelDOC did not produce a monolingual PDF.", 502
        )
    return restore_native_spaces(output.read_bytes(), pages)


def restore_native_spaces(content: bytes, pages: tuple[int, ...]) -> bytes:
    """Restore space mappings discarded by BabelDOC's outline-based font subsetting."""
    with pymupdf.open(stream=content, filetype="pdf") as document:
        font_xrefs: set[int] = set()
        space_glyphs: dict[str, int] = {}
        for index in pages:
            page = document[index]
            for xref, _extension, _type, _base, filename, encoding in page.get_fonts():
                if xref in font_xrefs or filename not in EMBEDDING_FONT_METADATA:
                    continue
                font_xrefs.add(xref)
                reference = document.xref_get_key(xref, "ToUnicode")
                descendant = document.xref_get_key(xref, "DescendantFonts")
                if reference[0] != "xref" or descendant[0] != "array" or encoding != "Identity-H":
                    raise TranslerError(
                        "BABELDOC_FONT_MAPPING_INVALID",
                        f"Vendor font {filename} requires an Identity-H font and ToUnicode map.",
                        502,
                    )
                descendant_xref = int(descendant[1].strip("[] ").split()[0])
                # PDF's omitted CIDToGIDMap defaults to Identity for CIDFontType2.
                if document.xref_get_key(descendant_xref, "CIDToGIDMap") not in {
                    ("name", "/Identity"),
                    ("null", "null"),
                }:
                    raise TranslerError(
                        "BABELDOC_FONT_MAPPING_INVALID",
                        f"Vendor font {filename} requires an identity CID-to-glyph mapping.",
                        502,
                    )
                if filename not in space_glyphs:
                    font_path, _metadata = get_font_and_metadata(filename)
                    font = pymupdf.Font(fontfile=str(font_path))
                    space_glyphs[filename] = int(font.has_glyph(32))
                glyph = space_glyphs[filename]
                if not glyph:
                    raise TranslerError(
                        "BABELDOC_FONT_MAPPING_INVALID",
                        f"Vendor font {filename} has no space glyph.",
                        502,
                    )
                cmap_xref = int(reference[1].split()[0])
                cmap = document.xref_stream(cmap_xref)
                mappings = TypeAdapter(dict[int, int]).validate_python(parse_tounicode_cmap(cmap))
                if glyph in mappings:
                    continue
                if cmap.count(b"endcmap") != 1:
                    raise TranslerError(
                        "BABELDOC_FONT_MAPPING_INVALID",
                        f"Vendor font {filename} has an invalid CMap.",
                        502,
                    )
                mapping = f"1 beginbfchar\n<{glyph:04x}><0020>\nendbfchar\nendcmap".encode()
                document.update_stream(cmap_xref, cmap.replace(b"endcmap", mapping))
        return cast(bytes, document.tobytes(deflate=True, garbage=3))
