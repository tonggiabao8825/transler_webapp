"""Processing subprocess boundary with deadlines, worker leases and page checkpoints."""

import json
import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory

import structlog
from pydantic import TypeAdapter

from transler.core.config import Settings
from transler.core.errors import EngineError, TranslerError
from transler.processing.engine import stop_process
from transler.processing.pdf.pdf_ir import PDFManifest
from transler.processing.processing_contracts import (
    ProcessingOptions,
    RunnerError,
    RunnerRequest,
    RunnerResult,
)
from transler.processing.progress import ProcessingProgress


class ProcessingEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def run(
        self,
        source: bytes,
        source_format: str,
        options: ProcessingOptions,
        checkpoint: bytes | None,
        start_page: int,
        extras: tuple[bytes, ...],
        cached: dict[str, str],
        manifest: PDFManifest | None,
        on_cache: Callable[[dict[str, str]], None],
        on_manifest: Callable[[PDFManifest], None],
        on_page: Callable[[int, bytes], None],
        on_progress: Callable[[ProcessingProgress], None],
        heartbeat: Callable[[], None],
    ) -> tuple[bytes, str, str]:
        with TemporaryDirectory(prefix="transler-operation-") as temporary:
            directory = Path(temporary)
            (directory / "source").write_bytes(source)
            (directory / "cache.json").write_text(json.dumps(cached))
            if manifest is not None:
                (directory / "manifest.json").write_text(manifest.model_dump_json())
            (directory / "request.json").write_text(
                RunnerRequest(
                    source_format=source_format, options=options, start_page=start_page
                ).model_dump_json()
            )
            if checkpoint is not None:
                (directory / "checkpoint.pdf").write_bytes(checkpoint)
            for index, content in enumerate(extras):
                (directory / f"extra-{index}.pdf").write_bytes(content)
            llm = self.settings
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
                    "TESSDATA_PREFIX",
                    "AZURE_ENDPOINT",
                    "AZURE_API_KEY",
                    "AZURE_REGION",
                    "DEEPL_AUTH_KEY",
                    "GOOGLE_TRANSLATE_API_KEY",
                    "PADDLE_PDX_CACHE_HOME",
                    "PADDLE_PDX_MODEL_SOURCE",
                    "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK",
                    "OMP_NUM_THREADS",
                    "OPENBLAS_NUM_THREADS",
                }
            }
            env.update(
                {
                    "PYTHONUNBUFFERED": "1",
                    "API_PROVIDER": llm.api_provider,
                    "LLM_MODEL": llm.llm_model,
                    "LLM_BASE_URL": llm.llm_base_url,
                }
            )
            if llm.llm_api_key is not None:
                env["LLM_API_KEY"] = llm.llm_api_key.get_secret_value()
            with (directory / "diagnostics.log").open("wb") as log:
                process = subprocess.Popen(
                    [sys.executable, "-m", "transler.processing.processing_runner", str(directory)],
                    stdin=subprocess.PIPE,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                    env=env,
                )
                deadline = time.monotonic() + self.settings.engine_timeout_seconds
                completed = start_page
                next_heartbeat = 0.0
                progress: ProcessingProgress | None = None
                log_offset = 0
                logger = structlog.get_logger().bind(
                    process_id=process.pid, directory=directory.name
                )
                try:
                    while not (directory / "done.json").is_file():
                        with (directory / "diagnostics.log").open("rb") as diagnostics:
                            diagnostics.seek(log_offset)
                            output = diagnostics.read(65536)
                            log_offset = diagnostics.tell()
                        if output:
                            logger.info(
                                "processing_diagnostics", output=output.decode(errors="replace")
                            )
                        progress_file = directory / "progress.json"
                        if progress_file.is_file():
                            latest_progress = ProcessingProgress.model_validate_json(
                                progress_file.read_bytes()
                            )
                            if latest_progress != progress:
                                on_progress(latest_progress)
                                progress = latest_progress
                                logger.info(
                                    "processing_progress",
                                    stage=progress.stage,
                                    percent=progress.percent,
                                    current=progress.current,
                                    total=progress.total,
                                )
                        if time.monotonic() >= next_heartbeat:
                            heartbeat()
                            next_heartbeat = time.monotonic() + 5
                        latest_cache = TypeAdapter(dict[str, str]).validate_json(
                            (directory / "cache.json").read_bytes()
                        )
                        if latest_cache != cached:
                            on_cache(latest_cache)
                            cached = dict(latest_cache)
                        page = directory / f"page-{completed + 1}.pdf"
                        if page.is_file():
                            manifest_file = directory / "manifest.json"
                            if manifest_file.is_file():
                                manifest = PDFManifest.model_validate_json(
                                    manifest_file.read_bytes()
                                )
                                on_manifest(manifest)
                            on_page(completed + 1, page.read_bytes())
                            completed += 1
                            if process.stdin is None:
                                raise EngineError(
                                    "Processing checkpoint acknowledgement pipe is unavailable."
                                )
                            process.stdin.write(f"{completed}\n".encode())
                            process.stdin.flush()
                            page.unlink()
                        if process.poll() is not None:
                            if not (directory / "done.json").is_file():
                                if (directory / "error.json").is_file():
                                    failure = RunnerError.model_validate_json(
                                        (directory / "error.json").read_bytes()
                                    )
                                    raise TranslerError(
                                        failure.code, failure.message, failure.status
                                    )
                                raise EngineError(
                                    f"Processing worker exited {process.returncode}: "
                                    + (directory / "diagnostics.log").read_text(errors="replace")[
                                        -4000:
                                    ]
                                )
                            break
                        if time.monotonic() > deadline:
                            raise TranslerError(
                                "PROCESSING_TIMEOUT",
                                f"Processing exceeded {self.settings.engine_timeout_seconds}s; "
                                f"last stage={progress.stage if progress else 'Starting engine'}. "
                                "Reduce the document size or configure "
                                "TRANSLER_ENGINE_TIMEOUT_SECONDS "
                                "for the available CPU resources. Diagnostics: "
                                + (directory / "diagnostics.log").read_text(errors="replace")[
                                    -4000:
                                ],
                                504,
                            )
                        time.sleep(0.1)
                    process.wait(timeout=5)
                    if process.returncode != 0:
                        raise EngineError(
                            f"Processing worker exited {process.returncode} "
                            "after writing its result: "
                            + (directory / "diagnostics.log").read_text(errors="replace")[-4000:]
                        )
                    latest_cache = TypeAdapter(dict[str, str]).validate_json(
                        (directory / "cache.json").read_bytes()
                    )
                    if latest_cache != cached:
                        on_cache(latest_cache)
                    result = RunnerResult.model_validate_json(
                        (directory / "done.json").read_bytes()
                    )
                    return (directory / "result").read_bytes(), result.suffix, result.mime_type
                finally:
                    stop_process(process)
