"""Real PDF routing, OCR restoration and native translation with production dependencies."""

import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import monotonic, sleep
from uuid import UUID, uuid4

import numpy as np
import psutil
import pymupdf
import pytest
from conftest import ApiClient, make_pdf
from sqlalchemy import select
from test_accounts import register

from transler.core.errors import TranslerError
from transler.infrastructure.db import jobs, usage_ledger
from transler.infrastructure.storage import ObjectStorage
from transler.jobs.service import perform_job
from transler.processing.pdf.pdf import inspect_page_output
from transler.processing.pdf.pdf_ir import PDFManifest
from transler.processing.pdf.pdf_preflight import preflight


def mixed_pdf() -> bytes:
    with pymupdf.open() as source:
        page = source.new_page(width=500, height=600)
        page.insert_text(
            (45, 65), "Document translation helps people understand research.", fontsize=14
        )
        page.insert_text((45, 100), "Native document number 12345.", fontsize=14)
        raster = source.new_page(width=500, height=600)
        raster.insert_text((45, 65), "Scientific research results", fontsize=20)
        raster.insert_text((45, 105), "Document translation helps people.", fontsize=16)
        for x in (45, 245, 445):
            raster.draw_line((x, 150), (x, 250))
        for y in (150, 200, 250):
            raster.draw_line((45, y), (445, y))
        for x, y, text in (
            (60, 183, "Method"),
            (260, 183, "Score"),
            (60, 233, "Baseline"),
            (260, 233, "98.5"),
        ):
            raster.insert_text((x, y), text, fontsize=16)
        image = raster.get_pixmap(dpi=200).tobytes("png")
        source.delete_page(1)
        scan = source.new_page(width=500, height=600)
        scan.insert_image(scan.rect, stream=image)
        scan.set_rotation(90)
        native = source.new_page(width=500, height=600)
        native.insert_text((45, 65), "Additional native research result 67890.", fontsize=14)
        source.new_page(width=500, height=600)
        source.set_metadata({"title": "Mixed engine verification", "author": "Transler"})
        source.set_xml_metadata(
            '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>'
            "</x:xmpmeta>"
        )
        source.set_toc([[1, "Native", 1], [1, "Scanned table", 2], [1, "Blank", 4]])
        source.set_page_labels([{"startpage": 0, "prefix": "T-", "style": "D", "firstpagenum": 1}])
        source[0].insert_link(
            {
                "kind": pymupdf.LINK_GOTO,
                "from": pymupdf.Rect(45, 120, 170, 140),
                "page": 1,
                "to": pymupdf.Point(0, 0),
            }
        )
        return source.tobytes()


def test_preflight_distinguishes_hidden_ocr_and_hybrid_pages() -> None:
    content = mixed_pdf()
    with pymupdf.open(stream=content, filetype="pdf") as document:
        assert tuple(page.kind for page in preflight(document)) == (
            "native",
            "scanned",
            "native",
            "blank",
        )
        document[1].insert_text((45, 300), "Hidden searchable scan", render_mode=3)
        assert preflight(document)[1].kind == "scanned"
        document[1].insert_text((45, 340), "Visible native header")
        with pytest.raises(TranslerError, match="combines a scan-sized image"):
            preflight(document)


def test_quality_gate_rejects_missing_font_resources() -> None:
    content = make_pdf(1)
    with (
        pymupdf.open(stream=content, filetype="pdf") as original,
        pymupdf.open(stream=content, filetype="pdf") as corrupt,
    ):
        resource = corrupt.xref_get_key(corrupt[0].xref, "Resources")
        resource_xref = int(resource[1].split()[0])
        name = corrupt[0].get_fonts()[0][4]
        corrupt.xref_set_key(resource_xref, "Font", f"<< /{name} 0 0 R >>")
        with pytest.raises(TranslerError) as failure:
            inspect_page_output(original[0], corrupt[0], 1)
        assert failure.value.code == "PDF_FONT_RESOURCES_INVALID"


