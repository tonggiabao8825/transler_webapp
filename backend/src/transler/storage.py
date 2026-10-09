"""Private S3 object connector with bounded, logged service retries."""

from typing import TYPE_CHECKING

import boto3
import structlog
from botocore.config import Config

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

from transler.config import Settings


class ObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket
        self.client: S3Client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(connect_timeout=10, read_timeout=30, retries={"total_max_attempts": 1}),
        )

    def put(self, key: str, content: bytes) -> None:
        from transler.retries import service_retry

        for attempt in service_retry("s3.put", {"bucket": self.bucket, "key": key}):
            with attempt:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=content,
                    ContentType="application/pdf",
                )

    def get(self, key: str) -> bytes:
        from transler.retries import service_retry

        for attempt in service_retry("s3.get", {"bucket": self.bucket, "key": key}):
            with attempt:
                result = self.client.get_object(Bucket=self.bucket, Key=key)
                with result["Body"] as body:
                    return body.read()
        raise RuntimeError("S3 retry loop ended without returning or raising.")

    def delete(self, keys: tuple[str, ...]) -> None:
        from transler.retries import service_retry

        if not keys:
            return
        for attempt in service_retry("s3.delete", {"bucket": self.bucket, "keys": keys}):
            with attempt:
                result = self.client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": [{"Key": key} for key in keys]},
                )
                if result.get("Errors"):
                    structlog.get_logger().error("storage_delete_failed", errors=result["Errors"])
                    raise OSError(f"S3 refused to delete objects: {result['Errors']}")

    def delete_prefix(self, prefix: str) -> None:
        from transler.retries import service_retry

        for attempt in service_retry("s3.list", {"bucket": self.bucket, "prefix": prefix}):
            with attempt:
                pages = self.client.get_paginator("list_objects_v2").paginate(
                    Bucket=self.bucket,
                    Prefix=prefix,
                )
                for page in pages:
                    self.delete(tuple(item["Key"] for item in page.get("Contents", [])))
