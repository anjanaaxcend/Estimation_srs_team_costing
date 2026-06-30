from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import engine, Base
import app.models.user  # import models so Base knows about them


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize database — creates all tables that don't exist yet
    Base.metadata.create_all(bind=engine)

    # ---------------------------------------------------------------------------
    # Safe column-migration guards.
    # Uses information_schema.columns for PostgreSQL (transaction-safe).
    # Falls back to the old SELECT … LIMIT 1 trick for SQLite.
    # ---------------------------------------------------------------------------
    from sqlalchemy import text, inspect as sa_inspect

    is_pg = "postgresql" in str(engine.url)

    def _col_exists(conn, table: str, column: str) -> bool:
        if is_pg:
            row = conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ),
                {"t": table, "c": column},
            ).fetchone()
            return row is not None
        else:
            # SQLite: try a SELECT; if it raises the column is missing
            try:
                conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
                return True
            except Exception:
                return False

    def _add_col(conn, table: str, column: str, col_def: str):
        if not _col_exists(conn, table, column):
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
                print(f"  ✓ Added column {table}.{column}")
            except Exception as e:
                print(f"  ✗ Could not add {table}.{column}: {e}")

    with engine.begin() as conn:
        # users table
        _add_col(conn, "users", "reset_otp", "VARCHAR")
        _add_col(conn, "users", "reset_otp_expires_at", "TIMESTAMP")
        _add_col(conn, "users", "is_admin", "BOOLEAN DEFAULT FALSE")

        # temporary_srs table
        for col in ["team_content", "cost_content", "axcend_estimation_content", "document_hash"]:
            _add_col(conn, "temporary_srs", col, "TEXT")

        # approved_srs table
        for col in ["team_content", "cost_content", "axcend_estimation_content", "document_hash"]:
            _add_col(conn, "approved_srs", col, "TEXT")

        # user_plans table
        for col, col_def in [
            ("plan", "VARCHAR DEFAULT 'free'"),
            ("token_budget_monthly", "INTEGER DEFAULT 50000"),
            ("tokens_used_this_month", "INTEGER DEFAULT 0"),
            ("window_start", "TIMESTAMP"),
            ("updated_at", "TIMESTAMP"),
        ]:
            _add_col(conn, "user_plans", col, col_def)

    settings.generated_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure the directory exists before mounting StaticFiles
settings.generated_dir.mkdir(parents=True, exist_ok=True)

app.mount("/generated", StaticFiles(directory=settings.generated_dir), name="generated")
app.include_router(api_router, prefix=settings.api_prefix)

# Force reload config - update 2

