"""Durable dispatch and leased job execution; PostgreSQL is the source of truth.

The database-backed dispatcher closes the commit-to-broker gap without a second
outbox table. Duplicated Celery deliveries are safe because every execution must
claim a lease and all updates are fenced by a unique run token. A checkpoint is
the cumulative translated PDF, so retries preserve already translated pages.
"""

import base64
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import PurePosixPath
from uuid import UUID, uuid4

import pymupdf
import structlog
from celery import Celery
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import TypeAdapter
from sqlalchemy import and_, delete, insert, or_, select, update
from sqlalchemy.engine import Engine

from transler.config import Settings
from transler.contracts import BasicProvider, JobError, JobRecord, JobStatus
from transler.db import (
    accounts,
    artifacts,
    connect_database,
    document_revisions,
    documents,
    jobs,
    sessions,
    shared_artifacts,
    usage_ledger,
)
from transler.engine import PDFMathTranslate
from transler.errors import EngineError, JobCancelledError, TranslerError
from transler.formats import analyze_file
from transler.pdf import inspect_output, validate_checkpoint
from transler.processing_contracts import ProcessingOptions, ToolOptions
from transler.processing_engine import ProcessingEngine
from transler.services import owned_artifact, owned_document
from transler.storage import ObjectStorage
from transler.usage import release_usage

configuration = Settings()
celery = Celery("transler", broker=configuration.redis_url)
celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=3,
    task_publish_retry_policy={
        "max_retries": 3,
        "interval_start": 1,
        "interval_step": 1,
        "interval_max": 3,
    },
    task_serializer="json",
    accept_content=["json"],
    beat_schedule={
        "dispatch-durable-jobs": {"task": "transler.dispatch", "schedule": 5.0},
        "expire-guest-data": {"task": "transler.expire", "schedule": 3600.0},
    },
)


