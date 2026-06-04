"""Token budget service — covers all 3 stages: SRS, Team Allocation, Cost Estimation.

Key responsibilities:
- Auto-create a Free plan for new users on first call
- Monthly window reset (rolling 30-day window)
- Budget enforcement: BYOK users always pass; Free/Pro users are checked
- Token recording: deducts from budget + writes to TokenUsageLog
- BYOK key resolution: returns decrypted user key if available, else server key
"""
from __future__ import annotations

import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User, UserPlan, UserApiKey, TokenUsageLog
from app.services.encryption import decrypt_key, encrypt_key

# ──────────────────────────────────────────────
# Plan defaults (can be overridden via .env)
# ──────────────────────────────────────────────
FREE_BUDGET = settings.free_plan_token_budget
PRO_BUDGET = settings.pro_plan_token_budget
WINDOW_DAYS = 30
PLAN_BUDGETS = {
    "free": FREE_BUDGET,
    "pro": PRO_BUDGET,
}


def normalize_provider(provider: str | None) -> str:
    value = (provider or "openai").strip().lower()
    if value in {"groq", "openai_groq"}:
        return "openai"
    return value


def _get_or_create_plan(db: Session, user: User) -> UserPlan:
    """Fetch the user's plan, auto-creating a Free plan on first use."""
    plan = db.query(UserPlan).filter(UserPlan.user_id == user.id).first()
    if not plan:
        plan = UserPlan(
            user_id=user.id,
            plan="free",
            token_budget_monthly=FREE_BUDGET,
            tokens_used_this_month=0,
            window_start=datetime.datetime.utcnow(),
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


def _has_user_api_key(db: Session, user: User, provider: str) -> bool:
    provider = normalize_provider(provider)
    return db.query(UserApiKey).filter(
        UserApiKey.user_id == user.id,
        UserApiKey.provider == provider,
    ).first() is not None


def set_user_plan(db: Session, user: User, plan_name: str) -> UserPlan:
    normalized = (plan_name or "free").strip().lower()
    if normalized not in PLAN_BUDGETS:
        raise ValueError("plan_name must be one of: free, pro")

    plan = _get_or_create_plan(db, user)
    plan.plan = normalized
    plan.token_budget_monthly = PLAN_BUDGETS[normalized]
    db.commit()
    db.refresh(plan)
    return plan


def activate_paid_plan(db: Session, user: User) -> UserPlan:
    return set_user_plan(db, user, "pro")


def _reset_if_window_expired(db: Session, plan: UserPlan) -> None:
    """Reset monthly usage counter if the 30-day window has elapsed."""
    if not plan.window_start:
        plan.window_start = datetime.datetime.utcnow()
        db.commit()
        return

    now = datetime.datetime.utcnow()
    if plan.window_start.tzinfo:
        now = datetime.datetime.now(datetime.timezone.utc)

    elapsed = (now - plan.window_start.replace(tzinfo=None) if not plan.window_start.tzinfo else
               now - plan.window_start)
    if isinstance(elapsed, datetime.timedelta) and elapsed.days >= WINDOW_DAYS:
        plan.tokens_used_this_month = 0
        plan.window_start = now.replace(tzinfo=None)
        db.commit()


def get_user_plan_info(db: Session, user: User) -> dict:
    """Return plan status dict suitable for the /user/plan API response."""
    plan = _get_or_create_plan(db, user)
    _reset_if_window_expired(db, plan)

    saved_keys = db.query(UserApiKey).filter(UserApiKey.user_id == user.id).all()
    byok_providers = sorted({normalize_provider(key.provider) for key in saved_keys})
    if plan.plan not in PLAN_BUDGETS:
        plan.plan = "free"
        plan.token_budget_monthly = FREE_BUDGET
        db.commit()

    tokens_remaining = max(0, plan.token_budget_monthly - plan.tokens_used_this_month)
    reset_date = (
        (plan.window_start.replace(tzinfo=None) if plan.window_start.tzinfo else plan.window_start)
        + datetime.timedelta(days=WINDOW_DAYS)
    )

    return {
        "plan": plan.plan,
        "token_budget": plan.token_budget_monthly,
        "tokens_used": plan.tokens_used_this_month,
        "tokens_remaining": tokens_remaining,
        "reset_date": reset_date.isoformat(),
        "has_byok": bool(byok_providers),
        "byok_providers": byok_providers,
        "is_paid": plan.plan == "pro",
        "is_unlimited": False,
        "provider_key_mode": "user_key_for_saved_providers_else_app_key",
    }


def check_token_budget(db: Session, user: User | None, session_id: str | None, provider: str = "openai") -> None:
    """Raise HTTP 429 if the user has exhausted their monthly token budget.

    Users with their own key for this provider always pass.
    Registered Free/Pro users on app-owned Groq/Gemini keys are checked.
    """
    provider = normalize_provider(provider)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Please sign in to use AI credits. Free users receive a monthly AI token allowance.",
        )

    if _has_user_api_key(db, user, provider):
        return

    plan = _get_or_create_plan(db, user)
    _reset_if_window_expired(db, plan)

    if plan.plan not in PLAN_BUDGETS:
        plan.plan = "free"
        plan.token_budget_monthly = FREE_BUDGET
        db.commit()

    if plan.tokens_used_this_month >= plan.token_budget_monthly:
        remaining_days = WINDOW_DAYS - (datetime.datetime.utcnow() - plan.window_start.replace(tzinfo=None)).days
        raise HTTPException(
            status_code=402,
            detail=(
                f"Monthly AI credit limit exhausted ({plan.token_budget_monthly:,} tokens used). "
                f"Your budget resets in ~{max(0, remaining_days)} days. "
                f"Upgrade to Pro for more app-managed Groq/Gemini credits, or add your own {provider} API key."
            )
        )


