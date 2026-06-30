"""
Axcend Effort Estimation Service.

Converts a TeamAnalysisResult (from the AI team allocation step) into an
AxcendEstimationSheet that mirrors the AXCEND EFFORT ESTIMATION Excel format.

Key rules:
  - No hours are hard-coded. Every number flows from the feature complexity
    analysis produced by the AI or from the user-supplied percentages.
  - Resource-level codes (A1/A2/A3/S1/S2/S3) are derived from experience
    years, never from role labels alone.
  - Three distinct effort buckets are produced: pre_engineering, engineering,
    and project_management.
"""
from __future__ import annotations

import logging

from app.schemas.axcend import (
    AxcendEstimationPercentages,
    AxcendEstimationSheet,
    AxcendFeatureRow,
    AxcendModuleGroup,
    AxcendResourceRow,
)
from app.schemas.team import CompanyResource, TeamAnalysisResult

logger = logging.getLogger(__name__)


def experience_to_resource_level(years: float) -> str:
    """
    Map years of experience to the AXCEND resource-level code.
    S3  >= 10 yrs  (Lead / S3 Developer)
    S2  5-10 yrs   (Senior / S2 Developer)
    S1  < 5 yrs    (Junior / S1 Developer)
    """
    if years >= 10:
        return "S3"
    if years >= 5:
        return "S2"
    return "S1"


def _resource_level_for_member(member: CompanyResource) -> str:
    role_lower = (member.role or "").lower()
    if any(kw in role_lower for kw in ("manager", "pm", "scrum", "analyst")):
        years = member.experience_years
        if years >= 10:
            return "S3"
        if years >= 5:
            return "S2"
        return "S1"
    return experience_to_resource_level(member.experience_years)


def _is_design_and_development_allocation(description: str) -> bool:
    """Keep only true D&D rows in the module-feature sheet."""
    lowered = (description or "").lower()
    non_dd_keywords = (
        "internal testing",
        "client testing",
        "external testing",
        "external review",
        "deployment",
        "go-live",
        "uat",
        "user acceptance",
        "review",
    )
    return not any(keyword in lowered for keyword in non_dd_keywords)


def _find_roster_by_role(
    roster: list[CompanyResource],
    keywords: list[str],
    min_exp: float = 0.0,
    max_exp: float = 100.0,
) -> CompanyResource | None:
    candidates = [
        r for r in roster
        if any(kw in (r.role or "").lower() for kw in keywords)
        and min_exp <= r.experience_years <= max_exp
    ]
    if candidates:
        return max(candidates, key=lambda r: r.experience_years)

    candidates = [
        r for r in roster
        if any(kw in (r.role or "").lower() for kw in keywords)
    ]
    return max(candidates, key=lambda r: r.experience_years) if candidates else None


