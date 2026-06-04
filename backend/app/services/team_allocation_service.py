import json
import logging
import re
from urllib.parse import urlparse
from urllib.request import urlopen
from textwrap import dedent
from typing import Any

from app.core.config import settings
from app.services.planning_sync import enrich_team_members_with_planning
from app.schemas.team import (
    TeamAllocationDocumentResult,
    TeamStructure,
    TeamMemberEstimate,
    TeamAnalysisResult,
    FeatureComplexityEstimate,
    CompanyResource,
    FeatureAllocation,
    TeamPlanningPreferences,
)
from app.schemas.srs import ModelSelection
from app.services.ai_provider_utils import unique_model_candidates
from app.utils.project_name import resolve_project_name

logger = logging.getLogger(__name__)

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


class TeamAllocationService:
    ROLE_HINTS = (
        "lead full stack developer",
        "senior full stack developer",
        "junior full stack developer",
        "qa tester",
        "project manager",
        "devops engineer",
    )

    def __init__(self) -> None:
        self._clients: dict[tuple[str, str, str], Any] = {}

    @property
    def _client_instance(self) -> Any:
        return self._client_for(None)

    def _client_for(self, selected_model: ModelSelection | None) -> Any:
        config = self._provider_config(selected_model)
        if config["provider"] == "anthropic":
            from app.services.anthropic_client import AnthropicClientShim
            cache_key = (
                config["provider"],
                config["base_url"],
                config["api_key"],
            )
            if cache_key not in self._clients:
                self._clients[cache_key] = AnthropicClientShim(
                    api_key=config["api_key"],
                    base_url=config["base_url"],
                    timeout=settings.openai_timeout_seconds,
                )
            return self._clients[cache_key]

        if OpenAI is None:
            raise RuntimeError("The OpenAI Python SDK is not installed.")

        cache_key = (
            config["provider"],
            config["base_url"],
            config["api_key"],
        )
        if cache_key not in self._clients:
            self._clients[cache_key] = OpenAI(
                api_key=config["api_key"],
                base_url=config["base_url"],
                timeout=settings.openai_timeout_seconds,
            )
        return self._clients[cache_key]

    def _candidate_models(self, selected_model: ModelSelection | None) -> list[str]:
        provider = selected_model.provider if selected_model else "openai"
        runtime_model = selected_model.model if selected_model and selected_model.model else None

        if provider == "anthropic":
            return [runtime_model or "claude-3-5-sonnet-latest"]

        if provider == "ollama":
            return unique_model_candidates(
                [runtime_model, settings.ollama_srs_model],
                settings.ollama_srs_fallback_models,
            )

        if provider == "gemini":
            return unique_model_candidates(
                [runtime_model, settings.gemini_srs_model],
                settings.gemini_srs_fallback_models,
            )

        return unique_model_candidates(
            [runtime_model, settings.openai_srs_model],
            settings.openai_srs_fallback_models,
        )

    def _ai_model_attempts(self, selected_model: ModelSelection | None) -> list[ModelSelection]:
        primary = selected_model or ModelSelection(provider="openai")
        attempts: list[ModelSelection] = []

        def add_provider(provider: str, base_selection: ModelSelection | None = None) -> None:
            if provider == "openai" and not settings.openai_api_key:
                return
            if provider == "gemini" and not settings.gemini_api_key:
                return
            if provider == "ollama" and not settings.ollama_srs_enabled:
                return

            selection = base_selection if base_selection and base_selection.provider == provider else ModelSelection(provider=provider)
            for model_name in self._candidate_models(selection):
                attempts.append(
                    ModelSelection(
                        provider=provider,
                        model=model_name,
                        base_url=selection.base_url,
                        api_key=selection.api_key,
                    )
                )

        add_provider(primary.provider, primary)
        for fallback_provider in ("openai", "gemini", "ollama"):
            if fallback_provider != primary.provider:
                add_provider(fallback_provider)

        deduped: list[ModelSelection] = []
        seen: set[tuple[str, str, str | None]] = set()
        for attempt in attempts:
            key = (attempt.provider, attempt.model or "", attempt.base_url)
            if key not in seen:
                seen.add(key)
                deduped.append(attempt)
        return deduped

    def _provider_config(self, selected_model: ModelSelection | None) -> dict[str, str]:
        provider = selected_model.provider if selected_model else "openai"
        runtime_key = selected_model.api_key if selected_model and selected_model.api_key else None

        if provider == "anthropic":
            return {
                "provider": "anthropic",
                "model": (selected_model.model if selected_model and selected_model.model else "claude-3-5-sonnet-latest"),
                "base_url": (selected_model.base_url if selected_model and selected_model.base_url else "https://api.anthropic.com"),
                "api_key": runtime_key or "",
            }

        if provider == "ollama":
            return {
                "provider": "ollama",
                "model": (selected_model.model if selected_model and selected_model.model else settings.ollama_srs_model),
                "base_url": (selected_model.base_url if selected_model and selected_model.base_url else settings.ollama_api_base),
                "api_key": runtime_key or settings.ollama_api_key or "ollama",
            }

        if provider == "gemini":
            return {
                "provider": "gemini",
                "model": (selected_model.model if selected_model and selected_model.model else settings.gemini_srs_model),
                "base_url": (selected_model.base_url if selected_model and selected_model.base_url else "https://generativelanguage.googleapis.com/v1beta/openai/"),
                "api_key": runtime_key or settings.gemini_api_key or "",
            }

        # default: openai-compatible (Groq)
        return {
            "provider": "openai",
            "model": (selected_model.model if selected_model and selected_model.model else settings.openai_srs_model),
            "base_url": (selected_model.base_url if selected_model and selected_model.base_url else settings.openai_api_base),
            "api_key": runtime_key or settings.openai_api_key or "",
        }

    @staticmethod
    def _find_resource_for_bracket_static(
        roster: list[CompanyResource],
        role_keywords: list[str],
        min_exp: float = 0.0,
        max_exp: float = 100.0,
        fallback_role: str = "Developer",
        fallback_exp: float = 5.0,
    ) -> CompanyResource:
        candidates = []
        for r in roster:
            role_lower = r.role.lower()
            if any(kw in role_lower for kw in role_keywords) and min_exp <= r.experience_years <= max_exp:
                candidates.append(r)
        if candidates:
            return max(candidates, key=lambda x: x.experience_years)
        
        # Second pass: check role matches without experience constraint
        candidates_any_exp = [r for r in roster if any(kw in r.role.lower() for kw in role_keywords)]
        if candidates_any_exp:
            return max(candidates_any_exp, key=lambda x: x.experience_years)
            
        # Third pass: check any resource matching experience constraint
        candidates_any_role = [r for r in roster if min_exp <= r.experience_years <= max_exp]
        if candidates_any_role:
            return max(candidates_any_role, key=lambda x: x.experience_years)
            
        return CompanyResource(name="Fallback", role=fallback_role, experience_years=fallback_exp)

    def _build_scenario_team_structure(
        self,
        project_name: str,
        opt_key: str,
        feature_complexity_analysis: list[FeatureComplexityEstimate],
        active_roster: list[CompanyResource],
        management_coverage: str,
        deployment_coverage: str,
        logic_summary: str = "",
    ) -> TeamStructure:
        # 1. Total dev hours is sum of module estimated hours
        total_dev_hours = sum(max(0.0, float(m.estimated_hours or 0.0)) for m in feature_complexity_analysis)
        if total_dev_hours <= 0:
            total_dev_hours = 160.0

        # 2. Testing and deployment hours (senior dev)
        testing_internal_hours = round(total_dev_hours * 0.15, 2)
        testing_external_hours = round(total_dev_hours * 0.15, 2)
        deployment_hours = round(total_dev_hours * 0.10, 2)
        req_fetch_hours = 16.0
        weekly_meetings_hours = 16.0
        kt_hours = 8.0

        senior_hours = round(testing_internal_hours + testing_external_hours + deployment_hours + req_fetch_hours + weekly_meetings_hours + kt_hours, 2)
        total_base_effort = round(total_dev_hours + senior_hours, 2)

        # 3. Project Management hours
        pm_hours = round(total_base_effort * 0.15, 2)

        # 4. Risk and Negotiation
        total_efforts_estimation = round(total_base_effort + pm_hours, 2)
        risk_hours = round(total_efforts_estimation * 0.10, 2)
        negotiation_hours = round(total_efforts_estimation * 0.05, 2)

        # 5. Developer allocation split by option
        if opt_key == "fastest":
            mid_hours = total_dev_hours
            junior_hours = 0.0
            mid_count = 2
            junior_count = 0
            # Dev hours are halved by parallel staff
            mid_hours_per_member = round(mid_hours / 2.0, 2)
            junior_hours_per_member = 0.0
        elif opt_key == "lean":
            mid_hours = round(total_dev_hours * 0.50, 2)
            junior_hours = round(total_dev_hours * 0.50, 2)
            mid_count = 1
            junior_count = 1
            mid_hours_per_member = mid_hours
            junior_hours_per_member = junior_hours
        else: # balanced
            mid_hours = round(total_dev_hours * 0.50, 2)
            junior_hours = round(total_dev_hours * 0.50, 2)
            mid_count = 1
            junior_count = 1
            mid_hours_per_member = mid_hours
            junior_hours_per_member = junior_hours

        # 6. Roster matching
        res_senior = self._find_resource_for_bracket_static(active_roster, ["developer", "engineer", "architect"], min_exp=10.01, fallback_role="Lead Full Stack Developer", fallback_exp=12.0)
        res_mid = self._find_resource_for_bracket_static(active_roster, ["developer", "engineer", "architect"], min_exp=5.0, max_exp=10.0, fallback_role="Senior Full Stack Developer", fallback_exp=8.0)
        res_junior = self._find_resource_for_bracket_static(active_roster, ["developer", "engineer", "architect"], min_exp=0.0, max_exp=4.99, fallback_role="Junior Full Stack Developer", fallback_exp=2.0)
        res_pm = self._find_resource_for_bracket_static(active_roster, ["manager", "pm", "scrum", "analyst"], min_exp=0.0, fallback_role="Project Manager", fallback_exp=10.0)

        # 7. Create member estimates
        members_list = []

        # Senior Dev - Testing
        testing_senior_hours = round(testing_internal_hours + testing_external_hours + req_fetch_hours + weekly_meetings_hours + kt_hours, 2)
        members_list.append(
            TeamMemberEstimate(
                role=f"{res_senior.role} (Testing) ({res_senior.experience_years:g} Yrs Exp)",
                count=1,
                description="Handles internal testing (15%), external testing (15%), client requirements (16h), weekly meetings (16h), and KT (8h).",
                weekly_hours=40.0,
                active_weeks=round((testing_senior_hours / 40.0) * 0.75, 2),
                hours_per_member=testing_senior_hours
            )
        )

        # Senior Dev - Deployment
        members_list.append(
            TeamMemberEstimate(
                role=f"{res_senior.role} (Deployment) ({res_senior.experience_years:g} Yrs Exp)",
                count=1,
                description="Handles deployment activities (10%).",
                weekly_hours=40.0,
                active_weeks=round((deployment_hours / 40.0) * 0.75, 2),
                hours_per_member=deployment_hours
            )
        )

        # Mid-level Dev
        if mid_hours > 0:
            members_list.append(
                TeamMemberEstimate(
                    role=f"{res_mid.role} ({res_mid.experience_years:g} Yrs Exp)",
                    count=mid_count,
                    description="Handles core module development tasks.",
                    weekly_hours=40.0,
                    active_weeks=round((mid_hours_per_member / 40.0), 2),
                    hours_per_member=mid_hours_per_member
                )
            )

        # Junior Dev
        if junior_hours > 0:
            members_list.append(
                TeamMemberEstimate(
                    role=f"{res_junior.role} ({res_junior.experience_years:g} Yrs Exp)",
                    count=junior_count,
                    description="Assists with module development tasks.",
                    weekly_hours=40.0,
                    active_weeks=round((junior_hours_per_member / 40.0) * 1.30, 2), # 1.30 learning curve factor
                    hours_per_member=junior_hours_per_member
                )
            )

        # Project Manager
        members_list.append(
            TeamMemberEstimate(
                role=f"{res_pm.role} ({res_pm.experience_years:g} Yrs Exp)",
                count=1,
                description="Provides project management and delivery governance (15% of total base effort).",
                weekly_hours=40.0,
                active_weeks=round(pm_hours / 40.0, 2),
                hours_per_member=pm_hours
            )
        )

        # Risk Contingency virtual member
        members_list.append(
            TeamMemberEstimate(
                role="Risk Contingency (10%)",
                count=1,
                description="Calculated contingency buffer (10% of efforts estimation).",
                weekly_hours=40.0,
                active_weeks=round(risk_hours / 40.0, 2),
                hours_per_member=risk_hours
            )
        )

        # Negotiation Buffer virtual member
        members_list.append(
            TeamMemberEstimate(
                role="Negotiation Buffer (5%)",
                count=1,
                description="Calculated negotiation buffer (5% of efforts estimation).",
                weekly_hours=40.0,
                active_weeks=round(negotiation_hours / 40.0, 2),
                hours_per_member=negotiation_hours
            )
        )

        computed_total_hours = sum(int(m.count) * float(m.hours_per_member or 0.0) for m in members_list)
        max_active_weeks = max(float(m.active_weeks or 0.0) for m in members_list)
        total_size = sum(m.count for m in members_list if not m.role.startswith("Risk") and not m.role.startswith("Negotiation"))

        if not logic_summary:
            logic_summary = (
                f"{opt_key.title()} team structure generated from {total_dev_hours:g} dev hours. "
                f"Testing (30%) & Deployment (10%) allocated to Senior Developer. "
                f"Project Management (15%), Risk (10%), and Negotiation (5%) buffers included."
            )

        return TeamStructure(
            project_name=project_name,
            total_size=total_size,
            members=members_list,
            logic_summary=logic_summary,
            weekly_hours_per_member=40.0,
            total_working_weeks=round(max_active_weeks, 2),
            total_project_hours=round(computed_total_hours, 2)
        )

    def analyze_srs_for_team(
        self,
        srs_text: str,
        hint_name: str = "",
        selected_model: ModelSelection | None = None,
        company_roster: list[CompanyResource] | None = None,
        planning_preferences: TeamPlanningPreferences | None = None,
    ) -> TeamAnalysisResult:
        """Analyze SRS / project description text and recommend multiple optimized team structures."""
        provider_config = self._provider_config(selected_model)
        provider = provider_config["provider"]

        # Parse approved project duration (weeks) from srs_text
        approved_weeks = None
        weeks_match = re.search(r"Approved Project Duration:\s*(\d+)\s*days\s*\((\d+)\s*working weeks\)", srs_text, re.IGNORECASE)
        if weeks_match:
            approved_weeks = float(weeks_match.group(2))
        else:
            weeks_match2 = re.search(r"Approved Project Duration:\s*(\d+)\s*(?:working\s*)?weeks", srs_text, re.IGNORECASE)
            if weeks_match2:
                approved_weeks = float(weeks_match2.group(1))
            else:
                days_match = re.search(r"Approved Project Duration:\s*(\d+)\s*days", srs_text, re.IGNORECASE)
                if days_match:
                    approved_weeks = round(float(days_match.group(1)) / 5.0, 1)

        # Parse approved effort hours from srs_text (Realistic or otherwise)
        approved_hours = None
        hours_match = re.search(r"Realistic:\s*(?:\d+)\s*days\s*\((\d+)\s*hours\)", srs_text, re.IGNORECASE)
        if hours_match:
            approved_hours = float(hours_match.group(1))
        else:
            hours_match2 = re.search(r"Realistic:.*?(\d+)\s*hours", srs_text, re.IGNORECASE)
            if hours_match2:
                approved_hours = float(hours_match2.group(1))
            else:
                hours_match3 = re.search(r"Approved Total Project Effort.*?Realistic:.*?(\d+)\s*hours", srs_text, re.IGNORECASE | re.DOTALL)
                if hours_match3:
                    approved_hours = float(hours_match3.group(1))

        # Build a complexity-driven context hint
        approved_ref = f"The SRS has an approved project duration of approximately {approved_weeks} weeks. Use this as the BALANCED scenario baseline." if approved_weeks else ""

        duration_effort_clause = dedent(f"""
        PROJECT COMPLEXITY ANALYSIS → TEAM & TIMELINE DERIVATION (MANDATORY):

        {approved_ref}

        Step 1 — Derive project scope from features:
        - First, calculate the total engineering hours needed based on the feature complexity analysis.
        - Sum up the estimated_hours across all feature modules. This is your SCOPE.
        - This scope drives everything else. It is mostly constant across scenarios because the product scope
          is the same; staffing mainly changes calendar duration, concurrency, and a small amount of coordination overhead.

        Step 2 — Define three GENUINELY DIFFERENT scenarios:
        - Each scenario must have DIFFERENT total_working_weeks, DIFFERENT total_project_hours,
          and DIFFERENT team composition (sizes and roles).
        - "fastest": Large team, high parallelism. Many experienced people working simultaneously.
          Result: Shortest calendar time (fewer weeks), with total_project_hours staying CLOSE to the balanced option.
          It may be slightly higher because of coordination overhead, but never dramatically higher.
        - "balanced": Medium team, realistic mix of roles. Moderate weeks and baseline total hours.
          This is the most recommended configuration for the project complexity.
        - "lean": Minimum headcount, sequential execution. LONGEST calendar time, with somewhat lower total hours
          than balanced due to less overlap and management overhead, but still in the same general range.

        KEY RULE — total_project_hours formula:
          total_project_hours = SUM of (count × active_weeks × 40) for every member.
          This SHOULD stay in the same ballpark across scenarios because the implementation scope is the same.
          Do NOT make "fastest" massively higher than "balanced" just because more people work in parallel.
          A good rule of thumb:
          - fastest: about 0% to 5% above balanced
          - balanced: baseline scope effort
          - lean: about 5% to 15% below balanced

        Step 3 — Calibrate active_weeks per member by experience:
        - More experienced person (10+ yrs) → fewer active_weeks for the same feature scope.
        - Less experienced person (1-2 yrs) → more active_weeks for the same feature scope.
        - Members in the same scenario CAN have different active_weeks.
        - total_working_weeks = MAX active_weeks across all members in that scenario.
        """)


        # Set up active roster
        DEFAULT_ROSTER = [
            CompanyResource(name="Resource A", role="Lead Full Stack Developer", experience_years=12.0),
            CompanyResource(name="Resource B", role="Senior Full Stack Developer", experience_years=8.0),
            CompanyResource(name="Resource C", role="Junior Full Stack Developer", experience_years=2.0),
            CompanyResource(name="Resource D", role="QA Tester", experience_years=4.0),
            CompanyResource(name="Resource E", role="Project Manager", experience_years=10.0),
            CompanyResource(name="Resource F", role="DevOps Engineer", experience_years=7.0),
        ]
        
        active_roster = company_roster if company_roster else self._default_roster()
        planning_preferences = planning_preferences or TeamPlanningPreferences()
        preferred_strategy = planning_preferences.preferred_strategy if planning_preferences.preferred_strategy in {"fastest", "balanced", "lean"} else "balanced"
        management_coverage = planning_preferences.project_management_coverage if planning_preferences.project_management_coverage in {"light", "standard", "intensive"} else "standard"
        deployment_coverage = planning_preferences.deployment_coverage if planning_preferences.deployment_coverage in {"light", "standard", "intensive"} else "standard"
        # Build roster lines with velocity hints based on experience - names kept internal for reasoning only
        roster_lines = []
        for r in active_roster:
            exp = r.experience_years
            # Derive a natural-language velocity hint so the AI reasons dynamically
            if exp >= 10:
                velocity_hint = "very fast — can independently architect and deliver end-to-end with minimal ramp-up"
            elif exp >= 7:
                velocity_hint = "fast — strong ownership, minimal oversight needed"
            elif exp >= 5:
                velocity_hint = "moderate — solid output, occasional guidance needed"
            elif exp >= 3:
                velocity_hint = "moderately slow — produces good work but needs more calendar time per feature"
            elif exp >= 1:
                velocity_hint = "slow — learning curve expected, requires mentoring and more active_weeks per task"
            else:
                velocity_hint = "very slow — trainee level, needs close supervision and longest delivery window"
            roster_lines.append(
                f"- Role: {r.role} | Experience: {exp} Years | Working Velocity: {velocity_hint}"
            )
        roster_str = "\n".join(roster_lines)

        roster_clause = dedent(f"""
        COMPANY ROSTER (experience-based velocity profiles — for internal reasoning only):
        {roster_str}

        EXPERIENCE-DRIVEN TEAM DESIGN RULES (MANDATORY):
        1. Use the roster roles and experience years ONLY for velocity reasoning internally.
           Do NOT output any personal names in the JSON response.

        2. VELOCITY-BASED REASONING (this is how you decide which role to pick and how long they take):
           Think like a seasoned project manager:
           - A role with MORE years of experience completes the same feature FASTER.
             Their "active_weeks" for the same scope of work will be LOWER.
           - A role with FEWER years of experience will take LONGER for the same scope.
             Their "active_weeks" will be HIGHER.
           - Do NOT use fixed seniority-to-complexity mapping. Instead, reason:
             * "This module is high-risk with architectural decisions — I want a role with high experience
               (e.g. 12 Yrs Exp) who works fast and confidently. They'll finish it in fewer weeks."
             * "This module is straightforward CRUD — a moderately experienced role
               (e.g. 5 Yrs Exp) is fine. They take a bit longer but scope is manageable."
             * "This module is simple config — even a 2-year role can do it,
               but I budget more active_weeks for them."
           - Use experience years to CALIBRATE active_weeks:
             * A task that takes a 10-yr role 4 weeks might take a 5-yr role 6 weeks and a 2-yr role 9 weeks.
             * Apply this principle across all members in all three scenarios.

        3. THREE SCENARIO LOGIC:
           - "fastest": Assign the MOST experienced roles (highest years) to minimize active_weeks.
             Overlap work in parallel with a larger concurrent team. Lowest total calendar time.
           - "balanced": Mix of experienced and moderately experienced roles. Moderate active_weeks.
             A realistic, cost-effective team where each role's velocity is factored in.
           - "lean": Use fewer roles — even if it means less experienced roles that take longer (more active_weeks).
             Minimise headcount, maximise calendar time.

        4. OUTPUT ROLE FORMAT (mandatory — NO personal names):
           `<Role Title> (<Experience Years> Yrs Exp)`
           Examples:
           - "Lead Full Stack Developer (12 Yrs Exp)"
           - "Senior Full Stack Developer (8 Yrs Exp)"
           - "Junior Full Stack Developer (2 Yrs Exp)"
           - "QA Tester (4 Yrs Exp)"
           - "Project Manager (10 Yrs Exp)"
           - "DevOps Engineer (7 Yrs Exp)"
           Only use roles and experience years that exist in the roster above.
            NEVER include any person's name in the output.
         """)

        preferences_clause = dedent(f"""
        USER TEAM DESIGN PREFERENCES (MANDATORY):
        - Preferred strategy chosen by the user: {preferred_strategy.upper()}.
        - Project management coverage preference: {management_coverage.upper()}.
        - Deployment / DevOps coverage preference: {deployment_coverage.upper()}.

        How to apply these preferences:
        - Still return all three scenarios: fastest, balanced, and lean.
        - However, treat the user's preferred strategy as the default recommended option and align its logic_summary to clearly explain why it fits the user's preference.
        - For module-wise allocations, focus on DEVELOPMENT and TESTING work for each module.
        - Project management and deployment / DevOps must NOT be omitted from the team design. Include them in the overall team options and total effort.
        - Project management and deployment coverage should be reasoned separately from module build work, but their effort must remain INCLUDED in the same team allocation result, total_project_hours, and total_working_weeks.
        - Calibrate support intensity:
          * LIGHT: minimal but credible PM / DevOps oversight.
          * STANDARD: normal delivery governance and release support.
          * INTENSIVE: strong coordination, release management, and operational readiness coverage.
        """)

        hint_clause = (
            f'The user has provided a hint project name: "{hint_name}". '
            "Use this only if the content does not make the project name clear."
            if hint_name.strip()
            else "Infer the project name from the content."
        )

        provider_preamble = ""
        if provider in {"ollama", "gemini", "anthropic"}:
            provider_preamble = dedent("""
            CRITICAL INSTRUCTION FOR THIS PROVIDER:
            You MUST output ONLY a single valid JSON object. Nothing else.
            Do NOT output any text before or after the JSON.
            Do NOT use markdown code fences (```json or ```).
            Do NOT explain your answer or add any commentary.
            Start your response immediately with { and end with }.

            """)

        # ── Extract the FULL module list from the complete SRS text BEFORE truncating ──
        # This ensures all modules are known to the AI even if srs_text is long
        extracted_modules = self._extract_module_names_from_srs(srs_text)
        if extracted_modules:
            module_list_clause = (
                "AUTHORITATIVE MODULE LIST (extracted from the FULL approved SRS — you MUST analyze ALL of these):\n"
                + "\n".join(f"  {i+1}. {m}" for i, m in enumerate(extracted_modules))
                + "\n\nYour 'feature_complexity_analysis' array MUST have EXACTLY one entry per module listed above "
                  "and NOTHING else. Do not add, rename, merge, or remove any module."
            )
        else:
            module_list_clause = ""

        prompt = dedent(f"""
            {provider_preamble}
            You are a senior project manager and staffing architect reviewing a project description or SRS document.

            {hint_clause}

            {duration_effort_clause}

            {roster_clause}

            {preferences_clause}

            STRICT DIRECTIVE ON MODULES AND FEATURES (CRITICAL):
            {module_list_clause}
            - If the input text contains defined lists of 'Modules:' and 'Features:' (inherited from an approved SRS), you MUST analyze those exact modules and features.
            - Do NOT rename them, invent new ones, delete any, or flatten the structure.
            - Your 'feature_complexity_analysis' array MUST contain exactly one entry for each of those exact modules.
            - You MUST list the 'feature_complexity_analysis' entries in ALPHABETICAL order of their 'module_name'.
            - Group all complexity estimates, screen designs, and scenario staffing allocations (fastest, balanced, lean) strictly by those exact module names.

            Based on the content below, perform two tasks:
            1. Analyze the feature modules and screens described in the document, assign a complexity rating (Low, Medium, or High) and estimated total engineering hours for each module, with clear architectural reasoning.
               - In addition, you must extract/identify the specific Screen Designs or UI Pages involved in this module (put them in the `screen_designs` array).
               - For EACH module, you must also provide a detailed Feature/Module-wise Team Allocation mapping out who does what under each of the three scenarios (Fastest, Balanced, Lean).
               - IMPORTANT: Be highly realistic and practical about developer velocity. A high-complexity module feature should typically take 40 to 80 hours of total engineering effort, medium complexity 24 to 40 hours, and low complexity 8 to 20 hours. Do NOT overestimate and generate massive hours like 150-300 hours per feature module.
               - STRICT ROLE BRACKETS RULE:
                 * DEVELOPMENT WORK: Done ONLY by Mid-level and Junior developers (experience <= 10 years).
                 * TESTING & DEPLOYMENT WORK: Done ONLY by Senior developers (experience > 10 years).
                   - Internal testing time allocation = 15% of development hours.
                   - External testing time allocation = 15% of development hours.
                   - Deployment time allocation = 10% of development hours.
                 * SENIOR OTHER: Senior developers also handle client requirements (max 16h), weekly meetings (16h), and KT (8h).
                 * fastest_allocation: Recommend Mid-level Developer role for 100% of development hours. Senior Developer handles testing & deployment.
                 * balanced_allocation: Recommend Mid-level Developer (50%) and Junior Developer (50%) for development. Senior Developer handles testing & deployment.
                 * lean_allocation: Recommend Mid-level Developer (50%) and Junior Developer (50%) for development. Senior Developer handles testing & deployment.
            2. Generate three distinct, mathematically consistent team structure options:
               - "fastest": High parallel execution. Mid-level Developer count = 2 (split dev hours), Junior Developer count = 0. Senior Developer count = 1. PM count = 1.
               - "balanced": Mid-level Developer count = 1 (50% dev), Junior Developer count = 1 (50% dev). Senior Developer count = 1. PM count = 1.
               - "lean": Mid-level Developer count = 1 (50% dev), Junior Developer count = 1 (50% dev). Senior Developer count = 1. PM count = 1.
               - Always include "Project Manager" (PM hours = 15% of total base effort: Development + Testing + Deployment + Senior Development).
               - Always include "Risk Contingency (10%)" and "Negotiation Buffer (5%)" as separate virtual members in the members list.

            STRICT MATH EQUATIONS:
            - total_dev_hours = Sum of estimated hours across all modules.
            - testing_internal_hours = total_dev_hours * 0.15
            - testing_external_hours = total_dev_hours * 0.15
            - deployment_hours = total_dev_hours * 0.10
            - senior_other_hours = 16 (requirements) + 16 (meetings) + 8 (KT) = 40 hours
            - senior_developer_hours = testing_internal_hours + testing_external_hours + deployment_hours + senior_other_hours
            - total_base_effort = total_dev_hours + senior_developer_hours
            - pm_hours = total_base_effort * 0.15
            - total_efforts_estimation = total_base_effort + pm_hours
            - risk_hours = total_efforts_estimation * 0.10
            - negotiation_hours = total_efforts_estimation * 0.05
            - total_project_hours = total_efforts_estimation + risk_hours + negotiation_hours

            CRITICAL RULES FOR TEAM STRUCTURE OPTIONS:
            - Use ONLY roles and experience years from the Company Roster. Format each role as `<Role Title> (<Experience Years> Yrs Exp)`.
              NEVER include any personal name in the role field. Example: "Lead Developer (12 Yrs Exp)".
            - Calibrate active_weeks for each member:
              * Senior Developer active_weeks = (senior_hours / 40) * 0.75
              * Mid-level Developer active_weeks = mid_hours / 40
              * Junior Developer active_weeks = (junior_hours / 40) * 1.30
              * PM active_weeks = pm_hours / 40
              * Risk Contingency active_weeks = risk_hours / 40
              * Negotiation Buffer active_weeks = negotiation_hours / 40

            PROJECT CONTENT:
            {srs_text[:30000]}

            Return ONLY a valid JSON object matching this exact schema:
            {{
                "project_name": "<concise professional project name extracted from content>",
                "recommended_option": "fastest | balanced | lean",
                "feature_complexity_analysis": [
                    {{
                        "module_name": "<name of the module or feature area>",
                        "complexity": "Low | Medium | High",
                        "estimated_hours": <float: estimated hours to implement>,
                        "reasoning": "<1 sentence reasoning why this complexity and hour estimate fits the features>",
                        "screen_designs": ["<Screen/Page Name 1>", "<Screen/Page Name 2>"],
                        "fastest_allocation": [
                            {{
                                "role": "<Role Title matching Company Roster>",
                                "hours": <float: hours allocated to this feature under fastest>,
                                "description": "<specific tasks for this role on this feature>"
                            }}
                        ],
                        "balanced_allocation": [
                            {{
                                "role": "<Role Title matching Company Roster>",
                                "hours": <float: hours allocated to this feature under balanced>,
                                "description": "<specific tasks for this role on this feature>"
                            }}
                        ],
                        "lean_allocation": [
                            {{
                                "role": "<Role Title matching Company Roster>",
                                "hours": <float: hours allocated to this feature under lean>,
                                "description": "<specific tasks for this role on this feature>"
                            }}
                        ]
                    }}
                ],
                "options": {{
                    "fastest": {{
                        "project_name": "<project name>",
                        "total_size": <integer>,
                        "logic_summary": "<explanation of the fastest staffing strategy>",
                        "weekly_hours_per_member": 40,
                        "total_working_weeks": <float: max active_weeks of any member>,
                        "total_project_hours": <float: sum of all members' count * hours_per_member>,
                        "members": [
                            {{
                                "role": "<Role Title> (<Experience Years> Yrs Exp) — e.g. 'Lead Developer (12 Yrs Exp)'",
                                "count": <integer >= 1>,
                                "description": "<velocity reasoning: e.g. 'A 12 Yrs Exp Lead Developer (very fast velocity) completes their scope in 5.5 active_weeks — 2.5 weeks faster than a mid-level developer would need.'>",
                                "weekly_hours": 40,
                                "active_weeks": <float: calibrated by this role's experience — NOT the same as every other member>,
                                "hours_per_member": <float: active_weeks * 40>
                            }}
                        ]
                    }},
                    "balanced": {{
                        "project_name": "<project name>",
                        "total_size": <integer>,
                        "logic_summary": "<explanation of the balanced staffing strategy>",
                        "weekly_hours_per_member": 40,
                        "total_working_weeks": <float: max active_weeks of any member>,
                        "total_project_hours": <float: sum of all members' count * hours_per_member>,
                        "members": [
                            {{
                                "role": "<role>",
                                "count": <integer >= 1>,
                                "description": "<why this role and count is chosen for balanced option>",
                                "weekly_hours": 40,
                                "active_weeks": <float>,
                                "hours_per_member": <float: active_weeks * 40>
                            }}
                        ]
                    }},
                    "lean": {{
                        "project_name": "<project name>",
                        "total_size": <integer>,
                        "logic_summary": "<explanation of the lean staffing strategy>",
                        "weekly_hours_per_member": 40,
                        "total_working_weeks": <float: max active_weeks of any member>,
                        "total_project_hours": <float: sum of all members' count * hours_per_member>,
                        "members": [
                            {{
                                "role": "<role>",
                                "count": <integer >= 1>,
                                "description": "<why this role and count is chosen for lean option>",
                                "weekly_hours": 40,
                                "active_weeks": <float>,
                                "hours_per_member": <float: active_weeks * 40>
                            }}
                        ]
                    }}
                }}
            }}
        """)

        model_attempts = self._ai_model_attempts(selected_model)
        if not model_attempts:
            raise RuntimeError("No team allocation models are configured.")

        response = None
        last_errors: list[str] = []
        for attempt in model_attempts:
            attempt_config = self._provider_config(attempt)
            attempt_provider = attempt_config["provider"]
            model_name = attempt.model or attempt_config["model"]
            try:
                self._validate_provider_is_ready(attempt_config)
                client = self._client_for(attempt)
                kwargs = {
                    "model": model_name,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a senior project manager and staffing architect. "
                                "Return JSON containing module complexity analyses and three distinct, mathematically consistent team options (fastest, balanced, lean)."
                            )
                        },
                        {"role": "user", "content": prompt}
                    ]
                }
                if attempt_provider == "gemini":
                    kwargs["max_tokens"] = 8192
                elif attempt_provider in {"ollama", "anthropic"}:
                    kwargs["max_tokens"] = 4096
                else:
                    kwargs["response_format"] = {"type": "json_object"}
                    kwargs["max_tokens"] = 4096

                response = client.chat.completions.create(**kwargs)
                break
            except Exception as exc:
                detail = f"{attempt_provider}/{model_name}: {exc}"
                last_errors.append(detail)
                logger.warning("AI team allocation attempt failed: %s", detail)
        if response is None and last_errors:
            raise RuntimeError("All AI team allocation attempts failed. " + " | ".join(last_errors[-3:]))

        if not response or not response.choices[0].message.content:
            raise RuntimeError("Empty response from AI model")

        content = response.choices[0].message.content.strip()
        from app.services.ai_provider_utils import repair_json_string
        repaired_content = repair_json_string(content)
        data = json.loads(repaired_content)

        project_name = resolve_project_name(
            extracted_name=data.get("project_name"),
            provided_name=hint_name,
            raw_text=srs_text,
            fallback="Project Brief",
        )

        # Parse feature complexity analysis
        raw_analysis = data.get("feature_complexity_analysis", [])
        feature_complexity_analysis = []
        for item in raw_analysis:
            module_name = item.get("module_name", "General").strip()
            estimated_hours = float(item.get("estimated_hours") or 0.0)
            if estimated_hours <= 0:
                estimated_hours = 40.0

            # Deterministically recalculate module allocations to ensure strict math rules are followed
            # for all AI models (Gemini, Groq, custom, etc.)
            fastest_alloc = self._fallback_allocations_for_module(
                module_name,
                estimated_hours,
                active_roster,
                "fastest"
            )
            balanced_alloc = self._fallback_allocations_for_module(
                module_name,
                estimated_hours,
                active_roster,
                "balanced"
            )
            lean_alloc = self._fallback_allocations_for_module(
                module_name,
                estimated_hours,
                active_roster,
                "lean"
            )

            feature_complexity_analysis.append(
                FeatureComplexityEstimate(
                    module_name=module_name,
                    complexity=item.get("complexity", "Medium"),
                    estimated_hours=estimated_hours,
                    reasoning=item.get("reasoning", ""),
                    screen_designs=item.get("screen_designs") or [],
                    fastest_allocation=fastest_alloc,
                    balanced_allocation=balanced_alloc,
                    lean_allocation=lean_alloc
                )
            )

        feature_complexity_analysis = sorted(
            feature_complexity_analysis,
            key=lambda x: x.module_name.lower()
        )

        # Re-calculate and sanitize options using our strict deterministic formula
        options = {}
        for opt_key in ["fastest", "balanced", "lean"]:
            opt_data = data.get("options", {}).get(opt_key, {})
            if not opt_data:
                opt_data = data.get("options", {}).get("balanced", {})
            logic_summary = opt_data.get("logic_summary", "")

            options[opt_key] = self._build_scenario_team_structure(
                project_name=project_name,
                opt_key=opt_key,
                feature_complexity_analysis=feature_complexity_analysis,
                active_roster=active_roster,
                management_coverage=management_coverage,
                deployment_coverage=deployment_coverage,
                logic_summary=logic_summary
            )

        recommended_option = str(data.get("recommended_option") or preferred_strategy).strip().lower()
        if recommended_option not in {"fastest", "balanced", "lean"}:
            recommended_option = preferred_strategy

        return TeamAnalysisResult(
            project_name=project_name,
            feature_complexity_analysis=feature_complexity_analysis,
            options=options,
            recommended_option=recommended_option,
        )

    @staticmethod
    def _default_roster() -> list[CompanyResource]:
        return [
            CompanyResource(name="Resource A", role="Lead Full Stack Developer", experience_years=12.0),
            CompanyResource(name="Resource B", role="Senior Full Stack Developer", experience_years=8.0),
            CompanyResource(name="Resource C", role="Junior Full Stack Developer", experience_years=2.0),
            CompanyResource(name="Resource D", role="QA Tester", experience_years=4.0),
            CompanyResource(name="Resource E", role="Project Manager", experience_years=10.0),
            CompanyResource(name="Resource F", role="DevOps Engineer", experience_years=7.0),
        ]

    def build_deterministic_team_analysis(
        self,
        srs_text: str,
        hint_name: str = "",
        company_roster: list[CompanyResource] | None = None,
        planning_preferences: TeamPlanningPreferences | None = None,
        error_detail: str = "",
    ) -> TeamAnalysisResult:
        active_roster = company_roster if company_roster else self._default_roster()
        planning_preferences = planning_preferences or TeamPlanningPreferences()
        preferred_strategy = planning_preferences.preferred_strategy if planning_preferences.preferred_strategy in {"fastest", "balanced", "lean"} else "balanced"
        management_coverage = planning_preferences.project_management_coverage if planning_preferences.project_management_coverage in {"light", "standard", "intensive"} else "standard"
        deployment_coverage = planning_preferences.deployment_coverage if planning_preferences.deployment_coverage in {"light", "standard", "intensive"} else "standard"

        project_name = resolve_project_name(
            provided_name=hint_name,
            raw_text=srs_text,
            fallback="Project Brief",
        )
        modules = self._extract_fallback_module_names(srs_text)
        modules = sorted(modules, key=lambda m: m.lower())
        feature_complexity_analysis = [
            self._build_fallback_module_estimate(module_name, index, active_roster)
            for index, module_name in enumerate(modules)
        ]

        options = {
            option_key: self._build_fallback_team_structure(
                project_name=project_name,
                option_key=option_key,
                feature_complexity_analysis=feature_complexity_analysis,
                roster=active_roster,
                management_coverage=management_coverage,
                deployment_coverage=deployment_coverage,
                error_detail=error_detail,
            )
            for option_key in ("fastest", "balanced", "lean")
        }
        options = self._normalize_team_options(
            options=options,
            feature_complexity_analysis=feature_complexity_analysis,
            approved_hours=None,
        )

        return TeamAnalysisResult(
            project_name=project_name,
            feature_complexity_analysis=feature_complexity_analysis,
            options=options,
            recommended_option=preferred_strategy,
        )

    def _validate_provider_is_ready(self, provider_config: dict[str, str]) -> None:
        provider = provider_config["provider"]
        if provider == "ollama":
            parsed = urlparse(provider_config["base_url"])
            root = f"{parsed.scheme}://{parsed.netloc}"
            try:
                with urlopen(f"{root}/api/tags", timeout=1.5):
                    return
            except Exception as exc:
                raise RuntimeError(
                    "Ollama is not reachable. Falling back to deterministic team allocation."
                ) from exc

        if not provider_config.get("api_key"):
            raise RuntimeError(
                f"{provider.title()} API key is not configured. Falling back to deterministic team allocation."
            )

    @staticmethod
    def _classify_workstream(role: str) -> str:
        lowered = (role or "").strip().lower()
        if any(token in lowered for token in ["qa", "tester", "test engineer", "quality assurance"]):
            return "testing"
        if any(token in lowered for token in ["project manager", "program manager", "scrum master", "business analyst", "product manager"]):
            return "management"
        if any(token in lowered for token in ["devops", "platform engineer", "release engineer", "site reliability", "sre", "cloud engineer"]):
            return "deployment"
        if any(token in lowered for token in ["ui/ux", "ux designer", "ui designer", "product designer"]):
            return "design"
        if any(token in lowered for token in ["developer", "engineer", "architect"]):
            return "development"
        return "support"

    def _extract_module_names_from_srs(self, srs_text: str) -> list[str]:
        """
        Extract the AUTHORITATIVE module list from the complete SRS text.
        This scans the entire document (no truncation) and returns only the
        explicit modules defined in the SRS.  Returns an empty list if no
        structured module list can be found, in which case the AI is free
        to infer from the content.
        """
        module_names: list[str] = []

        # Pattern 1 – numbered/bulleted module list under a "Modules:" header
        # e.g.   "Modules: Auth; Dashboard; Payments"  (single-line CSV/semicolon)
        modules_line = re.search(r"^Modules:\s*(.+)$", srs_text, re.IGNORECASE | re.MULTILINE)
        if modules_line:
            for chunk in re.split(r";|\n", modules_line.group(1)):
                name = re.split(r"\s+-\s+|\s+:", chunk.strip(), maxsplit=1)[0].strip(" -•")
                if name and len(name) > 2:
                    module_names.append(name)

        # Pattern 2 – bullet list immediately following a "PROJECT MODULES" / "MODULES AND FEATURES" heading
        # e.g.   "PROJECT MODULES AND FEATURES\n• Authentication\n• Dashboard"
        section_match = re.search(
            r"(?:PROJECT\s+)?MODULES(?:\s+AND\s+FEATURES)?[:\n](.*?)(?:\n[A-Z][A-Z\s]{4,}:|$)",
            srs_text,
            re.IGNORECASE | re.DOTALL,
        )
        if section_match:
            block = section_match.group(1)
            for line in block.splitlines():
                stripped = line.strip().lstrip("-•*0123456789.) ")
                # Take only the first "segment" (up to a colon or dash separator)
                candidate = re.split(r"\s+-\s+|\s*:\s+", stripped, maxsplit=1)[0].strip()
                if candidate and 3 < len(candidate) < 80:
                    module_names.append(candidate)

        # Pattern 3 – numbered module sections e.g. "2.1 Authentication & Access Control"
        for m in re.finditer(
            r"^\d+\.\d+\s+([A-Z][A-Za-z0-9 &/'\-]{3,60})\s*$",
            srs_text,
            re.MULTILINE,
        ):
            candidate = m.group(1).strip()
            # Exclude generic section titles that are not module names
            if not re.search(
                r"\b(introduction|overview|purpose|scope|references|appendix|glossary|non.functional|constraint|assumption|technology|design|external|interface|team|delivery|conclusion|summary)\b",
                candidate,
                re.IGNORECASE,
            ):
                module_names.append(candidate)

        # Pattern 4 – explicit "Module \"Name\"" references anywhere in the text
        for m in re.finditer(r'Module\s+"([^"]{3,80})"', srs_text, re.IGNORECASE):
            module_names.append(m.group(1).strip())

        for raw_line in srs_text.splitlines():
            line = raw_line.strip().lstrip("-â€¢*0123456789.) ")
            match = re.match(r"^([^:;\-]{2,70})\s*(?:-|:)\s+(.+)$", line)
            if not match:
                continue
            name, description = match.group(1).strip(), match.group(2).strip()
            if re.search(r"\bmodule\b", description, re.IGNORECASE) and not re.search(
                r"\b(features?|ui pages?|non functional|recommended|source brief|project name|summary)\b",
                name,
                re.IGNORECASE,
            ):
                module_names.append(name)

        deduped = self._dedupe_module_names(module_names)
        return deduped

    def _extract_fallback_module_names(self, srs_text: str) -> list[str]:
        module_names: list[str] = []
        for match in re.finditer(r'Module\s+"([^"]+)"', srs_text, re.IGNORECASE):
            module_names.append(match.group(1).strip())

        modules_line = re.search(r"^Modules:\s*(.+)$", srs_text, re.IGNORECASE | re.MULTILINE)
        if modules_line:
            for chunk in re.split(r";|\n", modules_line.group(1)):
                name = re.split(r"\s+-\s+|\s+:", chunk.strip(), maxsplit=1)[0].strip(" -")
                if name:
                    module_names.append(name)

        if not module_names:
            lowered = srs_text.lower()
            domain_modules = []
            if any(term in lowered for term in ["hospital", "patient", "doctor", "clinic", "medical"]):
                domain_modules.extend(["Patient & Doctor Management", "Appointment & Clinical Workflow"])
            if any(term in lowered for term in ["ecommerce", "e-commerce", "shop", "cart", "order"]):
                domain_modules.extend(["Catalog & Product Management", "Orders & Payments"])
            if any(term in lowered for term in ["booking", "reservation", "appointment", "schedule"]):
                domain_modules.append("Scheduling & Booking Management")
            if any(term in lowered for term in ["crm", "lead", "sales", "customer"]):
                domain_modules.append("Customer & Lead Management")
            module_names.extend(domain_modules or ["Core Workflow Management"])

        module_names.extend([
            "Authentication & Access Control",
            "Dashboard & Reporting",
            "System Settings & Profiles",
            "Audit Trail & Activity Logs",
        ])
        return self._dedupe_module_names(module_names)

    @staticmethod
    def _module_key(name: str) -> str:
        normalized = (name or "").strip().lower().replace("&", " and ")
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        return re.sub(r"\s+", " ", normalized).strip()

    def _dedupe_module_names(self, module_names: list[str]) -> list[str]:
        deduped: dict[str, str] = {}
        for name in module_names:
            key = self._module_key(name)
            if key and key not in deduped:
                deduped[key] = name
        return list(deduped.values())

    def _build_fallback_module_estimate(
        self,
        module_name: str,
        index: int,
        roster: list[CompanyResource],
    ) -> FeatureComplexityEstimate:
        lowered = module_name.lower()
        if any(token in lowered for token in ["core", "workflow", "payment", "clinical", "order"]):
            complexity = "High"
            estimated_hours = 60.0
        elif any(token in lowered for token in ["auth", "access", "dashboard", "report", "audit", "settings", "profile"]):
            complexity = "Medium"
            estimated_hours = 32.0 if "auth" in lowered or "access" in lowered else 24.0
        else:
            complexity = "Medium"
            estimated_hours = 40.0

        screens = self._fallback_screens_for_module(module_name)
        return FeatureComplexityEstimate(
            module_name=module_name,
            complexity=complexity,
            estimated_hours=estimated_hours,
            reasoning=f"{module_name} requires coordinated implementation and validation based on the available SRS scope.",
            screen_designs=screens,
            fastest_allocation=self._fallback_allocations_for_module(module_name, estimated_hours, roster, "fastest"),
            balanced_allocation=self._fallback_allocations_for_module(module_name, estimated_hours, roster, "balanced"),
            lean_allocation=self._fallback_allocations_for_module(module_name, estimated_hours, roster, "lean"),
        )

    @staticmethod
    def _fallback_screens_for_module(module_name: str) -> list[str]:
        lowered = module_name.lower()
        if "auth" in lowered or "access" in lowered:
            return ["Login Page", "Registration & Recovery Page", "Role & Permission Settings"]
        if "dashboard" in lowered or "report" in lowered:
            return ["Dashboard", "Report Builder"]
        if "settings" in lowered or "profile" in lowered:
            return ["User Profile Page", "System Settings Panel"]
        if "audit" in lowered or "log" in lowered:
            return ["Audit Trail Viewer"]
        if "patient" in lowered or "doctor" in lowered:
            return ["Patient Profile", "Doctor Profile", "Care Team Console"]
        if "appointment" in lowered or "schedule" in lowered or "booking" in lowered:
            return ["Scheduling Calendar", "Booking Form", "Appointment Detail"]
        return [f"{module_name} Overview", f"{module_name} Detail"]

    def _fallback_allocations_for_module(
        self,
        module_name: str,
        estimated_hours: float,
        roster: list[CompanyResource],
        option_key: str,
    ) -> list[FeatureAllocation]:
        # Find resources matching brackets
        res_senior = self._find_resource_for_bracket_static(roster, ["developer", "engineer", "architect"], min_exp=10.01, fallback_role="Lead Full Stack Developer", fallback_exp=12.0)
        res_mid = self._find_resource_for_bracket_static(roster, ["developer", "engineer", "architect"], min_exp=5.0, max_exp=10.0, fallback_role="Senior Full Stack Developer", fallback_exp=8.0)
        res_junior = self._find_resource_for_bracket_static(roster, ["developer", "engineer", "architect"], min_exp=0.0, max_exp=4.99, fallback_role="Junior Full Stack Developer", fallback_exp=2.0)

        allocs = []
        if option_key == "fastest":
            allocs.append(self._feature_allocation(res_mid, round(estimated_hours, 2), f"Owns development for {module_name}."))
        elif option_key == "lean":
            allocs.append(self._feature_allocation(res_mid, round(estimated_hours * 0.5, 2), f"Develops core logic for {module_name}."))
            allocs.append(self._feature_allocation(res_junior, round(estimated_hours * 0.5, 2), f"Assists with development for {module_name}."))
        else: # balanced
            allocs.append(self._feature_allocation(res_mid, round(estimated_hours * 0.5, 2), f"Develops complex parts of {module_name}."))
            allocs.append(self._feature_allocation(res_junior, round(estimated_hours * 0.5, 2), f"Develops standard parts of {module_name}."))

        # Senior testing and deployment allocations
        allocs.append(self._feature_allocation(res_senior, round(estimated_hours * 0.15, 2), f"Internal testing for {module_name}."))
        allocs.append(self._feature_allocation(res_senior, round(estimated_hours * 0.15, 2), f"External testing for {module_name}."))
        allocs.append(self._feature_allocation(res_senior, round(estimated_hours * 0.10, 2), f"Deployment activities for {module_name}."))

        return allocs

    def _feature_allocation(
        self,
        resource: CompanyResource,
        hours: float,
        description: str,
    ) -> FeatureAllocation:
        return FeatureAllocation(
            role=resource.role,
            hours=hours,
            description=description,
            workstream=self._classify_workstream(resource.role),
        )

    def _build_fallback_team_structure(
        self,
        project_name: str,
        option_key: str,
        feature_complexity_analysis: list[FeatureComplexityEstimate],
        roster: list[CompanyResource],
        management_coverage: str,
        deployment_coverage: str,
        error_detail: str = "",
    ) -> TeamStructure:
        fallback_reason = f" AI provider fallback was used because: {error_detail}" if error_detail else ""
        logic_summary = (
            f"{option_key.title()} team structure generated from deterministic module scope, roster roles, "
            f"QA coverage, project management, and deployment support.{fallback_reason}"
        )
        return self._build_scenario_team_structure(
            project_name=project_name,
            opt_key=option_key,
            feature_complexity_analysis=feature_complexity_analysis,
            active_roster=roster,
            management_coverage=management_coverage,
            deployment_coverage=deployment_coverage,
            logic_summary=logic_summary
        )

    @staticmethod
    def _resource_for_role(
        roster: list[CompanyResource],
        role: str,
    ) -> CompanyResource | None:
        lowered = role.lower()
        for resource in roster:
            resource_role = resource.role.lower()
            if resource_role == lowered or resource_role in lowered or lowered in resource_role:
                return resource
        return None

    def _ensure_support_coverage(
        self,
        members: list[TeamMemberEstimate],
        roster: list[CompanyResource],
        option_key: str,
        management_coverage: str,
        deployment_coverage: str,
    ) -> list[TeamMemberEstimate]:
        resolved = list(members)
        workstreams = {self._classify_workstream(member.role) for member in resolved}
        base_weeks = max((float(member.active_weeks or 0.0) for member in resolved), default=6.0) or 6.0

        if "management" not in workstreams:
            resolved.append(
                self._build_support_member(
                    roster=roster,
                    workstream="management",
                    coverage=management_coverage,
                    option_key=option_key,
                    base_weeks=base_weeks,
                )
            )
        if "deployment" not in workstreams:
            resolved.append(
                self._build_support_member(
                    roster=roster,
                    workstream="deployment",
                    coverage=deployment_coverage,
                    option_key=option_key,
                    base_weeks=base_weeks,
                )
            )
        return resolved

    def _build_support_member(
        self,
        roster: list[CompanyResource],
        workstream: str,
        coverage: str,
        option_key: str,
        base_weeks: float,
    ) -> TeamMemberEstimate:
        candidate = self._pick_roster_resource(roster, workstream)
        default_role = "Project Manager" if workstream == "management" else "DevOps Engineer"
        default_exp = 8.0 if workstream == "management" else 6.0
        role_title = candidate.role if candidate else default_role
        experience = candidate.experience_years if candidate else default_exp

        coverage_factor = {
            "light": 0.35,
            "standard": 0.55,
            "intensive": 0.75,
        }.get(coverage, 0.55)
        scenario_factor = {
            "fastest": 0.9,
            "balanced": 1.0,
            "lean": 1.15,
        }.get(option_key, 1.0)
        active_weeks = round(max(1.0, base_weeks * coverage_factor * scenario_factor), 2)
        weekly_hours = 40.0
        hours_per_member = round(active_weeks * weekly_hours, 2)
        if workstream == "management":
            description = (
                f"A {role_title} with {experience:g} years of experience provides {coverage} delivery governance, "
                "sprint coordination, stakeholder communication, and project control inside the same allocation."
            )
        else:
            description = (
                f"A {role_title} with {experience:g} years of experience provides {coverage} environment setup, "
                "release readiness, deployment automation, monitoring, and handover support inside the same allocation."
            )

        return TeamMemberEstimate(
            role=f"{role_title} ({experience:g} Yrs Exp)",
            count=1,
            description=description,
            weekly_hours=weekly_hours,
            active_weeks=active_weeks,
            hours_per_member=hours_per_member,
        )

    def _pick_roster_resource(
        self,
        roster: list[CompanyResource],
        workstream: str,
    ) -> CompanyResource | None:
        candidates = [
            resource for resource in roster
            if self._classify_workstream(resource.role) == workstream
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda resource: resource.experience_years)

    @staticmethod
    def _baseline_scope_hours(
        feature_complexity_analysis: list[FeatureComplexityEstimate],
        approved_hours: float | None,
        options: dict[str, TeamStructure],
    ) -> float:
        if approved_hours and approved_hours > 0:
            return round(approved_hours, 2)

        estimated_total = sum(max(0.0, float(item.estimated_hours or 0.0)) for item in feature_complexity_analysis)
        if estimated_total > 0:
            return round(estimated_total, 2)

        balanced = options.get("balanced")
        if balanced and balanced.total_project_hours > 0:
            return round(float(balanced.total_project_hours), 2)

        for key in ("fastest", "lean"):
            option = options.get(key)
            if option and option.total_project_hours > 0:
                return round(float(option.total_project_hours), 2)
        return 0.0

    @staticmethod
    def _rescale_team_structure(team: TeamStructure, target_total_hours: float) -> TeamStructure:
        current_total = float(team.total_project_hours or 0.0)
        if current_total <= 0 or target_total_hours <= 0 or not team.members:
            return team

        scale = target_total_hours / current_total
        rescaled_members: list[TeamMemberEstimate] = []
        max_active_weeks = 0.0
        recomputed_total = 0.0

        for member in team.members:
            weekly_hours = float(member.weekly_hours or team.weekly_hours_per_member or 40.0)
            current_active_weeks = float(member.active_weeks or 0.0)
            if current_active_weeks <= 0:
                current_active_weeks = float(member.hours_per_member or 0.0) / weekly_hours if weekly_hours > 0 else 0.0

            active_weeks = round(max(0.5, current_active_weeks * scale), 2)
            hours_per_member = round(active_weeks * weekly_hours, 2)
            recomputed_total += int(member.count) * hours_per_member
            max_active_weeks = max(max_active_weeks, active_weeks)

            rescaled_members.append(
                member.model_copy(
                    update={
                        "weekly_hours": weekly_hours,
                        "active_weeks": active_weeks,
                        "hours_per_member": hours_per_member,
                    }
                )
            )

        return team.model_copy(
            update={
                "members": rescaled_members,
                "total_working_weeks": round(max_active_weeks, 2),
                "total_project_hours": round(recomputed_total, 2),
            }
        )

    def _normalize_team_options(
        self,
        options: dict[str, TeamStructure],
        feature_complexity_analysis: list[FeatureComplexityEstimate],
        approved_hours: float | None,
    ) -> dict[str, TeamStructure]:
        baseline_hours = self._baseline_scope_hours(feature_complexity_analysis, approved_hours, options)
        if baseline_hours <= 0:
            return options

        targets = {
            "balanced": round(baseline_hours, 2),
            "fastest": round(baseline_hours * 1.03, 2),
            "lean": round(baseline_hours * 0.86, 2),
        }

        normalized: dict[str, TeamStructure] = {}
        for key, option in options.items():
            target = targets.get(key)
            normalized[key] = self._rescale_team_structure(option, target) if target else option
        return normalized

    def extract_team_allocation_from_document(
        self,
        document_text: str,
        hint_name: str = "",
        selected_model: ModelSelection | None = None,
    ) -> TeamAllocationDocumentResult:
        heuristic_members = self._extract_members_heuristically(document_text)
        resolved_project_name = resolve_project_name(
            provided_name=hint_name,
            raw_text=document_text,
        )

        if heuristic_members:
            enriched_members, total_project_hours, total_working_weeks, weekly_hours_per_member = enrich_team_members_with_planning(
                heuristic_members,
                document_text,
            )
            total_size = sum(member.count for member in enriched_members)
            return TeamAllocationDocumentResult(
                project_name=resolved_project_name,
                has_team_allocation=True,
                total_size=total_size,
                members=enriched_members,
                logic_summary="Team allocation was extracted directly from the uploaded document.",
                message="Detected an explicit team/resource allocation in the uploaded document.",
                weekly_hours_per_member=weekly_hours_per_member,
                total_working_weeks=total_working_weeks,
                total_project_hours=total_project_hours,
            )

        if (not settings.openai_api_key and (not selected_model or not selected_model.api_key)) or OpenAI is None:
            return TeamAllocationDocumentResult(
                project_name=resolved_project_name,
                has_team_allocation=False,
                message="No explicit team allocation could be detected in this document.",
            )

        prompt = dedent(
            f"""
            You are reviewing a project document to determine whether it ALREADY contains an explicit
            team allocation / resource plan.

            Rules:
            - If the document includes a recommended team, resource plan, staffing table, or role/headcount mapping,
              set "has_team_allocation" to true and extract it exactly.
            - If the document only describes features/modules/timeline but does NOT explicitly recommend staffing,
              set "has_team_allocation" to false.
            - Do NOT invent team members when the document does not contain them.
            - Use the document content to identify the project name. Use the hint only if needed.

            Hint project name: {hint_name or "Not provided"}

            Document content:
            {document_text[:12000]}

            Return ONLY valid JSON with this exact structure:
            {{
              "project_name": "string",
              "has_team_allocation": true,
              "members": [
                {{ "role": "string", "count": 1, "description": "string" }}
              ],
              "logic_summary": "string",
              "message": "string"
            }}
            """
        )

        client = self._client_for(selected_model)
        config = self._provider_config(selected_model)
        model_name = selected_model.model if (selected_model and selected_model.model) else config["model"]

        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Determine whether the document explicitly contains a team allocation. "
                        "Never fabricate staffing data if it is missing."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )

        data = json.loads(response.choices[0].message.content)
        members = [
            TeamMemberEstimate(**member)
            for member in data.get("members", [])
            if int(member.get("count", 0)) > 0
        ]
        has_team_allocation = bool(data.get("has_team_allocation")) and bool(members)
        project_name = resolve_project_name(
            extracted_name=data.get("project_name"),
            provided_name=hint_name,
            raw_text=document_text,
        )
        enriched_members, total_project_hours, total_working_weeks, weekly_hours_per_member = enrich_team_members_with_planning(
            members,
            document_text,
        )
        return TeamAllocationDocumentResult(
            project_name=project_name,
            has_team_allocation=has_team_allocation,
            total_size=sum(member.count for member in enriched_members) if has_team_allocation else 0,
            members=enriched_members if has_team_allocation else [],
            logic_summary=data.get("logic_summary", ""),
            message=data.get("message", ""),
            weekly_hours_per_member=weekly_hours_per_member if has_team_allocation else 40,
            total_working_weeks=total_working_weeks if has_team_allocation else 0,
            total_project_hours=total_project_hours if has_team_allocation else 0,
        )

    def _extract_members_heuristically(self, document_text: str) -> list[TeamMemberEstimate]:
        members: list[TeamMemberEstimate] = []
        for raw_line in document_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            lowered = line.lower()
            if not any(role_hint in lowered for role_hint in self.ROLE_HINTS):
                continue

            match = re.search(r"(?P<role>[A-Za-z/&+\- ]+?)\s*(?:\||:|-)\s*(?P<count>\d+)\b", line)
            if not match:
                match = re.search(r"(?P<role>[A-Za-z/&+\- ]+?)\s+(?P<count>\d+)\b", line)
            if not match:
                continue

            role = re.sub(r"\s{2,}", " ", match.group("role")).strip(" -|:")
            count = int(match.group("count"))
            if count <= 0 or len(role) < 3:
                continue

            description = line
            members.append(TeamMemberEstimate(role=role.title(), count=count, description=description[:240]))

        deduped: dict[str, TeamMemberEstimate] = {}
        for member in members:
            key = member.role.lower()
            if key not in deduped:
                deduped[key] = member
        return list(deduped.values())
