from __future__ import annotations

import json
from textwrap import dedent
from typing import Any

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency in local dev
    OpenAI = None

from app.core.config import settings
from app.schemas.client import ClientInput
from app.schemas.requirements import (
    ConstraintItem,
    FeatureItem,
    ModuleItem,
    NonFunctionalRequirementItem,
    RequirementExtractionResult,
    UiPageItem,
    UserRoleItem,
    DataModelItem,
    BackendJobItem,
)
from app.schemas.srs import ModelSelection
from app.services.ai_provider_utils import is_model_unavailable_error, unique_model_candidates


class OpenAIRequirementExtractor:
    def __init__(self) -> None:
        self._clients: dict[tuple[str, str, str], Any] = {}

    @property
    def enabled(self) -> bool:
        return settings.openai_requirements_enabled and bool(settings.openai_api_key) and OpenAI is not None

    def is_enabled(self, selected_model: ModelSelection | None = None) -> bool:
        if OpenAI is None:
            return False
        config = self._provider_config(selected_model)
        provider = config["provider"]

        if provider == "gemini":
            return bool(config["model"]) and bool(config["api_key"])
        return settings.openai_requirements_enabled and bool(config["api_key"]) and bool(config["model"])

    def extract(
        self,
        payload: ClientInput,
        seed_result: RequirementExtractionResult | None = None,
        selected_model: ModelSelection | None = None,
        prior_requirements: RequirementExtractionResult | None = None,
        regeneration_feedback: str = "",
    ) -> RequirementExtractionResult:
        if not self.is_enabled(selected_model):
            raise RuntimeError(
                "No configured backend requirement-extraction model is currently available. Update backend/.env with a supported provider key and model."
            )

        client = self._client_for(selected_model)
        provider_config = self._provider_config(selected_model)
        provider = provider_config["provider"]
        
        attempted_models: list[str] = []
        candidate_models = self._candidate_models(selected_model)
        if not candidate_models:
            raise RuntimeError("No backend requirement-extraction model is configured.")

        response = None
        for model_name in candidate_models:
            attempted_models.append(model_name)
            try:
                response = client.chat.completions.create(
                    **self._completion_kwargs(
                        provider=provider,
                        model_name=model_name,
                        messages=[
                            {
                                "role": "system",
                                "content": self._developer_prompt(provider=provider, is_revision=bool(regeneration_feedback)),
                            },
                            {
                                "role": "user",
                                "content": self._user_prompt(
                                    payload,
                                    seed_result,
                                    prior_requirements=prior_requirements,
                                    regeneration_feedback=regeneration_feedback,
                                ),
                            },
                        ],
                    ),
                )
                break
            except Exception as exc:
                exc_str = str(exc)
                is_connection_error = (
                    "connection refused" in exc_str.lower()
                    or "failed to connect" in exc_str.lower()
                    or "connection error" in exc_str.lower()
                    or "remotely closed" in exc_str.lower()
                    or "nodename nor servname" in exc_str.lower()
                    or (getattr(exc, "__class__", None) and "ConnectError" in type(exc).__name__)
                    or (getattr(exc, "__class__", None) and "ConnectionRefused" in type(exc).__name__)
                )
                if is_connection_error:
                    raise RuntimeError(
                        f"Could not connect to the {provider} API endpoint. Check your backend API base URL and network connection."
                    ) from exc

                if is_model_unavailable_error(exc) and model_name != candidate_models[-1]:
                    continue
                if is_model_unavailable_error(exc):
                    from app.services.ai_provider_utils import is_quota_or_rate_limit_error
                    if is_quota_or_rate_limit_error(exc):
                        raise RuntimeError(
                            f"AI Provider Rate Limit or Quota Exceeded for {provider}. Please check your AI Studio dashboard or try again later. Details: {exc}"
                        ) from exc
                    attempted = ", ".join(attempted_models)
                    raise RuntimeError(
                        f"None of the configured backend requirement-extraction models are available. Tried: {attempted}. Update backend/.env with a supported model."
                    ) from exc
                raise

        if response is None:
            attempted = ", ".join(attempted_models)
            raise RuntimeError(
                f"None of the configured backend requirement-extraction models are available for {provider}. Tried: {attempted}."
            )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("AI provider returned an empty response.")
            
        from app.services.ai_provider_utils import repair_json_string
        repaired_content = repair_json_string(content)
        data = json.loads(repaired_content)
        ai_project_name = data.get("project_name")
        final_project_name = ai_project_name if ai_project_name and len(ai_project_name) > 3 else payload.project_name

        parsed = RequirementExtractionResult(
            project_name=final_project_name,
            normalized_text=self._as_text(data.get("normalized_text"), payload.raw_text),
            problem_statement=self._as_text(data.get("problem_statement"), ""),
            project_objectives=self._as_string_list(data.get("project_objectives")),
            proposed_solution=self._as_text(data.get("proposed_solution"), ""),
            recommended_technologies=self._as_string_list(data.get("recommended_technologies")),
            recommended_tools=self._as_string_list(data.get("recommended_tools")),
            executive_summary=self._as_text(data.get("executive_summary"), ""),
            features=self._parse_features(data.get("features")),
            modules=self._parse_modules(data.get("modules")),
            user_roles=self._parse_roles(data.get("user_roles")),
            data_models=self._parse_data_models(data.get("data_models")),
            backend_jobs=self._parse_backend_jobs(data.get("backend_jobs")),
            constraints=self._parse_constraints(data.get("constraints")),
            non_functional_requirements=self._parse_nfrs(data.get("non_functional_requirements")),
            ui_pages=self._parse_ui_pages(data.get("ui_pages")),
            assumptions=self._as_string_list(data.get("assumptions")),
            ai_observations=self._as_string_list(data.get("ai_observations")),
            conclusion=self._as_text(data.get("conclusion"), ""),
            confidence_score=self._as_confidence(data.get("confidence_score")),
        )
        if regeneration_feedback or prior_requirements:
            merged = parsed
        else:
            merged = self._merge_with_seed(parsed, seed_result, payload)
        return self._enforce_baseline_requirements(merged)


    def _enforce_baseline_requirements(
        self, result: RequirementExtractionResult
    ) -> RequirementExtractionResult:
        # Define the baseline modules and their associated features/UI pages
        baseline_defs = [
            {
                "module_name": "Authentication & Access Control",
                "summary": "Handles secure user authentication, multi-factor authorization, self-service registration, and role-based access control policies across all interfaces.",
                "features": [
                    {
                        "name": "User Login & MFA",
                        "description": "Secure user login with multi-factor authentication (MFA) and token-based session management.",
                        "priority": "high",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "User can authenticate using password and an MFA OTP token.",
                            "System generates valid JWT sessions.",
                            "Failed attempts lock accounts after 5 consecutive failures."
                        ]
                    },
                    {
                        "name": "User Registration & Password Recovery",
                        "description": "Seamless self-service account registration with email verification and self-service password recovery workflows.",
                        "priority": "high",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "User can register via a public signup page.",
                            "Activation link is sent to verified email.",
                            "Self-service password recovery with secure token verification."
                        ]
                    },
                    {
                        "name": "Role-Based Access Control (RBAC)",
                        "description": "Comprehensive definition of user roles and permission matrices to secure API endpoints and UI pathways.",
                        "priority": "high",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "Administrator can assign roles to specific user accounts.",
                            "Restricted routes return 403 Forbidden for unauthorized roles.",
                            "Permissions are enforced at the API level."
                        ]
                    }
                ],
                "ui_pages": [
                    {"name": "Login Page", "description": "Secure authentication form featuring email, password, and MFA code inputs.", "primary_module": "Authentication & Access Control"},
                    {"name": "Registration & Recovery Page", "description": "User self-registration form and secure password reset workflow interface.", "primary_module": "Authentication & Access Control"},
                    {"name": "RBAC Management Settings", "description": "Administrator control panel to inspect and customize roles and feature permission tables.", "primary_module": "Authentication & Access Control"}
                ]
            },
            {
                "module_name": "Dashboard & Reporting",
                "summary": "Aggregates real-time activities and compiles customized performance reports, analytics charts, and visual dashboards.",
                "features": [
                    {
                        "name": "Interactive Landing Dashboard",
                        "description": "A personalized homepage showcasing key metrics, system status, interactive activity graphs, and quick actions.",
                        "priority": "high",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "Users see a customized landing page based on their specific role.",
                            "Displays real-time system performance statistics and active counts.",
                            "Includes responsive grid layout with interactive data visualization widgets."
                        ]
                    },
                    {
                        "name": "Custom Report Generator",
                        "description": "Advanced query interface allowing administrators to generate, customize, and export operational reports.",
                        "priority": "medium",
                        "complexity": "high",
                        "acceptance_criteria": [
                            "Generates reports filtering by date range, module, and user activity.",
                            "Supports exporting data in PDF and CSV format.",
                            "Saves customized report queries for future access."
                        ]
                    }
                ],
                "ui_pages": [
                    {"name": "Executive Dashboard", "description": "Unified console presenting aggregated analytics, quick widgets, and direct workflow shortcuts.", "primary_module": "Dashboard & Reporting"},
                    {"name": "Report Builder Console", "description": "Dynamic querying workspace to construct, preview, and download custom logs or summaries.", "primary_module": "Dashboard & Reporting"}
                ]
            },
            {
                "module_name": "System Settings & Profiles",
                "summary": "Allows users to personalize settings and administrators to adjust global parameters, localization, and system operations.",
                "features": [
                    {
                        "name": "User Profile Management",
                        "description": "Allows authenticated users to view, edit, and update their personal profiles, avatars, and security preferences.",
                        "priority": "medium",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "Users can update contact info, upload avatar, and change password.",
                            "Enforces strong password complexity check during update.",
                            "Sends confirmation email upon key profile modifications."
                        ]
                    },
                    {
                        "name": "Organization Configurations",
                        "description": "System-wide settings for enterprise rules, notification settings, white-label configurations, and API integrations.",
                        "priority": "medium",
                        "complexity": "high",
                        "acceptance_criteria": [
                            "System administrators can modify system name, theme, and logo.",
                            "Toggle toggleable system-wide features.",
                            "Configure SMTP email server settings and test connections."
                        ]
                    }
                ],
                "ui_pages": [
                    {"name": "User Profile Page", "description": "Personal account information form with active session tracking list.", "primary_module": "System Settings & Profiles"},
                    {"name": "Global Settings Panel", "description": "System configuration screen for setting administrative thresholds and workspace preferences.", "primary_module": "System Settings & Profiles"}
                ]
            },
            {
                "module_name": "Audit Trail & Activity Logs",
                "summary": "Tracks all actions within the system, recording changes to security rules, database records, and configuration logs for audit compliance.",
                "features": [
                    {
                        "name": "Compliance Audit Logger",
                        "description": "Automated background logging of all database write operations, authentication attempts, and authorization changes.",
                        "priority": "high",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "Unalterable recording of user, IP, timestamp, action, and diff payload.",
                            "Logs are stored in an append-only archive.",
                            "Captures unauthorized access attempts immediately as critical warning flags."
                        ]
                    },
                    {
                        "name": "Activity Log Viewer",
                        "description": "Interactive interface for audit team members to search, filter, and inspect detailed audit trails.",
                        "priority": "medium",
                        "complexity": "medium",
                        "acceptance_criteria": [
                            "Search records by username, date range, or action type.",
                            "Export filtered query results directly into an Excel/PDF archive.",
                            "Display color-coded severity indicators for fast review."
                        ]
                    }
                ],
                "ui_pages": [
                    {"name": "Audit Trail Viewer", "description": "Searchable table log detailing system actions, active logins, and detailed state revisions.", "primary_module": "Audit Trail & Activity Logs"}
                ]
            }
        ]

        # Let's inspect existing modules
        existing_module_names = {m.name.lower() for m in result.modules}
        existing_feature_names = {f.name.lower() for f in result.features}
        existing_ui_page_names = {p.name.lower() for p in result.ui_pages}

        for baseline in baseline_defs:
            mod_name = baseline["module_name"]
            matched_mod = self._find_baseline_module(result.modules, mod_name)

            # Let's add missing features
            added_feature_names = []
            for feat in baseline["features"]:
                # Check if feature already exists
                matched_feat_name = None
                for existing_name in existing_feature_names:
                    if feat["name"].lower() in existing_name or existing_name in feat["name"].lower():
                        matched_feat_name = existing_name
                        break
                
                if not matched_feat_name:
                    # Create and add the feature
                    new_feat = FeatureItem(
                        name=feat["name"],
                        description=feat["description"],
                        priority=feat["priority"],
                        complexity=feat["complexity"],
                        acceptance_criteria=feat["acceptance_criteria"]
                    )
                    result.features.append(new_feat)
                    added_feature_names.append(feat["name"])
                    existing_feature_names.add(feat["name"].lower())
                else:
                    # Feature exists, let's find its actual name to ensure it's referenced in the module
                    actual_feat = next((f for f in result.features if f.name.lower() == matched_feat_name), None)
                    if actual_feat:
                        added_feature_names.append(actual_feat.name)

            # Let's add missing UI pages
            for page in baseline["ui_pages"]:
                matched_page_name = None
                for existing_name in existing_ui_page_names:
                    if page["name"].lower() in existing_name or existing_name in page["name"].lower():
                        matched_page_name = existing_name
                        break
                
                if not matched_page_name:
                    new_page = UiPageItem(
                        name=page["name"],
                        description=page["description"],
                        primary_module=matched_mod.name if matched_mod else mod_name
                    )
                    result.ui_pages.append(new_page)
                    existing_ui_page_names.add(page["name"].lower())

            # Now enforce the module itself
            if matched_mod:
                # Merge feature names into the existing module
                for fn in added_feature_names:
                    if fn not in matched_mod.feature_names:
                        matched_mod.feature_names.append(fn)
            else:
                # Create and insert the module
                new_mod = ModuleItem(
                    name=mod_name,
                    summary=baseline["summary"],
                    feature_names=added_feature_names
                )
                result.modules.append(new_mod)

        return result

    def _module_key(self, name: str) -> str:
        import re
        normalized = (name or "").strip().lower()
        normalized = normalized.replace("&", " and ")
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized

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

        if provider == "gemini":
            return unique_model_candidates(
                [runtime_model, settings.gemini_srs_model],
                settings.gemini_srs_fallback_models,
            )

        return unique_model_candidates(
            [runtime_model, settings.openai_requirements_model],
            settings.openai_requirements_fallback_models,
            [settings.openai_srs_model],
            settings.openai_srs_fallback_models,
        )

    @staticmethod
    def _completion_kwargs(provider: str, model_name: str, messages: list[dict[str, str]]) -> dict[str, Any]:
        base: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
        }

        if provider == "gemini":
            base["max_tokens"] = 8192
        elif provider == "anthropic":
            base["max_tokens"] = 4096
        else:
            # For OpenAI-compatible providers, request a JSON object response.
            base["response_format"] = {"type": "json_object"}
            base["max_tokens"] = 4096

        return base

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



        if provider == "gemini":
            return {
                "provider": "gemini",
                "model": (selected_model.model if selected_model and selected_model.model else settings.gemini_srs_model),
                "base_url": (selected_model.base_url if selected_model and selected_model.base_url else "https://generativelanguage.googleapis.com/v1beta/openai/"),
                "api_key": runtime_key or settings.gemini_api_key or "",
            }

        # default: openai-compatible (Groq, OpenAI, Mistral, etc.)
        return {
            "provider": "openai",
            "model": (selected_model.model if selected_model and selected_model.model else settings.openai_requirements_model),
            "base_url": (selected_model.base_url if selected_model and selected_model.base_url else settings.openai_api_base),
            "api_key": runtime_key or settings.openai_api_key or "",
        }

    def _developer_prompt(self, provider: str = "openai", is_revision: bool = False) -> str:
        provider_preamble = ""
        if provider in {"gemini", "anthropic"}:
            provider_preamble = dedent("""
            CRITICAL INSTRUCTION FOR THIS PROVIDER:
            You MUST output ONLY a single valid JSON object. Nothing else.
            Do NOT output any text before or after the JSON.
            Do NOT use markdown code fences (```json or ```).
            Do NOT explain your answer or add any commentary.
            Start your response immediately with { and end with }.

            """)

        revision_clause = ""
        if is_revision:
            revision_clause = dedent("""
            CRITICAL REVISION & REGENERATION RULES:
            - You are updating an existing set of structured requirements based on the user's specific feedback/prompt.
            - Treat the newest user feedback as an authoritative change request, not a suggestion.
            - If the feedback asks to remove/delete/drop/exclude/omit a module, you MUST remove that module from "modules" and remove its orphaned features and ui_pages.
            - If the feedback says "except", "keep only", "only keep", or "retain only", treat the named modules after that phrase as the KEEP LIST. Preserve those modules and remove every module not in that keep list.
            - Do NOT re-add baseline/default modules after the user explicitly removes them.
            - Do NOT discard existing modules, features, user roles, data models, or pages unless the user's feedback explicitly requests or implies their removal/replacement.
            - Focus on adding, modifying, or deleting modules and features as instructed by the user feedback.
            - Maintain logical consistency across all fields (e.g. if a module is added, ensure its corresponding features and ui_pages are added or referenced).
            - Keep all unaffected parts of the existing requirements intact.
            
            """)

        return dedent(
            f"""
            {provider_preamble}You are a Senior System Architect, Technical Product Manager, and Business Analyst.
            Your task is to profoundly analyze the client brief, extract the requirements, and intelligently INFER the underlying software architecture necessary to fulfill the request.

            {revision_clause}INTELLIGENT INFERENCE RULE:
            Do not just passively copy the user's text. You must THINK like an expert System Architect. 
            When a user provides a brief or a problem statement (e.g., a specific type of platform, an app for a specific industry, or an automation tool), you must proactively extrapolate the standard modules, entities, and features required for that specific software to function in a real-world, production environment.
            
            CRITICAL INTAKE ANALYTICAL RULES (HIGH INTELLIGENCE):
            1. STEP-BY-STEP COMPREHENSION PHASE: Before extracting, carefully analyze the user's project brief sentence-by-sentence. Identify all explicit and implicit requirements, functional workflows, calculations, compliance needs, and database entities.
            2. ZERO-LOSS EXTRACTION DIRECTIVE: You must NOT omit or gloss over any modules, features, third-party integrations, custom workflows, or constraints explicitly described in the brief. If a feature or workflow is mentioned, it MUST be fully captured and detailed inside the features and modules list.
            3. REALISTIC RE-CREATION: Proactively infer and extrapolate standard software infrastructure layers (e.g. Authentication, Dashboards, Settings, Audit Logs) while expanding the custom domain logic described by the user in high technical fidelity.
            4. THOROUGH FEATURE SPECIFICATION: Every extracted feature must have clear, implementation-oriented descriptions and concrete, testable acceptance criteria instead of vague high-level bullet points.

            - Analyze the core domain of the requested software.
            - Inject standard infrastructure features (e.g., Role-Based Access Control, Auditing, Settings, Dashboards) where logically required.
            - Inject domain-specific features (e.g., if it's a booking system, infer calendars, conflict resolution, notifications; if it's fintech, infer ledgers, payment gateways, compliance logs) without the user having to explicitly ask for them.
            - Provide the logical 'ui_pages' needed for the system (e.g. Dashboard, Login Page, Settings, User Profile).

            MANDATORY SYSTEM INFRASTRUCTURE MODULES (CRITICAL):
            Every multi-user enterprise, SaaS, medical, fintech, or commercial application (especially systems like a Hospital Management System (HMS), E-commerce, booking systems, CRM, etc.) MUST have the following baseline modules to be considered a complete system. You MUST proactively infer and generate them:
            1. 'Authentication & Access Control' (or 'User Authentication & RBAC') module:
               - Include features for: User Login, User Registration, Role-Based Access Control (RBAC), Password Reset, and Security Session Management.
               - Specify roles (e.g. for HMS: Admin, Doctor, Patient, Staff) and define their responsibilities.
            2. 'Dashboard & Reporting' module:
               - Include features for: Role-based Landing Dashboards, System Metrics, Activity Charts, and Quick Statistics.
            3. 'System Settings & Profiles' module:
               - Include features for: User Profile Management, Organization Settings, and General System Configurations.
            4. 'Audit Trail & Activity Logs' module:
               - Include features for: Compliance Auditing, Security Event Logging, and Administrative Activity Reports (critical for compliance like HIPAA or SOC2).

            Rules:
            - Normalize messy wording into clean, professional software engineering terminology.
            - Provide a strategic proposed solution approach detailing the architecture.
            - Features must be implementation-oriented and highly specific to the inferred domain.
            - Return only valid JSON with this exact shape:
            {{
              "project_name": "Propose a UNIQUE, SPECIFIC, and CREATIVE name for this project based on the requirements. YOU MUST OVERRIDE generic names like 'New AI Project' or 'The Project'. Examples: 'AuraCloud', 'ZenithPay', 'TitanStream'.",
              "normalized_text": "string",
              "problem_statement": "string",
              "project_objectives": ["string"],
              "proposed_solution": "string",
              "recommended_technologies": ["Specific databases like PostgreSQL/MongoDB, modern frameworks like Next.js/React, specific languages like Go/Python, specialized cloud services"],
              "recommended_tools": ["Specific devtools, CI/CD tools, monitoring tools, AI SDKs"],
              "executive_summary": "string",
              "features": [
                {{
                  "name": "string",
                  "description": "string",
                  "priority": "high|medium|low",
                  "complexity": "high|medium|low",
                  "acceptance_criteria": ["string"]
                }}
              ],
              "modules": [
                {{
                  "name": "string — IMPORTANT: Each module must own its domain-specific features EXCLUSIVELY. A feature name must appear in the feature_names list of EXACTLY ONE module. Never repeat the same feature name across multiple modules. E.g. patient-related features belong ONLY in the Patient Management module, doctor-related features ONLY in the Doctor Management module.",
                  "summary": "string",
                  "feature_names": ["string — only features that exclusively belong to THIS module"]
                }}
              ],
              "ui_pages": [
                {{
                  "name": "string",
                  "description": "string",
                  "primary_module": "string"
                }}
              ],
              "user_roles": [
                {{
                  "name": "string",
                  "responsibilities": ["string"]
                }}
              ],
              "data_models": [
                {{
                  "name": "string",
                  "description": "string",
                  "attributes": ["string"]
                }}
              ],
              "backend_jobs": [
                {{
                  "name": "string",
                  "trigger_type": "string",
                  "description": "string"
                }}
              ],
              "constraints": [
                {{
                  "category": "string",
                  "description": "string"
                }}
              ],
              "non_functional_requirements": [
                {{
                  "category": "string",
                  "description": "string",
                  "measurable_target": "string"
                }}
              ],
              "assumptions": ["string"],
              "ai_observations": ["string"],
              "conclusion": "string",
              "confidence_score": 0.0
            }}
            """
        ).strip()

    def _user_prompt(
        self,
        payload: ClientInput,
        seed_result: RequirementExtractionResult | None,
        prior_requirements: RequirementExtractionResult | None = None,
        regeneration_feedback: str = "",
    ) -> str:
        prior_json = json.dumps(prior_requirements.model_dump(mode="json"), indent=2) if prior_requirements else "null"
        if regeneration_feedback:
            return dedent(
                f"""
                REVISION AND REGENERATION REQUEST
                
                THE USER HAS PROVIDED FEEDBACK TO REVISE THE EXISTING REQUIREMENTS.
                
                USER FEEDBACK / INSTRUCTION:
                >>> {regeneration_feedback} <<<
                
                EXISTING REQUIREMENTS (CURRENT STATE):
                {prior_json}
                
                ORIGINAL CLIENT BRIEF (FOR REFERENCE):
                {payload.raw_text[:3000] + ("..." if len(payload.raw_text) > 3000 else "")}
                
                Your task:
                1. Carefully read the USER FEEDBACK and identify all additions, updates, or removals required.
                2. Apply these changes to the EXISTING REQUIREMENTS.
                3. If the feedback says "except", "keep only", "only keep", or "retain only", identify the keep-list modules and preserve them.
                4. If the user asks to remove/delete/drop/exclude/omit modules, remove those modules exactly. Do not preserve them for completeness and do not re-add default/baseline modules that were explicitly removed.
                5. Proactively infer any necessary cascading changes (e.g., if a module is removed, remove orphaned features/pages; if a new billing module is requested, add billing features, a Billing role if needed, a billing data model, and screen designs like 'Billing Settings' or 'Invoices').
                6. Output the updated structured requirements matching the JSON schema.
                """
            ).strip()
        else:
            return dedent(
                f"""
                REGENERATION REQUEST WITHOUT SPECIFIC FEEDBACK
                
                NO USER FEEDBACK PROVIDED. PRODUCE AN IMPROVED VERSION OF THE EXISTING REQUIREMENTS BY:
                - Adding more detail to feature descriptions.
                - Ensuring module boundaries are clear and logical.
                - Detecting any missing implied features that a senior system architect would expect.
                
                EXISTING REQUIREMENTS (CURRENT STATE):
                {prior_json}
                
                ORIGINAL CLIENT BRIEF (FOR REFERENCE):
                {payload.raw_text[:3000] + ("..." if len(payload.raw_text) > 3000 else "")}
                
                Output the revised structured requirements as JSON.
                """
            ).strip()

    def _merge_with_seed(
        self,
        parsed: RequirementExtractionResult,
        seed_result: RequirementExtractionResult | None,
        payload: ClientInput,
    ) -> RequirementExtractionResult:
        if seed_result is None:
            return parsed

        return RequirementExtractionResult(
            project_name=parsed.project_name or seed_result.project_name or payload.project_name,
            normalized_text=parsed.normalized_text or seed_result.normalized_text or payload.raw_text,
            problem_statement=parsed.problem_statement or seed_result.problem_statement,
            project_objectives=parsed.project_objectives or seed_result.project_objectives,
            proposed_solution=parsed.proposed_solution or seed_result.proposed_solution,
            recommended_technologies=parsed.recommended_technologies or seed_result.recommended_technologies,
            recommended_tools=parsed.recommended_tools or seed_result.recommended_tools,
            executive_summary=parsed.executive_summary or seed_result.executive_summary,
            features=parsed.features or seed_result.features,
            modules=parsed.modules or seed_result.modules,
            user_roles=parsed.user_roles or seed_result.user_roles,
            data_models=parsed.data_models or seed_result.data_models,
            backend_jobs=parsed.backend_jobs or seed_result.backend_jobs,
            constraints=parsed.constraints or seed_result.constraints,
            non_functional_requirements=parsed.non_functional_requirements or seed_result.non_functional_requirements,
            ui_pages=parsed.ui_pages or seed_result.ui_pages,
            assumptions=parsed.assumptions or seed_result.assumptions,
            ai_observations=parsed.ai_observations or seed_result.ai_observations,
            conclusion=parsed.conclusion or seed_result.conclusion,
            confidence_score=max(parsed.confidence_score, seed_result.confidence_score),
        )

    def _as_text(self, value: Any, default: str) -> str:
        return value.strip() if isinstance(value, str) and value.strip() else default

    def _as_string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    def _as_confidence(self, value: Any) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return 0.8
        return max(0.0, min(1.0, round(parsed, 2)))

    def _parse_features(self, value: Any) -> list[FeatureItem]:
        items: list[FeatureItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            description = self._as_text(entry.get("description"), "")
            if not name or not description:
                continue
            items.append(
                FeatureItem(
                    name=name,
                    description=description,
                    priority=self._as_text(entry.get("priority"), "medium").lower(),
                    complexity=self._as_text(entry.get("complexity"), "medium").lower(),
                    acceptance_criteria=self._as_string_list(entry.get("acceptance_criteria")),
                )
            )
        return items

    def _parse_roles(self, value: Any) -> list[UserRoleItem]:
        items: list[UserRoleItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            if not name:
                continue
            items.append(
                UserRoleItem(
                    name=name,
                    responsibilities=self._as_string_list(entry.get("responsibilities")),
                )
            )
        return items

    def _parse_constraints(self, value: Any) -> list[ConstraintItem]:
        items: list[ConstraintItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            category = self._as_text(entry.get("category"), "")
            description = self._as_text(entry.get("description"), "")
            if not category or not description:
                continue
            items.append(ConstraintItem(category=category, description=description))
        return items

    def _parse_nfrs(self, value: Any) -> list[NonFunctionalRequirementItem]:
        items: list[NonFunctionalRequirementItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            category = self._as_text(entry.get("category"), "")
            description = self._as_text(entry.get("description"), "")
            measurable_target = self._as_text(entry.get("measurable_target"), "")
            if not category or not description or not measurable_target:
                continue
            items.append(
                NonFunctionalRequirementItem(
                    category=category,
                    description=description,
                    measurable_target=measurable_target,
                )
            )
        return items

    def _parse_data_models(self, value: Any) -> list[DataModelItem]:
        items: list[DataModelItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            description = self._as_text(entry.get("description"), "")
            if not name:
                continue
            items.append(
                DataModelItem(
                    name=name,
                    description=description,
                    attributes=self._as_string_list(entry.get("attributes")),
                )
            )
        return items

    def _parse_backend_jobs(self, value: Any) -> list[BackendJobItem]:
        items: list[BackendJobItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            trigger_type = self._as_text(entry.get("trigger_type"), "")
            description = self._as_text(entry.get("description"), "")
            if not name:
                continue
            items.append(
                BackendJobItem(
                    name=name,
                    trigger_type=trigger_type,
                    description=description,
                )
            )
        return items

    def _parse_modules(self, value: Any) -> list[ModuleItem]:
        items: list[ModuleItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            if not name:
                continue
            items.append(
                ModuleItem(
                    name=name,
                    summary=self._as_text(entry.get("summary"), ""),
                    feature_names=self._as_string_list(entry.get("feature_names")),
                )
            )
        return items

    def _parse_ui_pages(self, value: Any) -> list[UiPageItem]:
        items: list[UiPageItem] = []
        if not isinstance(value, list):
            return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            if not name:
                continue
            items.append(
                UiPageItem(
                    name=name,
                    description=self._as_text(entry.get("description"), ""),
                    primary_module=self._as_text(entry.get("primary_module"), ""),
                )
            )
        return items
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = self._as_text(entry.get("name"), "")
            if not name:
                continue
            items.append(
                UiPageItem(
                    name=name,
                    description=self._as_text(entry.get("description"), ""),
                    primary_module=self._as_text(entry.get("primary_module"), ""),
                )
            )
        return items
