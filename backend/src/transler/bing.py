"""Bing HTTP boundary: bounded requests and complete, sentence-aware segments."""

import re
from threading import Lock

import httpx
from pydantic import BaseModel, ConfigDict, Field

from transler.retries import service_retry


class Translation(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    text: str = Field(min_length=1)


class TranslationResponse(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    translations: tuple[Translation, ...] = Field(min_length=1)


class ProviderExhaustedError(BaseException):
    """Escape PDFMathTranslate's unbounded Exception retry after our bounded attempts."""


def split_segments(text: str, limit: int) -> tuple[str, ...]:
    """Preserve every character and formula token while preferring sentence boundaries."""
    remaining = text
    segments: list[str] = []
    while len(remaining) > limit:
        candidates = list(re.finditer(r"[.!?]\s+|\s+", remaining[:limit]))
        sentences = [match for match in candidates if match.group()[0] in ".!?"]
        boundary = (sentences or candidates)[-1].end() if candidates else limit
        token = re.search(r"\{v\d*$", remaining[:boundary])
        if token is not None:
            boundary = token.start()
        if boundary == 0:
            raise ValueError(f"Translation token exceeds the {limit}-character segment limit.")
        segments.append(remaining[:boundary])
        remaining = remaining[boundary:]
    if remaining:
        segments.append(remaining)
    return tuple(segments)


class BingTranslation:
    def __init__(self, source_language: str, target_language: str) -> None:
        self.lang_in = {"auto": "auto-detect", "zh": "zh-Hans"}.get(
            source_language, source_language
        )
        self.lang_out = "zh-Hans" if target_language == "zh" else target_language
        self.client = httpx.Client(
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 Transler/0.1"},
        )
        self.cache: dict[str, str] = {}
        self.lock = Lock()
        self.url, self.ig, self.iid, self.key, self.token = self.session()

    def session(self) -> tuple[str, str, str, str, str]:
        for attempt in service_retry("bing.session", {}):
            with attempt:
                response = self.client.get("https://www.bing.com/translator")
                response.raise_for_status()
                ig = re.search(r'"ig":"(.*?)"', response.text)
                iid = re.findall(r'data-iid="(.*?)"', response.text)
                credentials = re.search(
                    r'params_AbusePreventionHelper\s*=\s*\[(.*?),"(.*?)",', response.text
                )
                if ig is None or not iid or credentials is None:
                    raise ValueError("Bing session response omitted translation credentials.")
                return (
                    str(response.url).removesuffix("translator"),
                    ig.group(1),
                    iid[-1],
                    credentials.group(1),
                    credentials.group(2),
                )
        raise RuntimeError("Bing session retries ended without a result.")

    def request_segment(self, text: str) -> str:
        with self.lock:
            cached = self.cache.get(text)
        if cached is not None:
            return cached
        for attempt in service_retry("bing.translate", {"target": self.lang_out}):
            with attempt:
                response = self.client.post(
                    f"{self.url}ttranslatev3",
                    params={"IG": self.ig, "IID": self.iid},
                    data={
                        "fromLang": self.lang_in,
                        "to": self.lang_out,
                        "text": text,
                        "token": self.token,
                        "key": self.key,
                    },
                )
                if response.is_error:
                    raise httpx.HTTPStatusError(
                        f"Bing translation HTTP {response.status_code}, target={self.lang_out}, "
                        f"segment_characters={len(text)}, response={response.text[:2000]}",
                        request=response.request,
                        response=response,
                    )
                response_items = response.json()
                if not isinstance(response_items, list) or not response_items:
                    raise ValueError("Bing returned no translation response items.")
                result = TranslationResponse.model_validate(response_items[0])
                translated = result.translations[0].text
                with self.lock:
                    self.cache[text] = translated
                return translated
        raise RuntimeError("Bing translation retries ended without a result.")

    def translate(self, text: str) -> str:
        with self.lock:
            cached = self.cache.get(text)
        if cached is not None:
            return cached
        try:
            parts = re.split(r"(\{v\d+\})", text)
            translated_parts: list[str] = []
            for part in parts:
                if re.fullmatch(r"\{v\d+\}", part) or not part.strip():
                    translated_parts.append(part)
                    continue
                leading = part[: len(part) - len(part.lstrip())]
                trailing = part[len(part.rstrip()) :]
                translated_parts.append(
                    leading
                    + " ".join(
                        self.request_segment(segment.strip())
                        for segment in split_segments(part.strip(), 900)
                    )
                    + trailing
                )
            translated = "".join(translated_parts)
        except (httpx.HTTPError, ValueError) as error:
            raise ProviderExhaustedError(str(error)) from error
        with self.lock:
            self.cache[text] = translated
        return translated

    def close(self) -> None:
        self.client.close()
