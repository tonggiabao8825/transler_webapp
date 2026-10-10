"""Job-scoped disk cache coalesces concurrent requests for the same translation unit."""

import json
from collections.abc import Callable
from concurrent.futures import Future
from pathlib import Path
from threading import Lock


class TranslationCache:
    def __init__(self, cached: dict[str, str], cache_file: Path | None) -> None:
        self.values = dict(cached)
        self.cache_file = cache_file
        self.pending: dict[str, Future[str]] = {}
        self.lock = Lock()

    def translate(self, key: str, request: Callable[[], str]) -> str:
        with self.lock:
            cached = self.values.get(key)
            if cached is not None:
                return cached
            future = self.pending.get(key)
            owner = future is None
            if future is None:
                future = Future[str]()
                self.pending[key] = future
        if not owner:
            return future.result()
        try:
            result = request()
            with self.lock:
                updated = {**self.values, key: result}
                if self.cache_file is not None:
                    temporary = self.cache_file.with_suffix(".tmp")
                    temporary.write_text(json.dumps(updated, ensure_ascii=False))
                    temporary.replace(self.cache_file)
                self.values = updated
                del self.pending[key]
            future.set_result(result)
            return result
        except BaseException as error:
            # Every waiter receives the original error, including vendor-boundary BaseExceptions.
            future.set_exception(error)
            raise
