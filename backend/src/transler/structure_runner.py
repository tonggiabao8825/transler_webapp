"""Bounded subprocess entry point for editor geometry inspection."""

import resource
import sys
from pathlib import Path

from pydantic import TypeAdapter

from transler.contracts import ApiError
from transler.errors import TranslerError
from transler.structure import PageStructure, pdf_structure


def main() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    try:
        pages = pdf_structure(Path(sys.argv[1]).read_bytes())
    except TranslerError as error:
        print(ApiError(code=error.code, message=error.message).model_dump_json())
        raise SystemExit(2) from error
    print(TypeAdapter(tuple[PageStructure, ...]).dump_json(pages).decode())


if __name__ == "__main__":
    main()
