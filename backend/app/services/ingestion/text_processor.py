from __future__ import annotations

import re


class TextProcessor:
    def clean(self, raw_text: str) -> str:
        if not raw_text or not raw_text.strip():
            raise ValueError("Input text cannot be empty.")

        # Normalize line endings
        normalized = raw_text.replace("\r\n", "\n").replace("\r", "\n")
        
        # Clean up excessive horizontal spacing in each line, but preserve the lines
        lines = []
        for line in normalized.split("\n"):
            line_cleaned = re.sub(r"[ \t]+", " ", line).strip()
            lines.append(line_cleaned)
        
        # Join lines and collapse multiple consecutive newlines to maximum of 2
        joined = "\n".join(lines)
        joined = re.sub(r"\n{3,}", "\n\n", joined)
        
        return joined.strip()