def claim_job(engine: Engine, job_id: UUID) -> JobRecord | None:
    now = datetime.now(UTC)
    with engine.begin() as connection:
        row = (
            connection.execute(
                select(jobs)
                .where(
                    jobs.c.id == job_id,
                )
                .with_for_update(skip_locked=True)
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return None
        job = JobRecord.model_validate(row)
        if job.status == JobStatus.CANCELLING:
            if job.lease_until is None or job.lease_until < now:
                connection.execute(
                    update(jobs)
                    .where(jobs.c.id == job_id)
                    .values(
                        status=JobStatus.CANCELLED,
                        stage="Cancelled",
                        finished_at=now,
                        lease_until=None,
                    )
                )
                release_usage(connection, job_id)
            return None
        if job.status not in {JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.PROCESSING}:
            return None
        if (
            job.status == JobStatus.PROCESSING
            and job.lease_until is not None
            and job.lease_until > now
        ):
            return None
        if (
            job.status == JobStatus.RETRYING
            and job.lease_until is not None
            and job.lease_until > now
        ):
            return None
        if job.attempt_count >= job.max_attempts:
            connection.execute(
                update(jobs)
                .where(jobs.c.id == job_id)
                .values(
                    status=JobStatus.FAILED,
                    stage="Failed",
                    finished_at=now,
                    lease_until=None,
                    error=JobError(
                        code="RETRY_LIMIT", message="Worker recovery exhausted three attempts."
                    ).model_dump(),
                )
            )
            release_usage(connection, job_id)
            return None
        row = (
            connection.execute(
                update(jobs)
                .where(jobs.c.id == job_id)
                .values(
                    status=JobStatus.PROCESSING,
                    stage="Preparing document",
                    attempt_count=job.attempt_count + 1,
                    run_token=uuid4(),
                    error=None,
                    started_at=job.started_at if job.started_at is not None else now,
                    lease_until=now + timedelta(seconds=60),
                )
                .returning(*jobs.c)
            )
            .mappings()
            .one()
        )
        return JobRecord.model_validate(row)


def heartbeat(engine: Engine, job: JobRecord) -> None:
    with engine.begin() as connection:
        current = connection.scalar(
            update(jobs)
            .where(
                jobs.c.id == job.id,
                jobs.c.run_token == job.run_token,
                jobs.c.status == JobStatus.PROCESSING,
            )
            .values(lease_until=datetime.now(UTC) + timedelta(seconds=60))
            .returning(jobs.c.id)
        )
        if current is None:
            raise JobCancelledError(f"Job {job.id} was cancelled or the worker lease was replaced.")


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
        storage.put(key, translated)
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
                    progress=round(completed / job.total_units * 90),
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

    if job.kind == "pdf_basic":
        adapter = PDFMathTranslate(
            settings.engine_timeout_seconds,
            TypeAdapter(BasicProvider).validate_python(job.provider),
        )
        current = adapter.translate_document(
            original,
            current,
            job.completed_pages,
            job.total_units,
            job.source_language,
            job.target_language,
            checkpoint_page,
            lambda: heartbeat(engine, job),
        )
        suffix, mime_type = "pdf", "application/pdf"
    else:
        if options is None:
            raise ValueError("Processing job options are missing.")
        if job.llm_model is None:
            raise ValueError("Processing job must snapshot its LLM model.")
        runner_settings = settings.model_copy(update={"llm_model": job.llm_model})
        current, suffix, mime_type = ProcessingEngine(runner_settings).run(
            original,
            PurePosixPath(source_artifact.filename).suffix[1:].lower(),
            options,
            current if job.checkpoint_key is not None else None,
            job.completed_pages,
            extras,
            job.translation_cache,
            checkpoint_cache,
            checkpoint_page,
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
    storage.put(output_key, current)
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


def record_failure(engine: Engine, job: JobRecord, error: Exception) -> None:
    retryable = isinstance(error, EngineError) and job.attempt_count < job.max_attempts
    code = error.code if isinstance(error, TranslerError) else type(error).__name__
    with engine.begin() as connection:
        connection.execute(
            update(jobs)
            .where(
                jobs.c.id == job.id,
                jobs.c.run_token == job.run_token,
                jobs.c.status == JobStatus.PROCESSING,
            )
            .values(
                status=JobStatus.RETRYING if retryable else JobStatus.FAILED,
                stage="Retry scheduled" if retryable else "Failed",
                error=JobError(code=code, message=str(error)).model_dump(),
                finished_at=None if retryable else datetime.now(UTC),
                lease_until=datetime.now(UTC) + timedelta(seconds=10) if retryable else None,
            )
        )
        if not retryable:
            release_usage(connection, job.id)
    structlog.get_logger().warning(
        "job_attempt_failed",
        job_id=str(job.id),
        attempt=job.attempt_count,
        retry_scheduled=retryable,
        error_code=code,
        error=str(error),
    )


def perform_job(settings: Settings, job_id: UUID) -> None:
    engine = connect_database(settings)
    try:
        job = claim_job(engine, job_id)
        if job is None:
            return
        try:
            execute_job(engine, ObjectStorage(settings), settings, job)
        except JobCancelledError:
            with engine.begin() as connection:
                connection.execute(
                    update(jobs)
                    .where(
                        jobs.c.id == job.id,
                        jobs.c.run_token == job.run_token,
                        jobs.c.status == JobStatus.CANCELLING,
                    )
                    .values(
                        status=JobStatus.CANCELLED,
                        stage="Cancelled",
                        finished_at=datetime.now(UTC),
                        lease_until=None,
                    )
                )
                release_usage(connection, job.id)
        except Exception as error:
            # Persist the root cause at the task boundary, then re-raise for Celery diagnostics.
            record_failure(engine, job, error)
            raise
    finally:
        engine.dispose()


@celery.task(name="transler.execute")
def run_job(job_id: str) -> None:
    perform_job(Settings(), UUID(job_id))


@celery.task(name="transler.dispatch")
def dispatch() -> None:
    engine = connect_database(Settings())
    try:
        now = datetime.now(UTC)
        with engine.connect() as connection:
            pending: tuple[UUID, ...] = tuple(
                connection.scalars(
                    select(jobs.c.id)
                    .where(
                        or_(
                            jobs.c.status == JobStatus.QUEUED,
                            and_(
                                jobs.c.status.in_(["PROCESSING", "RETRYING", "CANCELLING"]),
                                or_(jobs.c.lease_until < now, jobs.c.lease_until.is_(None)),
                            ),
                        )
                    )
                    .order_by(jobs.c.created_at)
                    .limit(100)
                )
            )
        for job_id in pending:
            run_job.apply_async(args=(str(job_id),), queue="pdf")
    finally:
        engine.dispose()


@celery.task(name="transler.expire")
def expire_guest_data() -> None:
    settings = Settings()
    engine, storage = connect_database(settings), ObjectStorage(settings)
    try:
        with engine.begin() as connection:
            owners: tuple[UUID, ...] = tuple(
                connection.scalars(
                    select(sessions.c.id)
                    .where(
                        sessions.c.expires_at < datetime.now(UTC),
                        ~sessions.c.id.in_(select(accounts.c.workspace_id)),
                    )
                    .with_for_update(skip_locked=True)
                )
            )
            for owner in owners:
                connection.execute(
                    update(jobs)
                    .where(jobs.c.owner_id == owner)
                    .values(
                        status=JobStatus.CANCELLED,
                        run_token=None,
                        lease_until=None,
                    )
                )
                connection.execute(
                    delete(shared_artifacts).where(shared_artifacts.c.owner_id == owner)
                )
                storage.delete_prefix(f"{owner}/")
                connection.execute(
                    delete(document_revisions).where(
                        document_revisions.c.document_id.in_(
                            select(documents.c.id).where(documents.c.owner_id == owner)
                        )
                    )
                )
                connection.execute(delete(jobs).where(jobs.c.owner_id == owner))
                connection.execute(delete(artifacts).where(artifacts.c.owner_id == owner))
                connection.execute(delete(documents).where(documents.c.owner_id == owner))
                connection.execute(delete(usage_ledger).where(usage_ledger.c.owner_id == owner))
                connection.execute(delete(sessions).where(sessions.c.id == owner))
    finally:
        engine.dispose()
