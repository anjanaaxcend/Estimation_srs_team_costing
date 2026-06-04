from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.services.ingestion.file_processor import FileProcessor
from app.services.ingestion.text_processor import TextProcessor


@dataclass
class NormalizedInput:
    raw_text: str
    cleaned_text: str
    source: str


text_processor = TextProcessor()
file_processor = FileProcessor()


def normalize_input(
    input_data: str | bytes,
    *,
    source: str | None = None,
    filename: str | None = None,
) -> NormalizedInput:
    detected_source = source or _detect_source(input_data=input_data, filename=filename)

    if detected_source == "text":
        if not isinstance(input_data, str):
            raise ValueError("Text source expects string input.")
        raw_text = input_data
    elif detected_source == "file":
        if not isinstance(input_data, bytes) or not filename:
            raise ValueError("File source expects file bytes and filename.")
        raw_text = file_processor.extract_text(filename, input_data)
    else:
        raise ValueError(f"Unsupported input source '{detected_source}'.")

    cleaned_text = text_processor.clean(raw_text)
    return NormalizedInput(raw_text=raw_text, cleaned_text=cleaned_text, source=detected_source)


def _detect_source(input_data: str | bytes, filename: str | None) -> str:
    if isinstance(input_data, str):
        return "text"
    if not filename:
        raise ValueError("Filename is required to detect non-text input type.")

    extension = Path(filename).suffix.lower()
    if extension in {".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".rtf", ".csv", ".json"}:
        return "file"
    if extension == ".doc":
        raise ValueError("Legacy .doc files are not supported yet. Please convert the file to .docx or PDF.")
    raise ValueError(f"Unsupported file type '{extension}'.")
