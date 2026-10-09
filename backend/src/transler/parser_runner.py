"""Resource-limited native PDF validator with a structured subprocess contract."""

import resource
import sys
from pathlib import Path

from transler.contracts import ApiError
from transler.errors import TranslerError
from transler.pdf import analyze_pdf_native


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("PDF parser requires exactly one source file path.")
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    try:
        result = analyze_pdf_native(Path(sys.argv[1]).read_bytes())
    except TranslerError as error:
        sys.stdout.write(ApiError(code=error.code, message=error.message).model_dump_json())
        raise SystemExit(2) from error
    sys.stdout.write(result.model_dump_json())


if __name__ == "__main__":
    main()
