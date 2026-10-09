"""Bounded retries for transient external transport failures only."""

import httpx
import structlog
from botocore.exceptions import ClientError, ConnectionClosedError, EndpointConnectionError
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError
from tenacity import (
    RetryCallState,
    Retrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)


def is_transient(error: BaseException) -> bool:
    if isinstance(error, ClientError):
        return error.response["ResponseMetadata"]["HTTPStatusCode"] in {429, 500, 502, 503, 504}
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in {429, 500, 502, 503, 504}
    return isinstance(
        error,
        (
            httpx.TransportError,
            EndpointConnectionError,
            ConnectionClosedError,
            RedisConnectionError,
            RedisTimeoutError,
        ),
    )


def service_retry(operation: str, params: dict[str, str | tuple[str, ...]]) -> Retrying:
    def warn(state: RetryCallState) -> None:
        structlog.get_logger().warning(
            "external_service_retry",
            operation=operation,
            params=params,
            attempt=state.attempt_number,
            error=str(state.outcome.exception()) if state.outcome else "",
        )

    return Retrying(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, max=4),
        retry=retry_if_exception(is_transient),
        before_sleep=warn,
        reraise=True,
    )
