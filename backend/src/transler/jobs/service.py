"""Execute one durable job and persist cancellation or failure at the task boundary."""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import update

from transler.core.config import Settings
from transler.core.contracts import JobStatus
from transler.core.errors import JobCancelledError
from transler.infrastructure.db import (
    connect_database,
    jobs,
)
from transler.infrastructure.storage import ObjectStorage
from transler.jobs.execution import execute_job
from transler.jobs.lifecycle import claim_job, record_failure
from transler.jobs.usage import release_usage


def perform_job(settings: Settings, job_id: UUID) -> None:
    engine = connect_database(settings)
    try:
        job = claim_job(engine, job_id)
        if job is None:
            return
        structlog.get_logger().info(
            "job_execution_started", job_id=str(job.id), run_token=str(job.run_token), kind=job.kind
        )
        try:
            execute_job(engine, ObjectStorage(settings), settings, job)
        except JobCancelledError:
            with engine.begin() as connection:
                cancelled = connection.scalar(
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
                    .returning(jobs.c.id)
                )
                if cancelled is not None:
                    release_usage(connection, job.id)
        except Exception as error:
            # Persist the root cause at the task boundary, then re-raise for Celery diagnostics.
            record_failure(engine, job, error)
            raise
    finally:
        engine.dispose()
