"""One isolated engine per job with acknowledged, atomic page checkpoints."""

import argparse
import sys
from pathlib import Path
from typing import cast

import pymupdf

from transler.contracts import BasicProvider
from transler.pdf_layout import PDFLayout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--original", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--provider", required=True, choices=["bing", "google", "azure", "deepl"])
    parser.add_argument("--start-page", required=True, type=int)
    parser.add_argument("--source-language", required=True)
    parser.add_argument("--target-language", required=True)
    arguments = parser.parse_args()
    adapter = PDFLayout(
        cast(BasicProvider, arguments.provider),
        arguments.source_language,
        arguments.target_language,
        None,
    )
    try:
        with (
            pymupdf.open(arguments.original) as original,
            pymupdf.open(arguments.checkpoint) as result,
        ):
            outline = result.get_toc()
            for index in range(arguments.start_page, original.page_count):
                with pymupdf.open() as single:
                    single.insert_pdf(original, from_page=index, to_page=index, links=False)
                    translated = adapter.translate_page(single.tobytes())
                with pymupdf.open(stream=translated, filetype="pdf") as page:
                    result.delete_page(index)
                    result.insert_pdf(page, start_at=index)
                for link in original[index].get_links():
                    preserved = {
                        key: value for key, value in link.items() if key not in {"xref", "id"}
                    }
                    result[index].insert_link(preserved)
                if outline:
                    result.set_toc(outline)
                completed = index + 1
                temporary = arguments.output_directory / f"page-{completed}.tmp"
                target = arguments.output_directory / f"page-{completed}.pdf"
                result.save(temporary, deflate=True, garbage=3)
                temporary.replace(target)
                acknowledgement = sys.stdin.readline().strip()
                if acknowledgement != str(completed):
                    raise ValueError(f"Checkpoint {completed} received invalid acknowledgement.")
    finally:
        adapter.close()


if __name__ == "__main__":
    main()
