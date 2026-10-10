"""Typed worker queries for immutable source documents and private artifacts."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.engine import Connection

from transler.core.contracts import ArtifactRecord, DocumentView, JobRecord
from transler.core.errors import TranslerError
from transler.infrastructure.db import artifacts, documents, jobs


def owned_document(connection: Connection, owner: UUID, document_id: UUID) -> DocumentView:
    row = (
        connection.execute(
            select(documents).where(
                documents.c.id == document_id,
                documents.c.owner_id == owner,
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise TranslerError("DOCUMENT_NOT_FOUND", "Document does not exist in this session.", 404)
    return DocumentView.model_validate(row)


def owned_artifact(connection: Connection, owner: UUID, artifact_id: UUID) -> ArtifactRecord:
    row = (
        connection.execute(
            select(artifacts).where(
                artifacts.c.id == artifact_id,
                artifacts.c.owner_id == owner,
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise TranslerError("ARTIFACT_NOT_FOUND", "File does not exist in this session.", 404)
    return ArtifactRecord.model_validate(row)


def owned_job(connection: Connection, owner: UUID, job_id: UUID) -> JobRecord:
    row = (
        connection.execute(
            select(jobs).where(
                jobs.c.id == job_id,
                jobs.c.owner_id == owner,
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise TranslerError("JOB_NOT_FOUND", "Job does not exist in this session.", 404)
    return JobRecord.model_validate(row)
