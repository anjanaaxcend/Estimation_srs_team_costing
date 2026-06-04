from __future__ import annotations

from app.schemas.client import ClientInput
from app.schemas.requirements import RequirementExtractionResult
from app.schemas.srs import (
    AppendixItem,
    ModelSelection,
    PipelineStageTrace,
    ReferenceItem,
    SRSGenerationResult,
    SRSSection,
)
from app.services.requirement_extractor import RequirementExtractorService
from app.services.srs_generator import SRSGeneratorService


class ProposalOrchestratorService:
    def __init__(self) -> None:
        self.requirement_extractor = RequirementExtractorService()
        self.srs_generator = SRSGeneratorService()

    def run(
        self,
        client_input: ClientInput,
        *,
        references: list[ReferenceItem] | None = None,
        appendices: list[AppendixItem] | None = None,
        selected_model: ModelSelection | None = None,
        prior_requirements: RequirementExtractionResult | None = None,
        prior_sections: list[SRSSection] | None = None,
        regeneration_feedback: str = "",
    ) -> SRSGenerationResult:
        pipeline_trace: list[PipelineStageTrace] = []

        extracted = self.requirement_extractor.extract(
            client_input,
            selected_model=selected_model,
            prior_requirements=prior_requirements,
            regeneration_feedback=regeneration_feedback,
        )
        pipeline_trace.append(
            PipelineStageTrace(
                stage="nlp_extraction",
                status="completed",
                summary=f"Extracted structured requirements with {len(extracted.modules)} modules and {len(extracted.features)} features.",
            )
        )

        rag_query = self._build_rag_query(client_input, extracted)
        rag_context = self.srs_generator.rag_service.query(rag_query)
        pipeline_trace.append(
            PipelineStageTrace(
                stage="rag_retrieval",
                status="completed" if rag_context else "warning",
                summary=(
                    f"Retrieved {len(rag_context)} domain context snippets for generation."
                    if rag_context
                    else "No RAG context was available, so generation will rely on extracted requirements only."
                ),
            )
        )

        result = self.srs_generator.generate(
            client_input,
            extracted,
            references=references,
            appendices=appendices,
            rag_context=rag_context,
            selected_model=selected_model,
            prior_sections=prior_sections,
            regeneration_feedback=regeneration_feedback,
        )
        pipeline_trace.append(
            PipelineStageTrace(
                stage="llm_generation",
                status="completed",
                summary=f"Generated proposal draft using the selected {self._model_label(result.selected_model)} path.",
            )
        )

        return result.model_copy(
            update={
                "structured_requirements": extracted,
                "selected_model": result.selected_model,
                "pipeline_trace": pipeline_trace,
            }
        )

    def _build_rag_query(self, client_input: ClientInput, requirements: RequirementExtractionResult) -> str:
        modules = ", ".join(module.name for module in requirements.modules[:4])
        features = ", ".join(feature.name for feature in requirements.features[:6])
        parts = [
            requirements.project_name,
            client_input.industry or "",
            requirements.problem_statement,
            modules,
            features,
        ]
        return " | ".join(part for part in parts if part)

    def _model_label(self, selected_model: ModelSelection | None) -> str:
        if selected_model is None:
            return "default model"
        if selected_model.model:
            return f"{selected_model.provider} model '{selected_model.model}'"
        return f"{selected_model.provider} model"

    def _merge_prior_requirements(
        self,
        extracted: RequirementExtractionResult,
        prior_requirements: RequirementExtractionResult,
    ) -> RequirementExtractionResult:
        return extracted.model_copy(
            update={
                "problem_statement": prior_requirements.problem_statement or extracted.problem_statement,
                "project_objectives": prior_requirements.project_objectives or extracted.project_objectives,
                "proposed_solution": prior_requirements.proposed_solution or extracted.proposed_solution,
                "recommended_technologies": prior_requirements.recommended_technologies or extracted.recommended_technologies,
                "recommended_tools": prior_requirements.recommended_tools or extracted.recommended_tools,
                "executive_summary": prior_requirements.executive_summary or extracted.executive_summary,
                "features": prior_requirements.features or extracted.features,
                "modules": prior_requirements.modules or extracted.modules,
                "user_roles": prior_requirements.user_roles or extracted.user_roles,
                "data_models": prior_requirements.data_models or extracted.data_models,
                "backend_jobs": prior_requirements.backend_jobs or extracted.backend_jobs,
                "constraints": prior_requirements.constraints or extracted.constraints,
                "non_functional_requirements": prior_requirements.non_functional_requirements or extracted.non_functional_requirements,
                "ui_pages": prior_requirements.ui_pages or extracted.ui_pages,
                "delivery_plan": prior_requirements.delivery_plan or extracted.delivery_plan,
                "assumptions": list(dict.fromkeys([*prior_requirements.assumptions, *extracted.assumptions])),
                "ai_observations": list(dict.fromkeys([*prior_requirements.ai_observations, *extracted.ai_observations])),
                "conclusion": prior_requirements.conclusion or extracted.conclusion,
                "confidence_score": max(prior_requirements.confidence_score, extracted.confidence_score),
            }
        )
