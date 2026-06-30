"""
Axcend Effort Estimation schemas — mirrors the AXCEND EFFORT ESTIMATION Excel format.

Sheet 1: Module → Feature breakdown with estimated hours per feature.
Sheet 2: AXCEND resource-level rows for pre-engineering, engineering, and PM.

All percentages are derived from the project's AI team-analysis result; nothing is hard-coded.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sheet 1 — Module / Feature estimation table
# ---------------------------------------------------------------------------

class AxcendFeatureRow(BaseModel):
    """One row in the Module Estimation sheet (Sheet 1)."""
    sl: int                          # serial number within the module
    module: str                      # parent module name
    feature: str                     # feature name
    description: str                 # code-level description / function name
    estimated_hours: float           # hours for this feature
    base_hours: float = 0.0          # base hours without developer multiplier
    developer: str = ""              # developer level S1/S2/S3



class AxcendModuleGroup(BaseModel):
    """All features that belong to one module."""
    sl: int                                    # module serial number (1-based)
    module_name: str
    features: list[AxcendFeatureRow] = Field(default_factory=list)
    module_total_hours: float = 0.0


# ---------------------------------------------------------------------------
# Sheet 2 — AXCEND effort estimation rows (Pre-Engineering / Engineering / PM)
# ---------------------------------------------------------------------------

class AxcendResourceRow(BaseModel):
    """One row in the AXCEND activity sheet (Sheet 2)."""
    activity: str           # e.g. "Requirement Collection"
    location: str           # e.g. "India"
    resource_level: str     # e.g. "A1", "A2", "A3", "S1", "S2", "S3"
    experience_years: float
    input_hours: float      # total hours for this activity
    section: str            # "pre_engineering" | "engineering" | "project_management"


# ---------------------------------------------------------------------------
# Estimation percentages — fetched from analysis, never hard-coded
# ---------------------------------------------------------------------------

class AxcendEstimationPercentages(BaseModel):
    """
    Percentages that drive the entire effort estimation.
    These are derived from the AI team-analysis result or user overrides;
    they are NEVER hard-coded constants.
    """
    internal_testing_pct: float = Field(
        default=0.20,
        description="Internal testing as a fraction of design & development hours (default 20%)"
    )
    client_testing_pct: float = Field(
        default=0.10,
        description="Client testing as a fraction of design & development hours (default 10%)"
    )
    deployment_pct: float = Field(
        default=0.10,
        description="Deployment as a fraction of design & development hours (default 10%)"
    )
    pm_pct: float = Field(
        default=0.10,
        description="Project management as a fraction of total engineering time (default 10%)"
    )
    risk_pct: float = Field(
        default=0.10,
        description="Risk contingency as a fraction of total efforts estimation (default 10%)"
    )
    negotiation_pct: float = Field(
        default=0.05,
        description="Negotiation buffer as a fraction of total efforts estimation (default 5%)"
    )


# ---------------------------------------------------------------------------
# Top-level estimation result
# ---------------------------------------------------------------------------

class AxcendEstimationSheet(BaseModel):
    """
    Complete Axcend Effort Estimation document.

    Mirrors both sheets of the AXCEND Excel template:
      - modules         → Sheet 1 module/feature table
      - pre_engineering / engineering / project_management → Sheet 2 rows
      - percentages     → the ratio-based math that drives the totals
    """
    project_name: str

    # Sheet 1
    modules: list[AxcendModuleGroup] = Field(default_factory=list)

    # Derived totals (Sheet 1 summary block)
    total_dd_hours: float = 0.0              # Design & Development total
    internal_testing_hours: float = 0.0     # internal_testing_pct × total_dd_hours
    client_testing_hours: float = 0.0       # client_testing_pct  × total_dd_hours
    deployment_hours: float = 0.0           # deployment_pct      × total_dd_hours
    grand_total_hours: float = 0.0          # sum of all above

    # Sheet 2 row groups
    pre_engineering: list[AxcendResourceRow] = Field(default_factory=list)
    engineering: list[AxcendResourceRow] = Field(default_factory=list)
    project_management: list[AxcendResourceRow] = Field(default_factory=list)

    # The percentages that produced these numbers
    percentages: AxcendEstimationPercentages = Field(
        default_factory=AxcendEstimationPercentages
    )


# ---------------------------------------------------------------------------
# Schemas for Cost Estimation & Export
# ---------------------------------------------------------------------------

class AxcendCostRow(BaseModel):
    """One row in the AXCEND Category Effort Table (Cost Estimation)."""
    role: str
    count: int
    experience_years: float
    hours_per_member: float
    rate_per_day: float
    is_pm: bool
    s_level: str


class AxcendExcelExportRequest(BaseModel):
    """
    Unified payload to export the AXCEND Excel workbook.
    Contains all data for Sheet 1 (Module Feature), Sheet 2 (Efforts),
    and Sheet 3 (Overall Software Design Efforts / Costs).
    """
    project_name: str
    currency: str = "USD"
    # Sheet 1
    modules: list[AxcendModuleGroup] = Field(default_factory=list)
    # Sheet 2
    pre_engineering: list[AxcendResourceRow] = Field(default_factory=list)
    engineering: list[AxcendResourceRow] = Field(default_factory=list)
    project_management: list[AxcendResourceRow] = Field(default_factory=list)
    # Sheet 3
    cost_rows: list[AxcendCostRow] = Field(default_factory=list)
    # Ratios
    effort_percentages: AxcendEstimationPercentages = Field(
        default_factory=AxcendEstimationPercentages
    )
    pm_pct: float = 10.0
    finance_cost_pct: float = 1.5
    forex_risk_pct: float = 1.0
    risk_pct: float = 25.0
    nego_deduction_pct: float = 0.0

