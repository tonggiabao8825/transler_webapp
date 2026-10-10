"""Translate editable text nodes while preserving native Office and markup structures."""

import re
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree
from markdown_it import MarkdownIt

from transler.processing.operations.formats import OFFICE_TEXT_TAGS, office_files, xml_root
from transler.processing.translation.llm import LLMTranslation


def office_context(content: bytes) -> str:
    paragraphs: list[str] = []
    for name, data in office_files(content):
        if name.endswith(".xml") and (
            name.startswith("word/") or name.startswith("ppt/slides/") or name.startswith("xl/")
        ):
            paragraphs.extend(
                str(element.text)
                for element in xml_root(data).iter()
                if element.tag in OFFICE_TEXT_TAGS and element.text
            )
    return "\n".join(paragraphs)[:5000]


def translate_office(content: bytes, translator: LLMTranslation) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, data in office_files(content):
            if name.endswith(".xml") and (
                name.startswith("word/")
                or name.startswith("ppt/slides/")
                or name.startswith("ppt/notesSlides/")
                or name.startswith("xl/sharedStrings")
                or name.startswith("xl/worksheets/")
            ):
                root = xml_root(data)
                for element in root.iter():
                    if element.tag in OFFICE_TEXT_TAGS and element.text and element.text.strip():
                        element.text = translator.translate(element.text)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
            archive.writestr(name, data)
    return output.getvalue()


def translate_markdown_part(part: str, translator: LLMTranslation, pattern: str) -> str:
    link = re.fullmatch(r"(!?)\[([^\]]*)\]\(([^)]*)\)", part)
    if link:
        label = translator.translate(link.group(2)) if link.group(2).strip() else link.group(2)
        return f"{link.group(1)}[{label}]({link.group(3)})"
    if re.fullmatch(pattern, part) or not part.strip():
        return part
    return translator.translate(part)


def translate_markdown(content: bytes, translator: LLMTranslation) -> bytes:
    source = content.decode("utf-8")
    tokens = MarkdownIt().parse(source)
    protected: set[int] = set()
    for token in tokens:
        if token.type in {"fence", "code_block", "html_block"} and token.map:
            protected.update(range(token.map[0], token.map[1]))
    lines = source.splitlines(keepends=True)
    if lines and lines[0].strip() == "---":
        for index, line in enumerate(lines[1:], 1):
            protected.add(index)
            if line.strip() == "---":
                break
        protected.add(0)
    result: list[str] = []
    pattern = r"`[^`]*`|!?\[[^\]]*\]\([^)]*\)|https?://\S+|[*_#>]+|^\s*(?:[-+] |\d+\. )"
    for index, line in enumerate(lines):
        if index in protected or not line.strip():
            result.append(line)
            continue
        parts = re.split("(" + pattern + ")", line)
        result.append("".join(translate_markdown_part(part, translator, pattern) for part in parts))
    return "".join(result).encode()


def translate_html(content: bytes, translator: LLMTranslation) -> bytes:
    from bs4 import BeautifulSoup, Comment, Declaration, Doctype, ProcessingInstruction

    soup = BeautifulSoup(content, "html.parser")
    for node in tuple(soup.find_all(string=True)):
        if (
            isinstance(node, (Comment, Doctype, Declaration, ProcessingInstruction))
            or node.parent is None
            or any(
                parent.name in {"script", "style", "code", "pre", "textarea"}
                for parent in node.parents
            )
            or not str(node).strip()
        ):
            continue
        source = str(node)
        left = source[: len(source) - len(source.lstrip())]
        right = source[len(source.rstrip()) :]
        node.replace_with(left + translator.translate(source.strip()) + right)
    return str(soup).encode()


def translate_plain(content: bytes, translator: LLMTranslation) -> bytes:
    return "".join(
        translator.translate(line.rstrip("\r\n")) + line[len(line.rstrip("\r\n")) :]
        if line.strip()
        else line
        for line in content.decode("utf-8").splitlines(keepends=True)
    ).encode()


def translate_file(content: bytes, source_format: str, translator: LLMTranslation) -> bytes:
    if source_format in {"docx", "pptx", "xlsx"}:
        return translate_office(content, translator)
    registry = {"md": translate_markdown, "html": translate_html, "txt": translate_plain}
    return registry[source_format](content, translator)
