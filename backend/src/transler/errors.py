"""Specific failures exposed at API and worker boundaries."""


class TranslerError(Exception):
    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class EngineError(TranslerError):
    def __init__(self, message: str) -> None:
        super().__init__("TRANSLATION_ENGINE_FAILED", message, 502)


class JobCancelledError(Exception):
    """The owner cancelled a job or this worker lost its execution lease."""
