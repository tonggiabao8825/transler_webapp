"""snapshot llm model"""

import sqlalchemy as sa
from alembic import op

revision: str = "9edaf0149a78"
down_revision: str | None = "01f9f636a4ed"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("llm_model", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "llm_model")
