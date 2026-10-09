"""Real PDFMathTranslate/provider integration; no mocked translation output."""

from uuid import UUID, uuid4

import pymupdf
import pytest
from conftest import ApiClient
from test_accounts import register

from transler.worker import perform_job

pytestmark = [pytest.mark.integration, pytest.mark.translation]


def test_real_translation_preserves_source_and_exports_pdf(client: ApiClient, pdf: bytes) -> None:
    source = client.post("/v1/documents", files={"file": ("research.pdf", pdf, "application/pdf")})
    assert source.status_code == 201, source.text
    document = source.json()
    register(client)
    response = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": document["id"],
            "source_language": "en",
            "target_language": "vi",
            "mode": "basic",
        },
    )
    assert response.status_code == 202, response.text
    job_id = UUID(response.json()["id"])
    perform_job(client.settings, job_id)
    result = client.get(f"/v1/jobs/{job_id}").json()
    assert result["status"] == "COMPLETED", result
    assert result["progress"] == 100
    assert client.get("/v1/account").json()["usage"]["pages_used"] == 1
    assert client.get("/v1/account").json()["usage"]["pages_reserved"] == 0
    assert result["completed_pages"] == 1
    assert result["quality_report"]["page_count"] == 1
    assert client.get(f"/v1/artifacts/{document['artifact_id']}/download").content == pdf
    translated = client.get(f"/v1/artifacts/{result['artifact_id']}/download")
    assert translated.status_code == 200
    assert len(translated.content) < 1024 * 1024, "Translated page embeds an unbounded full font."
    with pymupdf.open(stream=translated.content, filetype="pdf") as output:
        text = output[0].get_text()
        assert output.page_count == 1
        assert "ngôn ngữ" in text.lower() or "dịch" in text.lower(), text
        assert "Document translation helps people" not in text
    assert client.delete(f"/v1/documents/{document['id']}").status_code == 204
    assert client.get("/v1/account").json()["usage"]["pages_used"] == 1


def test_bing_translates_long_segments_without_losing_tail_or_formulas() -> None:
    from transler.bing import BingTranslation, split_segments

    text = (
        "Document translation helps people understand scientific research across languages. " * 18
        + "The final measurement is 987654321 and the equation is {v17}."
    )
    segments = split_segments(text, 900)
    assert "".join(segments) == text
    assert all(len(segment) <= 900 for segment in segments)
    connector = BingTranslation("en", "vi")
    try:
        result = connector.translate(text)
    finally:
        connector.close()
    assert "987654321" in result
    assert "{v17}" in result
    assert "nghiên cứu" in result.lower()
