from __future__ import annotations

from collections.abc import Iterable


def unique_model_candidates(*groups: Iterable[str | None]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for group in groups:
        for item in group:
            cleaned = (item or "").strip()
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            ordered.append(cleaned)
    return ordered


def is_model_unavailable_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    text = str(exc).lower()
    
    # Standard status codes indicating model unavailability, rate limit or not found
    if status_code in {400, 404, 429, 500, 503}:
        if "model" in text or "quota" in text or "rate limit" in text or "rate_limit" in text or "limit exceeded" in text:
            return True

    phrases = (
        "model not available",
        "model is not available",
        "model does not exist",
        "does not exist",
        "model not found",
        "model_not_found",
        "unknown model",
        "unsupported model",
        "invalid model",
        "no such model",
        "has been decommissioned",
        "quota exceeded",
        "rate limit",
        "rate_limit",
        "resource_exhausted",
        "not found",
    )
    return any(phrase in text for phrase in phrases)


def is_quota_or_rate_limit_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    text = str(exc).lower()
    phrases = (
        "quota exceeded",
        "rate limit",
        "rate_limit",
        "resource_exhausted",
        "quota",
        "too many requests",
        "limit exceeded",
    )
    return (
        status_code in {429, 503}
        or any(phrase in text for phrase in phrases)
    )


def repair_json_string(raw_json: str) -> str:
    """Attempt to clean up common LLM JSON formatting issues (like trailing commas, unescaped newlines, etc.)."""
    import re
    if not raw_json:
        return raw_json
        
    cleaned = raw_json.strip()
    
    # 1. Strip markdown code blocks if present
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'```\s*$', '', cleaned)
    cleaned = cleaned.strip()
    
    # 2. Fix trailing commas in objects and arrays
    # e.g., {"a": 1, } -> {"a": 1}
    # e.g., [1, 2, ] -> [1, 2]
    cleaned = re.sub(r',(\s*[\]\}])', r'\1', cleaned)
    
    # 3. Handle unescaped newlines inside JSON string literals
    in_string = False
    escaped = False
    result_chars = []
    
    chars = list(cleaned)
    i = 0
    n = len(chars)
    while i < n:
        char = chars[i]
        if char == '"' and not escaped:
            in_string = not in_string
            result_chars.append(char)
        elif char == '\\' and in_string and not escaped:
            escaped = True
            result_chars.append(char)
        else:
            if escaped:
                escaped = False
            
            if in_string:
                if char == '\n':
                    result_chars.append('\\n')
                elif char == '\r':
                    result_chars.append('\\r')
                elif char == '\t':
                    result_chars.append('\\t')
                elif ord(char) < 32:
                    # Escape other control characters
                    result_chars.append(f'\\u{ord(char):04x}')
                else:
                    result_chars.append(char)
            else:
                result_chars.append(char)
        i += 1
        
    return "".join(result_chars)