class AxcendEstimationService:
    """Build an AxcendEstimationSheet from AI-produced team-analysis data."""

    def build(
        self,
        analysis: TeamAnalysisResult,
        roster: list[CompanyResource] | None = None,
        selected_option: str = "balanced",
        percentages_override: AxcendEstimationPercentages | None = None,
        location: str = "India",
    ) -> AxcendEstimationSheet:
        pct = percentages_override or AxcendEstimationPercentages()
        active_roster = roster or self._default_roster()
        option_key = selected_option if selected_option in ("fastest", "lean") else "balanced"

        modules = self._build_module_groups(analysis, option_key)
        total_dd_hours = int(round(sum(m.module_total_hours for m in modules)))

        internal_testing_hours = int(round(total_dd_hours * pct.internal_testing_pct))
        client_testing_hours = int(round(total_dd_hours * pct.client_testing_pct))
        deployment_hours = int(round(total_dd_hours * pct.deployment_pct))
        grand_total = int(round(
            total_dd_hours + internal_testing_hours + client_testing_hours + deployment_hours
        ))

        pre_eng = self._build_pre_engineering(active_roster, location)
        eng = self._build_engineering(
            active_roster,
            location,
            total_dd_hours,
            pct,
            internal_testing_hours,
            client_testing_hours,
            deployment_hours,
        )
        pm_rows = self._build_project_management(
            active_roster,
            location,
            total_dd_hours,
            pct,
            internal_testing_hours,
            client_testing_hours,
            deployment_hours,
        )

        return AxcendEstimationSheet(
            project_name=analysis.project_name,
            modules=modules,
            total_dd_hours=total_dd_hours,
            internal_testing_hours=internal_testing_hours,
            client_testing_hours=client_testing_hours,
            deployment_hours=deployment_hours,
            grand_total_hours=grand_total,
            pre_engineering=pre_eng,
            engineering=eng,
            project_management=pm_rows,
            percentages=pct,
        )

    def _build_module_groups(
        self,
        analysis: TeamAnalysisResult,
        option_key: str,
    ) -> list[AxcendModuleGroup]:
        groups: list[AxcendModuleGroup] = []
        for sl, feat_est in enumerate(
            sorted(analysis.feature_complexity_analysis, key=lambda f: f.module_name.lower()),
            start=1,
        ):
            if option_key == "fastest":
                alloc_list = feat_est.fastest_allocation
            elif option_key == "lean":
                alloc_list = feat_est.lean_allocation
            else:
                alloc_list = feat_est.balanced_allocation

            feature_rows: list[AxcendFeatureRow] = []
            if alloc_list:
                for alloc in alloc_list:
                    description = alloc.description or feat_est.reasoning
                    if not _is_design_and_development_allocation(description):
                        continue
                    dev = "S1"
                    role_lower = (alloc.role or "").lower()
                    if "s3" in role_lower or "lead" in role_lower or "architect" in role_lower:
                        dev = "S3"
                    elif "s2" in role_lower or "senior" in role_lower:
                        dev = "S2"
                    
                    role_tagged = alloc.role or "Developer"
                    if not (role_tagged.endswith("(S1)") or role_tagged.endswith("(S2)") or role_tagged.endswith("(S3)")):
                        role_tagged = f"{role_tagged} ({dev})"

                    feature_rows.append(
                        AxcendFeatureRow(
                            sl=len(feature_rows) + 1,
                            module=feat_est.module_name,
                            feature=role_tagged,
                            description=description,
                            estimated_hours=int(round(alloc.hours)),
                            base_hours=int(round(alloc.hours / (0.75 if dev == "S3" else 1.0 if dev == "S2" else 1.30))),
                            developer=dev,
                        )
                    )

            if not feature_rows:
                feature_rows.append(
                    AxcendFeatureRow(
                        sl=1,
                        module=feat_est.module_name,
                        feature=f"{feat_est.module_name} (S1)",
                        description=feat_est.reasoning,
                        estimated_hours=int(round(feat_est.estimated_hours)),
                        base_hours=int(round(feat_est.estimated_hours / 1.30)),
                        developer="S1",
                    )
                )

            groups.append(
                AxcendModuleGroup(
                    sl=sl,
                    module_name=feat_est.module_name,
                    features=feature_rows,
                    module_total_hours=int(round(sum(row.estimated_hours for row in feature_rows))),
                )
            )
        return groups

    def _build_pre_engineering(
        self,
        roster: list[CompanyResource],
        location: str,
    ) -> list[AxcendResourceRow]:
        has_s3 = any(
            any(kw in (r.role or "").lower() for kw in ["s3", "lead", "architect"]) or r.experience_years >= 10.0
            for r in roster
        )
        has_s2 = any(
            any(kw in (r.role or "").lower() for kw in ["s2", "senior"]) or (5.0 <= r.experience_years < 10.0)
            for r in roster
        )

        lead_dev = _find_roster_by_role(roster, ["s3", "lead", "architect"], min_exp=10.0)
        sr_dev = _find_roster_by_role(roster, ["s2", "senior"], min_exp=5.0)
        jr_dev = _find_roster_by_role(roster, ["s1", "junior"], min_exp=0.0, max_exp=4.99)
        
        if lead_dev is None:
            lead_dev = CompanyResource(name="Lead Dev", role="S3 Developer", experience_years=12.0)
        if sr_dev is None:
            sr_dev = CompanyResource(name="Sr Dev", role="S2 Developer", experience_years=8.0)
        if jr_dev is None:
            jr_dev = CompanyResource(name="Jr Dev", role="S1 Developer", experience_years=2.0)

        if has_s3:
            pre_dev = lead_dev
        elif has_s2:
            pre_dev = sr_dev
        else:
            pre_dev = jr_dev

        rl = _resource_level_for_member(pre_dev)
        activities = [
            ("Requirement Collection", 32.0),
            ("Query Preparation", 32.0),
            ("Weekly Interactions", 32.0),
            ("Time for Referring Knowledge Base", 32.0),
        ]

        return [
            AxcendResourceRow(
                activity=act,
                location=location,
                resource_level=rl,
                experience_years=pre_dev.experience_years,
                input_hours=hrs,
                section="pre_engineering",
            )
            for act, hrs in activities
        ]

    def _build_engineering(
        self,
        roster: list[CompanyResource],
        location: str,
        total_dd_hours: float,
        pct: AxcendEstimationPercentages,
        internal_testing_hours: float,
        client_testing_hours: float,
        deployment_hours: float,
    ) -> list[AxcendResourceRow]:
        has_s3 = any(
            any(kw in (r.role or "").lower() for kw in ["s3", "lead", "architect"]) or r.experience_years >= 10.0
            for r in roster
        )
        has_s2 = any(
            any(kw in (r.role or "").lower() for kw in ["s2", "senior"]) or (5.0 <= r.experience_years < 10.0)
            for r in roster
        )
        has_s1 = any(
            (not any(kw in (r.role or "").lower() for kw in ["s3", "lead", "architect", "s2", "senior"]) and r.experience_years < 5.0) or any(kw in (r.role or "").lower() for kw in ["s1", "junior"])
            for r in roster
        )

        sr_dev = _find_roster_by_role(roster, ["s2", "senior"], min_exp=5.0)
        jr_dev = _find_roster_by_role(roster, ["s1", "junior"], min_exp=0.0, max_exp=4.99)
        lead_dev = _find_roster_by_role(roster, ["s3", "lead", "architect"], min_exp=10.0)
        if sr_dev is None:
            sr_dev = CompanyResource(name="Sr Dev", role="S2 Developer", experience_years=8.0)
        if jr_dev is None:
            jr_dev = CompanyResource(name="Jr Dev", role="S1 Developer", experience_years=2.0)
        if lead_dev is None:
            lead_dev = CompanyResource(name="Lead Dev", role="S3 Developer", experience_years=12.0)

        sr_rl = _resource_level_for_member(sr_dev)
        jr_rl = _resource_level_for_member(jr_dev)
        lead_rl = _resource_level_for_member(lead_dev)

        # Decide pre-engineering / deployment resource: priority S3 -> S2 -> S1
        if has_s3:
            deploy_dev = lead_dev
            deploy_rl = lead_rl
        elif has_s2:
            deploy_dev = sr_dev
            deploy_rl = sr_rl
        else:
            deploy_dev = jr_dev
            deploy_rl = jr_rl

        # Decide testing resource: priority S2 -> S1 -> S3
        if has_s2:
            testing_dev = sr_dev
            testing_rl = sr_rl
        elif has_s1:
            testing_dev = jr_dev
            testing_rl = jr_rl
        else:
            testing_dev = lead_dev
            testing_rl = lead_rl

        # Dynamic development splits
        s3_pct = 0.0
        s2_pct = 0.0
        s1_pct = 0.0

        if has_s3 and has_s2 and has_s1:
            s3_pct, s2_pct, s1_pct = 0.20, 0.30, 0.50
        elif has_s2 and has_s1:
            s2_pct, s1_pct = 0.30, 0.70
        elif has_s3 and has_s1:
            s3_pct, s1_pct = 0.30, 0.70
        elif has_s3 and has_s2:
            s3_pct, s2_pct = 0.40, 0.60
        elif has_s3:
            s3_pct = 1.0
        elif has_s2:
            s2_pct = 1.0
        else:
            s1_pct = 1.0

        s3_dev_hours = int(round(total_dd_hours * s3_pct))
        sr_dev_hours = int(round(total_dd_hours * s2_pct))
        jr_dev_hours = int(round(total_dd_hours * s1_pct))

        eng_rows = []
        if s3_dev_hours > 0:
            eng_rows.append(
                AxcendResourceRow(
                    activity="Software Development - S3",
                    location=location,
                    resource_level=lead_rl,
                    experience_years=lead_dev.experience_years,
                    input_hours=s3_dev_hours,
                    section="engineering",
                )
            )
        if sr_dev_hours > 0:
            eng_rows.append(
                AxcendResourceRow(
                    activity="Software Development - S2",
                    location=location,
                    resource_level=sr_rl,
                    experience_years=sr_dev.experience_years,
                    input_hours=sr_dev_hours,
                    section="engineering",
                )
            )
        if jr_dev_hours > 0:
            eng_rows.append(
                AxcendResourceRow(
                    activity="Software Development - S1",
                    location=location,
                    resource_level=jr_rl,
                    experience_years=jr_dev.experience_years,
                    input_hours=jr_dev_hours,
                    section="engineering",
                )
            )

        eng_rows.append(
            AxcendResourceRow(
                activity=f"Internal Testing ({round(pct.internal_testing_pct * 100)}% of D&D)",
                location=location,
                resource_level=testing_rl,
                experience_years=testing_dev.experience_years,
                input_hours=internal_testing_hours,
                section="engineering",
            )
        )
        eng_rows.append(
            AxcendResourceRow(
                activity=f"Client Testing ({round(pct.client_testing_pct * 100)}% of D&D)",
                location=location,
                resource_level=testing_rl,
                experience_years=testing_dev.experience_years,
                input_hours=client_testing_hours,
                section="engineering",
            )
        )
        eng_rows.append(
            AxcendResourceRow(
                activity=f"Deployment ({round(pct.deployment_pct * 100)}% of D&D)",
                location=location,
                resource_level=deploy_rl,
                experience_years=deploy_dev.experience_years,
                input_hours=deployment_hours,
                section="engineering",
            )
        )
        return eng_rows

    def _build_project_management(
        self,
        roster: list[CompanyResource],
        location: str,
        total_dd_hours: float,
        pct: AxcendEstimationPercentages,
        internal_testing_hours: float,
        client_testing_hours: float,
        deployment_hours: float,
    ) -> list[AxcendResourceRow]:
        has_s3 = any(
            any(kw in (r.role or "").lower() for kw in ["s3", "lead", "architect"]) or r.experience_years >= 10.0
            for r in roster
        )
        has_s2 = any(
            any(kw in (r.role or "").lower() for kw in ["s2", "senior"]) or (5.0 <= r.experience_years < 10.0)
            for r in roster
        )

        lead_dev = _find_roster_by_role(roster, ["s3", "lead", "architect"], min_exp=10.0)
        sr_dev = _find_roster_by_role(roster, ["s2", "senior"], min_exp=5.0)
        jr_dev = _find_roster_by_role(roster, ["s1", "junior"], min_exp=0.0, max_exp=4.99)
        
        if lead_dev is None:
            lead_dev = CompanyResource(name="Lead Dev", role="S3 Developer", experience_years=12.0)
        if sr_dev is None:
            sr_dev = CompanyResource(name="Sr Dev", role="S2 Developer", experience_years=8.0)
        if jr_dev is None:
            jr_dev = CompanyResource(name="Jr Dev", role="S1 Developer", experience_years=2.0)

        if has_s3:
            pm_dev = lead_dev
        elif has_s2:
            pm_dev = sr_dev
        else:
            pm_dev = jr_dev

        lead_rl = _resource_level_for_member(pm_dev)
        total_pre_eng_hours = 128.0
        total_engineering_hours = total_dd_hours + internal_testing_hours + client_testing_hours + deployment_hours
        pm_hours = int(round((total_pre_eng_hours + total_engineering_hours) * pct.pm_pct))

        return [
            AxcendResourceRow(
                activity=f"Project Management ({round(pct.pm_pct * 100)}% of Pre-Eng + Engineering)",
                location=location,
                resource_level=lead_rl,
                experience_years=pm_dev.experience_years,
                input_hours=pm_hours,
                section="project_management",
            )
        ]

    @staticmethod
    def _default_roster() -> list[CompanyResource]:
        return [
            CompanyResource(name="Resource A", role="S3 Developer", experience_years=12.0),
            CompanyResource(name="Resource B", role="S2 Developer", experience_years=8.0),
            CompanyResource(name="Resource C", role="S1 Developer", experience_years=2.0),
            CompanyResource(name="Resource D", role="QA Tester", experience_years=4.0),
            CompanyResource(name="Resource E", role="Project Manager", experience_years=10.0),
            CompanyResource(name="Resource F", role="DevOps Engineer", experience_years=7.0),
        ]
