"""HTTP and persistence contracts; unknown external fields are ignored."""

from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, from_attributes=True)


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    RETRYING = "RETRYING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLING = "CANCELLING"
    CANCELLED = "CANCELLED"


Language = Literal["en", "vi", "zh", "ja", "ko", "fr", "de", "es", "pt", "ru"]
SourceLanguage = Literal["auto"] | Language
BasicProvider = Literal["bing", "google", "azure", "deepl"]


class ImportRequest(Contract):
    url: HttpUrl


class TranslationRequest(Contract):
    document_id: UUID
    source_language: SourceLanguage
    target_language: Language
    mode: Literal["basic"]

    @model_validator(mode="after")
    def validate_languages(self) -> "TranslationRequest":
        if self.source_language == self.target_language:
            raise ValueError("Source and target languages must differ.")
        return self


class DocumentView(Contract):
    id: UUID
    filename: str
    source_format: str
    favorite: bool
    deleted_at: datetime | None
    page_count: int
    size: int
    checksum: str
    created_at: datetime
    artifact_id: UUID


class QualityWarning(Contract):
    code: str
    page: int
    message: str


class QualityReport(Contract):
    page_count: int
    pages_with_text: int
    overflow_count: int
    warnings: tuple[QualityWarning, ...]
    assessment: Literal["heuristic"]


class JobError(Contract):
    code: str
    message: str


class JobView(Contract):
    id: UUID
    document_id: UUID
    source_language: SourceLanguage
    target_language: Language
    provider: BasicProvider | Literal["groq"]
    kind: str
    total_units: int = Field(ge=1)
    llm_model: str | None
    status: JobStatus
    stage: str
    progress: int
    completed_pages: int
    attempt_count: int
    max_attempts: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    artifact_id: UUID | None
    error: JobError | None
    quality_report: QualityReport | None


class JobRecord(JobView):
    owner_id: UUID
    idempotency_key: str
    run_token: UUID | None
    lease_until: datetime | None
    checkpoint_key: str | None
    input_artifact_id: UUID | None
    translation_cache: dict[str, str]


class ArtifactRecord(Contract):
    id: UUID
    owner_id: UUID
    document_id: UUID
    storage_key: str
    filename: str
    size: int
    checksum: str
    mime_type: str
    units: int = Field(ge=1)


class ApiError(Contract):
    code: str
    message: str


class ProviderView(Contract):
    id: BasicProvider
    name: str
    mode: Literal["basic"]


class PageView(Contract):
    number: int
    width: float
    height: float
    text_characters: int


class DocumentAnalysis(Contract):
    page_count: int = Field(gt=0)
    pages: tuple[PageView, ...]
