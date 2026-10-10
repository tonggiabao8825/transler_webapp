"""Validated deployment configuration; secrets come from environment variables."""

from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from transler.core.contracts import BasicProvider


class LLMConfig(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")
    llm_api_key: SecretStr | None = Field(default=None, validation_alias="LLM_API_KEY")
    llm_model: str = Field(min_length=1, validation_alias="LLM_MODEL")
    llm_base_url: str = Field(
        pattern=r"^https://api\.groq\.com/openai/v1/?$", validation_alias="LLM_BASE_URL"
    )
    api_provider: Literal["groq"] = Field(validation_alias="API_PROVIDER")


class Settings(LLMConfig):
    model_config = SettingsConfigDict(env_prefix="TRANSLER_", env_file="../.env", extra="ignore")

    database_url: str = Field(min_length=1)
    redis_url: str = Field(min_length=1)
    s3_endpoint: str = Field(min_length=1)
    s3_access_key: str = Field(min_length=1)
    s3_secret_key: str = Field(min_length=1)
    s3_bucket: str = Field(min_length=1)
    secure_cookie: bool = True
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    engine_timeout_seconds: int = Field(default=600, ge=30, le=3600)
    basic_provider: BasicProvider = "bing"
    session_days: int = Field(default=7, ge=7, le=7)
    max_active_jobs: int = Field(default=2, ge=1, le=10)

    settings_key: SecretStr = Field(min_length=64, max_length=64)
    processor_token: SecretStr = Field(min_length=32)
