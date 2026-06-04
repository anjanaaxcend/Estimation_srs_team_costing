from __future__ import annotations

from collections import defaultdict
import re

from app.schemas.client import ClientInput
from app.schemas.requirements import (
    DeliveryPlan,
    EffortLevelEstimate,
    FeatureDeliveryEstimate,
    FeatureItem,
    ModuleItem,
    NonFunctionalRequirementItem,
    RequirementExtractionResult,
    UiPageItem,
)
from app.services.planning_sync import extract_planning_insights

# Complexity → estimated total developer days per feature
COMPLEXITY_DAYS = {"low": 4.0, "medium": 8.0, "high": 14.0}
# Complexity → estimated tester days per feature
COMPLEXITY_TEST_DAYS = {"low": 1.5, "medium": 3.0, "high": 5.0}

MODULE_LIBRARY = {
    "Authentication and Access": {
        "keywords": ("auth", "login", "sign in", "role", "permission", "access", "admin"),
        "summary": "Covers identity, access control, and administrative ownership of protected workflows.",
    },
    "User and Profile Management": {
        "keywords": ("user", "profile", "account", "registration", "customer", "patient"),
        "summary": "Handles core profile data, lifecycle records, and searchable user information.",
    },
    "Scheduling and Appointments": {
        "keywords": ("appointment", "schedule", "calendar", "booking", "slot", "reminder"),
        "summary": "Coordinates availability, booking, reminder, and visit scheduling workflows.",
    },
    "Document and File Management": {
        "keywords": ("document", "pdf", "docx", "upload", "export", "file", "attachment"),
        "summary": "Manages intake files, generated outputs, exported documents, and version traceability.",
    },
    "Analytics and Reporting": {
        "keywords": ("dashboard", "analytics", "report", "kpi", "summary", "insight", "chart"),
        "summary": "Aggregates usage and business visibility into dashboards, summaries, and exports.",
    },
    "Integration and Notifications": {
        "keywords": ("integration", "api", "notification", "email", "sms", "webhook", "push"),
        "summary": "Connects the platform to external systems and event-based communication channels.",
    },
    "Core Workflow Management": {
        "keywords": (),
        "summary": "Captures business workflows that do not clearly belong to a more specialized module.",
    },
}

