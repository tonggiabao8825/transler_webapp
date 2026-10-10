"""Persist private mixed-PDF engine manifests independently from PDF checkpoints."""

import sqlalchemy as sa
from alembic import op

revision: str = "b709184ce031"
down_revision: str | None = "f204271dab12"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("pipeline_manifest_key", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "pipeline_manifest_key")
