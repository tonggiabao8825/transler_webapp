"""PDFMathTranslate vendor interface over one source page; never rasterize export.

The pinned engine exposes its converter/interpreter interfaces but no translator
injection in translate_stream. This adapter uses those interfaces directly so
Bing's truncating text adapter is replaced without patching vendor/global state.
"""

import io
from typing import Protocol, cast

import numpy as np
import onnxruntime
import pymupdf
from numpy.typing import NDArray
from pdf2zh.converter import TranslateConverter
from pdf2zh.doclayout import OnnxModel
from pdf2zh.high_level import download_remote_fonts
from pdf2zh.pdfinterp import PDFPageInterpreterEx
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser
from pydantic import TypeAdapter

from transler.bing import BingTranslation
from transler.contracts import BasicProvider
from transler.llm import LLMTranslation


class TranslationPage(Protocol):
    pageno: int
    page_xref: int


class ModelBox(Protocol):
    xyxy: NDArray[np.float32]
    cls: float


class ModelPrediction(Protocol):
    boxes: list[ModelBox]
    names: dict[int, str]


class LayoutModel(Protocol):
    def predict(self, image: NDArray[np.uint8], imgsz: int) -> list[ModelPrediction]: ...


def page_layout(page: pymupdf.Page, model: LayoutModel) -> NDArray[np.float64]:
    pixmap = page.get_pixmap(colorspace=pymupdf.csRGB, alpha=False)
    image = np.frombuffer(pixmap.samples, np.uint8).reshape(pixmap.height, pixmap.width, 3)
    predictions = model.predict(image[:, :, ::-1], imgsz=max(32, pixmap.height // 32 * 32))
    if len(predictions) != 1:
        raise ValueError("Layout model must return exactly one prediction for a PDF page.")
    prediction = predictions[0]
    names = TypeAdapter(dict[int, str]).validate_python(prediction.names)
    mask = np.ones((pixmap.height, pixmap.width), dtype=np.float64)
    protected = {"abandon", "figure", "table", "isolate_formula", "formula_caption"}
    regions: list[tuple[int, int, int, int, int]] = []
    coordinates = TypeAdapter(tuple[float, float, float, float])
    for index, box in enumerate(prediction.boxes):
        x0, y0, x1, y1 = coordinates.validate_python(box.xyxy.tolist())
        category = names[int(box.cls)]
        value = 0 if category in protected else index + 2
        regions.append(
            (
                max(0, int(x0 - 1)),
                max(0, int(pixmap.height - y1 - 1)),
                min(pixmap.width - 1, int(x1 + 1)),
                min(pixmap.height - 1, int(pixmap.height - y0 + 1)),
                value,
            )
        )
    for x0, y0, x1, y1, value in sorted(regions, key=lambda region: region[4] == 0):
        mask[y0:y1, x0:x1] = value
    return mask


class PDFLayout:
    """Connector owning the layout model, target font, and job-scoped text session."""

    def __init__(
        self,
        provider: BasicProvider,
        source_language: str,
        target_language: str,
        translator: LLMTranslation | None,
    ) -> None:
        self.provider = provider
        self.source_language = source_language
        self.target_language = target_language
        model = OnnxModel.from_pretrained()
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
        model.model = onnxruntime.InferenceSession(
            model.model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.model = cast(LayoutModel, model)
        self.font_path = str(download_remote_fonts(target_language))
        self.font = pymupdf.Font("noto", fontfile=self.font_path)
        self.bing = (
            translator
            if translator is not None
            else (BingTranslation(source_language, target_language) if provider == "bing" else None)
        )

    def translate_page(self, source: bytes) -> bytes:
        with pymupdf.open(stream=source, filetype="pdf") as document:
            if document.page_count != 1:
                raise ValueError("Layout adapter requires exactly one source page.")
            fonts = {
                "tiro": document[0].insert_font(fontname="tiro"),
                "noto": document[0].insert_font(fontname="noto", fontfile=self.font_path),
            }
            for xref in range(1, document.xref_length()):
                for prefix in ("Resources/", ""):
                    kind, value = document.xref_get_key(xref, f"{prefix}Font")
                    target, path = xref, f"{prefix}Font/"
                    if kind == "xref":
                        target, path = int(value.split()[0]), ""
                    elif kind != "dict":
                        continue
                    for name, font_xref in fonts.items():
                        if document.xref_get_key(target, f"{path}{name}")[0] == "null":
                            document.xref_set_key(target, f"{path}{name}", f"{font_xref} 0 R")
            stream = document.tobytes()
            manager = PDFResourceManager()
            layout = {0: page_layout(document[0], self.model)}
            converter = TranslateConverter(
                manager,
                "",
                "",
                4,
                layout,
                self.source_language,
                self.target_language,
                self.provider,
                "noto",
                self.font,
                {},
                None,
                True,
            )
            if self.bing is not None:
                converter.translator = self.bing
            patches: dict[int, str] = {}
            interpreter = PDFPageInterpreterEx(manager, converter, patches)
            parsed = PDFDocument(PDFParser(io.BytesIO(stream)))
            page = cast(TranslationPage, next(PDFPage.create_pages(parsed)))
            page.pageno = 0
            page.page_xref = document.get_new_xref()
            document.update_object(page.page_xref, "<<>>")
            document.update_stream(page.page_xref, b"")
            document[0].set_contents(page.page_xref)
            try:
                interpreter.process_page(page)
            finally:
                converter.close()
            for xref, operations in patches.items():
                document.update_stream(xref, operations.encode())
            document.subset_fonts(fallback=False)
            return cast(bytes, document.tobytes(deflate=True, garbage=3))

    def close(self) -> None:
        if self.bing is not None:
            self.bing.close()
