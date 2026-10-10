"""Celery composition root; job execution and state transitions live in jobs."""

from uuid import UUID

from celery import Celery

from transler.core.config import Settings
from transler.jobs.dispatch import pending_jobs
from transler.jobs.retention import expire_guest_data as expire_workspaces
from transler.jobs.service import perform_job

configuration = Settings()
celery = Celery("transler", broker=configuration.redis_url)
celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    worker_redirect_stdouts_level="INFO",
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=3,
    task_publish_retry_policy={
        "max_retries": 3,
        "interval_start": 1,
        "interval_step": 1,
        "interval_max": 3,
    },
    task_serializer="json",
    accept_content=["json"],
    beat_schedule={
        "dispatch-durable-jobs": {"task": "transler.dispatch", "schedule": 5.0},
        "expire-guest-data": {"task": "transler.expire", "schedule": 3600.0},
    },
)


@celery.task(name="transler.execute")
def run_job(job_id: str) -> None:
    perform_job(Settings(), UUID(job_id))


@celery.task(name="transler.dispatch")
def dispatch() -> None:
    for job_id in pending_jobs(Settings()):
        run_job.apply_async(args=(str(job_id),), queue="pdf")


@celery.task(name="transler.expire")
def expire_guest_data() -> None:
    expire_workspaces(Settings())
