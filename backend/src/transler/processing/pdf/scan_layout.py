"""Pure OCR line grouping and glyph masks for white-background text and ruled tables."""

from typing import cast

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import Field, model_validator

from transler.core.contracts import Contract
from transler.core.errors import TranslerError

Image = NDArray[np.uint8]
Polygon = tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]]
PixelBox = tuple[int, int, int, int]


class OCRPrediction(Contract):
    rec_texts: tuple[str, ...]
    rec_scores: tuple[float, ...]
    rec_polys: tuple[Polygon, ...]

    @model_validator(mode="after")
    def validate_alignment(self) -> "OCRPrediction":
        if len(self.rec_texts) != len(self.rec_scores) or len(self.rec_texts) != len(
            self.rec_polys
        ):
            raise ValueError(
                "PaddleOCR text, confidence and polygon arrays have different lengths."
            )
        return self


class OCRUnit(Contract):
    text: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    box: PixelBox
    polygons: tuple[Polygon, ...]
    cell_index: int | None


def polygon_box(polygon: Polygon) -> PixelBox:
    return (
        int(min(point[0] for point in polygon)),
        int(min(point[1] for point in polygon)),
        int(np.ceil(max(point[0] for point in polygon))),
        int(np.ceil(max(point[1] for point in polygon))),
    )


def table_rules(image: Image) -> Image:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    horizontal = cv2.morphologyEx(
        ink,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (max(40, image.shape[1] // 30), 1)),
    )
    vertical = cv2.morphologyEx(
        ink,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(40, image.shape[0] // 30))),
    )
    return cast(Image, cv2.bitwise_or(horizontal, vertical))


def table_cells(rules: Image) -> tuple[PixelBox, ...]:
    contours, hierarchy = cv2.findContours(rules, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return ()
    cells: list[PixelBox] = []
    for index, contour in enumerate(contours):
        if hierarchy[0][index][3] < 0:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        if width > 30 and height > 20:
            cells.append((x + 3, y + 3, x + width - 3, y + height - 3))
    return tuple(sorted(cells, key=lambda box: (box[1], box[0])))


def merge_units(left: OCRUnit, right: OCRUnit) -> OCRUnit:
    return OCRUnit(
        text=left.text + " " + right.text,
        confidence=min(left.confidence, right.confidence),
        box=(
            min(left.box[0], right.box[0]),
            min(left.box[1], right.box[1]),
            max(left.box[2], right.box[2]),
            max(left.box[3], right.box[3]),
        ),
        polygons=left.polygons + right.polygons,
        cell_index=left.cell_index,
    )


def group_units(prediction: OCRPrediction, cells: tuple[PixelBox, ...]) -> tuple[OCRUnit, ...]:
    lines: list[OCRUnit] = []
    for text, confidence, polygon in zip(
        prediction.rec_texts, prediction.rec_scores, prediction.rec_polys, strict=True
    ):
        if not text.strip():
            continue
        if confidence < 0.85:
            raise TranslerError(
                "SCAN_OCR_REVIEW_REQUIRED",
                f"OCR confidence {confidence:.3f} is below 0.85 for text {text[:80]!r}. "
                "Upload a clearer scan or review the source region.",
                422,
            )
        box = polygon_box(polygon)
        if box[2] <= box[0] or box[3] <= box[1]:
            raise TranslerError(
                "SCAN_INVALID_GEOMETRY", "PaddleOCR returned a zero-area text polygon.", 502
            )
        if abs(polygon[1][1] - polygon[0][1]) > (box[2] - box[0]) * 0.035:
            raise TranslerError(
                "SCAN_ROTATION_REVIEW_REQUIRED", "Deskew the scanned text before translating.", 422
            )
        center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
        cell_index = next(
            (
                index
                for index, cell in enumerate(cells)
                if cell[0] < center[0] < cell[2] and cell[1] < center[1] < cell[3]
            ),
            None,
        )
        lines.append(
            OCRUnit(
                text=text,
                confidence=confidence,
                box=box,
                polygons=(polygon,),
                cell_index=cell_index,
            )
        )
    grouped: list[OCRUnit] = []
    for line in sorted(lines, key=lambda item: (item.box[1], item.box[0])):
        matching = next(
            (
                index
                for index, unit in enumerate(grouped)
                if (line.cell_index is not None and line.cell_index == unit.cell_index)
                or (
                    line.cell_index is None
                    and unit.cell_index is None
                    and 0 < line.box[1] - unit.box[3] < (line.box[3] - line.box[1]) * 0.9
                    and abs(line.box[0] - unit.box[0]) < (line.box[3] - line.box[1])
                    and line.box[0] < unit.box[2]
                    and line.box[2] > unit.box[0]
                )
            ),
            None,
        )
        if matching is None:
            grouped.append(line)
        else:
            grouped[matching] = merge_units(grouped[matching], line)
    return tuple(
        sorted(
            grouped,
            key=lambda unit: (
                (cells[unit.cell_index][1], cells[unit.cell_index][0])
                if unit.cell_index is not None
                else (unit.box[1], unit.box[0])
            ),
        )
    )


def estimate_font_size(unit: OCRUnit, mask: Image, point_scale: float) -> float:
    x0, y0, x1, y1 = unit.box
    _count, _labels, stats, _centers = cv2.connectedComponentsWithStats(
        mask[y0:y1, x0:x1], connectivity=8
    )
    heights = tuple(
        int(stat[cv2.CC_STAT_HEIGHT])
        for stat in stats[1:]
        if stat[cv2.CC_STAT_AREA] >= 8 and stat[cv2.CC_STAT_HEIGHT] >= 4
    )
    if not heights:
        raise TranslerError(
            "SCAN_STYLE_REVIEW_REQUIRED",
            "OCR region contains no measurable glyphs for typesetting.",
            422,
        )
    return max(8, float(np.quantile(heights, 0.85)) * point_scale * 1.3)


def glyph_mask(image: Image, prediction: OCRPrediction, rules: Image) -> Image:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    polygons = tuple(np.array(polygon, dtype=np.int32) for polygon in prediction.rec_polys)
    regions = np.zeros(gray.shape, dtype=np.uint8)
    cv2.fillPoly(regions, polygons, (255,))
    ink = cv2.threshold(gray, 245, 255, cv2.THRESH_BINARY_INV)[1]
    expanded = cv2.dilate(cv2.bitwise_and(ink, regions), np.ones((5, 5), dtype=np.uint8))
    protected = cv2.dilate(rules, np.ones((3, 3), dtype=np.uint8))
    return cast(Image, cv2.bitwise_and(expanded, cv2.bitwise_not(protected)))
