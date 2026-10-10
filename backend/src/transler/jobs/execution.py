"""Run owned processing inputs and publish fenced checkpoints and artifacts."""

import base64
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import PurePosixPath
from uuid import UUID, uuid4

import pymupdf
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import TypeAdapter
from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import Engine

from transler.core.config import Settings
from transler.core.contracts import BasicProvider, JobRecord, JobStatus
from transler.core.errors import JobCancelledError, TranslerError
from transler.infrastructure.db import (
    artifacts,
    jobs,
    usage_ledger,
)
from transler.infrastructure.storage import ObjectStorage
from transler.jobs.lifecycle import heartbeat
from transler.jobs.services import owned_artifact, owned_document
from transler.processing.operations.formats import analyze_file
from transler.processing.pdf.pdf import inspect_output, validate_checkpoint
from transler.processing.pdf.pdf_ir import PDFManifest
from transler.processing.processing_contracts import BasicOptions, ProcessingOptions, ToolOptions
from transler.processing.processing_engine import ProcessingEngine
from transler.processing.progress import ProcessingProgress


def execute_job(engine: Engine, storage: ObjectStorage, settings: Settings, job: JobRecord) -> None:
    with engine.connect() as connection:
        document = owned_document(connection, job.owner_id, job.document_id)
        source_artifact = owned_artifact(
            connection, job.owner_id, job.input_artifact_id or document.artifact_id
        )
        options = (
            TypeAdapter(ProcessingOptions).validate_python(
                connection.scalar(select(jobs.c.options).where(jobs.c.id == job.id))
            )
            if job.kind != "pdf_basic"
            else None
        )
        if isinstance(options, ToolOptions) and options.password:
            encrypted = base64.b64decode(options.password, validate=True)
            password = (
                AESGCM(bytes.fromhex(settings.settings_key.get_secret_value()))
                .decrypt(encrypted[:12], encrypted[28:] + encrypted[12:28], None)
                .decode()
            )
            options = options.model_copy(update={"password": password})
        extras = (
            tuple(
                storage.get(owned_artifact(connection, job.owner_id, UUID(id)).storage_key)
                for id in options.artifact_ids
            )
            if isinstance(options, ToolOptions)
            else ()
        )
    original = storage.get(source_artifact.storage_key)
    current = original if job.checkpoint_key is None else storage.get(job.checkpoint_key)

    def checkpoint_page(completed: int, translated: bytes) -> None:
        validate_checkpoint(original, translated, completed)
        key = (
            f"{job.owner_id}/{job.document_id}/checkpoints/{job.id}/{job.run_token}-{completed}.pdf"
        )
        storage.put(key, translated, "application/pdf")
        with engine.begin() as connection:
            previous = connection.execute(
                select(jobs.c.checkpoint_key)
                .where(
                    jobs.c.id == job.id,
                    jobs.c.run_token == job.run_token,
                    jobs.c.status == JobStatus.PROCESSING,
                )
                .with_for_update()
            ).one_or_none()
            if previous is None:
                storage.delete((key,))
                raise JobCancelledError(f"Job {job.id} cancelled before checkpoint commit.")
            connection.execute(
                update(jobs)
                .where(jobs.c.id == job.id)
                .values(
                    completed_pages=completed,
                    checkpoint_key=key,
                    stage=f"Translated {completed} of {job.total_units} pages",
                    progress=func.greatest(
                        jobs.c.progress, round(completed / job.total_units * 90)
                    ),
                    lease_until=datetime.now(UTC) + timedelta(seconds=60),
                )
            )
        if previous.checkpoint_key is not None:
            storage.delete((previous.checkpoint_key,))

    def checkpoint_cache(cache: dict[str, str]) -> None:
        with engine.begin() as connection:
            saved = connection.scalar(
                update(jobs)
                .where(
                    jobs.c.id == job.id,
                    jobs.c.run_token == job.run_token,
                    jobs.c.status == JobStatus.PROCESSING,
                )
                .values(translation_cache=cache)
                .returning(jobs.c.id)
            )
            if saved is None:
                raise JobCancelledError(f"Job {job.id} cancelled before translation cache commit.")

    def checkpoint_manifest(manifest: PDFManifest) -> None:
        key = f"{job.owner_id}/{job.document_id}/pipelines/{job.id}/{job.run_token}.json"
        storage.put(key, manifest.model_dump_json().encode(), "application/json")
        with engine.begin() as connection:
            previous = connection.execute(
                select(jobs.c.pipeline_manifest_key)
                .where(
                    jobs.c.id == job.id,
                    jobs.c.run_token == job.run_token,
                    jobs.c.status == JobStatus.PROCESSING,
                )
                .with_for_update()
            ).one_or_none()
            if previous is None:
                storage.delete((key,))
                raise JobCancelledError(f"Job {job.id} cancelled before pipeline manifest commit.")
            connection.execute(
                update(jobs).where(jobs.c.id == job.id).values(pipeline_manifest_key=key)
            )
        if previous.pipeline_manifest_key is not None and previous.pipeline_manifest_key != key:
            storage.delete((previous.pipeline_manifest_key,))

    def report_progress(progress: ProcessingProgress) -> None:
        with engine.begin() as connection:
            saved = connection.scalar(
                update(jobs)
                .where(
                    jobs.c.id == job.id,
                    jobs.c.run_token == job.run_token,
                    jobs.c.status == JobStatus.PROCESSING,
                )
                .values(
                    stage=progress.stage, progress=func.greatest(jobs.c.progress, progress.percent)
                )
                .returning(jobs.c.id)
            )
            if saved is None:
                raise JobCancelledError(f"Job {job.id} cancelled before progress publication.")

    if job.kind == "pdf_basic":
        options = BasicOptions(
            type="pdf_basic",
            provider=TypeAdapter(BasicProvider).validate_python(job.provider),
            source_language=job.source_language,
            target_language=job.target_language,
        )
    if options is None:
        raise ValueError("Processing job options are missing.")
    if job.kind != "pdf_basic" and job.llm_model is None:
        raise ValueError("Processing job must snapshot its LLM model.")
    manifest = (
        PDFManifest.model_validate_json(storage.get(job.pipeline_manifest_key))
        if job.pipeline_manifest_key is not None
        else None
    )
    if job.kind in {"pdf_basic", "advanced"} and job.completed_pages and manifest is None:
        raise TranslerError(
            "PDF_CHECKPOINT_INCOMPATIBLE",
            "This partial checkpoint was created by the retired PDF engine. "
            "Start a new translation job.",
            409,
        )
    runner_settings = (
        settings.model_copy(update={"llm_model": job.llm_model})
        if job.llm_model is not None
        else settings
    )
    current, suffix, mime_type = ProcessingEngine(runner_settings).run(
        original,
        PurePosixPath(source_artifact.filename).suffix[1:].lower(),
        options,
        current if job.checkpoint_key is not None else None,
        job.completed_pages,
        extras,
        job.translation_cache,
        manifest,
        checkpoint_cache,
        checkpoint_manifest,
        checkpoint_page,
        report_progress,
        lambda: heartbeat(engine, job),
    )
    heartbeat(engine, job)
    with engine.begin() as connection:
        connection.execute(
            update(jobs)
            .where(
                jobs.c.id == job.id,
                jobs.c.run_token == job.run_token,
                jobs.c.status == JobStatus.PROCESSING,
            )
            .values(stage="Validating translated PDF", progress=95)
        )
    report = inspect_output(original, current) if job.kind in {"pdf_basic", "advanced"} else None
    if suffix == "pdf":
        with pymupdf.open(stream=current, filetype="pdf") as output:
            if output.is_encrypted:
                if not isinstance(options, ToolOptions) or not options.password:
                    raise ValueError("Encrypted output requires its protection password.")
                if not output.authenticate(options.password):
                    raise ValueError("Output PDF password verification failed.")
            output_units = output.page_count
    elif suffix == "zip":
        output_units = source_artifact.units
    else:
        output_units = analyze_file(current, "result." + suffix).page_count
    artifact_id = uuid4()
    output_key = f"{job.owner_id}/{job.document_id}/results/{artifact_id}.{suffix}"
    storage.put(output_key, current, mime_type)
    with engine.begin() as connection:
        row = connection.execute(
            select(jobs.c.status, jobs.c.run_token)
            .where(
                jobs.c.id == job.id,
            )
            .with_for_update()
        ).one_or_none()
        if row is None or row.status != JobStatus.PROCESSING or row.run_token != job.run_token:
            storage.delete((output_key,))
            raise JobCancelledError(f"Job {job.id} cancelled before completion.")
        connection.execute(
            insert(artifacts).values(
                id=artifact_id,
                owner_id=job.owner_id,
                document_id=job.document_id,
                storage_key=output_key,
                filename=(
                    f"{PurePosixPath(document.filename).stem} "
                    f"({job.kind}-{job.target_language}).{suffix}"
                ),
                mime_type=mime_type,
                units=output_units,
                size=len(current),
                checksum=sha256(current).hexdigest(),
            )
        )
        connection.execute(
            update(jobs)
            .where(jobs.c.id == job.id)
            .values(
                status=JobStatus.COMPLETED,
                stage="Completed",
                progress=100,
                artifact_id=artifact_id,
                quality_report=report.model_dump(mode="json") if report is not None else None,
                finished_at=datetime.now(UTC),
                lease_until=None,
            )
        )

        connection.execute(
            update(usage_ledger).where(usage_ledger.c.job_id == job.id).values(status="CONSUMED")
        )
