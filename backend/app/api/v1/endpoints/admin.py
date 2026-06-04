"""Admin endpoints — restricted to users with is_admin=True.

Provides platform-wide token usage stats, user management, and plan overrides.
"""
from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import TokenUsageLog, User, UserPlan, UserApiKey
from app.services.token_service import FREE_BUDGET, set_user_plan

router = APIRouter()


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required.")
    return current_user


# ── Overview Stats ────────────────────────────────────────────────────────────

@router.get("/stats")
def get_admin_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Platform-wide token usage summary for the current calendar month."""
    now = datetime.datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    logs_this_month = (
        db.query(TokenUsageLog)
        .filter(TokenUsageLog.created_at >= month_start)
        .all()
    )

    total_tokens = sum(l.total_tokens or 0 for l in logs_this_month)
    by_stage = {"srs": 0, "team": 0, "cost": 0}
    by_provider: dict[str, int] = {}

    for log in logs_this_month:
        stage = log.stage if log.stage in by_stage else "srs"
        by_stage[stage] += log.total_tokens or 0
        by_provider[log.provider] = by_provider.get(log.provider, 0) + (log.total_tokens or 0)

    total_users = db.query(User).count()
    # Users active in last 7 days
    week_ago = now - datetime.timedelta(days=7)
    active_users = (
        db.query(TokenUsageLog.user_id)
        .filter(TokenUsageLog.created_at >= week_ago, TokenUsageLog.user_id.isnot(None))
        .distinct()
        .count()
    )

    return {
        "total_tokens_this_month": total_tokens,
        "by_stage": by_stage,
        "by_provider": by_provider,
        "total_users": total_users,
        "active_users_last_7_days": active_users,
        "month": now.strftime("%B %Y"),
    }


# ── Users Table ───────────────────────────────────────────────────────────────

@router.get("/users")
def get_all_users(
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """List all registered users with their plan and usage data."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    result = []
    for user in users:
        plan = db.query(UserPlan).filter(UserPlan.user_id == user.id).first()
        saved_keys = db.query(UserApiKey).filter(UserApiKey.user_id == user.id).all()
        byok_providers = sorted({key.provider for key in saved_keys})

        # Last activity
        last_log = (
            db.query(TokenUsageLog)
            .filter(TokenUsageLog.user_id == user.id)
            .order_by(TokenUsageLog.created_at.desc())
            .first()
        )

        result.append({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_admin": user.is_admin,
            "plan": plan.plan if plan else "free",
            "token_budget": plan.token_budget_monthly if plan else FREE_BUDGET,
            "tokens_used": plan.tokens_used_this_month if plan else 0,
            "has_byok": bool(byok_providers),
            "byok_providers": byok_providers,
            "last_active": last_log.created_at.isoformat() if last_log else None,
            "joined": user.created_at.isoformat() if user.created_at else None,
        })
    return result


class UpdatePlanRequest(BaseModel):
    plan: str | None = None  # free | pro
    tier: str | None = None  # frontend alias for plan
    custom_budget: int | None = None


@router.post("/users/{user_id}/plan")
def update_user_plan(
    user_id: int,
    payload: UpdatePlanRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Admin: change a user's plan tier."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    requested_plan = (payload.plan or payload.tier or "free").strip().lower()
    if requested_plan not in {"free", "pro"}:
        raise HTTPException(status_code=400, detail="plan must be one of: free, pro")

    plan = set_user_plan(db, user, requested_plan)
    if payload.custom_budget is not None and payload.custom_budget >= 0:
        plan.token_budget_monthly = payload.custom_budget
        db.commit()

    db.commit()

    return {"status": "updated", "user_id": user_id, "plan": requested_plan}


# ── Token Usage Chart ─────────────────────────────────────────────────────────

@router.get("/token-usage")
def get_platform_token_usage(
    days: int = 30,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Platform-wide daily token usage breakdown for the last N days."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    logs = (
        db.query(TokenUsageLog)
        .filter(TokenUsageLog.created_at >= since)
        .order_by(TokenUsageLog.created_at)
        .all()
    )

    daily: dict[str, dict] = {}
    for log in logs:
        date_str = log.created_at.strftime("%Y-%m-%d")
        if date_str not in daily:
            daily[date_str] = {"date": date_str, "srs": 0, "team": 0, "cost": 0, "total": 0}
        stage = log.stage if log.stage in ("srs", "team", "cost") else "srs"
        daily[date_str][stage] += log.total_tokens or 0
        daily[date_str]["total"] += log.total_tokens or 0

    return list(daily.values())


# ── Top Consumers ─────────────────────────────────────────────────────────────

@router.get("/top-consumers")
def get_top_consumers(
    limit: int = 10,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Return top N users by token consumption this month."""
    now = datetime.datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    from sqlalchemy import func as sqlfunc
    rows = (
        db.query(TokenUsageLog.user_id, sqlfunc.sum(TokenUsageLog.total_tokens).label("total"))
        .filter(TokenUsageLog.created_at >= month_start, TokenUsageLog.user_id.isnot(None))
        .group_by(TokenUsageLog.user_id)
        .order_by(sqlfunc.sum(TokenUsageLog.total_tokens).desc())
        .limit(limit)
        .all()
    )

    result = []
    for row in rows:
        user = db.query(User).filter(User.id == row.user_id).first()
        if user:
            result.append({
                "user_id": user.id,
                "name": user.name or user.email,
                "email": user.email,
                "tokens_this_month": int(row.total or 0),
            })
    return result
