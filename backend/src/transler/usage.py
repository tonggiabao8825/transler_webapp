"""Terminal job reservations are released atomically with fenced worker writes."""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.engine import Connection

from transler.db import jobs, usage_ledger


def release_usage(connection: Connection, job_id: UUID) -> None:
    connection.execute(
        update(usage_ledger)
        .where(
            usage_ledger.c.job_id == job_id,
            usage_ledger.c.job_id.in_(
                select(jobs.c.id).where(
                    jobs.c.id == job_id, jobs.c.status.in_(("FAILED", "CANCELLED"))
                )
            ),
        )
        .values(status="RELEASED")
    )
