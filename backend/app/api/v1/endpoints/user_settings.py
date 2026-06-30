"""User settings endpoints: token plan info, BYOK key management, usage history."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User, UserApiKey
from app.services.token_service import (
    activate_paid_plan,
    delete_user_api_key,
    get_token_usage_history,
    get_user_plan_info,
    save_user_api_key,
    PRO_BUDGET,
)

router = APIRouter()

VALID_PROVIDERS = {"openai", "groq", "gemini", "anthropic"}


# ── Plan Info ────────────────────────────────────────────────────────────────

@router.get("/plan")
def get_plan(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the current user's token plan and usage stats."""
    return get_user_plan_info(db, current_user)


@router.post("/plan/upgrade")
def upgrade_plan(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upgrade current user to Pro plan (demo endpoint — in production, hook to payment)."""
    activate_paid_plan(db, current_user)
    return {"status": "upgraded", "plan": "pro", "token_budget": PRO_BUDGET}


# ── BYOK Key Management ──────────────────────────────────────────────────────

@router.get("/api-keys")
def get_api_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return which providers the user has saved keys for (boolean, never the key itself)."""
    saved = db.query(UserApiKey).filter(UserApiKey.user_id == current_user.id).all()
    saved_providers = {k.provider for k in saved}
    return {
        provider: provider in saved_providers
        for provider in VALID_PROVIDERS
    }


class SaveApiKeyRequest(BaseModel):
    provider: str
    api_key: str


@router.post("/api-keys")
def save_api_key(
    payload: SaveApiKeyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Encrypt and store a BYOK API key for the given provider."""
    if payload.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider. Must be one of: {', '.join(VALID_PROVIDERS)}")
    if not payload.api_key.strip():
        raise HTTPException(status_code=400, detail="API key must not be empty.")
    save_user_api_key(db, current_user, payload.provider, payload.api_key.strip())
    return {"status": "saved", "provider": payload.provider}


@router.delete("/api-keys/{provider}")
def remove_api_key(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a saved BYOK key for the given provider."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {provider}")
    delete_user_api_key(db, current_user, provider)
    return {"status": "removed", "provider": provider}


# ── Usage History ────────────────────────────────────────────────────────────

@router.get("/token-usage")
def get_token_usage(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return daily token usage breakdown (by stage: srs/team/cost) for the last N days."""
    if days < 1 or days > 365:
        days = 30
    return get_token_usage_history(db, current_user, days)
