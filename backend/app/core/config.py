from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")


def _resolve_path(raw_value: str) -> Path:
    path = Path(raw_value)
    if path.is_absolute():
        return path
    return (PROJECT_ROOT / path).resolve()


def _resolve_database_url(raw_value: str | None) -> str:
    if raw_value is None or not raw_value.strip():
        return "sqlite:///" + (PROJECT_ROOT / "scopesense.db").resolve().as_posix()

    cleaned = raw_value.strip()
    sqlite_prefixes = ("sqlite:///", "sqlite+pysqlite:///")
    for prefix in sqlite_prefixes:
        if cleaned.startswith(prefix):
            db_path = cleaned[len(prefix):]
            if db_path == ":memory:":
                return cleaned

            path = Path(db_path)
            if not path.is_absolute():
                path = (PROJECT_ROOT / path).resolve()
            normalized = path.as_posix()
            return f"{prefix}{normalized}"
    return cleaned


def _as_bool(raw_value: str | None, default: bool) -> bool:
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _as_csv_tuple(raw_value: str | None) -> tuple[str, ...]:
    if raw_value is None or not raw_value.strip():
        return ()
    return tuple(item.strip() for item in raw_value.split(",") if item.strip())


def _default_rag_source_paths() -> tuple[Path, ...]:
    candidates = [
        Path.home() / "Downloads" / "IP_RAGs_and_LangChain_Part_1.pdf",
        PROJECT_ROOT / "backend" / "generated",
    ]
    
    found_paths: list[Path] = []
    for path in candidates:
        if path.exists():
            if path.is_dir():
                found_paths.extend(path.glob("*.pdf"))
                found_paths.extend(path.glob("*.docx"))
                found_paths.extend(path.glob("*.txt"))
            else:
                found_paths.append(path)
    return tuple(found_paths)


def _resolve_path_list(raw_value: str | None, defaults: tuple[Path, ...]) -> tuple[Path, ...]:
    if raw_value is None or not raw_value.strip():
        return defaults

    resolved_paths: list[Path] = []
    for item in raw_value.split(";"):
        cleaned = item.strip()
        if not cleaned:
            continue
        resolved_paths.append(_resolve_path(cleaned))
    return tuple(resolved_paths)


@dataclass(frozen=True)
class Settings:
    app_name: str = "AI SRS Builder"
    api_prefix: str = "/api/v1"
    project_root: Path = PROJECT_ROOT
    backend_root: Path = PROJECT_ROOT / "backend"
    srs_template_path: Path = PROJECT_ROOT / "backend" / "app" / "templates" / "ieee_srs_template.json"
    generated_dir: Path = _resolve_path(os.getenv("GENERATED_DIR", "backend/generated"))
    nlp_training_data_path: Path = _resolve_path(
        os.getenv("NLP_TRAINING_DATA_PATH", "backend/training/requirements_training_data.json")
    )
    nlp_model_artifact_path: Path = _resolve_path(
        os.getenv("NLP_MODEL_ARTIFACT_PATH", "backend/training/requirements_model.pkl")
    )
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_api_base: str = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
    secret_key: str = os.getenv("SECRET_KEY", "")
    free_plan_token_budget: int = int(os.getenv("FREE_PLAN_TOKEN_BUDGET", "50000"))
    pro_plan_token_budget: int = int(os.getenv("PRO_PLAN_TOKEN_BUDGET", "500000"))
    local_nlp_extraction_enabled: bool = _as_bool(os.getenv("LOCAL_NLP_EXTRACTION_ENABLED"), True)
    openai_requirements_enabled: bool = _as_bool(os.getenv("OPENAI_REQUIREMENTS_ENABLED"), False)
    openai_requirements_model: str = os.getenv("OPENAI_REQUIREMENTS_MODEL", "gpt-4o-mini")
    openai_requirements_fallback_models: tuple[str, ...] = _as_csv_tuple(
        os.getenv("OPENAI_REQUIREMENTS_FALLBACK_MODELS")
    )
    openai_srs_enabled: bool = _as_bool(os.getenv("OPENAI_SRS_ENABLED"), True)
    openai_srs_model: str = os.getenv("OPENAI_SRS_MODEL", "gpt-4o-mini")
    openai_srs_fallback_models: tuple[str, ...] = _as_csv_tuple(
        os.getenv("OPENAI_SRS_FALLBACK_MODELS")
    )
    ollama_api_base: str = os.getenv("OLLAMA_API_BASE", "http://localhost:11434/v1")
    ollama_api_key: str = os.getenv("OLLAMA_API_KEY", "ollama")
    ollama_srs_enabled: bool = _as_bool(os.getenv("OLLAMA_SRS_ENABLED"), True)
    ollama_srs_model: str = os.getenv("OLLAMA_SRS_MODEL", "llama3.1")
    ollama_srs_fallback_models: tuple[str, ...] = _as_csv_tuple(
        os.getenv("OLLAMA_SRS_FALLBACK_MODELS")
    )
    gemini_api_key: str | None = os.getenv("GEMINI_API_KEY") or None
    gemini_srs_model: str = os.getenv("GEMINI_SRS_MODEL", "gemini-flash-latest")
    gemini_srs_fallback_models: tuple[str, ...] = _as_csv_tuple(
        os.getenv("GEMINI_SRS_FALLBACK_MODELS")
    )
    openai_timeout_seconds: float = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))
    rag_enabled: bool = _as_bool(os.getenv("RAG_ENABLED"), True)
    rag_top_k: int = int(os.getenv("RAG_TOP_K", "4"))
    rag_source_paths: tuple[Path, ...] = _resolve_path_list(
        os.getenv("RAG_SOURCE_PATHS"),
        _default_rag_source_paths(),
    )
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    )
    database_url: str = _resolve_database_url(
        os.getenv("DATABASE_URL", "postgresql+psycopg2://user:password@localhost:5432/scopesense")
    )
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str | None = os.getenv("SMTP_USER")
    smtp_password: str | None = os.getenv("SMTP_PASSWORD")
    emails_from: str | None = os.getenv("EMAILS_FROM")

settings = Settings()
