from __future__ import annotations

from pydantic import BaseModel, Field


class ClientInput(BaseModel):
    project_name: str = Field(..., min_length=3)
    client_name: str | None = None
    industry: str | None = None
    raw_text: str = Field(..., min_length=1)
    business_goals: list[str] = Field(default_factory=list)
    timeline_expectation: str | None = None
    budget_range: str | None = None
    integrations: list[str] = Field(default_factory=list)
    compliance_requirements: list[str] = Field(default_factory=list)
    deployment_preferences: list[str] = Field(default_factory=list)
