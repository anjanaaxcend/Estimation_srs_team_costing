from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path

from docx import Document
from pypdf import PdfReader


class FileProcessor:
    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".rtf", ".csv", ".json"}

    def extract_text(self, filename: str, file_bytes: bytes) -> str:
        extension = Path(filename).suffix.lower()
        if extension not in self.SUPPORTED_EXTENSIONS:
            if extension == ".doc":
                raise ValueError("Legacy .doc files are not supported yet. Please save the document as .docx or PDF and try again.")
            raise ValueError("Unsupported file type. Supported types: PDF, DOCX, TXT, MD, RTF, CSV, JSON.")
        if not file_bytes:
            raise ValueError("Uploaded file is empty.")

        if extension == ".pdf":
            return self._extract_pdf_text(file_bytes)
        if extension == ".docx":
            return self._extract_docx_text(file_bytes)
        if extension in {".xlsx", ".xls"}:
            return self._extract_xlsx_text(file_bytes)
        if extension == ".rtf":
            return self._extract_rtf_text(file_bytes)
        return self._extract_plain_text(file_bytes)

    def _extract_pdf_text(self, file_bytes: bytes) -> str:
        reader = PdfReader(BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        combined = "\n".join(page.strip() for page in pages if page.strip())
        if not combined:
            raise ValueError("No readable text found in PDF.")
        return combined

    def _extract_docx_text(self, file_bytes: bytes) -> str:
        document = Document(BytesIO(file_bytes))
        paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
        combined = "\n".join(paragraphs)
        if not combined:
            raise ValueError("No readable text found in DOCX.")
        return combined

    def _extract_plain_text(self, file_bytes: bytes) -> str:
        try:
            decoded = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            decoded = file_bytes.decode("latin-1")

        combined = decoded.strip()
        if not combined:
            raise ValueError("No readable text found in the uploaded file.")
        return combined

    def _extract_rtf_text(self, file_bytes: bytes) -> str:
        raw_text = self._extract_plain_text(file_bytes)
        without_controls = re.sub(r"\\[a-z]+\d* ?", "", raw_text)
        without_braces = without_controls.replace("{", "").replace("}", "")
        without_hex = re.sub(r"\\'[0-9a-fA-F]{2}", "", without_braces)
        combined = re.sub(r"\s+", " ", without_hex).strip()
        if not combined:
            raise ValueError("No readable text found in RTF.")
        return combined
    def _extract_xlsx_text(self, file_bytes: bytes) -> str:
        import openpyxl
        wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
        lines = []
        for sheet in wb.worksheets:
            lines.append(f"SHEET: {sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                # Filter out None and join as string
                row_text = " | ".join(str(val) for val in row if val is not None).strip()
                if row_text:
                    lines.append(row_text)
            lines.append("") # Spacer between sheets
        
        combined = "\n".join(lines).strip()
        if not combined:
            raise ValueError("No readable text found in Excel file.")
        return combined
