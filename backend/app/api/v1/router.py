from fastapi import APIRouter

from app.api.v1.endpoints import cost, health, srs, export, team, auth, user_settings, admin

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(health.router, tags=["health"])
api_router.include_router(srs.router, prefix="/srs", tags=["srs"])
api_router.include_router(export.router, prefix="/export", tags=["export"])
api_router.include_router(team.router, prefix="/team", tags=["team"])
api_router.include_router(cost.router, prefix="/cost", tags=["cost"])
api_router.include_router(user_settings.router, prefix="/user", tags=["user"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])

