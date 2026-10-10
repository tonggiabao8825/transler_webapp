"""Exercise Phase 1 contracts against the real application infrastructure."""

from hashlib import sha256
from uuid import UUID, uuid4

import pymupdf
import pytest
from conftest import ApiClient, make_pdf
from sqlalchemy import select, update

from transler.core.contracts import JobRecord, JobStatus
from transler.core.errors import EngineError, JobCancelledError
from transler.infrastructure.db import jobs
from transler.jobs.lifecycle import claim_job, heartbeat, record_failure
from transler.jobs.service import perform_job

pytestmark = pytest.mark.integration


def upload(client: ApiClient, content: bytes) -> UUID:
    response = client.post(
        "/v1/documents", files={"file": ("source.pdf", content, "application/pdf")}
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["id"])


def test_import_validation_ownership_and_delete(client: ApiClient, pdf: bytes) -> None:
    document_id = upload(client, pdf)
    document = client.get(f"/v1/documents/{document_id}").json()
    assert document["checksum"] == sha256(pdf).hexdigest()
    assert client.get(f"/v1/artifacts/{document['artifact_id']}/download").content == pdf
    assert client.get(f"/v1/documents/{document_id}/pages").json()[0]["text_characters"] > 0
    with ApiClient(client.settings, str(client.base_url)) as stranger:
        assert stranger.post("/v1/session").status_code == 200
        assert stranger.get(f"/v1/documents/{document_id}").status_code == 404
        assert stranger.get(f"/v1/artifacts/{document['artifact_id']}/download").status_code == 404
    assert client.delete(f"/v1/documents/{document_id}").status_code == 204
    assert client.get(f"/v1/artifacts/{document['artifact_id']}/download").status_code == 404
    response = client.post(
        "/v1/documents", files={"file": ("bad.pdf", b"not pdf", "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_PDF"
    response = client.post(
        "/v1/documents", files={"file": ("large.pdf", make_pdf(31), "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "PAGE_LIMIT_EXCEEDED"


def test_encryption_size_rejected_and_blank_page_preserved(client: ApiClient, pdf: bytes) -> None:
    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        encrypted = document.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="reader"
        )
    response = client.post(
        "/v1/documents", files={"file": ("secret.pdf", encrypted, "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "ENCRYPTED_PDF"
    with pymupdf.open() as document:
        document.new_page()
        blank = document.tobytes()
    document_id = upload(client, blank)
    response = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": str(document_id),
            "source_language": "en",
            "target_language": "vi",
            "mode": "basic",
        },
    )
    assert response.status_code == 202, response.text
    perform_job(client.settings, UUID(response.json()["id"]))
    job = client.get(f"/v1/jobs/{response.json()['id']}").json()
    assert job["status"] == "COMPLETED", job
    output = client.get(f"/v1/artifacts/{job['artifact_id']}/download")
    with pymupdf.open(stream=output.content, filetype="pdf") as result:
        assert result.page_count == 1
        assert not result[0].get_text()
    response = client.post(
        "/v1/documents", files={"file": ("huge.pdf", b"x" * (22 * 1024 * 1024), "application/pdf")}
    )
    assert response.status_code == 413


def test_ssrf_and_cross_origin_rejected(client: ApiClient) -> None:
    for url in (
        "http://example.com/file.pdf",
        "https://127.0.0.1/file.pdf",
        "https://[::1]/file.pdf",
        "https://169.254.169.254/file.pdf",
    ):
        response = client.post("/v1/documents/import-url", json={"url": url})
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "UNSAFE_URL"
    response = client.post("/v1/session", headers={"Origin": "https://attacker.example"})
    assert response.status_code == 403


def test_public_https_import(client: ApiClient) -> None:
    response = client.post(
        "/v1/documents/import-url",
        json={
            "url": "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
        },
    )
    assert response.status_code == 201, response.text
    assert 1 <= response.json()["page_count"] <= 30


def test_durable_jobs_idempotency_quota_and_cancel(client: ApiClient, pdf: bytes) -> None:
    document_id = upload(client, pdf)
    request = {
        "document_id": str(document_id),
        "source_language": "en",
        "target_language": "vi",
        "mode": "basic",
    }
    key = str(uuid4())
    first = client.post("/v1/translations", headers={"Idempotency-Key": key}, json=request)
    assert first.status_code == 202, first.text
    repeated = client.post("/v1/translations", headers={"Idempotency-Key": key}, json=request)
    assert repeated.json()["id"] == first.json()["id"]
    assert "owner_id" not in repeated.json()
    assert "run_token" not in repeated.json()
    conflict = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": key},
        json={**request, "target_language": "fr"},
    )
    assert conflict.status_code == 409
    second = client.post(
        "/v1/translations", headers={"Idempotency-Key": str(uuid4())}, json=request
    )
    assert second.status_code == 202
    assert (
        client.post(
            "/v1/translations", headers={"Idempotency-Key": str(uuid4())}, json=request
        ).status_code
        == 429
    )
    assert client.delete(f"/v1/documents/{document_id}").status_code == 409
    for job in (first.json(), second.json()):
        cancelled = client.post(f"/v1/jobs/{job['id']}/cancel")
        assert cancelled.json()["status"] == "CANCELLED"


def test_leases_fence_duplicates_retry_and_cancellation(client: ApiClient, pdf: bytes) -> None:
    document_id = upload(client, pdf)
    response = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": str(document_id),
            "source_language": "en",
            "target_language": "vi",
            "mode": "basic",
        },
    )
    job_id = UUID(response.json()["id"])
    engine = client.database
    claimed = claim_job(engine, job_id)
    assert claimed is not None
    assert claimed.attempt_count == 1
    assert claim_job(engine, job_id) is None
    heartbeat(engine, claimed)
    record_failure(engine, claimed, EngineError("Real worker boundary failure exercise."))
    assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "RETRYING"
    with engine.begin() as connection:
        connection.execute(update(jobs).where(jobs.c.id == job_id).values(lease_until=None))
    next_attempt = claim_job(engine, job_id)
    assert next_attempt is not None and next_attempt.attempt_count == 2
    assert next_attempt.run_token != claimed.run_token
    with pytest.raises(JobCancelledError):
        heartbeat(engine, claimed)
    record_failure(engine, claimed, EngineError("Stale worker cannot overwrite current state."))
    assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "PROCESSING"
    assert client.post(f"/v1/jobs/{job_id}/cancel").json()["status"] == "CANCELLING"
    with pytest.raises(JobCancelledError):
        heartbeat(engine, next_attempt)
    with engine.begin() as connection:
        connection.execute(update(jobs).where(jobs.c.id == job_id).values(lease_until=None))
    assert claim_job(engine, job_id) is None
    assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "CANCELLED"
    with engine.connect() as connection:
        record = JobRecord.model_validate(
            connection.execute(select(jobs).where(jobs.c.id == job_id)).mappings().one()
        )
    assert record.status == JobStatus.CANCELLED
