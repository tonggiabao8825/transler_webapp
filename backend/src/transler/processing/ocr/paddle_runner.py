"""Isolated Paddle runtime avoids native-library ABI collisions with PDF engines."""

import argparse
import sys
from pathlib import Path

import cv2
from paddleocr import PaddleOCR

from transler.processing.ocr.ocr_models import recognition_model
from transler.processing.pdf.scan_layout import OCRPrediction


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--source-language", required=True)
    arguments = parser.parse_args()
    directory: Path = arguments.directory
    ocr = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name=recognition_model(arguments.source_language),
        device="cpu",
        cpu_threads=2,
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_det_limit_side_len=1280,
        text_det_limit_type="max",
        text_recognition_batch_size=4,
    )
    try:
        (directory / "ready").touch()
        for request in sys.stdin:
            index = int(request.strip())
            if index < 0:
                raise ValueError("OCR request index must be non-negative.")
            image = cv2.imread(str(directory / f"input-{index}.png"))
            if image is None:
                raise ValueError(f"PaddleOCR input image {index} could not be decoded.")
            predictions = tuple(ocr.predict(image))
            if len(predictions) != 1:
                raise ValueError("PaddleOCR must return exactly one prediction per rendered page.")
            prediction = OCRPrediction.model_validate(predictions[0].json["res"])
            temporary = directory / "result.tmp"
            temporary.write_text(prediction.model_dump_json())
            temporary.replace(directory / f"result-{index}.json")
    finally:
        ocr.close()


if __name__ == "__main__":
    main()
