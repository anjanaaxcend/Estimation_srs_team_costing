import re

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()

# ── In-process cache: { engine: (timestamp, result_dict) } ──────────────────
_rate_limit_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 60.0


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/providers/status")
def providers_status() -> dict:
    """Return which AI providers are configured and enabled (no live API calls made)."""
    return {
        "openai_groq": {
            "enabled": settings.openai_srs_enabled,
            "has_key": bool(settings.openai_api_key),
            "model": settings.openai_srs_model,
            "base_url": settings.openai_api_base,
            "fallback_models": list(settings.openai_srs_fallback_models),
        },
        "gemini": {
            "enabled": bool(settings.gemini_api_key),
            "has_key": bool(settings.gemini_api_key),
            "model": settings.gemini_srs_model,
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "fallback_models": list(settings.gemini_srs_fallback_models),
        },
    }


@router.get("/health/rate-limit")
def get_rate_limit(engine: str = "openai") -> dict:
    """
    Probe the selected AI engine with a minimal 1-token completion and return
    the rate-limit headers so the frontend can display remaining TPM / RPM / TPD.
    Results are cached for 60 seconds per engine to avoid wasting tokens.
    """
    import time
    import json
    import urllib.request
    import urllib.error

    engine = (engine or "openai").strip().lower()
    if engine in {"groq", "openai_groq"}:
        engine = "openai"

    now = time.monotonic()
    if engine in _rate_limit_cache:
        ts, cached = _rate_limit_cache[engine]
        if now - ts < _CACHE_TTL_SECONDS:
            return cached

    # ── Determine API credentials based on engine ────────────────────────────
    if engine == "gemini":
        api_key = settings.gemini_api_key
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
        model = settings.gemini_srs_model or "gemini-2.5-flash-lite"
        console_url = "https://ai.dev/rate-limit"
    else:
        # Default: Groq / OpenAI-compatible endpoint
        api_key = settings.openai_api_key
        base_url = (settings.openai_api_base or "https://api.openai.com/v1").rstrip("/")
        model = settings.openai_srs_model or "gpt-4o-mini"
        console_url = (
            "https://console.groq.com/settings/limits"
            if "groq.com" in (base_url or "")
            else "https://platform.openai.com/usage"
        )

    if not api_key:
        result = {"engine": engine, "status": "no_key", "note": "No API key configured", "console_url": console_url}
        _rate_limit_cache[engine] = (now, result)
        return result

    # ── Fire minimal probe request ────────────────────────────────────────────
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    http_ok = False
    raw_headers: list[tuple[str, str]] = []
    error_payload: dict | None = None
    error_text = ""

    try:
        with urllib.request.urlopen(req, timeout=8.0) as resp:
            http_ok = True
            raw_headers = list(resp.headers.items())
    except urllib.error.HTTPError as e:
        # 429 always contains rate-limit headers; other 4xx may not
        raw_headers = list(e.headers.items()) if e.headers else []
        try:
            error_text = e.read().decode("utf-8", errors="replace")
            error_payload = json.loads(error_text) if error_text else None
        except Exception:
            error_payload = None
        has_rl = any("x-ratelimit" in k.lower() for k, _ in raw_headers)
        if not has_rl:
            retry_seconds = _extract_retry_seconds(error_payload, error_text)
            quota_violations = _extract_quota_violations(error_payload)
            if e.code == 429 or retry_seconds is not None or quota_violations:
                reset_value = f"{retry_seconds}s" if retry_seconds is not None else None
                result = {
                    "engine": engine,
                    "status": "ok",
                    "model": model,
                    "http_ok": False,
                    "console_url": console_url,
                    "note": f"Provider quota response: HTTP {e.code}",
                    "limit_requests": 1 if quota_violations else None,
                    "remaining_requests": 0 if quota_violations else None,
                    "reset_requests": reset_value,
                    "limit_tokens": 1 if quota_violations else None,
                    "remaining_tokens": 0 if quota_violations else None,
                    "reset_tokens": reset_value,
                    "limit_tokens_day": None,
                    "remaining_tokens_day": None,
                    "quota_violations": quota_violations,
                }
            else:
                result = {
                    "engine": engine,
                    "status": "error",
                    "note": f"HTTP {e.code}: {e.reason}",
                    "console_url": console_url,
                }
            _rate_limit_cache[engine] = (now, result)
            return result
    except Exception as e:
        result = {"engine": engine, "status": "error", "note": str(e), "console_url": console_url}
        _rate_limit_cache[engine] = (now, result)
        return result

    # ── Parse standard x-ratelimit-* headers (Groq, OpenAI, Gemini OpenAI-compat) ─
    # Build a case-insensitive header lookup from the raw list
    hdr_map: dict[str, str] = {}
    for k, v in raw_headers:
        hdr_map.setdefault(k.lower(), v)

    def _hdr(name: str) -> str | None:
        return hdr_map.get(name.lower())

    def _parse_int(val: str | None) -> int | None:
        if val is None:
            return None
        try:
            return int(val)
        except ValueError:
            return None

    limit_req   = _parse_int(_hdr("x-ratelimit-limit-requests"))
    remain_req  = _parse_int(_hdr("x-ratelimit-remaining-requests"))
    reset_req   = _hdr("x-ratelimit-reset-requests")
    limit_tpm   = _parse_int(_hdr("x-ratelimit-limit-tokens"))
    remain_tpm  = _parse_int(_hdr("x-ratelimit-remaining-tokens"))
    reset_tpm   = _hdr("x-ratelimit-reset-tokens")
    limit_tpd   = _parse_int(_hdr("x-ratelimit-limit-tokens-day"))
    remain_tpd  = _parse_int(_hdr("x-ratelimit-remaining-tokens-day"))

    result = {
        "engine": engine,
        "status": "ok",
        "model": model,
        "http_ok": http_ok,
        "console_url": console_url,
        # Requests
        "limit_requests": limit_req,
        "remaining_requests": remain_req,
        "reset_requests": reset_req,
        # Tokens-per-minute
        "limit_tokens": limit_tpm,
        "remaining_tokens": remain_tpm,
        "reset_tokens": reset_tpm,
        # Tokens-per-day (Groq specific)
        "limit_tokens_day": limit_tpd,
        "remaining_tokens_day": remain_tpd,
    }

    _rate_limit_cache[engine] = (now, result)
    return result


