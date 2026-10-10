"""Job-scoped OCR subprocess connector with bounded initialization and page deadlines."""

import os
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2

from transler.core.errors import TranslerError
from transler.processing.ocr.ocr_models import recognition_model
from transler.processing.pdf.scan_layout import Image, OCRPrediction


class PaddleConnector:
    def __init__(self, source_language: str, timeout_seconds: int) -> None:
        recognition_model(source_language)
        self.timeout_seconds = timeout_seconds
        self.temporary = TemporaryDirectory(prefix="transler-ocr-")
        self.directory = Path(self.temporary.name)
        self.requests = 0
        self.log = (self.directory / "diagnostics.log").open("wb")
        env = {
            key: value
            for key, value in os.environ.items()
            if key
            in {
                "PATH",
                "HOME",
                "LANG",
                "LC_ALL",
                "TMPDIR",
                "PADDLE_PDX_CACHE_HOME",
                "PADDLE_PDX_MODEL_SOURCE",
                "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK",
                "OMP_NUM_THREADS",
                "OPENBLAS_NUM_THREADS",
            }
        }
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "transler.processing.ocr.paddle_runner",
                "--directory",
                str(self.directory),
                "--source-language",
                source_language,
            ],
            stdin=subprocess.PIPE,
            stdout=self.log,
            stderr=self.log,
            env=env,
        )
        try:
            self.await_file(self.directory / "ready")
        except TranslerError:
            self.close()
            raise

    def await_file(self, path: Path) -> None:
        deadline = time.monotonic() + self.timeout_seconds
        while not path.is_file():
            if self.process.poll() is not None:
                raise TranslerError(
                    "PADDLE_OCR_FAILED",
                    f"PaddleOCR exited {self.process.returncode} while waiting for {path.name}: "
                    + (self.directory / "diagnostics.log").read_text(errors="replace")[-4000:],
                    502,
                )
            if time.monotonic() >= deadline:
                raise TranslerError(
                    "PADDLE_OCR_TIMEOUT",
                    f"PaddleOCR exceeded {self.timeout_seconds}s while waiting for {path.name}.",
                    502,
                )
            time.sleep(0.1)

    def predict(self, image: Image) -> OCRPrediction:
        index = self.requests
        input_file = self.directory / f"input-{index}.png"
        if not cv2.imwrite(str(input_file), cv2.cvtColor(image, cv2.COLOR_RGB2BGR)):
            raise TranslerError(
                "SCAN_ENCODING_FAILED", "Could not encode the PaddleOCR input page.", 502
            )
        if self.process.stdin is None:
            raise TranslerError("PADDLE_OCR_FAILED", "PaddleOCR request pipe is unavailable.", 502)
        self.process.stdin.write(f"{index}\n".encode())
        self.process.stdin.flush()
        output = self.directory / f"result-{index}.json"
        self.await_file(output)
        prediction = OCRPrediction.model_validate_json(output.read_bytes())
        input_file.unlink()
        output.unlink()
        self.requests += 1
        return prediction

    def close(self) -> None:
        if self.process.stdin is not None:
            self.process.stdin.close()
        if self.process.poll() is None:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
        self.log.close()
        self.temporary.cleanup()
