"""Atomic subprocess progress messages, separate from durable PDF checkpoints."""

from pathlib import Path

from pydantic import Field

from transler.core.contracts import Contract


class ProcessingProgress(Contract):
    stage: str = Field(min_length=1, max_length=64)
    percent: int = Field(ge=0, le=90)
    current: int = Field(ge=0)
    total: int = Field(ge=0)


def write_progress(directory: Path, progress: ProcessingProgress) -> None:
    temporary = directory / "progress.tmp"
    temporary.write_text(progress.model_dump_json())
    temporary.replace(directory / "progress.json")
