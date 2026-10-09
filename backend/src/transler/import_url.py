"""HTTPS importer: validate every redirect and pin connections to vetted public IPs."""

import ipaddress
import socket
import time
from itertools import islice
from pathlib import PurePosixPath
from urllib.parse import unquote

import httpx

from transler.errors import TranslerError
from transler.retries import service_retry


def resolve_public_address(url: httpx.URL) -> str:
    if url.scheme != "https" or url.port not in {None, 443} or url.username or url.password:
        raise TranslerError(
            "UNSAFE_URL", "Import requires HTTPS on port 443 without credentials.", 422
        )
    try:
        addresses = socket.getaddrinfo(url.host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise TranslerError(
            "URL_DNS_FAILED", f"Cannot resolve host {url.host}: {error}", 422
        ) from error
    ips = tuple(ipaddress.ip_address(address[4][0]) for address in addresses)
    if not ips or any(not ip.is_global for ip in ips):
        raise TranslerError("UNSAFE_URL", f"Host {url.host} resolves to a non-public address.", 422)
    return str(ips[0])


def download_pdf(url_string: str, max_bytes: int) -> tuple[str, bytes]:
    url = httpx.URL(url_string)
    deadline = time.monotonic() + 120
    with httpx.Client(timeout=httpx.Timeout(30, connect=10), trust_env=False) as client:
        for redirect in range(4):
            address = resolve_public_address(url)
            pinned = url.copy_with(host=address)
            for attempt in service_retry("import_url", {"host": url.host}):
                with attempt:
                    if time.monotonic() > deadline:
                        raise TranslerError(
                            "URL_IMPORT_TIMEOUT", "HTTPS import exceeded 120 seconds.", 504
                        )
                    with client.stream(
                        "GET",
                        pinned,
                        headers={
                            "Host": url.host,
                            "Accept": "application/pdf",
                            "Accept-Encoding": "identity",
                        },
                        extensions={"sni_hostname": url.host},
                    ) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            if redirect == 3 or "location" not in response.headers:
                                raise TranslerError(
                                    "URL_REDIRECT_LIMIT", "Invalid or excessive redirects.", 422
                                )
                            url = url.join(response.headers["location"])
                            break
                        if response.is_error:
                            body = b"".join(islice(response.iter_raw(chunk_size=512), 4))
                            raise httpx.HTTPStatusError(
                                f"Import host {url.host} returned HTTP {response.status_code}. "
                                f"Response body: {body.decode(errors='replace')}",
                                request=response.request,
                                response=response,
                            )
                        if response.headers.get("content-encoding", "identity") != "identity":
                            raise TranslerError(
                                "UNSUPPORTED_HTTP_ENCODING",
                                "PDF host must honor Accept-Encoding: identity.",
                                422,
                            )
                        if response.headers.get("content-type", "").split(";")[0].strip() not in {
                            "application/pdf",
                            "application/octet-stream",
                        }:
                            raise TranslerError(
                                "INVALID_MIME", "Import response must contain a PDF.", 422
                            )
                        chunks: list[bytes] = []
                        size = 0
                        for chunk in response.iter_raw():
                            if time.monotonic() > deadline:
                                raise TranslerError(
                                    "URL_IMPORT_TIMEOUT", "HTTPS import exceeded 120 seconds.", 504
                                )
                            size += len(chunk)
                            if size > max_bytes:
                                raise TranslerError(
                                    "FILE_TOO_LARGE", f"Import exceeds {max_bytes} bytes.", 413
                                )
                            chunks.append(chunk)
                        name = PurePosixPath(unquote(url.path)).name
                        filename = name if name.lower().endswith(".pdf") else "imported.pdf"
                        return filename, b"".join(chunks)
    raise TranslerError("URL_IMPORT_FAILED", "Import ended without a PDF response.", 422)
