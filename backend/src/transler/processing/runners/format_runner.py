"""Format parser subprocess entry point."""

import resource
import sys
from pathlib import Path

from transler.core.contracts import ApiError
from transler.core.errors import TranslerError
from transler.processing.operations.formats import analyze_file


def main() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        result = analyze_file(Path(sys.argv[1]).read_bytes(), sys.argv[2])
        print(result.model_dump_json())
    except TranslerError as error:
        print(ApiError(code=error.code, message=error.message).model_dump_json())
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