def _extract_retry_seconds(payload: dict | None, raw_text: str = "") -> int | None:
    if isinstance(payload, dict):
        details = payload.get("error", {}).get("details", []) or payload.get("details", [])
        for detail in details:
            retry_delay = detail.get("retryDelay") if isinstance(detail, dict) else None
            if isinstance(retry_delay, str):
                match = re.match(r"(\d+)", retry_delay)
                if match:
                    return int(match.group(1))

        message = payload.get("error", {}).get("message") or payload.get("message") or ""
        raw_text = f"{raw_text}\n{message}"

    match = re.search(r"retry in\s+(\d+(?:\.\d+)?)s", raw_text, re.IGNORECASE)
    if match:
        return int(float(match.group(1)))
    return None


def _extract_quota_violations(payload: dict | None) -> list[dict]:
    if not isinstance(payload, dict):
        return []

    details = payload.get("error", {}).get("details", []) or payload.get("details", [])
    violations: list[dict] = []
    for detail in details:
        if not isinstance(detail, dict):
            continue
        for violation in detail.get("violations", []) or []:
            if not isinstance(violation, dict):
                continue
            violations.append(
                {
                    "metric": violation.get("quotaMetric"),
                    "quota_id": violation.get("quotaId"),
                    "dimensions": violation.get("quotaDimensions") or {},
                }
            )
    return violations
