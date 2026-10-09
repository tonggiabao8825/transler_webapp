"""Alembic migration environment uses the same validated database configuration."""

from logging.config import fileConfig

from alembic import context

from transler.config import Settings
from transler.db import connect_database, metadata

fileConfig(context.config.config_file_name)


def run_migrations() -> None:
    engine = connect_database(Settings())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations()
