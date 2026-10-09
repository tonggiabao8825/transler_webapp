"""Persist administrator-controlled availability for the twelve workspace tools."""

import sqlalchemy as sa
from alembic import op

revision: str = "f204271dab12"
down_revision: str | None = "a419f172db30"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    table = op.create_table(
        "tool_settings",
        sa.Column("code", sa.String(24), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.bulk_insert(
        table,
        [
            {"code": code, "enabled": True}
            for code in (
                "translate",
                "editor",
                "convert",
                "documents",
                "ocr",
                "merge",
                "split",
                "compress",
                "pdf_to_images",
                "images_to_pdf",
                "protect",
                "unlock",
            )
        ],
    )


def downgrade() -> None:
    op.drop_table("tool_settings")
