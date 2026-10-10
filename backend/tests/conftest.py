"""Integration fixtures use real PostgreSQL, Redis, S3 and PDF files."""

import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx
import pymupdf
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from transler.bootstrap import provision_storage
from transler.core.config import Settings
from transler.infrastructure.db import connect_database


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    base = Settings()
    database = connect_database(base)
    with database.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        exists = connection.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = 'transler_test'")
        )
        if exists is None:
            connection.execute(text("CREATE DATABASE transler_test"))
    database.dispose()
    broker = urlsplit(base.redis_url)
    settings = Settings.model_validate(
        {
            **base.model_dump(),
            "database_url": make_url(base.database_url)
            .set(database="transler_test")
            .render_as_string(hide_password=False),
            "redis_url": urlunsplit((broker.scheme, broker.netloc, "/15", "", "")),
            "s3_bucket": f"{base.s3_bucket}-tests",
        }
    )
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        env={**os.environ, "TRANSLER_DATABASE_URL": settings.database_url},
    )
    provision_storage(settings)
    return settings


class ApiClient(httpx.Client):
    """HTTP connector exposing worker configuration for integration exercises."""

    def __init__(self, settings: Settings, base_url: str) -> None:
        super().__init__(base_url=base_url, timeout=120)
        self.settings = settings
        self.database = connect_database(settings)


@pytest.fixture(scope="session")
def api_url(test_settings: Settings) -> Iterator[str]:
    root = Path(__file__).resolve().parents[2]
    environment = {
        **os.environ,
        "LLM_MODEL": test_settings.llm_model,
        "TRANSLER_SETTINGS_KEY": test_settings.settings_key.get_secret_value(),
        "TRANSLER_DATABASE_URL": test_settings.database_url,
        "TRANSLER_REDIS_URL": test_settings.redis_url,
        "TRANSLER_S3_ENDPOINT": test_settings.s3_endpoint,
        "TRANSLER_S3_ACCESS_KEY": test_settings.s3_access_key,
        "TRANSLER_S3_SECRET_KEY": test_settings.s3_secret_key,
        "TRANSLER_S3_BUCKET": test_settings.s3_bucket,
        "TRANSLER_SECURE_COOKIE": "false",
        "TRANSLER_MAX_UPLOAD_BYTES": str(test_settings.max_upload_bytes),
        "TRANSLER_BASIC_PROVIDER": test_settings.basic_provider,
        "TRANSLER_PROCESSOR_TOKEN": test_settings.processor_token.get_secret_value(),
        "TRANSLER_PROCESSOR_URL": "http://localhost:8001",
        "TRANSLER_PUBLIC_URL": "http://localhost:8800",
        "TRANSLER_API_PORT": "8800",
        "TRANSLER_STRIPE_WEBHOOK_SECRET": "integration-stripe-signing-secret-32-characters",
        "TRANSLER_SEPAY_WEBHOOK_KEY": "integration-sepay-secret-32-characters",
        "TRANSLER_SEPAY_BANK_CODE": "MB",
        "TRANSLER_SEPAY_ACCOUNT_NUMBER": "123456789",
        "TRANSLER_SEPAY_ACCOUNT_NAME": "TRANSLER INTEGRATION",
    }
    log_path = root / ".runtime" / "integration-node-api.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            ["node", "dist/main.js"], cwd=root / "api", env=environment, stdout=log, stderr=log
        )
        try:
            for _attempt in range(100):
                if process.poll() is not None:
                    raise RuntimeError(f"Node integration API exited. Read {log_path}.")
                try:
                    response = httpx.get("http://localhost:8800/health/ready", timeout=2)
                    if response.status_code == 200:
                        break
                except httpx.ConnectError:
                    time.sleep(0.1)
            else:
                raise RuntimeError(f"Node integration API did not become ready. Read {log_path}.")
            yield "http://localhost:8800"
        finally:
            process.terminate()
            process.wait(timeout=10)


@pytest.fixture
def client(test_settings: Settings, api_url: str) -> Iterator[ApiClient]:
    with ApiClient(test_settings, api_url) as connection:
        response = connection.post("/v1/session")
        assert response.status_code == 200, response.text
        yield connection
        documents = connection.get("/v1/documents").json()
        for document in documents:
            for job in connection.get("/v1/jobs").json():
                if job["document_id"] == document["id"] and job["status"] in {"QUEUED", "RETRYING"}:
                    connection.post(f"/v1/jobs/{job['id']}/cancel").raise_for_status()
            connection.delete(f"/v1/documents/{document['id']}").raise_for_status()
        connection.database.dispose()


def make_pdf(page_count: int) -> bytes:
    with pymupdf.open() as document:
        for index in range(page_count):
            page = document.new_page()
            page.insert_text((72, 90), f"Welcome to Transler — Page {index + 1}", fontsize=18)
            page.insert_textbox(
                pymupdf.Rect(72, 120, 490, 230),
                "Document translation helps people understand ideas across languages. "
                "The original layout and scientific formulas should be preserved.",
                fontsize=12,
            )
        return document.tobytes()


@pytest.fixture
def pdf() -> bytes:
    return make_pdf(1)
