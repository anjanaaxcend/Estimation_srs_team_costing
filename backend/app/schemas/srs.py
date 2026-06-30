from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.client import ClientInput
from app.schemas.requirements import RequirementExtractionResult


class ReferenceItem(BaseModel):
    title: str
    description: str


class AppendixItem(BaseModel):
    title: str
    content: str


class SRSSection(BaseModel):
    title: str
    body: str


class ModuleEffort(BaseModel):
    module_name: str
    features: list[str]
    total_days: int           # AI-estimated total dev days for this module
    testing_days: int
    start_week: float
    end_week: float


class TeamStructure(BaseModel):
    lead_count: int           # Senior / Lead developers
    mid_count: int            # Mid-level developers
    junior_count: int         # Junior developers
    tester_count: int
    devops_count: int = 0
    ui_ux_count: int = 0


class DeliveryPlanData(BaseModel):
    modules: list[ModuleEffort] = Field(default_factory=list)
    recommended_team: TeamStructure | None = None
    total_duration_days: int   # AI-estimated total project duration


class ModelSelection(BaseModel):
    provider: Literal["openai", "gemini", "anthropic"] = "openai"
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None   # runtime override (never stored)


class PipelineStageTrace(BaseModel):
    stage: Literal[
        "nlp_extraction",
        "rag_retrieval",
        "llm_generation",
    ]
    status: Literal["completed", "warning", "failed"]
    summary: str


class SRSGenerationRequest(BaseModel):
    client_input: ClientInput
    requirements: RequirementExtractionResult
    references: list[ReferenceItem] = Field(default_factory=list)
    appendices: list[AppendixItem] = Field(default_factory=list)
    selected_model: ModelSelection | None = None


class SRSTextGenerationRequest(BaseModel):
    project_name: str | None = None
    raw_text: str = Field(..., min_length=1)
    client_name: str | None = None
    industry: str | None = None
    business_goals: list[str] = Field(default_factory=list)
    timeline_expectation: str | None = None
    budget_range: str | None = None
    integrations: list[str] = Field(default_factory=list)
    compliance_requirements: list[str] = Field(default_factory=list)
    deployment_preferences: list[str] = Field(default_factory=list)
    selected_model: ModelSelection | None = None


class SRSGenerationResult(BaseModel):
    title: str
    sections: list[SRSSection] = Field(default_factory=list)
    delivery_plan: DeliveryPlanData | None = None
    docx_path: str | None = None
    xlsx_path: str | None = None
    pdf_path: str | None = None
    cleaned_text: str = ""
    structured_requirements: RequirementExtractionResult | None = None
    selected_model: ModelSelection | None = None
    pipeline_trace: list[PipelineStageTrace] = Field(default_factory=list)
