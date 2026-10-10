"""PostgreSQL connector and schema shared by HTTP and worker processes."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.engine import Engine

from transler.core.config import Settings

metadata = MetaData()
sessions = Table(
    "sessions",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("token_hash", String(64), unique=True, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
documents = Table(
    "documents",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("owner_id", UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True),
    Column("filename", String(255), nullable=False),
    Column("page_count", Integer, nullable=False),
    Column("size", Integer, nullable=False),
    Column("checksum", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("artifact_id", UUID(as_uuid=True), nullable=False),
    Column("native_text", Boolean),
    Column("source_format", String(16), nullable=False, server_default="pdf"),
    Column("favorite", Boolean, nullable=False, server_default="false"),
    Column("deleted_at", DateTime(timezone=True)),
    CheckConstraint("page_count BETWEEN 1 AND 30"),
)
artifacts = Table(
    "artifacts",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("owner_id", UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False),
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False),
    Column("storage_key", String(512), unique=True, nullable=False),
    Column("filename", String(255), nullable=False),
    Column("size", Integer, nullable=False),
    Column("checksum", String(64), nullable=False),
    Column("mime_type", String(100), nullable=False, server_default="application/pdf"),
    Column("units", Integer, nullable=False, server_default="1"),
)
jobs = Table(
    "jobs",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("owner_id", UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True),
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False),
    Column("idempotency_key", String(128), nullable=False),
    Column("source_language", String(16), nullable=False),
    Column("target_language", String(16), nullable=False),
    Column("provider", String(16), nullable=False, server_default="bing"),
    Column("kind", String(24), nullable=False, server_default="pdf_basic"),
    Column("total_units", Integer, nullable=False, server_default="1"),
    Column("llm_model", String(128)),
    Column("options", JSONB, nullable=False, server_default="{}"),
    Column("translation_cache", JSONB, nullable=False, server_default="{}"),
    Column("input_artifact_id", UUID(as_uuid=True), ForeignKey("artifacts.id")),
    Column("status", String(16), nullable=False, index=True),
    Column("stage", String(64), nullable=False),
    Column("progress", Integer, nullable=False),
    Column("completed_pages", Integer, nullable=False),
    Column("attempt_count", Integer, nullable=False),
    Column("max_attempts", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("artifact_id", UUID(as_uuid=True), ForeignKey("artifacts.id")),
    Column("error", JSONB),
    Column("quality_report", JSONB),
    Column("run_token", UUID(as_uuid=True)),
    Column("lease_until", DateTime(timezone=True)),
    Column("checkpoint_key", String(512)),
    Column("pipeline_manifest_key", String(512)),
    UniqueConstraint("owner_id", "idempotency_key", name="uq_job_idempotency"),
    CheckConstraint("progress BETWEEN 0 AND 100"),
    CheckConstraint("attempt_count BETWEEN 0 AND max_attempts"),
)


def connect_database(settings: Settings) -> Engine:
    return create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)


plans = Table(
    "plans",
    metadata,
    Column("code", String(24), primary_key=True),
    Column("name", String(80), nullable=False),
    Column("monthly_pages", Integer, nullable=False),
    Column("document_limit", Integer, nullable=False),
    Column("max_active_jobs", Integer, nullable=False),
    Column("duration_days", Integer, nullable=False),
    Column("price_vnd", Integer),
    Column("price_usd_cents", Integer),
    Column("yearly_price_vnd", Integer),
    Column("yearly_price_usd_cents", Integer),
    Column("enabled", Boolean, nullable=False),
    CheckConstraint(
        "monthly_pages > 0 AND document_limit > 0 "
        "AND max_active_jobs BETWEEN 1 AND 2 AND duration_days BETWEEN 1 AND 366"
    ),
    CheckConstraint("price_vnd IS NULL OR price_vnd > 0"),
    CheckConstraint("price_usd_cents IS NULL OR price_usd_cents > 0"),
    CheckConstraint(
        "yearly_price_vnd IS NULL OR yearly_price_vnd > 0", name="plans_yearly_vnd_positive"
    ),
    CheckConstraint(
        "yearly_price_usd_cents IS NULL OR yearly_price_usd_cents > 0",
        name="plans_yearly_usd_positive",
    ),
)
accounts = Table(
    "accounts",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column(
        "workspace_id", UUID(as_uuid=True), ForeignKey("sessions.id"), unique=True, nullable=False
    ),
    Column("email", String(254), unique=True, nullable=False),
    Column("name", String(80), nullable=False),
    Column("password_hash", String(255), nullable=False),
    Column("role", String(16), nullable=False),
    Column("is_active", Boolean, nullable=False),
    Column("plan_code", String(24), ForeignKey("plans.code"), nullable=False),
    Column("plan_expires_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("role IN ('user', 'admin')"),
)
auth_sessions = Table(
    "auth_sessions",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("account_id", UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, index=True),
    Column("token_hash", String(64), unique=True, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
tool_settings = Table(
    "tool_settings",
    metadata,
    Column("code", String(24), primary_key=True),
    Column("enabled", Boolean, nullable=False),
)
payment_orders = Table(
    "payment_orders",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("account_id", UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, index=True),
    Column("request_id", UUID(as_uuid=True), nullable=False),
    Column("plan_code", String(24), ForeignKey("plans.code"), nullable=False),
    Column("provider", String(16), nullable=False),
    Column("billing_cycle", String(8), nullable=False, server_default="monthly"),
    Column("amount", Integer, nullable=False),
    Column("currency", String(3), nullable=False),
    Column("duration_days", Integer, nullable=False),
    Column("reference", String(40), unique=True, nullable=False),
    Column("checkout_id", String(255), unique=True),
    Column("checkout_url", String(2048)),
    Column("status", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("paid_at", DateTime(timezone=True)),
    Column("review_reason", String(255)),
    UniqueConstraint("account_id", "request_id", name="uq_account_checkout_request"),
    CheckConstraint("amount > 0 AND duration_days > 0"),
    CheckConstraint("billing_cycle IN ('monthly','yearly')", name="orders_billing_cycle_valid"),
    CheckConstraint("provider IN ('sepay', 'stripe', 'card')"),
    CheckConstraint("status IN ('PENDING', 'PAID', 'EXPIRED', 'REVIEW', 'CANCELLED')"),
)
payment_events = Table(
    "payment_events",
    metadata,
    Column("provider", String(16), primary_key=True),
    Column("event_id", String(255), primary_key=True),
    Column("order_id", UUID(as_uuid=True), ForeignKey("payment_orders.id")),
    Column("fingerprint", String(64), nullable=False),
    Column("outcome", String(80), nullable=False),
    Column("received_at", DateTime(timezone=True), nullable=False),
)
audit_events = Table(
    "audit_events",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("actor_id", UUID(as_uuid=True), ForeignKey("accounts.id")),
    Column("action", String(80), nullable=False),
    Column("target", String(255), nullable=False),
    Column("detail", String(1000), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

usage_ledger = Table(
    "usage_ledger",
    metadata,
    Column("job_id", UUID(as_uuid=True), primary_key=True),
    Column("owner_id", UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False, index=True),
    Column("pages", Integer, nullable=False),
    Column("status", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("status IN ('RESERVED', 'CONSUMED', 'RELEASED')"),
    CheckConstraint("pages > 0"),
)

provider_settings = Table(
    "provider_settings",
    metadata,
    Column("provider", String(24), primary_key=True),
    Column("enabled", Boolean, nullable=False),
    Column("settings", JSONB, nullable=False),
    Column("encrypted_secrets", String, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("updated_by", UUID(as_uuid=True), ForeignKey("accounts.id")),
    CheckConstraint("provider IN ('sepay', 'stripe')"),
)

document_revisions = Table(
    "document_revisions",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False),
    Column("revision", Integer, nullable=False),
    Column("job_id", UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False),
    Column("base_artifact_id", UUID(as_uuid=True), ForeignKey("artifacts.id"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("document_id", "revision", name="uq_document_revision"),
)
api_keys = Table(
    "api_keys",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("account_id", UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False),
    Column("name", String(80), nullable=False),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("prefix", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("last_used_at", DateTime(timezone=True)),
)

shared_artifacts = Table(
    "shared_artifacts",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    Column("artifact_id", UUID(as_uuid=True), ForeignKey("artifacts.id"), nullable=False),
    Column("owner_id", UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False),
    Column("token_hash", String(64), unique=True, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
