from __future__ import annotations

from pydantic import BaseModel, Field


class CostTeamMemberInput(BaseModel):
    role: str
    count: int = Field(..., ge=0)
    hourly_rate: float = Field(..., ge=0)
    weekly_hours: float = Field(default=40, gt=0)
    hours_per_member: float = Field(..., ge=0)
    notes: str = ""


class CostLineItem(BaseModel):
    label: str
    amount: float = Field(..., ge=0)


class CostEstimationExportRequest(BaseModel):
    project_name: str
    currency: str = "INR"
    members: list[CostTeamMemberInput] = Field(default_factory=list)
    project_management_cost: float = Field(..., ge=0)
    profit_slabs: list[CostLineItem] = Field(default_factory=list)
    miscellaneous_costs: list[CostLineItem] = Field(default_factory=list)
