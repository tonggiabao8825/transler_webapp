"""Private Python processing API for resource-limited PDF analysis and HTTPS import."""

import subprocess
import sys
from pathlib import Path
from secrets import compare_digest
from tempfile import TemporaryDirectory
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import TypeAdapter

from transler.config import Settings
from transler.contracts import ApiError, DocumentAnalysis, ImportRequest
from transler.errors import TranslerError
from transler.formats import FormatAnalysis
from transler.import_url import download_pdf
from transler.middleware import RequestLimits
from transler.pdf import analyze_pdf
from transler.structure import PageStructure

settings = Settings()
app = FastAPI(
    title="Transler internal PDF processor", docs_url=None, redoc_url=None, openapi_url=None
)
app.add_middleware(RequestLimits, max_bytes=settings.max_upload_bytes + 65536)


def authorize(request: Request) -> None:
    expected = "Bearer " + settings.processor_token.get_secret_value()
    if not compare_digest(request.headers.get("authorization", ""), expected):
        raise TranslerError(
            "PROCESSOR_AUTH_FAILED", "Internal processor authorization failed.", 401
        )


Authorization = Annotated[None, Depends(authorize)]


@app.exception_handler(TranslerError)
async def application_error(request: Request, error: TranslerError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content=ApiError(code=error.code, message=error.message).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content=ApiError(code="INVALID_REQUEST", message=str(error)).model_dump()
    )


@app.exception_handler(httpx.HTTPError)
async def import_error(request: Request, error: httpx.HTTPError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ApiError(
            code="URL_IMPORT_FAILED", message=f"HTTPS import failed: {error}"
        ).model_dump(),
    )


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready(authorization: Authorization) -> dict[str, str]:
    return {"status": "ready"}


@app.post("/analyze", response_model=DocumentAnalysis)
async def analyze(request: Request, authorization: Authorization) -> DocumentAnalysis:
    return analyze_pdf(await request.body())


@app.post("/import")
def import_pdf(body: ImportRequest, authorization: Authorization) -> Response:
    filename, content = download_pdf(str(body.url), settings.max_upload_bytes)
    return Response(
        content, media_type="application/pdf", headers={"X-Transler-Filename": quote(filename)}
    )


@app.post("/formats/analyze", response_model=FormatAnalysis)
async def analyze_format(
    request: Request, filename: str, authorization: Authorization
) -> FormatAnalysis:
    with TemporaryDirectory(prefix="transler-format-") as directory:
        path = Path(directory) / "source"
        path.write_bytes(await request.body())
        try:
            result = subprocess.run(
                [sys.executable, "-m", "transler.format_runner", str(path), filename],
                capture_output=True,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise TranslerError(
                "FORMAT_PARSE_TIMEOUT", "Format inspection exceeded 30 seconds.", 422
            ) from error
        if result.returncode == 2:
            failure = ApiError.model_validate_json(result.stdout)
            raise TranslerError(failure.code, failure.message, 422)
        if result.returncode:
            raise TranslerError(
                "FORMAT_PARSE_FAILED", result.stderr.decode(errors="replace")[-2000:], 422
            )
        return FormatAnalysis.model_validate_json(result.stdout)


@app.post("/pdf/structure")
async def structure(request: Request, authorization: Authorization) -> tuple[PageStructure, ...]:
    with TemporaryDirectory(prefix="transler-geometry-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(await request.body())
        try:
            result = subprocess.run(
                [sys.executable, "-m", "transler.structure_runner", str(source)],
                capture_output=True,
                timeout=20,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise TranslerError(
                "PDF_STRUCTURE_TIMEOUT", "PDF geometry inspection exceeded 20 seconds.", 422
            ) from error
        if result.returncode == 2:
            error_body = ApiError.model_validate_json(result.stdout)
            raise TranslerError(error_body.code, error_body.message, 422)
        if result.returncode:
            raise TranslerError(
                "PDF_STRUCTURE_FAILED",
                f"PDF geometry inspection exited {result.returncode}: "
                f"{result.stderr.decode(errors='replace')[-2000:]}",
                422,
            )
        return TypeAdapter(tuple[PageStructure, ...]).validate_json(result.stdout)
