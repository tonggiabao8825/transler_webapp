"""Embedded Noto Sans faces keep Latin, Vietnamese and Cyrillic text consistent."""

from pathlib import Path

import pymupdf

from transler.core.errors import TranslerError


def font_archive() -> pymupdf.Archive:
    directory = Path(__file__).with_name("fonts")
    missing = tuple(
        name
        for name in (
            "NotoSans-Regular.ttf",
            "NotoSans-Bold.ttf",
            "NotoSans-Italic.ttf",
            "NotoSans-BoldItalic.ttf",
        )
        if not (directory / name).is_file()
    )
    if missing:
        raise TranslerError(
            "PDF_FONT_MISSING",
            f"PDF font resources are missing from {directory}: {', '.join(missing)}. "
            "Rebuild the backend package with its bundled fonts.",
            500,
        )
    return pymupdf.Archive(str(directory))


def text_css(font_size: float, line_height: float) -> str:
    faces = "".join(
        f"@font-face {{font-family:TranslerSans;src:url(NotoSans-{face}.ttf);"
        f"font-weight:{weight};font-style:{style};}}"
        for face, weight, style in (
            ("Regular", "normal", "normal"),
            ("Bold", "bold", "normal"),
            ("Italic", "normal", "italic"),
            ("BoldItalic", "bold", "italic"),
        )
    )
    return (
        faces
        + f"* {{font-family:TranslerSans;font-size:{font_size}pt;color:#000;"
        + f"line-height:{line_height};margin:0;padding:0;}}"
    )