@pytest.mark.integration
@pytest.mark.translation
def test_mixed_pdf_translates_with_both_engines_and_preserves_navigation(client: ApiClient) -> None:
    content = mixed_pdf()
    upload = client.post("/v1/documents", files={"file": ("mixed.pdf", content, "application/pdf")})
    assert upload.status_code == 201, upload.text
    document = upload.json()
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
    identifier = UUID(response.json()["id"])
    perform_job(client.settings, identifier)
    job = client.get(f"/v1/jobs/{identifier}").json()
    assert job["status"] == "COMPLETED", job
    assert job["completed_pages"] == 4
    with client.database.connect() as connection:
        key = connection.scalar(select(jobs.c.pipeline_manifest_key).where(jobs.c.id == identifier))
    assert key is not None
    storage = ObjectStorage(client.settings)
    manifest = PDFManifest.model_validate_json(storage.get(key))
    assert manifest.native_engine == "babeldoc-0.6.4"
    assert len(manifest.scan_pages) == 1
    scan_ir = manifest.scan_pages[0]
    assert any(region.region_type == "table_cell" for region in scan_ir.regions)
    assert all(region.translated_text for region in scan_ir.regions)
    assert all(region.style.font_family == "Noto Sans" for region in scan_ir.regions)
    mask = pymupdf.Pixmap(base64.b64decode(scan_ir.source_mask_png_base64))
    assert mask.width > 2000
    output = client.get(f"/v1/artifacts/{job['artifact_id']}/download")
    with (
        pymupdf.open(stream=output.content, filetype="pdf") as result,
        pymupdf.open(stream=content, filetype="pdf") as original,
    ):
        assert result.page_count == 4
        assert result[1].rotation == 90
        assert result.metadata["title"] == original.metadata["title"]
        assert result.get_xml_metadata() == original.get_xml_metadata()
        assert result.get_toc() == original.get_toc()
        assert result.get_page_labels() == original.get_page_labels()
        assert result[0].get_links()[0]["page"] == 1
        assert "12345" in result[0].get_text()
        assert "98.5" in result[1].get_text()
        assert "Scientific research results" not in result[1].get_text()
        scan_fonts = result[1].get_fonts()
        assert scan_fonts
        assert all("Noto Sans" in font[3] for font in scan_fonts)
        assert all(result.extract_font(font[0])[3] for font in scan_fonts)
        assert "Noto Sans" in " ".join(font[3] for font in result[0].get_fonts())
        assert "67890" in result[2].get_text()
        assert "Noto Sans" in " ".join(font[3] for font in result[2].get_fonts())
        assert all("\x00" not in page.get_text() for page in result)
        assert not result[3].get_text()
        image = result[1].get_image_info(xrefs=True)[0]
        background = pymupdf.Pixmap(result, image["xref"])
        assert background.width > 2000
        pixels = np.frombuffer(background.samples, np.uint8).reshape(
            background.height, background.width, background.n
        )
        # The source heading pixels must be erased, not covered by an invisible text layer.
        heading = pixels[
            int(45 * background.height / 600) : int(70 * background.height / 600),
            int(45 * background.width / 500) : int(310 * background.width / 500),
            :3,
        ]
        assert float(np.mean(heading < 245)) < 0.005
        artifact = Path("../.runtime/new-engine-mixed.pdf")
        artifact.write_bytes(output.content)
        result[0].get_pixmap(dpi=120).save("../.runtime/new-engine-native.png")
        result[1].get_pixmap(dpi=120).save("../.runtime/new-engine-scan.png")
    assert client.get(f"/v1/artifacts/{document['artifact_id']}/download").content == content
    assert client.delete(f"/v1/documents/{document['id']}").status_code == 204
    with pytest.raises(storage.client.exceptions.NoSuchKey):
        storage.get(key)


@pytest.mark.integration
@pytest.mark.translation
def test_processing_timeout_fails_once_and_reaps_runner(client: ApiClient) -> None:
    register(client)
    with (
        pymupdf.open(stream=mixed_pdf(), filetype="pdf") as original,
        pymupdf.open() as document,
    ):
        for _index in range(30):
            document.insert_pdf(original, from_page=0, to_page=0)
        content = document.tobytes()
    upload = client.post(
        "/v1/documents", files={"file": ("timeout.pdf", content, "application/pdf")}
    )
    assert upload.status_code == 201, upload.text
    document_id = upload.json()["id"]
    response = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": document_id,
            "source_language": "en",
            "target_language": "vi",
            "mode": "basic",
        },
    )
    assert response.status_code == 202, response.text
    identifier = UUID(response.json()["id"])
    children = {child.pid for child in psutil.Process().children(recursive=True)}
    with pytest.raises(TranslerError) as failure:
        perform_job(client.settings.model_copy(update={"engine_timeout_seconds": 30}), identifier)
    assert failure.value.code == "PROCESSING_TIMEOUT"
    job = client.get(f"/v1/jobs/{identifier}").json()
    assert job["status"] == "FAILED", job
    assert "BabelDOC:" in job["error"]["message"]
    with client.database.connect() as connection:
        assert connection.scalar(select(jobs.c.attempt_count).where(jobs.c.id == identifier)) == 1
        assert (
            connection.scalar(
                select(usage_ledger.c.status).where(usage_ledger.c.job_id == identifier)
            )
            == "RELEASED"
        )
    assert {child.pid for child in psutil.Process().children(recursive=True)} <= children
    assert client.delete(f"/v1/documents/{document_id}").status_code == 204


@pytest.mark.integration
@pytest.mark.translation
def test_cancel_active_engine_reaps_runner_and_releases_usage(client: ApiClient) -> None:
    register(client)
    upload = client.post(
        "/v1/documents", files={"file": ("cancel.pdf", make_pdf(3), "application/pdf")}
    )
    assert upload.status_code == 201, upload.text
    document_id = upload.json()["id"]
    response = client.post(
        "/v1/translations",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "document_id": document_id,
            "source_language": "en",
            "target_language": "vi",
            "mode": "basic",
        },
    )
    assert response.status_code == 202, response.text
    identifier = UUID(response.json()["id"])
    children = {child.pid for child in psutil.Process().children(recursive=True)}
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(perform_job, client.settings, identifier)
        deadline = monotonic() + 40
        try:
            while monotonic() < deadline:
                job = client.get(f"/v1/jobs/{identifier}").json()
                if job["stage"].startswith("BabelDOC:"):
                    break
                if future.done():
                    future.result()
                    raise AssertionError(f"Engine exited before publishing progress: {job}")
                sleep(0.1)
            else:
                raise TimeoutError("Engine did not publish live progress within 40 seconds.")
        finally:
            cancelled = client.post(f"/v1/jobs/{identifier}/cancel")
            assert cancelled.status_code == 200, cancelled.text
        future.result(timeout=20)
    assert client.get(f"/v1/jobs/{identifier}").json()["status"] == "CANCELLED"
    with client.database.connect() as connection:
        assert (
            connection.scalar(
                select(usage_ledger.c.status).where(usage_ledger.c.job_id == identifier)
            )
            == "RELEASED"
        )
    assert {child.pid for child in psutil.Process().children(recursive=True)} <= children
    assert client.delete(f"/v1/documents/{document_id}").status_code == 204
