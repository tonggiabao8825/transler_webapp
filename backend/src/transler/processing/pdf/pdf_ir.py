"""Versioned Scan Engine geometry; native engine internals remain adapter-owned."""

from typing import Literal

from pydantic import Field, model_validator

from transler.core.contracts import Contract


class Point(Contract):
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)


class BoundingBox(Contract):
    x0: float = Field(allow_inf_nan=False)
    y0: float = Field(allow_inf_nan=False)
    x1: float = Field(allow_inf_nan=False)
    y1: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_area(self) -> "BoundingBox":
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError("Region bounding boxes must have positive width and height.")
        return self


class TextStyle(Contract):
    font_family: str | None
    font_size: float = Field(gt=0, allow_inf_nan=False)
    color: tuple[int, int, int]
    provenance: Literal["estimated"]


class TextRegion(Contract):
    id: str = Field(min_length=1)
    page_index: int = Field(ge=0)
    source_text: str = Field(min_length=1)
    translated_text: str | None
    bbox: BoundingBox
    polygon: tuple[Point, ...] = Field(min_length=4)
    source_polygons: tuple[tuple[Point, Point, Point, Point], ...]
    layout_bbox: BoundingBox | None
    rendered_font_size: float | None = Field(gt=0, allow_inf_nan=False)
    baseline: tuple[Point, Point] | None
    rotation: float = Field(allow_inf_nan=False)
    region_type: Literal["paragraph", "table_cell"]
    reading_order: int = Field(ge=0)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    style: TextStyle
    linked_region_ids: tuple[str, ...]


class PageIR(Contract):
    page_index: int = Field(ge=0)
    width: float = Field(gt=0, allow_inf_nan=False)
    height: float = Field(gt=0, allow_inf_nan=False)
    rotation: Literal[0, 90, 180, 270]
    crop_box: BoundingBox
    media_box: BoundingBox
    coordinate_system: Literal["unrotated_pdf_points_top_left"]
    render_dpi: int = Field(gt=0)
    source_mask_png_base64: str
    regions: tuple[TextRegion, ...]

    @model_validator(mode="after")
    def validate_regions(self) -> "PageIR":
        identifiers = tuple(region.id for region in self.regions)
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("Scan IR region IDs must be unique within the page.")
        for region in self.regions:
            if region.page_index != self.page_index:
                raise ValueError(f"Region {region.id} references a different page.")
            if any(link not in identifiers for link in region.linked_region_ids):
                raise ValueError(f"Region {region.id} references a missing linked region.")
        return self


class PageClassification(Contract):
    page_index: int
    kind: Literal["native", "scanned", "blank"]


class PDFManifest(Contract):
    schema_version: Literal[1]
    source_checksum: str
    translation_checksum: str
    native_engine: Literal["babeldoc-0.6.4"]
    scan_engine: Literal["paddleocr-3.3.2-opencv-4.10"]
    pages: tuple[PageClassification, ...]
    scan_pages: tuple[PageIR, ...]
