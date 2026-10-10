"""Find runnable durable jobs without publishing broker messages."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select

from transler.core.config import Settings
from transler.core.contracts import JobStatus
from transler.infrastructure.db import (
    connect_database,
    jobs,
)


def pending_jobs(settings: Settings) -> tuple[UUID, ...]:
    engine = connect_database(settings)
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
        return pending
    finally:
        engine.dispose()
