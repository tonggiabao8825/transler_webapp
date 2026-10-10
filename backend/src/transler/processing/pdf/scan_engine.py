"""PaddleOCR/OpenCV connector owns scanned-page restoration and typesetting."""

import base64
import html
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, cast

import cv2
import numpy as np
import pymupdf

from transler.core.contracts import Contract
from transler.core.errors import TranslerError
from transler.processing.ocr.paddle_connector import PaddleConnector
from transler.processing.pdf.pdf_ir import BoundingBox, PageIR, Point, TextRegion, TextStyle
from transler.processing.pdf.scan_layout import (
    Image,
    OCRUnit,
    estimate_font_size,
    glyph_mask,
    group_units,
    table_cells,
    table_rules,
)
from transler.processing.translation.translation_gateway import TranslationConnector
from transler.processing.typography import font_archive, text_css


def rectangle_box(rect: pymupdf.Rect) -> BoundingBox:
    return BoundingBox(x0=rect.x0, y0=rect.y0, x1=rect.x1, y1=rect.y1)


def region_ir(
    unit: OCRUnit,
    index: int,
    page_index: int,
    width: float,
    height: float,
    pixel_width: int,
    pixel_height: int,
    mask: Image,
    cells: tuple[tuple[int, int, int, int], ...],
) -> TextRegion:
    scale = width / pixel_width
    vertical_scale = height / pixel_height
    box = unit.box if unit.cell_index is None else cells[unit.cell_index]
    bbox = BoundingBox(
        x0=box[0] * scale, y0=box[1] * vertical_scale, x1=box[2] * scale, y1=box[3] * vertical_scale
    )
    return TextRegion(
        id=f"p{page_index}-r{index}",
        page_index=page_index,
        source_text=unit.text,
        translated_text=None,
        bbox=bbox,
        polygon=(
            Point(x=bbox.x0, y=bbox.y0),
            Point(x=bbox.x1, y=bbox.y0),
            Point(x=bbox.x1, y=bbox.y1),
            Point(x=bbox.x0, y=bbox.y1),
        ),
        source_polygons=tuple(
            tuple(Point(x=x * scale, y=y * vertical_scale) for x, y in polygon)
            for polygon in unit.polygons
        ),
        layout_bbox=None,
        rendered_font_size=None,
        baseline=None,
        rotation=0,
        region_type="paragraph" if unit.cell_index is None else "table_cell",
        reading_order=index,
        confidence=unit.confidence,
        style=TextStyle(
            font_family="Noto Sans",
            font_size=estimate_font_size(unit, mask, vertical_scale),
            color=(0, 0, 0),
            provenance="estimated",
        ),
        linked_region_ids=(),
    )


class Composition(Contract):
    rect: tuple[float, float, float, float]
    html: str
    css: str
    scale_low: float


def region_composition(
    region: TextRegion, image: Image, width: float, height: float
) -> Composition:
    if region.translated_text is None:
        raise ValueError(f"Scan region {region.id} has no translation.")
    bbox = region.bbox
    rect = pymupdf.Rect(bbox.x0, bbox.y0, bbox.x1, bbox.y1)
    if region.region_type == "paragraph":
        pixel_scale = image.shape[1] / width
        x0, x1 = max(0, int(rect.x0 * pixel_scale)), min(image.shape[1], int(rect.x1 * pixel_scale))
        bottom = min(image.shape[0], int((rect.y1 + 6) * pixel_scale))
        start = int(rect.y1 * pixel_scale) + 2
        for row in range(start, bottom):
            if np.mean(image[row, x0:x1] < 180) > 0.01:
                bottom = row
                break
        rect.y0 = max(0, rect.y0 - 2)
        rect.y1 = max(rect.y1, bottom / pixel_scale)
        rect.x0 = max(0, rect.x0 - 1)
        rect.x1 = min(width, rect.x1 + 2)
    size = region.style.font_size
    if rect.y1 > height or rect.x1 > width or rect.y0 < 0 or rect.x0 < 0:
        raise TranslerError(
            "SCAN_INVALID_GEOMETRY", f"Region {region.id} exceeds the page boundary.", 502
        )
    return Composition(
        rect=(rect.x0, rect.y0, rect.x1, rect.y1),
        html="<div>" + html.escape(region.translated_text) + "</div>",
        css=text_css(size, 1.15),
        scale_low=max(0.7, 8 / size),
    )


class ScanPreparation(Contract):
    source: bytes
    background_png: bytes
    ir: PageIR