BASELINE_MODULE_DEFINITIONS = [
    {
        "name": "Authentication & Access Control",
        "summary": "Handles login, registration, password recovery, session security, and role-based access control across the application.",
        "features": [
            FeatureItem(
                name="User Login & Session Security",
                description="Secure login with protected sessions, failed-attempt handling, and logout controls.",
                priority="high",
                complexity="medium",
                acceptance_criteria=[
                    "Users can log in and log out securely.",
                    "Sessions expire after inactivity.",
                    "Failed login attempts are rate-limited or locked after repeated failures.",
                ],
            ),
            FeatureItem(
                name="User Registration & Password Recovery",
                description="Self-service registration, email verification, password reset, and account recovery workflows.",
                priority="high",
                complexity="medium",
                acceptance_criteria=[
                    "Users can register through a controlled signup flow.",
                    "Users can reset forgotten passwords through a secure token.",
                    "Account recovery actions are logged for audit review.",
                ],
            ),
            FeatureItem(
                name="Role-Based Access Control",
                description="Role and permission management for protecting pages, APIs, and administrative actions.",
                priority="high",
                complexity="medium",
                acceptance_criteria=[
                    "Administrators can assign roles to users.",
                    "Protected routes reject unauthorized access.",
                    "Permissions are enforced consistently in UI and API layers.",
                ],
            ),
        ],
        "ui_pages": [
            UiPageItem(
                name="Login Page",
                description="Secure authentication page with email, password, and optional MFA inputs.",
                primary_module="Authentication & Access Control",
            ),
            UiPageItem(
                name="Registration & Recovery Page",
                description="Signup, email verification, password reset, and account recovery interface.",
                primary_module="Authentication & Access Control",
            ),
            UiPageItem(
                name="Role & Permission Settings",
                description="Admin screen for assigning roles and controlling feature access.",
                primary_module="Authentication & Access Control",
            ),
        ],
    },
    {
        "name": "Dashboard & Reporting",
        "summary": "Provides role-based dashboards, system summaries, exports, and reporting views for operational visibility.",
        "features": [
            FeatureItem(
                name="Role-Based Dashboard",
                description="Landing dashboard with metrics, quick actions, and status widgets tailored by user role.",
                priority="high",
                complexity="medium",
                acceptance_criteria=[
                    "Users see dashboard content relevant to their role.",
                    "Key operational metrics are visible after login.",
                    "Dashboard widgets link to primary workflows.",
                ],
            ),
            FeatureItem(
                name="Report Generation & Export",
                description="Generate filtered reports and export operational data for business review.",
                priority="medium",
                complexity="medium",
                acceptance_criteria=[
                    "Users can filter report data by core business dimensions.",
                    "Reports can be exported in common formats.",
                    "Generated reports respect role permissions.",
                ],
            ),
        ],
        "ui_pages": [
            UiPageItem(
                name="Dashboard",
                description="Role-aware overview page with metrics, recent activity, and quick workflow shortcuts.",
                primary_module="Dashboard & Reporting",
            ),
            UiPageItem(
                name="Report Builder",
                description="Report configuration page with filters, preview, and export actions.",
                primary_module="Dashboard & Reporting",
            ),
        ],
    },
    {
        "name": "System Settings & Profiles",
        "summary": "Supports user profile management, workspace configuration, notification preferences, and administrative settings.",
        "features": [
            FeatureItem(
                name="User Profile Management",
                description="User profile, preferences, password change, and notification settings.",
                priority="medium",
                complexity="medium",
                acceptance_criteria=[
                    "Users can update profile information.",
                    "Users can change their password from the profile area.",
                    "Preference updates persist across sessions.",
                ],
            ),
            FeatureItem(
                name="Application Configuration",
                description="Administrative configuration for organization settings, defaults, and system preferences.",
                priority="medium",
                complexity="medium",
                acceptance_criteria=[
                    "Administrators can update global settings.",
                    "System configuration changes are validated.",
                    "Critical configuration changes are audit logged.",
                ],
            ),
        ],
        "ui_pages": [
            UiPageItem(
                name="User Profile Page",
                description="Profile editing page with personal details, password controls, and preferences.",
                primary_module="System Settings & Profiles",
            ),
            UiPageItem(
                name="System Settings Panel",
                description="Administrative page for managing global application configuration.",
                primary_module="System Settings & Profiles",
            ),
        ],
    },
    {
        "name": "Audit Trail & Activity Logs",
        "summary": "Captures security events, data changes, login activity, and administrative actions for traceability.",
        "features": [
            FeatureItem(
                name="Audit Event Logging",
                description="Capture authentication events, authorization failures, data changes, and admin actions.",
                priority="high",
                complexity="medium",
                acceptance_criteria=[
                    "Sensitive actions create audit records.",
                    "Audit records include user, timestamp, action, and target entity.",
                    "Audit logs cannot be edited by regular users.",
                ],
            ),
            FeatureItem(
                name="Activity Log Viewer",
                description="Searchable activity log interface for administrators and compliance users.",
                priority="medium",
                complexity="medium",
                acceptance_criteria=[
                    "Authorized users can search and filter logs.",
                    "Log views support date and action filters.",
                    "Log exports preserve audit details.",
                ],
            ),
        ],
        "ui_pages": [
            UiPageItem(
                name="Audit Trail Viewer",
                description="Searchable audit page with filters, event details, and export actions.",
                primary_module="Audit Trail & Activity Logs",
            ),
        ],
    },
]

BASELINE_NFRS = [
    NonFunctionalRequirementItem(
        category="Security",
        description="The system must enforce authenticated access, role-based authorization, secure session handling, and protection for sensitive data.",
        measurable_target="100% of protected pages and APIs require authorization checks before access.",
    ),
    NonFunctionalRequirementItem(
        category="Auditability",
        description="The system must record security-sensitive actions, administrative changes, and important business events.",
        measurable_target="Critical user and admin actions are logged with actor, timestamp, action, and target record.",
    ),
]


