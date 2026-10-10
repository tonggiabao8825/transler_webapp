"""Transactional job claims, leases and failure state transitions."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import structlog
from sqlalchemy import select, update
from sqlalchemy.engine import Engine

from transler.core.contracts import JobError, JobRecord, JobStatus
from transler.core.errors import EngineError, JobCancelledError, TranslerError
from transler.infrastructure.db import (
    jobs,
)
from transler.jobs.usage import release_usage


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


def record_failure(engine: Engine, job: JobRecord, error: Exception) -> None:
    retryable = isinstance(error, EngineError) and job.attempt_count < job.max_attempts
    code = error.code if isinstance(error, TranslerError) else type(error).__name__
    with engine.begin() as connection:
        saved = connection.scalar(
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
            .returning(jobs.c.id)
        )
        if saved is not None and not retryable:
            release_usage(connection, job.id)
    structlog.get_logger().warning(
        "job_attempt_failed",
        job_id=str(job.id),
        attempt=job.attempt_count,
        retry_scheduled=retryable,
        error_code=code,
        error=str(error),
    )
