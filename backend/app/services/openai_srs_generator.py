from __future__ import annotations

import json
import logging
from math import ceil
import os
from textwrap import dedent
from typing import Any

logger = logging.getLogger(__name__)

try:
    import httpx as _httpx
except ImportError:  # pragma: no cover
    _httpx = None

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency in local dev
    OpenAI = None

from app.core.config import settings
from app.schemas.client import ClientInput
from app.schemas.requirements import RequirementExtractionResult
from app.schemas.srs import AppendixItem, DeliveryPlanData, ModelSelection, ModuleEffort, ReferenceItem, SRSSection, TeamStructure
from app.services.ai_provider_utils import is_model_unavailable_error, unique_model_candidates
from app.services.planning_sync import extract_planning_insights, extract_requested_delivery_weeks


class OpenAISRSGenerator:
    def __init__(self) -> None:
        self._clients: dict[tuple[str, str, str], Any] = {}

    @property
    def enabled(self) -> bool:
        return settings.openai_srs_enabled and bool(settings.openai_api_key) and OpenAI is not None

    def is_enabled(self, selected_model: ModelSelection | None = None) -> bool:
        if OpenAI is None:
            return False
        config = self._provider_config(selected_model)
        provider = config["provider"]
        # Ollama: just needs a model name — connection errors surface at request time
        if provider == "ollama":
            return settings.ollama_srs_enabled and bool(config["model"])
        # Gemini: needs both a model name and an API key configured
        if provider == "gemini":
            return bool(config["model"]) and bool(config["api_key"])
        # OpenAI-compatible (Groq etc): needs both key and model
        return settings.openai_srs_enabled and bool(config["api_key"]) and bool(config["model"])


    def generate_sections(
        self,
        client_input: ClientInput,
        requirements: RequirementExtractionResult,
        references: list[ReferenceItem],
        appendices: list[AppendixItem],
        section_titles: list[str],
        rag_context: list[str] | None = None,
        web_context: str | None = None,
        selected_model: ModelSelection | None = None,
        prior_sections: list[SRSSection] | None = None,
        regeneration_feedback: str = "",
    ) -> tuple[list[SRSSection], DeliveryPlanData | None, ModelSelection]:
        if not self.is_enabled(selected_model):
            raise RuntimeError(
                "No configured backend SRS generation model is currently available. Update backend/.env with a supported provider key and model."
            )
        requested_weeks = self._requested_delivery_weeks(client_input, requirements)
        payload, resolved_model = self._request_json_payload_with_fallbacks(
            client_input=client_input,
            requirements=requirements,
            references=references,
            appendices=appendices,
            section_titles=section_titles,
            rag_context=rag_context,
            web_context=web_context,
            selected_model=selected_model,
            prior_sections=prior_sections or [],
            regeneration_feedback=regeneration_feedback,
        )
        if payload is None:
            final_sections = [
                SRSSection(
                    title=title,
                    body=self._generate_fallback_body(title, requirements, requirements.project_name),
                )
                for title in section_titles
            ]
            if requested_weeks > 0:
                final_sections = self._apply_timeline_guardrail(
                    final_sections,
                    None,
                    requested_weeks,
                    requirements.project_name,
                )
            return final_sections, None, resolved_model

        raw_sections = payload.get("sections")
        if not isinstance(raw_sections, list):
            raise ValueError("OpenAI response did not include a JSON 'sections' array.")

        parsed_sections: list[SRSSection] = []
        for section in raw_sections:
            if not isinstance(section, dict):
                continue
            title = section.get("title")
            body = section.get("body")
            if isinstance(title, str) and isinstance(body, str) and title.strip():
                parsed_sections.append(SRSSection(title=title.strip(), body=body.strip()))

        by_title = {section.title: section for section in parsed_sections}

        # Graceful fallback: never crash on missing sections — fill them with a placeholder.
        final_sections: list[SRSSection] = []
        for title in section_titles:
            if title in by_title:
                final_sections.append(by_title[title])
            else:
                # Try fuzzy match (model may have used a slightly different title)
                keyword = title.split(".", 1)[-1].strip().lower()
                matched = next(
                    (s for s in parsed_sections if keyword in s.title.lower()),
                    None,
                )
                if matched:
                    final_sections.append(SRSSection(title=title, body=matched.body))
                else:
                    # Generate real fallback content from structured requirements
                    final_sections.append(
                        SRSSection(
                            title=title,
                            body=self._generate_fallback_body(title, requirements, requirements.project_name),
                        )
                    )

        delivery_plan = None
        raw_delivery = payload.get("delivery_plan")
        if isinstance(raw_delivery, dict):
            try:
                modules = []
                for mod in raw_delivery.get("modules", []):
                    total_days = mod.get("total_days", 0)
                    testing_days = max(1, round(total_days * 0.10))  # 10% of total days
                    modules.append(ModuleEffort(
                        module_name=mod.get("module_name", "Unknown"),
                        features=mod.get("features", []),
                        total_days=total_days,
                        testing_days=testing_days,
                        start_week=mod.get("start_week", 0.0),
                        end_week=mod.get("end_week", 0.0)
                    ))
                modules = sorted(modules, key=lambda m: m.module_name.lower())

                team = raw_delivery.get("recommended_team", {})
                delivery_plan = DeliveryPlanData(
                    modules=modules,
                    recommended_team=TeamStructure(
                        lead_count=team.get("lead_count", 0),
                        mid_count=team.get("mid_count", 0),
                        junior_count=team.get("junior_count", 0),
                        tester_count=team.get("tester_count", 0),
                        devops_count=team.get("devops_count", 0),
                        ui_ux_count=team.get("ui_ux_count", 0)
                    ),
                    total_duration_days=raw_delivery.get("total_duration_days", 0)
                )
                if requested_weeks > 0:
                    delivery_plan = self._constrain_delivery_plan(delivery_plan, requested_weeks)
            except Exception as e:
                logger.warning("Failed to parse delivery_plan: %s", e)

        # Post-process: sanitize markdown hash headings, replace dash bullets with proper bullet points
        final_sections = [
            SRSSection(
                title=sec.title,
                body=self._sanitize_text(sec.body)
            )
            for sec in final_sections
        ]
        final_sections = self._repair_weak_sections(
            final_sections,
            requirements,
            delivery_plan,
            requested_weeks,
        )

        # ── Deterministic sync: always overwrite the UI Pages section body
        # from requirements.ui_pages so the SRS Preview never diverges from the
        # structured data displayed in the Experience Map panel.
        if requirements.ui_pages:
            ui_pages_body = "\n".join(
                f"\u2022 {page.name} ({page.primary_module or 'General'}): {page.description or 'UI screen'}"
                for page in requirements.ui_pages
            )
            ui_hints = ("ui pages", "screen design", "user interface", "ui page")
            final_sections = [
                SRSSection(title=sec.title, body=ui_pages_body)
                if any(hint in sec.title.lower() for hint in ui_hints)
                else sec
                for sec in final_sections
            ]

        if requested_weeks > 0:
            final_sections = self._apply_timeline_guardrail(
                final_sections,
                delivery_plan,
                requested_weeks,
                requirements.project_name,
            )

        return final_sections, delivery_plan, resolved_model

    def _request_json_payload(
        self,
        client_input: ClientInput,
        requirements: RequirementExtractionResult,
        references: list[ReferenceItem],
        appendices: list[AppendixItem],
        section_titles: list[str],
        rag_context: list[str] | None,
        web_context: str | None,
        selected_model: ModelSelection | None,
        prior_sections: list[SRSSection] | None = None,
        regeneration_feedback: str = "",
    ) -> dict[str, Any] | None:
        client = self._client_for(selected_model)
        model_name = self._provider_config(selected_model)["model"]
        provider = self._provider_config(selected_model)["provider"]
        messages = [
            {
                "role": "system",
                "content": self._developer_prompt(
                    section_titles,
                    requirements.project_name,
                    provider=provider,
                    is_revision=bool(regeneration_feedback),
                ),
            },
            {
                "role": "user",
                "content": self._user_prompt(
                    client_input,
                    requirements,
                    references,
                    appendices,
                    rag_context,
                    web_context,
                    prior_sections=prior_sections or [],
                    regeneration_feedback=regeneration_feedback,
                ),
            },
        ]
        try:
            kwargs = self._completion_kwargs(provider, model_name, messages, 0.2)
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content
            from app.services.ai_provider_utils import repair_json_string
            repaired_content = repair_json_string(content)
            parsed = json.loads(repaired_content)
            if not isinstance(parsed, dict) or "sections" not in parsed or not isinstance(parsed["sections"], list):
                raise ValueError("OpenAI response did not include a JSON 'sections' array.")
            return parsed
        except Exception as exc:
            # ── Connection / network errors → friendly 503 ───────────────
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
                if provider == "ollama":
                    raise RuntimeError(
                        "Ollama is not running. Please start Ollama locally (`ollama serve`) and ensure the model is pulled before generating."
                    ) from exc
                raise RuntimeError(
                    f"Could not connect to the {provider} API endpoint. Check your API base URL and network connection."
                ) from exc

            if not self._is_json_generation_error(exc):
                raise

            logger.warning("SRS JSON generation failed; retrying with stricter JSON-only prompt: %s", exc)
            retry_messages = [
                {
                    "role": "system",
                    "content": self._developer_prompt(
                        section_titles,
                        requirements.project_name,
                        provider=provider,
                        is_revision=bool(regeneration_feedback),
                    )
                    + "\n\nJSON VALIDATION RETRY: Return valid JSON only. Section body strings must not contain raw object literals, arrays, braces, or unescaped quotation marks.",
                },
                {
                    "role": "user",
                    "content": self._user_prompt(
                        client_input,
                        requirements,
                        references,
                        appendices,
                        rag_context,
                        web_context,
                        prior_sections=prior_sections or [],
                        regeneration_feedback=regeneration_feedback,
                    )
                    + "\n\nRetry instruction: Do not include delivery_plan JSON, module objects, arrays, or code-like examples inside any section body. Put structured module data only in the top-level delivery_plan field.",
                },
            ]
            try:
                retry_kwargs = self._completion_kwargs(provider, model_name, retry_messages, 0)
                response = client.chat.completions.create(**retry_kwargs)
                from app.services.ai_provider_utils import repair_json_string
                repaired_content = repair_json_string(response.choices[0].message.content)
                parsed_retry = json.loads(repaired_content)
                if not isinstance(parsed_retry, dict) or "sections" not in parsed_retry or not isinstance(parsed_retry["sections"], list):
                    raise ValueError("OpenAI response did not include a JSON 'sections' array.")
                return parsed_retry
            except Exception as retry_exc:
                if not self._is_json_generation_error(retry_exc):
                    raise
                logger.warning("SRS JSON retry failed; using deterministic fallback sections: %s", retry_exc)
                return None

    def _request_json_payload_with_fallbacks(
        self,
        client_input: ClientInput,
        requirements: RequirementExtractionResult,
        references: list[ReferenceItem],
        appendices: list[AppendixItem],
        section_titles: list[str],
        rag_context: list[str] | None,
        web_context: str | None,
        selected_model: ModelSelection | None,
        prior_sections: list[SRSSection] | None,
        regeneration_feedback: str = "",
    ) -> tuple[dict[str, Any] | None, ModelSelection]:
        client = self._client_for(selected_model)
        provider_config = self._provider_config(selected_model)
        provider = provider_config["provider"]
        messages = [
            {
                "role": "system",
                "content": self._developer_prompt(
                    section_titles,
                    requirements.project_name,
                    provider=provider,
                    is_revision=bool(regeneration_feedback),
                ),
            },
            {
                "role": "user",
                "content": self._user_prompt(
                    client_input,
                    requirements,
                    references,
                    appendices,
                    rag_context,
                    web_context,
                    prior_sections=prior_sections or [],
                    regeneration_feedback=regeneration_feedback,
                ),
            },
        ]
        attempted_models: list[str] = []
        candidate_models = self._candidate_models(selected_model)
        if not candidate_models:
            raise RuntimeError("No configured backend SRS generation model is currently available.")

        for model_name in candidate_models:
            attempted_models.append(model_name)
            resolved_model = self._resolved_model_selection(provider_config, model_name)
            logger.info(
                "[AI PROVIDER] Calling %s model %s | Base URL: %s",
                provider_config["provider"],
                model_name,
                provider_config["base_url"],
            )
            try:
                kwargs = self._completion_kwargs(provider, model_name, messages, 0.2)
                response = client.chat.completions.create(**kwargs)
                from app.services.ai_provider_utils import repair_json_string
                repaired_content = repair_json_string(response.choices[0].message.content)
                parsed = json.loads(repaired_content)
                if not isinstance(parsed, dict) or "sections" not in parsed or not isinstance(parsed["sections"], list):
                    raise ValueError("OpenAI response did not include a JSON 'sections' array.")
                return parsed, resolved_model
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
                    if provider == "ollama":
                        raise RuntimeError(
                            "Ollama is not running. Please start Ollama locally (`ollama serve`) and ensure the configured backend model is pulled before generating."
                        ) from exc
                    raise RuntimeError(
                        f"Could not connect to the {provider} API endpoint. Check your backend API base URL and network connection."
                    ) from exc

                if is_model_unavailable_error(exc):
                    if model_name != candidate_models[-1]:
                        logger.warning(
                            "Configured model '%s' is unavailable for provider %s; trying fallback.",
                            model_name,
                            provider,
                        )
                        continue
                    from app.services.ai_provider_utils import is_quota_or_rate_limit_error
                    if is_quota_or_rate_limit_error(exc):
                        raise RuntimeError(
                            f"AI Provider Rate Limit or Quota Exceeded for {provider}. Please check your AI Studio dashboard or try again later. Details: {exc}"
                        ) from exc
                    attempted = ", ".join(attempted_models)
                    raise RuntimeError(
                        f"None of the configured backend SRS models are available for {provider}. Tried: {attempted}. Update backend/.env with a supported model."
                    ) from exc

                if not self._is_json_generation_error(exc):
                    raise

                logger.warning(
                    "SRS JSON generation failed for model %s; retrying with stricter JSON-only prompt: %s",
                    model_name,
                    exc,
                )
                retry_messages = [
                    {
                        "role": "system",
                        "content": self._developer_prompt(
                            section_titles,
                            requirements.project_name,
                            provider=provider,
                            is_revision=bool(regeneration_feedback),
                        )
                        + "\n\nJSON VALIDATION RETRY: Return valid JSON only. Section body strings must not contain raw object literals, arrays, braces, or unescaped quotation marks.",
                    },
                    {
                        "role": "user",
                        "content": self._user_prompt(
                            client_input,
                            requirements,
                            references,
                            appendices,
                            rag_context,
                            web_context,
                            prior_sections=prior_sections or [],
                            regeneration_feedback=regeneration_feedback,
                        )
                        + "\n\nRetry instruction: Do not include delivery_plan JSON, module objects, arrays, or code-like examples inside any section body. Put structured module data only in the top-level delivery_plan field.",
                    },
                ]
                try:
                    retry_kwargs = self._completion_kwargs(provider, model_name, retry_messages, 0)
                    response = client.chat.completions.create(**retry_kwargs)
                    from app.services.ai_provider_utils import repair_json_string
                    repaired_content = repair_json_string(response.choices[0].message.content)
                    parsed_retry = json.loads(repaired_content)
                    if not isinstance(parsed_retry, dict) or "sections" not in parsed_retry or not isinstance(parsed_retry["sections"], list):
                        raise ValueError("OpenAI response did not include a JSON 'sections' array.")
                    return parsed_retry, resolved_model
                except Exception as retry_exc:
                    if is_model_unavailable_error(retry_exc):
                        if model_name != candidate_models[-1]:
                            logger.warning(
                                "Configured model '%s' became unavailable during retry for provider %s; trying fallback.",
                                model_name,
                                provider,
                            )
                            continue
                        from app.services.ai_provider_utils import is_quota_or_rate_limit_error
                        if is_quota_or_rate_limit_error(retry_exc):
                            raise RuntimeError(
                                f"AI Provider Rate Limit or Quota Exceeded for {provider}. Please check your AI Studio dashboard or try again later. Details: {retry_exc}"
                            ) from retry_exc
                        attempted = ", ".join(attempted_models)
                        raise RuntimeError(
                            f"None of the configured backend SRS models are available for {provider}. Tried: {attempted}. Update backend/.env with a supported model."
                        ) from retry_exc
                    if not self._is_json_generation_error(retry_exc):
                        raise
                    logger.warning(
                        "SRS JSON retry failed for model %s; using deterministic fallback sections: %s",
                        model_name,
                        retry_exc,
                    )
                    return None, resolved_model

        attempted = ", ".join(attempted_models)
        raise RuntimeError(
            f"None of the configured backend SRS models are available for {provider}. Tried: {attempted}. Update backend/.env with a supported model."
        )

    @staticmethod
    def _strip_json_fences(content: str) -> str:
        """Strip markdown code fences that Gemini/Ollama sometimes wrap JSON in."""
        import re
        if not content:
            return content
        # Remove ```json ... ``` or ``` ... ``` fences
        stripped = re.sub(r'^```(?:json)?\s*', '', content.strip(), flags=re.IGNORECASE)
        stripped = re.sub(r'```\s*$', '', stripped.strip())
        return stripped.strip()

    @staticmethod
    def _is_json_generation_error(exc: Exception) -> bool:
        import json
        if isinstance(exc, json.JSONDecodeError):
            return True
        if isinstance(exc, ValueError) and "sections" in str(exc):
            return True
        text = str(exc).lower()
        status_code = getattr(exc, "status_code", None)
        return (
            status_code == 400
            and (
                "json_validate_failed" in text
                or "failed to generate json" in text
                or "failed_generation" in text
            )
        )

    @classmethod
    def _repair_weak_sections(
        cls,
        sections: list[SRSSection],
        requirements: RequirementExtractionResult,
        delivery_plan: DeliveryPlanData | None,
        requested_weeks: float,
    ) -> list[SRSSection]:
        repaired: list[SRSSection] = []
        for section in sections:
            title_lower = section.title.lower()
            is_team_sec = any(kw in title_lower for kw in ["team", "delivery", "working hours", "allocation", "7."])
            
            body_normalized = section.body.lower()
            is_weak = cls._is_weak_section_body(section.body)
            # A team/delivery section is considered weak/invalid if it contains technologies/tools or doesn't describe the working model/team
            has_tech_markers = any(marker in body_normalized for marker in [
                "recommended technologies", "recommended tools", "tech stack", "technologies:", "tools:",
                "vue.js", "react", "next.js", "flask", "fastapi", "sqlite", "postgresql", "postgres", "mysql", 
                "mongodb", "redis", "celery", "tailwind", "bootstrap", "docker", "sentry", "django", "express", 
                "nodejs", "node.js", "github", "gitlab", "aws", "gcp", "azure", "supabase", "firebase"
            ])
            has_team_markers = any(marker in body_normalized for marker in [
                "working model", "recommended team", "headcount", "role", "developer", "engineer", "working hours"
            ])
            has_option_markers = any(marker in body_normalized for marker in [
                "option 1", "option 2", "option 3", "fastest", "balanced", "lean"
            ])
            if is_team_sec:
                is_weak = True

            if not is_weak:
                repaired.append(section)
                continue

            if is_team_sec:
                body = cls._build_three_options_team_section(
                    requirements=requirements,
                    delivery_plan=delivery_plan,
                    requested_weeks=requested_weeks,
                )
            else:
                body = cls._generate_fallback_body(section.title, requirements, requirements.project_name)

            repaired.append(SRSSection(title=section.title, body=body))
        return repaired

    @staticmethod
    def _is_weak_section_body(body: str) -> bool:
        normalized = " ".join((body or "").split()).strip().lower()
        if len(normalized) < 80:
            return True
        weak_phrases = (
            "the delivery plan is as follows",
            "content for this section is derived",
            "please refer to",
            "to be determined",
            "tbd",
        )
        return any(phrase in normalized for phrase in weak_phrases)

    @classmethod
    def _build_three_options_team_section(
        cls,
        requirements: RequirementExtractionResult | None,
        delivery_plan: DeliveryPlanData | None,
        requested_weeks: float = 0.0,
        project_name: str = "",
    ) -> str:
        if requirements:
            p_name = requirements.project_name or project_name
            blueprint = requirements.delivery_plan
        else:
            p_name = project_name or "the project"
            blueprint = None

        explicit_total_hours = cls._extract_explicit_total_hours(blueprint)
        total_duration_days = delivery_plan.total_duration_days if delivery_plan else 0
        if total_duration_days <= 0 and blueprint and blueprint.estimated_project_days:
            total_duration_days = round(sum(item.days for item in blueprint.estimated_project_days))

        base_weeks = max(1.0, round(total_duration_days / 5.0, 1)) if total_duration_days > 0 else 4.0
        if requested_weeks > 0:
            base_weeks = max(1.0, round(requested_weeks, 1))

        features = requirements.features if requirements and requirements.features else []
        high_cnt = 0
        med_cnt = 0
        low_cnt = 0

        if features:
            for feature in features:
                complexity = (feature.complexity or "medium").lower()
                if "high" in complexity:
                    high_cnt += 1
                elif "low" in complexity:
                    low_cnt += 1
                else:
                    med_cnt += 1
        else:
            modules = requirements.modules if requirements and requirements.modules else []
            if modules:
                high_cnt = len(modules)
                med_cnt = len(modules) * 2
                low_cnt = len(modules)
            else:
                high_cnt = 2
                med_cnt = 4
                low_cnt = 2

        module_count = len(requirements.modules) if requirements and requirements.modules else 0
        scoped_effort_hours = cls._estimate_scope_effort_hours(
            module_count=module_count,
            high_count=high_cnt,
            medium_count=med_cnt,
            low_count=low_cnt,
        )
        scoped_effort_hours = max(scoped_effort_hours, max(120.0, base_weeks * 32.0))
        balanced_total_hours = explicit_total_hours if explicit_total_hours > 0 else round(scoped_effort_hours)
        fastest_total_hours = round(balanced_total_hours * 1.10)
        lean_total_hours = round(max(scoped_effort_hours * 0.9, balanced_total_hours * 0.93))

        balanced_weeks = base_weeks
        fastest_weeks = max(1.0, round(max(1.0, balanced_weeks * 0.7) * 2) / 2)
        if fastest_weeks >= balanced_weeks and balanced_weeks > 1.0:
            fastest_weeks = max(1.0, balanced_weeks - 0.5)
        lean_weeks = max(round(max(balanced_weeks + 1.0, balanced_weeks * 1.5) * 2) / 2, balanced_weeks + 0.5)

        recommended_team = delivery_plan.recommended_team if delivery_plan and delivery_plan.recommended_team else None
        lead_base = recommended_team.lead_count if recommended_team and recommended_team.lead_count > 0 else 1
        mid_base = recommended_team.mid_count if recommended_team and recommended_team.mid_count > 0 else 1
        tester_base = recommended_team.tester_count if recommended_team and recommended_team.tester_count > 0 else 1
        devops_base = recommended_team.devops_count if recommended_team and recommended_team.devops_count > 0 else 1
        ui_ux_base = recommended_team.ui_ux_count if recommended_team and recommended_team.ui_ux_count > 0 else 1
        senior_fastest_base = max(2, mid_base + (recommended_team.junior_count if recommended_team else 0))

        fastest_members_lines, fastest_size = cls._build_effort_driven_staffing_lines(
            role_specs=[
                {
                    "role": "Lead Developer (12 Yrs Exp)",
                    "base_count": lead_base,
                    "share": 0.18,
                    "note": "Owns architecture, technical decisions, and implementation quality.",
                },
                {
                    "role": "Senior Developer (8 Yrs Exp)",
                    "base_count": senior_fastest_base,
                    "share": 0.46,
                    "note": "Builds complex core backend features, APIs, and critical business logic in parallel.",
                },
                {
                    "role": "QA Tester (4 Yrs Exp)",
                    "base_count": tester_base,
                    "share": 0.14,
                    "note": "Runs functional, regression, and release-readiness testing.",
                },
                {
                    "role": "DevOps Engineer (7 Yrs Exp)",
                    "base_count": devops_base,
                    "share": 0.08,
                    "note": "Sets up deployment, environments, monitoring, and release automation.",
                },
                {
                    "role": "UI/UX Designer (6 Yrs Exp)",
                    "base_count": ui_ux_base,
                    "share": 0.05,
                    "note": "Finalizes screens, user flows, and interaction details.",
                },
                {
                    "role": "Project Manager (10 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.09,
                    "note": "Coordinates sprints, tracks milestones, manages risk, and keeps parallel tracks aligned.",
                },
            ],
            total_project_hours=fastest_total_hours,
            project_weeks=fastest_weeks,
        )
        balanced_members_lines, balanced_size = cls._build_effort_driven_staffing_lines(
            role_specs=[
                {
                    "role": "Lead Developer (12 Yrs Exp)",
                    "base_count": lead_base,
                    "share": 0.20,
                    "note": "Owns architecture, technical decisions, and implementation quality.",
                },
                {
                    "role": "Mid-level Developer (5 Yrs Exp)",
                    "base_count": mid_base,
                    "share": 0.34,
                    "note": "Builds core backend and frontend features across the approved modules.",
                },
                {
                    "role": "QA Tester (4 Yrs Exp)",
                    "base_count": tester_base,
                    "share": 0.16,
                    "note": "Runs functional, regression, and release-readiness testing.",
                },
                {
                    "role": "DevOps Engineer (7 Yrs Exp)",
                    "base_count": devops_base,
                    "share": 0.09,
                    "note": "Sets up deployment, environments, monitoring, and release automation.",
                },
                {
                    "role": "UI/UX Designer (6 Yrs Exp)",
                    "base_count": ui_ux_base,
                    "share": 0.08,
                    "note": "Finalizes screens, user flows, and interaction details.",
                },
                {
                    "role": "Project Manager (10 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.13,
                    "note": "Coordinates sprints, tracks milestones, manages risk, and ensures timeline delivery.",
                },
            ],
            total_project_hours=balanced_total_hours,
            project_weeks=balanced_weeks,
        )
        lean_members_lines, lean_size = cls._build_effort_driven_staffing_lines(
            role_specs=[
                {
                    "role": "Senior Full-stack Developer (8 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.60,
                    "note": "Owns the core build and handles backend plus frontend delivery in sequence.",
                },
                {
                    "role": "QA Tester (4 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.18,
                    "note": "Runs structured testing and release verification near each milestone.",
                },
                {
                    "role": "DevOps Engineer (7 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.08,
                    "note": "Handles environment setup, deployment, backups, and release support.",
                },
                {
                    "role": "UI/UX Designer (6 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.05,
                    "note": "Finalizes critical screens and interaction flows only.",
                },
                {
                    "role": "Project Manager (10 Yrs Exp)",
                    "base_count": 1,
                    "share": 0.09,
                    "note": "Coordinates the plan, reviews risks, and keeps the sequential delivery on track.",
                },
            ],
            total_project_hours=lean_total_hours,
            project_weeks=lean_weeks,
        )

        weekly_hours = 40
        lines = [
            f"The team design and timeline analysis for {p_name} provides three distinct delivery strategies based on real implementation effort, module complexity, and parallelization opportunities.",
            "The hours below reflect scoped delivery effort rather than theoretical full-time team capacity, so totals stay grounded and timeline-aware.",
            "",
            "OPTION 1: FASTEST / SHORTEST TIMELINE",
            f"• Working Weeks: {fastest_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *fastest_members_lines,
            f"• Total Size: {fastest_size} members",
            f"• Total Project Hours: {round(fastest_total_hours)} hours",
            "• Milestones/Strategy: Accelerates delivery by parallelizing module tracks. Frontend pages are built concurrently with backend APIs to compress calendar time.",
            "",
            "OPTION 2: BALANCED APPROACH (RECOMMENDED)",
            f"• Working Weeks: {balanced_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *balanced_members_lines,
            f"• Total Size: {balanced_size} members",
            f"• Total Project Hours: {round(balanced_total_hours)} hours",
            "• Milestones/Strategy: The optimal blend of speed and resource efficiency. Features are built in structured sprints with high alignment and clean handoffs.",
            "",
            "OPTION 3: LEAN / COST-EFFICIENT",
            f"• Working Weeks: {lean_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *lean_members_lines,
            f"• Total Size: {lean_size} members",
            f"• Total Project Hours: {round(lean_total_hours)} hours",
            "• Milestones/Strategy: Minimizes headcounts and stretches delivery in a controlled way. Modules are implemented more sequentially, prioritizing the core minimum viable product.",
        ]
        return "\n".join(lines)

        # Step 1: Calculate raw base duration
        total_duration_days = delivery_plan.total_duration_days if delivery_plan else 0
        if total_duration_days <= 0 and blueprint and blueprint.estimated_project_days:
            total_duration_days = round(sum(item.days for item in blueprint.estimated_project_days))
        
        base_weeks = max(1.0, round(total_duration_days / 5.0, 1)) if total_duration_days > 0 else 4.0
        if requested_weeks > 0:
            base_weeks = max(1.0, round(requested_weeks, 1))

        # Step 2: Compute Baseline Dev Effort Hours dynamically
        features = requirements.features if requirements and requirements.features else []
        high_cnt = 0
        med_cnt = 0
        low_cnt = 0
        
        if features:
            for f in features:
                c = (f.complexity or "medium").lower()
                if "high" in c:
                    high_cnt += 1
                elif "low" in c:
                    low_cnt += 1
                else:
                    med_cnt += 1
        else:
            modules = requirements.modules if requirements and requirements.modules else []
            if modules:
                high_cnt = len(modules) * 1
                med_cnt = len(modules) * 2
                low_cnt = len(modules) * 1
            else:
                high_cnt = 2
                med_cnt = 4
                low_cnt = 2

        # Standard complexity hours
        total_feature_hours = (high_cnt * 40.0) + (med_cnt * 24.0) + (low_cnt * 12.0)
        
        # If specific NLP feature estimates are present, override with their sum
        if blueprint and blueprint.feature_estimates:
            est_hours = 0.0
            for fe in blueprint.feature_estimates:
                for ed in fe.developer_days:
                    est_hours += ed.days * 8.0
                for et in fe.tester_days:
                    est_hours += et.days * 8.0
            if est_hours > 0:
                total_feature_hours = est_hours

        # Let's say 80% is development
        base_dev_hours = total_feature_hours * 0.8

        # Step 3: Align Balanced Weeks & Calibrate Dev Effort Hours
        # Balanced Dev Capacity = Lead (1.5) + Mid (1.0) = 2.5
        balanced_dev_capacity = 2.5
        balanced_weeks = base_weeks
        # Calibrate base developer effort hours exactly to match the target base_weeks!
        calibrated_base_dev_hours = balanced_weeks * balanced_dev_capacity * 40.0

        # Step 4: Scenario 2 - BALANCED APPROACH (RECOMMENDED)
        # Roles and responsibilities
        role_specs_balanced = [
            ("Lead Developer (12 Yrs Exp)", 1, "Owns architecture, technical decisions, and implementation quality.", balanced_weeks),
            ("Mid-level Developer (5 Yrs Exp)", 1, "Builds core backend and frontend features across the approved modules.", balanced_weeks),
            ("QA Tester (4 Yrs Exp)", 1, "Runs functional, regression, and release-readiness testing.", balanced_weeks),
            ("DevOps Engineer (7 Yrs Exp)", 1, "Sets up deployment, environments, monitoring, and release automation.", max(1.0, round(balanced_weeks * 0.5, 1))),
            ("UI/UX Designer (6 Yrs Exp)", 1, "Finalizes screens, user flows, and interaction details.", max(1.0, round(balanced_weeks * 0.4, 1))),
            ("Project Manager (10 Yrs Exp)", 1, "Coordinates sprints, tracks milestones, manages risk, and ensures timeline delivery.", balanced_weeks)
        ]

        # Step 5: Scenario 1 - FASTEST / SHORTEST TIMELINE
        # Fastest Dev Capacity = Lead (1.5) + 2x Senior (1.25) = 4.0
        fastest_dev_capacity = 4.0
        fastest_dev_weeks = calibrated_base_dev_hours / (fastest_dev_capacity * 40.0)
        fastest_weeks = max(1.0, round(fastest_dev_weeks * 2) / 2)
        # Guarantee it is shorter than Balanced
        fastest_weeks = min(fastest_weeks, max(1.0, round(balanced_weeks * 0.7 * 2) / 2))
        
        role_specs_fastest = [
            ("Lead Developer (12 Yrs Exp)", 1, "Owns architecture, technical decisions, and implementation quality.", fastest_weeks),
            ("Senior Developer (8 Yrs Exp)", 2, "Builds complex core backend features, APIs, and critical business logic.", fastest_weeks),
            ("QA Tester (4 Yrs Exp)", 1, "Runs functional, regression, and release-readiness testing.", fastest_weeks),
            ("DevOps Engineer (7 Yrs Exp)", 1, "Sets up deployment, environments, monitoring, and release automation.", max(1.0, round(fastest_weeks * 0.7, 1))),
            ("UI/UX Designer (6 Yrs Exp)", 1, "Finalizes screens, user flows, and interaction details.", max(1.0, round(fastest_weeks * 0.6, 1))),
            ("Project Manager (10 Yrs Exp)", 1, "Coordinates sprints, tracks milestones, manages risk, and ensures timeline delivery.", fastest_weeks)
        ]

        # Step 6: Scenario 3 - LEAN / COST-EFFICIENT
        # Lean Dev Capacity = Mid-level Dev (1.0) = 1.0
        lean_dev_capacity = 1.0
        lean_dev_weeks = calibrated_base_dev_hours / (lean_dev_capacity * 40.0)
        lean_weeks = max(1.0, round(lean_dev_weeks * 2) / 2)
        # Guarantee it is longer than Balanced
        lean_weeks = max(lean_weeks, max(balanced_weeks + 2.0, round(balanced_weeks * 1.5 * 2) / 2))

        role_specs_lean = [
            ("Mid-level Developer (5 Yrs Exp)", 1, "Builds core backend and frontend features across the approved modules.", lean_weeks),
            ("QA Tester (4 Yrs Exp)", 1, "Runs functional, regression, and release-readiness testing.", lean_weeks)
        ]

        # Formatting weekly schedule and common parameters
        weekly_hours = 40
        lines = [
            f"The team design and timeline analysis for {p_name} provides three distinct delivery strategies based on real-time module complexities, feature count, and parallelization opportunities.",
            ""
        ]

        # Build Scenario 1 Lines: FASTEST
        fastest_total_hours = 0.0
        fastest_size = 0
        fastest_members_lines = []
        for role, count, note, active_weeks in role_specs_fastest:
            role_hours = count * active_weeks * weekly_hours
            fastest_total_hours += role_hours
            fastest_size += count
            fastest_members_lines.append(f"  - {role}: {count} headcount, {round(role_hours)} hours total (active for {active_weeks} weeks). Primary responsibilities: {note}")
        
        lines.extend([
            "OPTION 1: FASTEST / SHORTEST TIMELINE",
            f"• Working Weeks: {fastest_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *fastest_members_lines,
            f"• Total Size: {fastest_size} members",
            f"• Total Project Hours: {round(fastest_total_hours)} hours",
            "• Milestones/Strategy: Accelerates delivery by parallelizing module tracks. Front-end pages are built concurrently with backend APIs to compress calendar time.",
            ""
        ])

        # Build Scenario 2 Lines: BALANCED
        balanced_total_hours = 0.0
        balanced_size = 0
        balanced_members_lines = []
        for role, count, note, active_weeks in role_specs_balanced:
            role_hours = count * active_weeks * weekly_hours
            balanced_total_hours += role_hours
            balanced_size += count
            balanced_members_lines.append(f"  - {role}: {count} headcount, {round(role_hours)} hours total (active for {active_weeks} weeks). Primary responsibilities: {note}")

        lines.extend([
            "OPTION 2: BALANCED APPROACH (RECOMMENDED)",
            f"• Working Weeks: {balanced_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *balanced_members_lines,
            f"• Total Size: {balanced_size} members",
            f"• Total Project Hours: {round(balanced_total_hours)} hours",
            "• Milestones/Strategy: The optimal blend of speed and resource efficiency. Features are built in structured sprints with high alignment and clean handoffs.",
            ""
        ])

        # Build Scenario 3 Lines: LEAN
        lean_total_hours = 0.0
        lean_size = 0
        lean_members_lines = []
        for role, count, note, active_weeks in role_specs_lean:
            role_hours = count * active_weeks * weekly_hours
            lean_total_hours += role_hours
            lean_size += count
            lean_members_lines.append(f"  - {role}: {count} headcount, {round(role_hours)} hours total (active for {active_weeks} weeks). Primary responsibilities: {note}")

        lines.extend([
            "OPTION 3: LEAN / COST-EFFICIENT",
            f"• Working Weeks: {lean_weeks} weeks",
            f"• Working Schedule: 8 hours/day, 5 days/week ({weekly_hours} hours/week per person)",
            "• Staffing Plan:",
            *lean_members_lines,
            f"• Total Size: {lean_size} members",
            f"• Total Project Hours: {round(lean_total_hours)} hours",
            "• Milestones/Strategy: Minimizes headcounts to lower management overhead. Modules are implemented sequentially, prioritizing the core minimum viable product."
        ])

        return "\n".join(lines)

    @staticmethod
    def _extract_explicit_total_hours(blueprint: Any) -> float:
        if not blueprint:
            return 0.0
        planning_text = "\n".join(getattr(blueprint, "planning_assumptions", []) or [])
        if not planning_text.strip():
            return 0.0
        return max(0.0, extract_planning_insights(planning_text).total_project_hours)

    @staticmethod
    def _estimate_scope_effort_hours(
        module_count: int,
        high_count: int,
        medium_count: int,
        low_count: int,
    ) -> float:
        total_features = max(0, high_count + medium_count + low_count)
        if module_count <= 0:
            module_count = max(1, min(4, total_features))

        raw_feature_hours = (high_count * 24.0) + (medium_count * 14.0) + (low_count * 8.0)
        feature_cap = max(module_count * 5, 6)
        if total_features > feature_cap:
            damping_ratio = feature_cap / total_features
            raw_feature_hours *= max(0.55, damping_ratio)

        module_hours = module_count * 26.0
        coordination_hours = 18.0 + (module_count * 6.0)
        qa_and_release_buffer = max(24.0, raw_feature_hours * 0.18)
        return round(module_hours + raw_feature_hours + coordination_hours + qa_and_release_buffer, 2)

    @staticmethod
    def _build_effort_driven_staffing_lines(
        role_specs: list[dict[str, Any]],
        total_project_hours: float,
        project_weeks: float,
        weekly_hours: float = 40.0,
    ) -> tuple[list[str], int]:
        members_lines: list[str] = []
        total_size = 0
        safe_total_hours = max(0.0, total_project_hours)
        safe_weeks = max(1.0, project_weeks)
        allocated_hours = 0.0

        for index, spec in enumerate(role_specs):
            remaining_hours = max(0.0, safe_total_hours - allocated_hours)
            role_hours = remaining_hours if index == len(role_specs) - 1 else round(safe_total_hours * float(spec["share"]), 2)
            allocated_hours += role_hours

            base_count = max(1, int(spec.get("base_count", 1) or 1))
            required_count = ceil(role_hours / (safe_weeks * weekly_hours)) if role_hours > 0 else 1
            count = max(base_count, required_count)

            per_person_hours = role_hours / count if count > 0 else role_hours
            active_weeks = max(0.5, round(per_person_hours / weekly_hours, 1)) if role_hours > 0 else 0.5
            active_weeks = min(safe_weeks, active_weeks)

            total_size += count
            members_lines.append(
                f"  - {spec['role']}: {count} headcount, {round(role_hours)} hours total "
                f"(active for {active_weeks} weeks). Primary responsibilities: {spec['note']}"
            )

        return members_lines, total_size

    @staticmethod
    def _build_rule_based_team_section(
        requirements: RequirementExtractionResult,
        delivery_plan: DeliveryPlanData | None,
    ) -> str:
        return OpenAISRSGenerator._build_three_options_team_section(
            requirements=requirements,
            delivery_plan=delivery_plan,
        )

    @staticmethod
    def _sanitize_text(text: str) -> str:
        """Sanitize markdown: replace dash bullets with points, strip hash headings and make them uppercase."""
        import re
        lines = text.splitlines()
        result = []
        for line in lines:
            # Remove any hallucinated Priority/Complexity labels
            line = re.sub(r'\|?\s*(Priority|Complexity):\s*(High|Medium|Low|N/A)\s*\|?', '', line, flags=re.IGNORECASE)
            
            stripped = line.lstrip()
            indent = line[: len(line) - len(stripped)]
            
            # Remove hash headings and uppercase the text for subtitles
            if stripped.startswith("#"):
                clean = re.sub(r'^#+\s*', '', stripped)
                result.append(indent + clean.upper())
                continue

            # Replace markdown bullets
            if stripped.startswith("- "):
                result.append(indent + "• " + stripped[2:])
            elif stripped.startswith("* "):
                result.append(indent + "• " + stripped[2:])
            elif line.strip():
                result.append(line)
        return "\n".join(result)

    @staticmethod
    def _requested_delivery_weeks(
        client_input: ClientInput,
        requirements: RequirementExtractionResult,
    ) -> float:
        return extract_requested_delivery_weeks(
            "\n\n".join(
                value
                for value in (
                    client_input.timeline_expectation or "",
                    client_input.raw_text or "",
                    requirements.normalized_text or "",
                )
                if value
            )
        )

    @staticmethod
    def _constrain_delivery_plan(delivery_plan: DeliveryPlanData, requested_weeks: float) -> DeliveryPlanData:
        requested_days = max(1, round(requested_weeks * 5))
        modules = sorted(delivery_plan.modules, key=lambda m: m.module_name.lower())
        if modules:
            span = requested_weeks / len(modules)
            constrained_modules = []
            for index, module in enumerate(modules):
                start_week = round(index * span, 2)
                end_week = round(requested_weeks if index == len(modules) - 1 else (index + 1) * span, 2)
                constrained_modules.append(
                    module.model_copy(
                        update={
                            "start_week": start_week,
                            "end_week": max(end_week, start_week),
                        }
                    )
                )
            modules = constrained_modules
        return delivery_plan.model_copy(
            update={
                "modules": modules,
                "total_duration_days": requested_days,
            }
        )

    @staticmethod
    def _apply_timeline_guardrail(
        sections: list[SRSSection],
        delivery_plan: DeliveryPlanData | None,
        requested_weeks: float,
        project_name: str,
    ) -> list[SRSSection]:
        guarded_sections: list[SRSSection] = []
        for section in sections:
            title_lower = section.title.lower()
            if any(kw in title_lower for kw in ["team", "delivery", "working hours", "allocation", "7."]):
                guarded_sections.append(
                    SRSSection(
                        title=section.title,
                        body=OpenAISRSGenerator._build_guarded_team_section(
                            delivery_plan,
                            requested_weeks,
                            project_name,
                        ),
                    )
                )
            else:
                guarded_sections.append(section)
        return guarded_sections

    @classmethod
    def _build_guarded_team_section(
        cls,
        delivery_plan: DeliveryPlanData | None,
        requested_weeks: float,
        project_name: str,
    ) -> str:
        return cls._build_three_options_team_section(
            requirements=None,
            delivery_plan=delivery_plan,
            requested_weeks=requested_weeks,
            project_name=project_name,
        )

    @staticmethod
    def _generate_fallback_body(title: str, requirements: Any, project_name: str) -> str:
        """Generate real content from structured requirements when AI misses a section."""
        title_lower = title.lower()
        req = requirements  # RequirementExtractionResult or dict

        # Helper to safely get list field
        def get_list(attr):
            val = getattr(req, attr, None) if hasattr(req, attr) else (req.get(attr) if isinstance(req, dict) else None)
            return val or []

        def get_str(attr):
            val = getattr(req, attr, None) if hasattr(req, attr) else (req.get(attr) if isinstance(req, dict) else None)
            return val or ""

        def get_val(obj, attr, default=""):
            if obj is None:
                return default
            if isinstance(obj, str):
                return obj
            if isinstance(obj, dict):
                return obj.get(attr, default)
            return getattr(obj, attr, default)

        if "functional" in title_lower and "non" not in title_lower:
            features = get_list("features")
            if features:
                lines = ["The system shall implement the following functional requirements:\n"]
                for f in features:
                    name = get_val(f, "name")
                    desc = get_val(f, "description") if not isinstance(f, str) else ""
                    lines.append(f"• {name}: {desc}" if desc else f"• {name}")
                return "\n".join(lines)

        if "non-functional" in title_lower or "nfr" in title_lower:
            nfrs = get_list("non_functional_requirements")
            if nfrs:
                lines = ["The system shall meet the following non-functional requirements:\n"]
                for n in nfrs:
                    cat = get_val(n, "category")
                    desc = get_val(n, "description") if not isinstance(n, str) else ""
                    target = get_val(n, "measurable_target") if not isinstance(n, str) else ""
                    entry = f"• {cat}: {desc}"
                    if target:
                        entry += f" (Target: {target})"
                    lines.append(entry)
                return "\n".join(lines)

        if "technolog" in title_lower or "constraint" in title_lower or ("design" in title_lower and "team" not in title_lower):
            techs = get_list("recommended_technologies")
            tools = get_list("recommended_tools")
            lines = []
            if techs:
                lines.append("RECOMMENDED TECHNOLOGIES:\n")
                # Filter out generic high-level phrases if possible, but at least list them as bullet points
                lines.extend([f"• {t}" for t in techs])
            if tools:
                lines.append("\nRECOMMENDED TOOLS:\n")
                lines.extend([f"• {t}" for t in tools])
            if not lines:
                return "The system architecture will utilize a modern tech stack (e.g., PostgreSQL for data persistence, Next.js for the frontend, and AWS for cloud infrastructure) to ensure scalability and performance."
            return "\n".join(lines)

        if "data model" in title_lower or "database" in title_lower:
            models = get_list("data_models")
            if models:
                lines = ["The following core data entities are required:\n"]
                for m in models:
                    name = get_val(m, "name")
                    desc = get_val(m, "description") if not isinstance(m, str) else ""
                    lines.append(f"• {name}: {desc}" if desc else f"• {name}")
                return "\n".join(lines)

        if "assumption" in title_lower or "constraint" in title_lower:
            assumptions = get_list("assumptions")
            constraints = get_list("constraints")
            lines = []
            if assumptions:
                lines.append("Assumptions:\n")
                lines.extend([f"• {a}" for a in assumptions])
            if constraints:
                lines.append("\nConstraints:\n")
                for c in constraints:
                    cat = get_val(c, "category")
                    desc = get_val(c, "description") if not isinstance(c, str) else ""
                    lines.append(f"• {cat}: {desc}" if desc else f"• {cat}")
            if lines:
                return "\n".join(lines)

        if "team" in title_lower or "delivery" in title_lower or "composition" in title_lower or "working hours" in title_lower:
            return OpenAISRSGenerator._build_three_options_team_section(
                requirements=requirements if not isinstance(requirements, dict) else None,
                delivery_plan=None,
                requested_weeks=0.0,
                project_name=project_name,
            )

        # Generic fallback using executive summary
        summary = get_str("executive_summary") or get_str("proposed_solution")
        if summary:
            return summary
        return "Content for this section is derived from the project brief. Please refer to the modules and features sections for detailed specifications."


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

    @staticmethod
    def _completion_kwargs(provider: str, model_name: str, messages: list, temperature: float) -> dict:
        """Build provider-aware completion kwargs.

        CRITICAL: response_format={"type":"json_object"} is supported by
        OpenAI/Groq and Ollama. Gemini's OpenAI-compat endpoint rejects this
        parameter with a 400 error. For Gemini we rely entirely on the
        system prompt's JSON-only instruction to get clean JSON output.
        """
        base = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
        }

        if provider == "gemini":
            # Gemini supports large context but does NOT accept response_format
            base["max_tokens"] = 8192
        elif provider == "ollama":
            # Ollama local models have limited context but DO accept response_format to guarantee valid JSON
            base["response_format"] = {"type": "json_object"}
            base["max_tokens"] = 4096
        elif provider == "anthropic":
            # Anthropic models are routed through messages API which expects max_tokens
            base["max_tokens"] = 4096
        else:
            # OpenAI / Groq and other fully-compatible providers support JSON mode
            base["response_format"] = {"type": "json_object"}
            base["max_tokens"] = 4096

        return base

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
            [settings.openai_requirements_model],
            settings.openai_requirements_fallback_models,
        )

    @staticmethod
    def _resolved_model_selection(
        provider_config: dict[str, str],
        model_name: str,
    ) -> ModelSelection:
        return ModelSelection(
            provider=provider_config["provider"],
            model=model_name,
            base_url=provider_config["base_url"] or None,
        )

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

        # default: openai-compatible (Groq, OpenAI, Mistral, etc.)
        return {
            "provider": "openai",
            "model": (selected_model.model if selected_model and selected_model.model else settings.openai_srs_model),
            "base_url": (selected_model.base_url if selected_model and selected_model.base_url else settings.openai_api_base),
            "api_key": runtime_key or settings.openai_api_key or "",
        }

    def _developer_prompt(
        self,
        section_titles: list[str],
        project_name: str,
        provider: str = "openai",
        is_revision: bool = False,
    ) -> str:
        titles_list = "\n".join(f'  - "{t}"' for t in section_titles)
        # Both Ollama and Gemini need explicit JSON-only instructions because
        # we cannot use response_format={"type":"json_object"} with them.
        provider_preamble = ""
        if provider in ("ollama", "gemini", "anthropic"):
            provider_preamble = dedent("""
            CRITICAL INSTRUCTION:
            You MUST output ONLY a single valid JSON object. Nothing else.
            Do NOT output any text before or after the JSON.
            Do NOT use markdown code fences (```json or ```).
            Do NOT explain your answer or add any commentary.
            Start your response immediately with { and end with }.

            """)
        revision_block = ""
        if is_revision:
            revision_block = dedent("""
            REGENERATION RULES:
            - This request is a revision of an existing SRS draft.
            - You MUST analyze the user's regeneration instruction and apply it materially across the relevant sections.
            - You MUST return an updated SRS, not a lightly rephrased copy of the previous draft.
            - Preserve unchanged scope that remains valid, but rewrite any affected sections so the requested changes are visible in the final SRS text.
            - Ensure section 2 (modules/features), section 3 (UI pages), section 5 (non-functional requirements), and section 7 (team design) are updated whenever the feedback impacts them.
            - If the user asks to add or change scope, reflect that change both in section bodies and in the delivery_plan.
            - If the user asks to remove/delete/drop/exclude/omit modules, those modules must not appear anywhere in section 2, section 3, section 7, or delivery_plan.modules.
            - If the user says "except", "keep only", "only keep", or "retain only", treat the named modules as the keep list and do not bring back any module outside that list from the previous draft.

            """)
        return dedent(

            f"""
            {provider_preamble}You are a senior business analyst and lead solution architect.
            Your task is to produce a comprehensive Software Requirements Specification (SRS) document in JSON format.
            {revision_block}

            JSON STRUCTURE REQUIREMENT:
            {{
              "sections": [
                {{ "title": "Section Title", "body": "Plain text content" }}
              ],
              "delivery_plan": {{
                "modules": [
                  {{
                    "module_name": "string",
                    "features": ["string"],
                    "total_days": integer,
                    "testing_days": integer,
                    "start_week": float,
                    "end_week": float
                  }}
                ],
                "recommended_team": {{
                  "lead_count": integer,
                  "mid_count": integer,
                  "junior_count": integer,
                  "tester_count": integer,
                  "devops_count": integer,
                  "ui_ux_count": integer
                }},
                "total_duration_days": integer
              }}
            }}

            CRITICAL: You MUST return EXACTLY these {len(section_titles)} sections in order:
{titles_list}

            CRITICAL SRS INTELLECTUAL AND TECHNICAL INSTRUCTIONS (HIGH FIDELITY):
            1. COGNITIVE SYNTHESIS: Act as a master Solutions Architect. Deeply analyze all parsed modules, features, constraints, objectives, and integrations from the user brief.
            2. HIGH TECHNICAL DEPTH: Write detailed, thorough, technically rigorous explanations. Each section body must be highly detailed and specific, with concrete explanations of technical concepts, API integrations, database workflows, and UI requirements. Never output generic, vague, or low-effort filler text.
            3. EXACT ALIGNMENT: Ensure that every business rule, custom process, compliance standard, and integration mentioned in the user brief is fully mapped and discussed in detail in the relevant sections.

            SECTION SPECIFIC RULES:
            1. Introduction: Write a clean professional overview of the project purpose and context for {project_name}. You MUST use the name "{project_name}" throughout the text instead of generic terms like "The Project" or "New AI Project". Minimum 3 paragraphs.
            2. Project Modules and Features: HIERARCHICAL structure. You MUST list all modules in ALPHABETICAL order by their name. For each module write its name and purpose paragraph, then list ONLY the features that are exclusively assigned to THAT module. CRITICAL: Each feature must appear under exactly ONE module — never duplicate a feature name across multiple modules. If a feature relates to patients, it belongs ONLY in the Patient Management module; if it relates to doctors, it belongs ONLY in the Doctor Management module. Do NOT list features from other modules under a given module, even if they seem related. Minimum 3 sentences per module. Every feature must have a description. Do not use hash headings. NEVER include "Priority" or "Complexity" labels or metadata in the text.
            3. UI Pages and Screen Design: List ALL UI screens and pages required for this project. You MUST list UI screens grouped by their primary module in ALPHABETICAL order of the module names. For each screen provide: the page name, which module it belongs to, primary user actions on that page, and key UI components visible. Minimum 5 screens — derive from the modules and features if not pre-extracted. Format each entry as: "PAGE NAME (Module): Description of functionality and key user interactions."
            4. External Interface Requirements: Describe all third-party API integrations, external systems, payment gateways, communication services, and deployment infrastructure. Be specific about protocols, data formats, and service boundaries. At least 4 to 6 bullet points.
            5. Non-Functional Requirements: List performance, security, scalability, usability, and reliability requirements with measurable targets. At least 5 to 8 points.
            6. Technologies and Design Constraints: Act as a Senior System Architect. Suggest modern, intelligent, and highly specific technologies (e.g., PostgreSQL, MongoDB, Redis, Next.js, FastAPI, Docker, Kubernetes, AWS Lambda). ABSOLUTELY FORBIDDEN to use generic phrases like "cloud-based technologies", "modular architecture", or "relevant data protection". You must pick specific, industry-standard tools and explain why they fit. Provide 5 to 8 detailed bullet points.
            7. Team Design and Working Hours: State the recommended team composition for {project_name}. You MUST provide exactly three distinct team options: "OPTION 1: FASTEST / SHORTEST TIMELINE", "OPTION 2: BALANCED APPROACH (RECOMMENDED)", and "OPTION 3: LEAN / COST-EFFICIENT". For each option, specify staffing roles, headcounts, working schedule (8 hours/day, 5 days/week), and total estimated hours. ABSOLUTELY FORBIDDEN to list technologies, databases, dev tools, or frameworks in this section (this is strictly for staffing/allocation). If a Timeline expectation is specified in the user prompt, treat it as a HARD calendar cap for total working weeks and delivery_plan.total_duration_days. For each role state: role title, headcount, total estimated hours on the project, and primary responsibilities. Then provide: total project hours (sum across all roles), total working weeks, and a brief milestone timeline. This section MUST be consistent with the delivery_plan JSON object you return. Do NOT print the delivery_plan JSON, module objects, arrays, braces, or code-like structured data inside this section body.

            GENERAL RULES — THESE ARE ABSOLUTE AND NON-NEGOTIABLE:
            !! You MUST use the Project Name "{project_name}" in the text whenever referring to the product. DO NOT use generic placeholders like 'New AI Project'.
            !! NEVER use ## or ### or #### heading syntax. These are forbidden.
            !! NEVER use | pipe characters or --- for tables. These are forbidden.
            !! NEVER use Markdown formatting of any kind (bold **, italic *, code `, etc).
            !! NEVER place JSON snippets, object literals, arrays, braces, or key/value object examples inside any section body string.
            !! The only JSON structure allowed is the outer response object and the top-level delivery_plan field.
            - All section bodies must be clean, plain human-readable text.
            - Use a blank line to separate topics within a section.
            - Label subsections using PLAIN UPPERCASE TEXT followed by a colon (e.g. "RECOMMENDED TEAM:").
            - Use simple dash bullet points (-) for all lists.
            - Do NOT hallucinate features or facts not derived from the user input.
            - Use the JSON keys exactly as defined above.
            """
        ).strip()

    def _user_prompt(
        self,
        client_input: ClientInput,
        requirements: RequirementExtractionResult,
        references: list[ReferenceItem],
        appendices: list[AppendixItem],
        rag_context: list[str] | None = None,
        web_context: str | None = None,
        prior_sections: list[SRSSection] | None = None,
        regeneration_feedback: str = "",
    ) -> str:
        rag_block = "\n".join(f"- {ctx}" for ctx in (rag_context or [])) or "No relevant internal data found."
        web_block = web_context or "No real-time web data found."
        revision_context = ""
        if regeneration_feedback.strip() or prior_sections:
            prior_sections_block = "\n\n".join(
                f"{section.title}\n{section.body}" for section in (prior_sections or [])
            ) or "No previous SRS draft provided."
            revision_context = dedent(
                f"""

                REGENERATION INSTRUCTION:
                {regeneration_feedback or "No explicit regeneration feedback was provided. Improve clarity and completeness only if needed."}

                AUTHORITATIVE CURRENT STRUCTURED SCOPE AFTER APPLYING THAT INSTRUCTION:
                Use the Features, Modules, and UI Pages blocks below as the source of truth. If a module is absent from those blocks, do not recreate it from the previous draft.

                PREVIOUS SRS DRAFT TO REVISE:
                {prior_sections_block[:12000] + ("..." if len(prior_sections_block) > 12000 else "")}
                """
            )
        
        feature_block = "\n".join(
            f"- {feature.name}: {feature.description}"
            for feature in requirements.features
        ) or "- None provided"
        module_block = "\n".join(
            f"- {module.name}: {module.summary} | Features: {', '.join(module.feature_names) or 'None'}"
            for module in requirements.modules
        ) or "- None provided"
        role_block = "\n".join(
            f"- {role.name}: {'; '.join(role.responsibilities) or 'No responsibilities supplied'}"
            for role in requirements.user_roles
        ) or "- None provided"
        constraint_block = "\n".join(
            f"- {item.category}: {item.description}" for item in requirements.constraints
        ) or "- None provided"
        nfr_block = "\n".join(
            f"- {item.category}: {item.description} | Target: {item.measurable_target}"
            for item in requirements.non_functional_requirements
        ) or "- None provided"
        assumption_block = "\n".join(f"- {item}" for item in requirements.assumptions) or "- None provided"
        observation_block = "\n".join(f"- {item}" for item in requirements.ai_observations) or "- None provided"
        ui_pages_block = "\n".join(
            f"- {page.name}: {page.description or 'UI screen'} | Module: {page.primary_module or 'General'}"
            for page in requirements.ui_pages
        ) or "- No UI pages pre-extracted (generate minimum 5 screens from the modules and features above)"
        reference_block = "\n".join(f"- {item.title}: {item.description}" for item in references) or "- None provided"
        appendix_block = "\n".join(f"- {item.title}: {item.content}" for item in appendices) or "- None provided"
        requested_weeks = self._requested_delivery_weeks(client_input, requirements)
        delivery_guardrail = (
            f"Delivery timing guardrail: The user explicitly requested completion in {requested_weeks:g} weeks. "
            f"All team hours, total working weeks, module dates, and delivery_plan.total_duration_days must fit inside {requested_weeks:g} weeks."
            if requested_weeks > 0
            else "Delivery timing guardrail: No hard delivery duration was specified."
        )

        return dedent(
            f"""
            Retrieved Context (RAG):
            {rag_block}

            Retrieved Context (Web Search):
            {web_block}

            Create an SRS for the following project.

            Project name: {client_input.project_name}
            Client name: {client_input.client_name or "Not specified"}
            Industry: {client_input.industry or "Not specified"}
            Raw intake:
            {client_input.raw_text[:4000] + ("..." if len(client_input.raw_text) > 4000 else "")}

            Business goals:
            {chr(10).join(f"- {goal}" for goal in client_input.business_goals) or "- None provided"}

            Timeline expectation: {client_input.timeline_expectation or "Not specified"}
            {delivery_guardrail}
            Budget range: {client_input.budget_range or "Not specified"}
            Integrations:
            {chr(10).join(f"- {item}" for item in client_input.integrations) or "- None provided"}
            Compliance requirements:
            {chr(10).join(f"- {item}" for item in client_input.compliance_requirements) or "- None provided"}
            Deployment preferences:
            {chr(10).join(f"- {item}" for item in client_input.deployment_preferences) or "- None provided"}

            Executive summary:
            {requirements.executive_summary}

            Normalized text:
            {requirements.normalized_text[:4000] + ("..." if len(requirements.normalized_text) > 4000 else "")}

            Problem statement:
            {requirements.problem_statement}

            Project objectives:
            {chr(10).join(f"- {item}" for item in requirements.project_objectives) or "- None provided"}

            Features:
            {feature_block}

            Modules:
            {module_block}

            User roles:
            {role_block}

            Existing delivery metadata from the NLP pipeline:
            - This may contain conservative defaults and should not be treated as final staffing truth.
            - Recalculate the best delivery plan from the extracted modules, features, priorities, and complexity.
            - Your final answer should be optimized and cleaner than the raw extraction.

            Constraints:
            {constraint_block}

            Non-functional requirements:
            {nfr_block}

            Assumptions:
            {assumption_block}

            AI observations:
            {observation_block}

            UI Pages (pre-extracted by NLP pipeline — use these as the basis for section 3):
            {ui_pages_block}

            References:
            {reference_block}

            Appendices:
            {appendix_block}
            {revision_context}
            """
        ).strip()
