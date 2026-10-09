"""Payment orders can be explicitly cancelled without losing their history."""

from alembic import op

revision: str = "a419f172db30"
down_revision: str | None = "b735aeec0a21"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.drop_constraint("payment_orders_status_check", "payment_orders", type_="check")
    op.create_check_constraint(
        "payment_orders_status_check",
        "payment_orders",
        "status IN ('PENDING','PAID','EXPIRED','REVIEW','CANCELLED')",
    )


def downgrade() -> None:
    op.drop_constraint("payment_orders_status_check", "payment_orders", type_="check")
    op.create_check_constraint(
        "payment_orders_status_check",
        "payment_orders",
        "status IN ('PENDING','PAID','EXPIRED','REVIEW')",
    )
