"""Subprocess connector with deadline, cooperative cancellation and process-group cleanup."""

import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory

from transler.contracts import BasicProvider
from transler.errors import EngineError


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)


class PDFMathTranslate:
    def __init__(self, timeout_seconds: int, provider: BasicProvider) -> None:
        self.timeout_seconds = timeout_seconds
        self.provider = provider

    def translate_document(
        self,
        original: bytes,
        checkpoint: bytes,
        start_page: int,
        page_count: int,
        source_language: str,
        target_language: str,
        on_page: Callable[[int, bytes], None],
        heartbeat: Callable[[], None],
    ) -> bytes:
        with TemporaryDirectory(prefix="transler-") as temporary:
            directory = Path(temporary)
            source = directory / "source.pdf"
            current = directory / "checkpoint.pdf"
            diagnostics = directory / "engine.log"
            source.write_bytes(original)
            current.write_bytes(checkpoint)
            result = checkpoint
            with diagnostics.open("wb") as log:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "transler.engine_runner",
                        "--provider",
                        self.provider,
                        "--original",
                        str(source),
                        "--checkpoint",
                        str(current),
                        "--output-directory",
                        str(directory),
                        "--start-page",
                        str(start_page),
                        "--source-language",
                        source_language,
                        "--target-language",
                        target_language,
                    ],
                    stdin=subprocess.PIPE,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                    env={
                        key: value
                        for key, value in os.environ.items()
                        if key
                        in {
                            "PATH",
                            "HOME",
                            "LANG",
                            "LC_ALL",
                            "TMPDIR",
                            "HTTP_PROXY",
                            "HTTPS_PROXY",
                            "NO_PROXY",
                            "SSL_CERT_FILE",
                            "REQUESTS_CA_BUNDLE",
                            "AZURE_ENDPOINT",
                            "AZURE_API_KEY",
                            "DEEPL_AUTH_KEY",
                        }
                    },
                )
                deadline = time.monotonic() + self.timeout_seconds
                completed = start_page
                try:
                    while completed < page_count:
                        heartbeat()
                        if time.monotonic() >= deadline:
                            raise EngineError(
                                f"PDFMathTranslate job exceeded {self.timeout_seconds}s at page "
                                f"{completed + 1} ({source_language} → {target_language}). "
                                f"Diagnostics: {diagnostics.read_text(errors='replace')[-4000:]}",
                            )
                        output = directory / f"page-{completed + 1}.pdf"
                        if output.is_file():
                            result = output.read_bytes()
                            on_page(completed + 1, result)
                            output.unlink()
                            if process.stdin is None:
                                raise EngineError(
                                    "Translation acknowledgement pipe is unavailable."
                                )
                            process.stdin.write(f"{completed + 1}\n".encode())
                            process.stdin.flush()
                            completed += 1
                            continue
                        if process.poll() is not None:
                            raise EngineError(
                                f"PDFMathTranslate exited {process.returncode} before page "
                                f"{completed + 1}. Diagnostics: "
                                f"{diagnostics.read_text(errors='replace')[-4000:]}",
                            )
                        try:
                            process.wait(timeout=0.5)
                        except subprocess.TimeoutExpired:
                            continue
                    process.wait(timeout=10)
                    if process.returncode != 0:
                        raise EngineError(
                            f"PDFMathTranslate exited {process.returncode}: "
                            f"{diagnostics.read_text(errors='replace')[-4000:]}",
                        )
                    heartbeat()
                finally:
                    stop_process(process)
                    if process.stdin is not None:
                        process.stdin.close()
            return result
