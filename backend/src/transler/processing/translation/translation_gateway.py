"""Job-scoped provider connector shared by both PDF layout engines."""

import hashlib
import os
import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from threading import Lock
from typing import Protocol

import httpx
from pydantic import Field, TypeAdapter

from transler.core.contracts import BasicProvider, Contract
from transler.core.retries import service_retry
from transler.processing.translation.bing import BingTranslation, ProviderExhaustedError
from transler.processing.translation.llm import Context
from transler.processing.translation.translation_cache import TranslationCache


class TranslationConnector(Protocol):
    def use_context(self, context: Context) -> None: ...
    def translate(self, text: str) -> str: ...
    def close(self) -> None: ...


class ServiceTranslation(Contract):
    text: str = Field(min_length=1)


class DeepLResponse(Contract):
    translations: tuple[ServiceTranslation, ...] = Field(min_length=1, max_length=1)


class AzureResult(Contract):
    translations: tuple[ServiceTranslation, ...] = Field(min_length=1, max_length=1)


class GoogleTranslation(Contract):
    translatedText: str = Field(min_length=1)


class GoogleData(Contract):
    translations: tuple[GoogleTranslation, ...] = Field(min_length=1, max_length=1)


class GoogleResponse(Contract):
    data: GoogleData


def required_secret(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"Configure {name} before using this Basic translation provider.")
    return value


def checked_response(response: httpx.Response, service: str) -> httpx.Response:
    if response.is_error:
        raise httpx.HTTPStatusError(
            f"{service} translation HTTP {response.status_code}: {response.text[:2000]}",
            request=response.request,
            response=response,
        )
    return response


def validate_pdf_tokens(source: str, translated: str) -> str:
    placeholders = r"\{v\d+\}|</?b\d+>"
    if Counter(re.findall(placeholders, source)) != Counter(re.findall(placeholders, translated)):
        raise ValueError("Translation altered protected PDF formula/style placeholders.")
    if not translated.strip():
        raise ValueError("Translation provider returned an empty translation.")
    return translated


def deepl_request(
    client: httpx.Client, text: str, source: str, target: str, context: Context
) -> str:
    key = required_secret("DEEPL_AUTH_KEY")
    url = "https://api-free.deepl.com" if key.endswith(":fx") else "https://api.deepl.com"
    payload: dict[str, str | list[str]] = {
        "text": [text],
        "target_lang": target.upper(),
        "context": context.document,
    }
    if source != "auto":
        payload["source_lang"] = source.upper()
    response = checked_response(
        client.post(
            url + "/v2/translate", json=payload, headers={"Authorization": "DeepL-Auth-Key " + key}
        ),
        "DeepL",
    )
    return DeepLResponse.model_validate(response.json()).translations[0].text


def azure_request(
    client: httpx.Client, text: str, source: str, target: str, context: Context
) -> str:
    endpoint = required_secret("AZURE_ENDPOINT").rstrip("/")
    if not endpoint.startswith("https://"):
        raise ValueError("AZURE_ENDPOINT must be an HTTPS Translator endpoint.")
    params = {"api-version": "3.0", "to": target}
    if source != "auto":
        params["from"] = source
    headers = {"Ocp-Apim-Subscription-Key": required_secret("AZURE_API_KEY")}
    region = os.environ.get("AZURE_REGION")
    if region:
        headers["Ocp-Apim-Subscription-Region"] = region
    response = checked_response(
        client.post(endpoint + "/translate", params=params, json=[{"Text": text}], headers=headers),
        "Azure",
    )
    result = TypeAdapter(tuple[AzureResult, ...]).validate_python(response.json())
    if len(result) != 1:
        raise ValueError("Azure Translator must return exactly one result per input segment.")
    return result[0].translations[0].text


def google_request(
    client: httpx.Client, text: str, source: str, target: str, context: Context
) -> str:
    payload = {"q": text, "target": target, "format": "text"}
    if source != "auto":
        payload["source"] = source
    response = checked_response(
        client.post(
            "https://translation.googleapis.com/language/translate/v2",
            params={"key": required_secret("GOOGLE_TRANSLATE_API_KEY")},
            json=payload,
        ),
        "Google Cloud",
    )
    return GoogleResponse.model_validate(response.json()).data.translations[0].translatedText


class BasicTranslation:
    def __init__(
        self,
        provider: BasicProvider,
        source: str,
        target: str,
        cached: dict[str, str],
        cache_file: Path,
    ) -> None:
        self.provider = provider
        self.source = source
        self.target = target
        self.cache = TranslationCache(cached, cache_file)
        self.lock = Lock()
        self.bing: BingTranslation | None = None
        self.context = Context(document="", section="", previous="", following="")
        self.client = httpx.Client(timeout=httpx.Timeout(60, connect=10), follow_redirects=False)
        self.request: Callable[[httpx.Client, str, str, str, Context], str] | None = {
            "deepl": deepl_request,
            "azure": azure_request,
            "google": google_request,
        }.get(provider)

    def use_context(self, context: Context) -> None:
        with self.lock:
            self.context = context

    def translate(self, text: str) -> str:
        if not any(character.isalpha() for character in text):
            return text
        with self.lock:
            context = self.context
        key = hashlib.sha256(
            f"basic:{self.provider}:{self.source}:{self.target}:{context.document}:{text}".encode()
        ).hexdigest()

        def request() -> str:
            try:
                if self.provider == "bing":
                    with self.lock:
                        if self.bing is None:
                            self.bing = BingTranslation(self.source, self.target)
                        bing = self.bing
                    result = bing.translate(text)
                else:
                    if self.request is None:
                        raise ValueError(f"Unsupported Basic provider: {self.provider}.")
                    for attempt in service_retry(
                        "translation.basic",
                        {"provider": self.provider, "source": self.source, "target": self.target},
                    ):
                        with attempt:
                            result = self.request(
                                self.client, text, self.source, self.target, context
                            )
                result = validate_pdf_tokens(text, result)
            except (httpx.HTTPError, ValueError) as error:
                raise ProviderExhaustedError(str(error)) from error
            return result

        return self.cache.translate(key, request)

    def close(self) -> None:
        self.client.close()
        if self.bing is not None:
            self.bing.close()
