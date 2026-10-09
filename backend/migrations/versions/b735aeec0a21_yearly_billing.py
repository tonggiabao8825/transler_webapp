"""Explicit annual prices and immutable order billing cycles."""

import sqlalchemy as sa
from alembic import op

revision: str = "b735aeec0a21"
down_revision: str | None = "9edaf0149a78"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("plans", sa.Column("yearly_price_vnd", sa.Integer(), nullable=True))
    op.add_column("plans", sa.Column("yearly_price_usd_cents", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "plans_yearly_vnd_positive", "plans", "yearly_price_vnd IS NULL OR yearly_price_vnd > 0"
    )
    op.create_check_constraint(
        "plans_yearly_usd_positive",
        "plans",
        "yearly_price_usd_cents IS NULL OR yearly_price_usd_cents > 0",
    )
    op.add_column(
        "payment_orders",
        sa.Column("billing_cycle", sa.String(8), nullable=False, server_default="monthly"),
    )
    op.create_check_constraint(
        "orders_billing_cycle_valid", "payment_orders", "billing_cycle IN ('monthly','yearly')"
    )


def downgrade() -> None:
    op.drop_constraint("orders_billing_cycle_valid", "payment_orders", type_="check")
    op.drop_column("payment_orders", "billing_cycle")
    op.drop_constraint("plans_yearly_usd_positive", "plans", type_="check")
    op.drop_constraint("plans_yearly_vnd_positive", "plans", type_="check")
    op.drop_column("plans", "yearly_price_usd_cents")
    op.drop_column("plans", "yearly_price_vnd")
