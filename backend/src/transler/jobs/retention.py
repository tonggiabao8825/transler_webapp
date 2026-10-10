"""Delete expired guest workspaces after revoking processing leases."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, update

from transler.core.config import Settings
from transler.core.contracts import JobStatus
from transler.infrastructure.db import (
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
from transler.infrastructure.storage import ObjectStorage


def expire_guest_data(settings: Settings) -> None:
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
