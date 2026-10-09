"""Admin tool availability is persisted and enforced by the real job API."""

from uuid import UUID, uuid4

import pytest
from conftest import ApiClient
from sqlalchemy import text
from test_accounts import register

pytestmark = pytest.mark.integration


def test_admin_tool_availability_blocks_operations(client: ApiClient, pdf: bytes) -> None:
    account = register(client)
    assert len(client.get("/v1/tools").json()) == 12
    assert client.put("/v1/admin/tools/ocr", json={"enabled": False}).status_code == 403
    with client.database.begin() as connection:
        connection.execute(
            text("UPDATE accounts SET role='admin' WHERE id=:id"), {"id": UUID(account["id"])}
        )
    document_response = client.post(
        "/v1/documents", files={"file": ("tool-test.pdf", pdf, "application/pdf")}
    )
    assert document_response.status_code == 201, document_response.text
    document = document_response.json()
    try:
        for tool, options in [
            ("ocr", {"type": "ocr", "language": "auto"}),
            (
                "editor",
                {
                    "type": "edit",
                    "base_revision": 0,
                    "operations": [
                        {
                            "type": "rotate_page",
                            "page": 0,
                            "rect": None,
                            "destination": None,
                            "text": None,
                            "font_size": None,
                            "angle": 90,
                            "order": None,
                            "source_language": None,
                            "target_language": None,
                        }
                    ],
                },
            ),
            ("convert", {"type": "conversion", "target_format": "png"}),
            ("pdf_to_images", {"type": "conversion", "target_format": "png"}),
        ]:
            disabled = client.put(f"/v1/admin/tools/{tool}", json={"enabled": False})
            assert disabled.status_code == 200 and not disabled.json()["enabled"], disabled.text
            blocked = client.post(
                "/v1/operations",
                headers={"Idempotency-Key": str(uuid4())},
                json={
                    "document_id": document["id"],
                    "input_artifact_id": document["artifact_id"],
                    "options": options,
                },
            )
            assert blocked.status_code == 403 and blocked.json()["code"] == "TOOL_DISABLED", (
                blocked.text
            )
            assert client.put(f"/v1/admin/tools/{tool}", json={"enabled": True}).status_code == 200
        assert client.get("/v1/jobs").json() == []
        invalid = client.put("/v1/admin/tools/not-a-tool", json={"enabled": False})
        assert invalid.status_code == 422
        assert any(
            event["action"] == "admin.tool"
            for event in client.get("/v1/admin/audit?offset=0&limit=50").json()
        )
    finally:
        for tool in ["ocr", "editor", "convert", "pdf_to_images"]:
            client.put(f"/v1/admin/tools/{tool}", json={"enabled": True}).raise_for_status()
