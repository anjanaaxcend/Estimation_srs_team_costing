from __future__ import annotations

from pydantic import BaseModel, Field


class FeatureItem(BaseModel):
    name: str
    description: str
    priority: str
    complexity: str
    acceptance_criteria: list[str] = Field(default_factory=list)


class ModuleItem(BaseModel):
    name: str
    summary: str
    feature_names: list[str] = Field(default_factory=list)


class UserRoleItem(BaseModel):
    name: str
    responsibilities: list[str] = Field(default_factory=list)


class DataModelItem(BaseModel):
    name: str
    description: str
    attributes: list[str] = Field(default_factory=list)


class BackendJobItem(BaseModel):
    name: str
    trigger_type: str
    description: str


class ConstraintItem(BaseModel):
    category: str
    description: str


class UiPageItem(BaseModel):
    name: str
    description: str = ""
    primary_module: str = ""


class NonFunctionalRequirementItem(BaseModel):
    category: str
    description: str
    measurable_target: str


class EffortLevelEstimate(BaseModel):
    level: str
    days: float


class FeatureDeliveryEstimate(BaseModel):
    module_name: str
    feature_name: str
    complexity: str
    recommended_developer_level: str
    recommended_tester_level: str
    developer_days: list[EffortLevelEstimate] = Field(default_factory=list)
    tester_days: list[EffortLevelEstimate] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class DeliveryPlan(BaseModel):
    team_size: int = 10
    developer_count: int = 5
    tester_count: int = 5
    devops_count: int = 1
    ui_ux_count: int = 1
    estimated_project_days: list[EffortLevelEstimate] = Field(default_factory=list)
    feature_estimates: list[FeatureDeliveryEstimate] = Field(default_factory=list)
    planning_assumptions: list[str] = Field(default_factory=list)


class RequirementExtractionResult(BaseModel):
    project_name: str
    normalized_text: str = ""
    problem_statement: str = ""
    project_objectives: list[str] = Field(default_factory=list)
    proposed_solution: str = ""
    recommended_technologies: list[str] = Field(default_factory=list)
    recommended_tools: list[str] = Field(default_factory=list)
    executive_summary: str = ""
    features: list[FeatureItem] = Field(default_factory=list)
    modules: list[ModuleItem] = Field(default_factory=list)
    user_roles: list[UserRoleItem] = Field(default_factory=list)
    data_models: list[DataModelItem] = Field(default_factory=list)
    backend_jobs: list[BackendJobItem] = Field(default_factory=list)
    constraints: list[ConstraintItem] = Field(default_factory=list)
    non_functional_requirements: list[NonFunctionalRequirementItem] = Field(default_factory=list)
    ui_pages: list[UiPageItem] = Field(default_factory=list)
    delivery_plan: DeliveryPlan = Field(default_factory=DeliveryPlan)
    assumptions: list[str] = Field(default_factory=list)
    ai_observations: list[str] = Field(default_factory=list)
    conclusion: str = ""
    confidence_score: float = Field(default=0.75, ge=0, le=1)