def record_token_usage(
    db: Session,
    user: User | None,
    session_id: str | None,
    provider: str,
    model: str | None,
    usage: Any,   # OpenAI Usage object or dict with total_tokens
    stage: str,   # "srs" | "team" | "cost"
    project_name: str | None = None,
) -> int:
    """Record token usage and deduct from the user's budget. Returns total_tokens consumed."""
    provider = normalize_provider(provider)

    # Extract token counts from the API usage object
    if usage is None:
        return 0

    if hasattr(usage, "total_tokens"):
        total = int(usage.total_tokens or 0)
        prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion = int(getattr(usage, "completion_tokens", 0) or 0)
    elif isinstance(usage, dict):
        total = int(usage.get("total_tokens", 0) or 0)
        prompt = int(usage.get("prompt_tokens", 0) or 0)
        completion = int(usage.get("completion_tokens", 0) or 0)
    else:
        return 0

    if total <= 0:
        return 0

    # Write usage log entry
    log_entry = TokenUsageLog(
        user_id=user.id if user else None,
        session_id=session_id if not user else None,
        provider=provider,
        model=model or "",
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        stage=stage,
        project_name=project_name,
    )
    db.add(log_entry)

    # Deduct from user's budget (only for registered users without BYOK for this provider)
    if user:
        byok = db.query(UserApiKey).filter(
            UserApiKey.user_id == user.id,
            UserApiKey.provider == provider
        ).first()
        if not byok:
            plan = _get_or_create_plan(db, user)
            if plan.plan not in PLAN_BUDGETS:
                plan.plan = "free"
                plan.token_budget_monthly = FREE_BUDGET
            plan.tokens_used_this_month = (plan.tokens_used_this_month or 0) + total

    db.commit()
    return total


def get_effective_api_key(db: Session, user: User | None, provider: str) -> str | None:
    """Return the user's decrypted BYOK key if saved, else None (caller uses server key)."""
    provider = normalize_provider(provider)
    if not user:
        return None
    byok = db.query(UserApiKey).filter(
        UserApiKey.user_id == user.id,
        UserApiKey.provider == provider
    ).first()
    if not byok or not byok.encrypted_key:
        return None
    decrypted = decrypt_key(byok.encrypted_key)
    return decrypted or None


def save_user_api_key(db: Session, user: User, provider: str, plain_key: str) -> None:
    """Encrypt and upsert a BYOK API key for the given provider."""
    provider = normalize_provider(provider)
    encrypted = encrypt_key(plain_key)
    existing = db.query(UserApiKey).filter(
        UserApiKey.user_id == user.id,
        UserApiKey.provider == provider
    ).first()
    if existing:
        existing.encrypted_key = encrypted
    else:
        db.add(UserApiKey(user_id=user.id, provider=provider, encrypted_key=encrypted))
    db.commit()


def delete_user_api_key(db: Session, user: User, provider: str) -> None:
    """Remove a BYOK key for the given provider."""
    provider = normalize_provider(provider)
    db.query(UserApiKey).filter(
        UserApiKey.user_id == user.id,
        UserApiKey.provider == provider
    ).delete()
    db.commit()


def get_token_usage_history(db: Session, user: User, days: int = 30) -> list[dict]:
    """Return daily token usage breakdown by stage for the last N days."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    logs = (
        db.query(TokenUsageLog)
        .filter(
            TokenUsageLog.user_id == user.id,
            TokenUsageLog.created_at >= since,
        )
        .order_by(TokenUsageLog.created_at)
        .all()
    )
    # Group by date + stage
    daily: dict[str, dict[str, int]] = {}
    for log in logs:
        date_str = log.created_at.strftime("%Y-%m-%d")
        if date_str not in daily:
            daily[date_str] = {"date": date_str, "srs": 0, "team": 0, "cost": 0, "total": 0}
        stage = log.stage if log.stage in ("srs", "team", "cost") else "srs"
        daily[date_str][stage] = daily[date_str].get(stage, 0) + (log.total_tokens or 0)
        daily[date_str]["total"] += log.total_tokens or 0
    return list(daily.values())
