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
    # Initialize database
    Base.metadata.create_all(bind=engine)
    
    # Ensure SQLite has the new columns
    from sqlalchemy import text
    with engine.begin() as conn:
        try:
            conn.execute(text("SELECT reset_otp FROM users LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_otp VARCHAR"))
            except Exception as e:
                print(f"Error adding reset_otp column: {e}")
        
        try:
            conn.execute(text("SELECT reset_otp_expires_at FROM users LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_otp_expires_at DATETIME"))
            except Exception as e:
                print(f"Error adding reset_otp_expires_at column: {e}")

        # Ensure temporary_srs table has new columns
        for column_name in ["team_content", "cost_content", "document_hash"]:
            try:
                conn.execute(text(f"SELECT {column_name} FROM temporary_srs LIMIT 1"))
            except Exception:
                try:
                    conn.execute(text(f"ALTER TABLE temporary_srs ADD COLUMN {column_name} TEXT"))
                except Exception as e:
                    print(f"Error adding {column_name} to temporary_srs table: {e}")

        # Ensure approved_srs table has new columns
        for column_name in ["team_content", "cost_content", "document_hash"]:
            try:
                conn.execute(text(f"SELECT {column_name} FROM approved_srs LIMIT 1"))
            except Exception:
                try:
                    conn.execute(text(f"ALTER TABLE approved_srs ADD COLUMN {column_name} TEXT"))
                except Exception as e:
                    print(f"Error adding {column_name} to approved_srs table: {e}")

        # Ensure users table has is_admin column
        try:
            conn.execute(text("SELECT is_admin FROM users LIMIT 1"))
        except Exception:
            try:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0 NOT NULL"))
            except Exception as e:
                print(f"Error adding is_admin to users: {e}")

        # Ensure user_plans table exists with all columns (created by Base.metadata.create_all above,
        # but we guard for existing deployments)
        for column_name, col_def in [
            ("plan", "VARCHAR DEFAULT 'free'"),
            ("token_budget_monthly", "INTEGER DEFAULT 50000"),
            ("tokens_used_this_month", "INTEGER DEFAULT 0"),
            ("window_start", "DATETIME"),
            ("updated_at", "DATETIME"),
        ]:
            try:
                conn.execute(text(f"SELECT {column_name} FROM user_plans LIMIT 1"))
            except Exception:
                try:
                    conn.execute(text(f"ALTER TABLE user_plans ADD COLUMN {column_name} {col_def}"))
                except Exception as e:
                    print(f"Error adding {column_name} to user_plans: {e}")

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

