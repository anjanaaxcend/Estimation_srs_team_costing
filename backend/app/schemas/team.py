from pydantic import BaseModel, Field


class CompanyResource(BaseModel):
    name: str
    role: str
    experience_years: float
    count: int = 1


class TeamMemberEstimate(BaseModel):
    role: str
    count: int
    description: str = ""
    weekly_hours: float | None = None
    active_weeks: float | None = None
    hours_per_member: float | None = None


class TeamStructure(BaseModel):
    project_name: str
    total_size: int
    members: list[TeamMemberEstimate]
    logic_summary: str = ""
    weekly_hours_per_member: float = 40
    total_working_weeks: float = 0
    total_project_hours: float = 0


class FeatureAllocation(BaseModel):
    role: str
    hours: float
    description: str = ""
    workstream: str = ""


class FeatureComplexityEstimate(BaseModel):
    module_name: str
    complexity: str  # "Low", "Medium", "High"
    estimated_hours: float
    reasoning: str
    screen_designs: list[str] = Field(default_factory=list)
    fastest_allocation: list[FeatureAllocation] = Field(default_factory=list)
    balanced_allocation: list[FeatureAllocation] = Field(default_factory=list)
    lean_allocation: list[FeatureAllocation] = Field(default_factory=list)


class TeamPlanningPreferences(BaseModel):
    preferred_strategy: str = "balanced"
    project_management_coverage: str = "standard"
    deployment_coverage: str = "standard"


class TeamAnalysisResult(BaseModel):
    project_name: str
    feature_complexity_analysis: list[FeatureComplexityEstimate] = Field(default_factory=list)
    options: dict[str, TeamStructure] = Field(default_factory=dict)
    recommended_option: str = "balanced"


class TeamAnalysisRequest(BaseModel):
    srs_text: str
    project_name: str = "Unknown Project"
    planning_preferences: TeamPlanningPreferences | None = None


class TeamAllocationDocumentResult(BaseModel):
    project_name: str = ""
    has_team_allocation: bool
    total_size: int = 0
    members: list[TeamMemberEstimate] = Field(default_factory=list)
    logic_summary: str = ""
    message: str = ""
    weekly_hours_per_member: float = 40
    total_working_weeks: float = 0
    total_project_hours: float = 0
