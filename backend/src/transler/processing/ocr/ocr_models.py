"""Explicit recognition models for the pinned PaddleOCR version."""

from transler.core.errors import TranslerError


def recognition_model(source_language: str) -> str:
    if source_language == "auto":
        raise TranslerError(
            "SCAN_SOURCE_LANGUAGE_REQUIRED",
            "Select the source language explicitly for scanned PDFs "
            "so PaddleOCR uses the correct recognition model.",
            422,
        )
    models = {
        "en": "en_PP-OCRv5_mobile_rec",
        "vi": "latin_PP-OCRv5_mobile_rec",
        "fr": "latin_PP-OCRv5_mobile_rec",
        "de": "latin_PP-OCRv5_mobile_rec",
        "es": "latin_PP-OCRv5_mobile_rec",
        "pt": "latin_PP-OCRv5_mobile_rec",
        "zh": "PP-OCRv5_server_rec",
        "ja": "PP-OCRv5_server_rec",
        "ko": "korean_PP-OCRv5_mobile_rec",
        "ru": "eslav_PP-OCRv5_mobile_rec",
    }
    if source_language not in models:
        raise TranslerError(
            "SCAN_LANGUAGE_NOT_SUPPORTED", f"No OCR model is configured for {source_language}.", 422
        )
    return models[source_language]
