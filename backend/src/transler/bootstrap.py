"""Provision a private bucket and expire unreferenced objects after seven days."""

from botocore.exceptions import ClientError

from transler.core.config import Settings
from transler.core.retries import service_retry
from transler.infrastructure.storage import ObjectStorage


def provision_storage(settings: Settings) -> None:
    storage = ObjectStorage(settings)
    for attempt in service_retry("s3.provision", {"bucket": storage.bucket}):
        with attempt:
            try:
                storage.client.head_bucket(Bucket=storage.bucket)
            except ClientError as error:
                if error.response["ResponseMetadata"]["HTTPStatusCode"] != 404:
                    raise
                storage.client.create_bucket(Bucket=storage.bucket)
            storage.client.put_bucket_lifecycle_configuration(
                Bucket=storage.bucket,
                LifecycleConfiguration={
                    "Rules": [
                        {
                            "ID": "incomplete-uploads",
                            "Status": "Enabled",
                            "Filter": {"Prefix": ""},
                            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                        }
                    ]
                },
            )


if __name__ == "__main__":
    provision_storage(Settings())