class ProjectBlueprintService:

    def enrich(
        self,
        requirements: RequirementExtractionResult,
        payload: ClientInput,
        regeneration_feedback: str = "",
        prior_requirements: RequirementExtractionResult | None = None,
    ) -> RequirementExtractionResult:
        candidate_modules = [
            *requirements.modules,
            *(prior_requirements.modules if prior_requirements else []),
            *(ModuleItem(name=item["name"], summary="", feature_names=[]) for item in BASELINE_MODULE_DEFINITIONS),
        ]
        kept_module_keys = self._kept_module_keys_from_feedback(regeneration_feedback, candidate_modules)
        suppressed_module_keys = self._suppressed_module_keys_from_feedback(
            regeneration_feedback,
            candidate_modules,
            kept_module_keys=kept_module_keys,
        )
        if kept_module_keys and prior_requirements is not None:
            requirements = self._restore_kept_modules_from_prior(
                requirements=requirements,
                prior_requirements=prior_requirements,
                kept_module_keys=kept_module_keys,
            )
        requirements = self._deduplicate_modules(requirements)
        # Only derive modules from keyword library if AI didn't produce any
        modules = requirements.modules
        derived_modules_from_features = False
        if not modules:
            modules = self._derive_modules(requirements.features)
            requirements = requirements.model_copy(update={"modules": modules})
            derived_modules_from_features = True

        requirements = self._enforce_baseline_scope(
            requirements,
            suppressed_module_keys=suppressed_module_keys,
            kept_module_keys=kept_module_keys,
        )
        if suppressed_module_keys:
            requirements = self._apply_feedback_module_removals(requirements, suppressed_module_keys)
        requirements = self._deduplicate_modules(requirements)
        if suppressed_module_keys:
            requirements = self._apply_feedback_module_removals(requirements, suppressed_module_keys)
        modules = sorted(requirements.modules, key=lambda m: m.name.lower())
        requirements = requirements.model_copy(update={"modules": modules})
        delivery_plan = self._build_delivery_plan(modules, requirements.features, payload)
        observations = list(requirements.ai_observations)
        if derived_modules_from_features:
            observations.append(
                "Modules were inferred from feature keywords since the AI extraction did not produce a module structure."
            )

        return requirements.model_copy(
            update={
                "modules": modules,
                "delivery_plan": delivery_plan,
                "ai_observations": observations,
            }
        )

    def _enforce_baseline_scope(
        self,
        requirements: RequirementExtractionResult,
        suppressed_module_keys: set[str] | None = None,
        kept_module_keys: set[str] | None = None,
    ) -> RequirementExtractionResult:
        suppressed_module_keys = suppressed_module_keys or set()
        kept_module_keys = kept_module_keys or set()
        modules = list(requirements.modules)
        features = list(requirements.features)
        ui_pages = list(requirements.ui_pages)
        nfrs = list(requirements.non_functional_requirements)
        observations = list(requirements.ai_observations)
        existing_feature_names = {feature.name.lower() for feature in features}
        existing_page_names = {page.name.lower() for page in ui_pages}
        baseline_changed = False

        for baseline in BASELINE_MODULE_DEFINITIONS:
            if kept_module_keys and not self._is_suppressed_module_name(baseline["name"], kept_module_keys):
                continue
            if self._is_suppressed_module_name(baseline["name"], suppressed_module_keys):
                continue
            matched_module = self._find_baseline_module(modules, baseline["name"])
            module_name = matched_module.name if matched_module else baseline["name"]
            baseline_feature_names: list[str] = []

            for feature in baseline["features"]:
                matched_feature = self._find_named_item(features, feature.name)
                if matched_feature:
                    baseline_feature_names.append(matched_feature.name)
                    continue
                if feature.name.lower() not in existing_feature_names:
                    features.append(feature)
                    existing_feature_names.add(feature.name.lower())
                    baseline_changed = True
                baseline_feature_names.append(feature.name)

            for page in baseline["ui_pages"]:
                matched_page = self._find_named_item(ui_pages, page.name)
                if matched_page:
                    continue
                if page.name.lower() not in existing_page_names:
                    ui_pages.append(page.model_copy(update={"primary_module": module_name}))
                    existing_page_names.add(page.name.lower())
                    baseline_changed = True

            if matched_module:
                merged_feature_names = list(
                    dict.fromkeys([*(matched_module.feature_names or []), *baseline_feature_names])
                )
                summary = matched_module.summary
                if len((baseline["summary"] or "").strip()) > len((summary or "").strip()):
                    summary = baseline["summary"]
                modules = [
                    module.model_copy(update={"summary": summary, "feature_names": merged_feature_names})
                    if module.name == matched_module.name
                    else module
                    for module in modules
                ]
            else:
                modules.append(
                    ModuleItem(
                        name=baseline["name"],
                        summary=baseline["summary"],
                        feature_names=baseline_feature_names,
                    )
                )
                baseline_changed = True

        existing_nfr_categories = {nfr.category.strip().lower() for nfr in nfrs}
        for nfr in BASELINE_NFRS:
            if nfr.category.strip().lower() not in existing_nfr_categories:
                nfrs.append(nfr)
                existing_nfr_categories.add(nfr.category.strip().lower())
                baseline_changed = True

        if baseline_changed:
            observations.append(
                "Baseline application scope was enforced: authentication, access control, dashboard/reporting, settings, audit logging, security, and deployment-ready traceability."
            )

        return requirements.model_copy(
            update={
                "modules": modules,
                "features": features,
                "ui_pages": ui_pages,
                "non_functional_requirements": nfrs,
                "ai_observations": list(dict.fromkeys(observations)),
            }
        )

    def _find_baseline_module(
        self,
        modules: list[ModuleItem],
        baseline_name: str,
    ) -> ModuleItem | None:
        baseline_key = self._module_key(baseline_name)
        baseline_tokens = set(baseline_key.split())
        for module in modules:
            module_key = self._module_key(module.name)
            module_tokens = set(module_key.split())
            if module_key == baseline_key or module_key in baseline_key or baseline_key in module_key:
                return module
            if {"authentication", "auth", "login", "access", "rbac"} & module_tokens and {"authentication", "access"} & baseline_tokens:
                return module
            if {"dashboard", "reporting", "analytics", "report"} & module_tokens and {"dashboard", "reporting"} & baseline_tokens:
                return module
            if {"settings", "setting", "configuration", "configurations"} & module_tokens and {"settings", "profiles"} & baseline_tokens:
                return module
            if {"audit", "activity", "logs", "logging"} & module_tokens and {"audit", "activity", "logs"} & baseline_tokens:
                return module
        return None

    def _suppressed_module_keys_from_feedback(
        self,
        feedback: str,
        candidate_modules: list[ModuleItem],
        kept_module_keys: set[str] | None = None,
    ) -> set[str]:
        lowered_feedback = self._module_key(feedback)
        if not lowered_feedback:
            return set()

        kept_module_keys = kept_module_keys or set()
        if kept_module_keys:
            suppressed: set[str] = set()
            for module in candidate_modules:
                aliases = self._module_alias_keys(module.name)
                if aliases and not (aliases & kept_module_keys):
                    suppressed.update(aliases)
            return suppressed

        removal_words = {
            "remove",
            "removed",
            "removing",
            "delete",
            "deleted",
            "drop",
            "exclude",
            "without",
            "omit",
        }
        feedback_tokens = set(lowered_feedback.split())
        if not (feedback_tokens & removal_words):
            return set()

        suppressed: set[str] = set()
        for module in candidate_modules:
            aliases = self._module_alias_keys(module.name)
            if any(alias and self._alias_mentioned(alias, lowered_feedback) for alias in aliases):
                suppressed.update(aliases)
        return suppressed

    def _kept_module_keys_from_feedback(
        self,
        feedback: str,
        candidate_modules: list[ModuleItem],
    ) -> set[str]:
        normalized_feedback = self._module_key(feedback)
        if not normalized_feedback:
            return set()

        keep_markers = (
            "except",
            "keep only",
            "only keep",
            "keep",
            "retain only",
            "only",
        )
        if not any(marker in normalized_feedback for marker in keep_markers):
            return set()

        keep_region = normalized_feedback
        for marker in ("except", "keep only", "only keep", "retain only"):
            marker_index = normalized_feedback.find(marker)
            if marker_index >= 0:
                keep_region = normalized_feedback[marker_index + len(marker):]
                break

        kept: set[str] = set()
        for module in candidate_modules:
            aliases = self._module_alias_keys(module.name)
            if any(alias and self._alias_mentioned(alias, keep_region) for alias in aliases):
                kept.update(aliases)
        return kept

    def _restore_kept_modules_from_prior(
        self,
        requirements: RequirementExtractionResult,
        prior_requirements: RequirementExtractionResult,
        kept_module_keys: set[str],
    ) -> RequirementExtractionResult:
        modules = list(requirements.modules)
        features = list(requirements.features)
        ui_pages = list(requirements.ui_pages)

        existing_module_aliases = {
            alias
            for module in modules
            for alias in self._module_alias_keys(module.name)
        }
        existing_feature_names = {feature.name for feature in features}
        existing_page_names = {page.name for page in ui_pages}

        for prior_module in prior_requirements.modules:
            prior_aliases = self._module_alias_keys(prior_module.name)
            if not (prior_aliases & kept_module_keys):
                continue
            if not (prior_aliases & existing_module_aliases):
                modules.append(prior_module)
                existing_module_aliases.update(prior_aliases)

            for prior_feature in prior_requirements.features:
                if prior_feature.name in (prior_module.feature_names or []) and prior_feature.name not in existing_feature_names:
                    features.append(prior_feature)
                    existing_feature_names.add(prior_feature.name)

            for prior_page in prior_requirements.ui_pages:
                if self._module_alias_keys(prior_page.primary_module) & prior_aliases and prior_page.name not in existing_page_names:
                    ui_pages.append(prior_page)
                    existing_page_names.add(prior_page.name)

        return requirements.model_copy(
            update={
                "modules": modules,
                "features": features,
                "ui_pages": ui_pages,
            }
        )

    def _apply_feedback_module_removals(
        self,
        requirements: RequirementExtractionResult,
        suppressed_module_keys: set[str],
    ) -> RequirementExtractionResult:
        if not suppressed_module_keys:
            return requirements

        removed_feature_names: set[str] = set()
        removed_module_names: list[str] = []
        kept_modules: list[ModuleItem] = []

        for module in requirements.modules:
            if self._is_suppressed_module_name(module.name, suppressed_module_keys):
                removed_module_names.append(module.name)
                removed_feature_names.update(module.feature_names or [])
            else:
                kept_modules.append(module)

        if not removed_module_names:
            return requirements

        kept_feature_names = {
            feature_name
            for module in kept_modules
            for feature_name in (module.feature_names or [])
        }
        features = [
            feature
            for feature in requirements.features
            if feature.name not in removed_feature_names or feature.name in kept_feature_names
        ]
        ui_pages = [
            page
            for page in requirements.ui_pages
            if not self._is_suppressed_module_name(page.primary_module, suppressed_module_keys)
        ]
        observations = [
            *requirements.ai_observations,
            "Regeneration feedback explicitly removed modules: " + ", ".join(removed_module_names) + ".",
        ]

        return requirements.model_copy(
            update={
                "modules": kept_modules,
                "features": features,
                "ui_pages": ui_pages,
                "ai_observations": list(dict.fromkeys(observations)),
            }
        )

    def _is_suppressed_module_name(self, module_name: str, suppressed_module_keys: set[str]) -> bool:
        if not module_name:
            return False
        aliases = self._module_alias_keys(module_name)
        return any(alias in suppressed_module_keys for alias in aliases)

    def _module_alias_keys(self, module_name: str) -> set[str]:
        key = self._module_key(module_name)
        aliases = {key}
        trimmed = re.sub(r"\b(module|modules|management|system)\b", " ", key)
        trimmed = re.sub(r"\s+", " ", trimmed).strip()
        if len(trimmed) >= 4:
            aliases.add(trimmed)
        tokens = [token for token in trimmed.split() if len(token) >= 4]
        aliases.update(tokens)
        if "authentication" in key:
            aliases.update({"auth", "login", "authentication"})
        if "dashboard" in key or "reporting" in key:
            aliases.update({"dashboard", "reporting", "reports"})
        if "audit" in key:
            aliases.update({"audit", "logs", "activity logs"})
        if "settings" in key or "profiles" in key:
            aliases.update({"settings", "profiles"})
        return {alias for alias in aliases if alias}

    @staticmethod
    def _alias_mentioned(alias: str, normalized_feedback: str) -> bool:
        if not alias:
            return False
        return bool(re.search(rf"(^|\s){re.escape(alias)}(\s|$)", normalized_feedback))

    @staticmethod
    def _find_named_item(items: list, expected_name: str):
        expected = expected_name.lower()
        for item in items:
            name = getattr(item, "name", "").lower()
            if expected == name or expected in name or name in expected:
                return item
        return None

    def _deduplicate_modules(
        self,
        requirements: RequirementExtractionResult,
    ) -> RequirementExtractionResult:
        if not requirements.modules:
            return requirements

        merged_modules: dict[str, ModuleItem] = {}
        canonical_names: dict[str, str] = {}

        for module in requirements.modules:
            key = self._module_key(module.name)
            existing = merged_modules.get(key)
            deduped_feature_names = list(dict.fromkeys(module.feature_names or []))

            if existing is None:
                merged_modules[key] = module.model_copy(
                    update={"feature_names": deduped_feature_names}
                )
                canonical_names[key] = module.name
                continue

            merged_summary = existing.summary
            if len((module.summary or "").strip()) > len((existing.summary or "").strip()):
                merged_summary = module.summary

            merged_feature_names = list(
                dict.fromkeys([*(existing.feature_names or []), *deduped_feature_names])
            )
            merged_modules[key] = existing.model_copy(
                update={
                    "summary": merged_summary,
                    "feature_names": merged_feature_names,
                }
            )

        normalized_primary_modules = []
        for page in requirements.ui_pages:
            primary_module = page.primary_module
            if primary_module:
                key = self._module_key(primary_module)
                primary_module = canonical_names.get(key, primary_module)
            normalized_primary_modules.append(
                page.model_copy(update={"primary_module": primary_module})
            )

        sorted_modules = sorted(merged_modules.values(), key=lambda m: m.name.lower())
        return requirements.model_copy(
            update={
                "modules": sorted_modules,
                "ui_pages": normalized_primary_modules,
            }
        )

    def _module_key(self, name: str) -> str:
        normalized = (name or "").strip().lower()
        normalized = normalized.replace("&", " and ")
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized

    # ── Internal: keyword-based module derivation (fallback only) ─────────────

    def _derive_modules(self, features: list[FeatureItem]) -> list[ModuleItem]:
        module_features: dict[str, list[str]] = defaultdict(list)
        for feature in features:
            module_name = self._infer_module_name(feature)
            module_features[module_name].append(feature.name)

        modules: list[ModuleItem] = []
        for module_name, feature_names in module_features.items():
            summary = MODULE_LIBRARY.get(module_name, {}).get(
                "summary", "Handles related platform functionality."
            )
            modules.append(
                ModuleItem(name=module_name, summary=summary, feature_names=feature_names)
            )

        if not modules:
            modules.append(
                ModuleItem(
                    name="Core Workflow Management",
                    summary=MODULE_LIBRARY["Core Workflow Management"]["summary"],
                    feature_names=[],
                )
            )
        return modules

    def _infer_module_name(self, feature: FeatureItem) -> str:
        text = f"{feature.name} {feature.description}".lower()
        best_match = "Core Workflow Management"
        best_score = 0
        for module_name, meta in MODULE_LIBRARY.items():
            score = sum(1 for kw in meta["keywords"] if kw and kw in text)
            if score > best_score:
                best_match = module_name
                best_score = score
        return best_match

    # ── Internal: complexity-based delivery plan (no S3/S2/S1 labels) ────────

    def _build_delivery_plan(
        self,
        modules: list[ModuleItem],
        features: list[FeatureItem],
        payload: ClientInput,
    ) -> DeliveryPlan:
        feature_map = {f.name: f for f in features}
        feature_estimates: list[FeatureDeliveryEstimate] = []
        total_dev_days = 0.0
        total_test_days = 0.0

        for feature in features:
            module_name = next(
                (m.name for m in modules if feature.name in m.feature_names),
                "Core Workflow Management",
            )
            complexity = feature.complexity.lower() if feature.complexity else "medium"
            dev_days = COMPLEXITY_DAYS.get(complexity, 8.0)
            test_days = COMPLEXITY_TEST_DAYS.get(complexity, 3.0)
            total_dev_days += dev_days
            total_test_days += test_days

            feature_estimates.append(
                FeatureDeliveryEstimate(
                    module_name=module_name,
                    feature_name=feature.name,
                    complexity=feature.complexity,
                    recommended_developer_level="Lead" if complexity == "high" else "Mid" if complexity == "medium" else "Junior",
                    recommended_tester_level="Lead" if complexity == "high" else "Mid",
                    developer_days=[EffortLevelEstimate(level="Total", days=dev_days)],
                    tester_days=[EffortLevelEstimate(level="Total", days=test_days)],
                    notes=[
                        "Estimate derived from extracted complexity rating.",
                        "Actual effort should be refined in sprint planning.",
                    ],
                )
            )

        planning_insights = extract_planning_insights(payload.raw_text)
        explicit_total_hours = planning_insights.total_project_hours
        derived_total_hours = (total_dev_days + total_test_days) * 8
        if explicit_total_hours > 0 and derived_total_hours > 0:
            scale_factor = explicit_total_hours / derived_total_hours
            total_dev_days = 0.0
            total_test_days = 0.0
            for estimate in feature_estimates:
                estimate.developer_days = [
                    level.model_copy(update={"days": round(level.days * scale_factor, 2)})
                    for level in estimate.developer_days
                ]
                estimate.tester_days = [
                    level.model_copy(update={"days": round(level.days * scale_factor, 2)})
                    for level in estimate.tester_days
                ]
                total_dev_days += sum(level.days for level in estimate.developer_days)
                total_test_days += sum(level.days for level in estimate.tester_days)

        # Team sizing based on total project size
        total_days = total_dev_days + total_test_days
        if total_days < 60:
            team_size, developer_count, tester_count = 4, 3, 1
        elif total_days < 150:
            team_size, developer_count, tester_count = 7, 5, 2
        elif total_days < 300:
            team_size, developer_count, tester_count = 12, 8, 4
        else:
            team_size, developer_count, tester_count = 18, 12, 6

        # Estimated project days with recommended team
        parallel_dev_days = round(total_dev_days / max(developer_count, 1), 1)
        parallel_test_days = round(total_test_days / max(tester_count, 1), 1)
        estimated_total_days = round(parallel_dev_days + parallel_test_days, 1)

        estimated_project_days = [
            EffortLevelEstimate(level="Total Estimated Days", days=estimated_total_days)
        ]

        estimated_weeks = round(estimated_total_days / 5) if estimated_total_days > 0 else 0
        explicit_weeks = int(round(planning_insights.total_working_weeks)) if planning_insights.total_working_weeks > 0 else 0
        assumptions = [
            f"Team model: {team_size} total members — {developer_count} developers, {tester_count} testers.",
            f"Total raw effort: {round(total_dev_days)} dev days + {round(total_test_days)} test days.",
            f"Estimated calendar duration with recommended team: ~{estimated_weeks} weeks.",
            "Module boundaries and timings should be reviewed before committing to delivery contracts.",
        ]
        if explicit_total_hours > 0:
            assumptions.append(f"Brief-derived planning signal: explicit total project hours detected ({round(explicit_total_hours)} hours).")
        if explicit_weeks > 0:
            assumptions.append(f"Brief-derived planning signal: explicit delivery duration detected ({explicit_weeks} weeks).")
        if payload.timeline_expectation:
            assumptions.append(f"Client timing note: {payload.timeline_expectation}")
        if modules:
            assumptions.append(f"{len(modules)} modules identified across {len(features)} features.")

        return DeliveryPlan(
            team_size=team_size,
            developer_count=developer_count,
            tester_count=tester_count,
            estimated_project_days=estimated_project_days,
            feature_estimates=feature_estimates,
            planning_assumptions=assumptions,
        )