class ScanEngine:
    def __init__(self, source_language: str) -> None:
        self.ocr = PaddleConnector(source_language, 180)

    def recognize_page(self, source: bytes, page_index: int) -> ScanPreparation:
        with pymupdf.open(stream=source, filetype="pdf") as document:
            if document.page_count != 1:
                raise ValueError(
                    "Scan Engine requires one page with an explicit source-page index."
                )
            page = document[0]
            rotation = cast(Literal[0, 90, 180, 270], page.rotation)
            page.set_rotation(0)
            if page.rect.width * page.rect.height * (300 / 72) ** 2 > 25_000_000:
                raise TranslerError(
                    "SCAN_RENDER_LIMIT", "Scan page exceeds the 25-megapixel rendering limit.", 422
                )
            pixmap = page.get_pixmap(dpi=300, colorspace=pymupdf.csRGB, alpha=False)
            image = np.frombuffer(pixmap.samples, np.uint8).reshape(pixmap.height, pixmap.width, 3)
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
            if float(np.mean(gray > 225)) < 0.7:
                raise TranslerError(
                    "SCAN_BACKGROUND_REVIEW_REQUIRED",
                    f"Page {page_index + 1} is outside the white-background Scan Engine scope.",
                    422,
                )
            prediction = self.ocr.predict(image)
            rules = table_rules(image)
            cells = table_cells(rules)
            units = group_units(prediction, cells)
            if not units:
                raise TranslerError(
                    "SCAN_NO_TEXT",
                    f"PaddleOCR found no readable text on page {page_index + 1}.",
                    422,
                )
            for unit in units:
                for polygon in unit.polygons:
                    x0 = max(0, int(min(point[0] for point in polygon)) - 6)
                    y0 = max(0, int(min(point[1] for point in polygon)) - 6)
                    x1 = min(image.shape[1], int(max(point[0] for point in polygon)) + 6)
                    y1 = min(image.shape[0], int(max(point[1] for point in polygon)) + 6)
                    if float(np.mean(gray[y0:y1, x0:x1] > 225)) < 0.55:
                        raise TranslerError(
                            "SCAN_REGION_BACKGROUND_REVIEW_REQUIRED",
                            f"Page {page_index + 1} has text on a complex background; "
                            "restoration requires review.",
                            422,
                        )
            mask = glyph_mask(image, prediction, rules)
            restored = cast(Image, cv2.inpaint(image, mask, 3, cv2.INPAINT_TELEA))
            encoded, background = cv2.imencode(".png", cv2.cvtColor(restored, cv2.COLOR_RGB2BGR))
            mask_encoded, mask_png = cv2.imencode(".png", mask)
            if not encoded or not mask_encoded:
                raise TranslerError(
                    "SCAN_ENCODING_FAILED",
                    "OpenCV could not encode the restored scan or text mask.",
                    502,
                )
            regions = tuple(
                region_ir(
                    unit,
                    index,
                    page_index,
                    page.rect.width,
                    page.rect.height,
                    image.shape[1],
                    image.shape[0],
                    mask,
                    cells,
                )
                for index, unit in enumerate(units)
            )
            ir = PageIR(
                page_index=page_index,
                width=page.rect.width,
                height=page.rect.height,
                rotation=rotation,
                crop_box=rectangle_box(page.cropbox),
                media_box=rectangle_box(page.mediabox),
                coordinate_system="unrotated_pdf_points_top_left",
                render_dpi=300,
                source_mask_png_base64=base64.b64encode(mask_png.tobytes()).decode(),
                regions=regions,
            )
            return ScanPreparation(source=source, background_png=background.tobytes(), ir=ir)

    def close(self) -> None:
        self.ocr.close()


def compose_scan_page(
    preparation: ScanPreparation, connector: TranslationConnector
) -> tuple[bytes, PageIR]:
    background = cv2.imdecode(np.frombuffer(preparation.background_png, np.uint8), cv2.IMREAD_COLOR)
    if background is None:
        raise TranslerError(
            "SCAN_ENCODING_FAILED", "The restored scan image could not be decoded.", 502
        )
    restored = cast(Image, cv2.cvtColor(background, cv2.COLOR_BGR2RGB))
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="scan-translation")
    try:
        translations = executor.map(
            connector.translate, (region.source_text for region in preparation.ir.regions)
        )
        translated = tuple(
            region.model_copy(update={"translated_text": text})
            for region, text in zip(preparation.ir.regions, translations, strict=True)
        )
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
    with pymupdf.open(stream=preparation.source, filetype="pdf") as document:
        page = document[0]
        page.set_rotation(0)
        empty = document.get_new_xref()
        document.update_object(empty, "<<>>")
        document.update_stream(empty, b"")
        page.set_contents(empty)
        page.insert_image(page.rect, stream=preparation.background_png)
        composed: list[TextRegion] = []
        for region in translated:
            composition = region_composition(region, restored, page.rect.width, page.rect.height)
            remaining, scale = page.insert_htmlbox(
                pymupdf.Rect(composition.rect),
                composition.html,
                css=composition.css,
                archive=font_archive(),
                scale_low=composition.scale_low,
            )
            if remaining < 0:
                raise TranslerError(
                    "SCAN_TEXT_FIT_REVIEW_REQUIRED",
                    f"Translated region {region.id} does not fit rect={composition.rect} "
                    f"with estimated font={region.style.font_size:.2f}pt and minimum=8pt. "
                    "Review this paragraph or table cell before exporting.",
                    422,
                )
            composed.append(
                region.model_copy(
                    update={
                        "layout_bbox": rectangle_box(pymupdf.Rect(composition.rect)),
                        "rendered_font_size": region.style.font_size * scale,
                    }
                )
            )
        ir = preparation.ir.model_copy(update={"regions": tuple(composed)})
        page.set_rotation(ir.rotation)
        page.clean_contents(sanitize=True)
        document.subset_fonts()
        return cast(bytes, document.tobytes(deflate=True, garbage=4)), ir
