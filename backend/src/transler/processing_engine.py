"""Processing subprocess boundary with deadlines, worker leases and page checkpoints."""

import json
import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import TypeAdapter

from transler.config import Settings
from transler.engine import stop_process
from transler.errors import EngineError, TranslerError
from transler.processing_contracts import (
    ProcessingOptions,
    RunnerError,
    RunnerRequest,
    RunnerResult,
)


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
        on_cache: Callable[[dict[str, str]], None],
        on_page: Callable[[int, bytes], None],
        heartbeat: Callable[[], None],
    ) -> tuple[bytes, str, str]:
        with TemporaryDirectory(prefix="transler-operation-") as temporary:
            directory = Path(temporary)
            (directory / "source").write_bytes(source)
            (directory / "cache.json").write_text(json.dumps(cached))
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
                if key in {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TESSDATA_PREFIX"}
            }
            env.update(
                {
                    "API_PROVIDER": llm.api_provider,
                    "LLM_MODEL": llm.llm_model,
                    "LLM_BASE_URL": llm.llm_base_url,
                }
            )
            if llm.llm_api_key is not None:
                env["LLM_API_KEY"] = llm.llm_api_key.get_secret_value()
            with (directory / "diagnostics.log").open("wb") as log:
                process = subprocess.Popen(
                    [sys.executable, "-m", "transler.processing_runner", str(directory)],
                    stdin=subprocess.PIPE,
                    stdout=log,
                    stderr=log,
                    start_new_session=True,
                    env=env,
                )
                deadline = time.monotonic() + self.settings.engine_timeout_seconds
                completed = start_page
                try:
                    while not (directory / "done.json").is_file():
                        heartbeat()
                        latest_cache = TypeAdapter(dict[str, str]).validate_json(
                            (directory / "cache.json").read_bytes()
                        )
                        if latest_cache != cached:
                            on_cache(latest_cache)
                            cached = dict(latest_cache)
                        page = directory / f"page-{completed + 1}.pdf"
                        if page.is_file():
                            on_page(completed + 1, page.read_bytes())
                            completed += 1
                            if process.stdin is None:
                                raise EngineError(
                                    "Processing checkpoint acknowledgement pipe is unavailable."
                                )
                            process.stdin.write(f"{completed}\n".encode())
                            process.stdin.flush()
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
                            raise EngineError(
                                "Processing operation exceeded "
                                f"{self.settings.engine_timeout_seconds} seconds."
                            )
                        time.sleep(0.5)
                    process.wait(timeout=5)
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
