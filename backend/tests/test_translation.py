"""Real native-PDF/provider integration; no mocked translation output."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from queue import SimpleQueue
from uuid import UUID, uuid4

import httpx
import pymupdf
import pytest
from conftest import ApiClient
from test_accounts import register

from transler.jobs.service import perform_job

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
        assert "\x03" not in text
    assert client.delete(f"/v1/documents/{document['id']}").status_code == 204
    assert client.get("/v1/account").json()["usage"]["pages_used"] == 1


def test_bing_translates_long_segments_without_losing_tail_or_formulas() -> None:
    from transler.processing.translation.bing import BingTranslation, split_segments

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


def test_concurrent_translation_cache_shares_results_and_service_errors(
    client: ApiClient, tmp_path: Path
) -> None:
    from transler.processing.translation.bing import BingTranslation
    from transler.processing.translation.translation_cache import TranslationCache

    cache = TranslationCache({}, tmp_path / "translations.json")
    requests: SimpleQueue[str] = SimpleQueue()
    connector = BingTranslation("en", "vi")
    text = "Scientific research helps people understand results. Measurement 987654321 {v17}."

    def translate() -> str:
        requests.put("translation")
        return connector.translate(text)

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = tuple(pool.map(lambda _: cache.translate("research", translate), range(8)))
    finally:
        connector.close()
    assert requests.qsize() == 1
    assert len(set(results)) == 1
    assert "987654321" in results[0] and "{v17}" in results[0]
    assert "nghiên cứu" in results[0].lower()
    assert cache.pending == {}
    assert (tmp_path / "translations.json").is_file()

    def missing_artifact() -> str:
        requests.put("missing")
        response = client.get(f"/v1/artifacts/{UUID(int=0)}/preview")
        response.raise_for_status()
        return response.text

    def fail_request(index: int) -> int:
        with pytest.raises(httpx.HTTPStatusError) as failure:
            cache.translate("missing", missing_artifact)
        return failure.value.response.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = tuple(pool.map(fail_request, range(8)))
    assert statuses == (404,) * 8
    assert requests.qsize() == 2
    assert "missing" not in cache.values
