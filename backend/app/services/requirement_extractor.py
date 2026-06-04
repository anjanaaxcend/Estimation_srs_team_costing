from __future__ import annotations

from app.schemas.client import ClientInput
from app.schemas.requirements import RequirementExtractionResult
from app.schemas.srs import ModelSelection
from app.services.local_nlp_requirement_extractor import LocalNLPRequirementExtractor
from app.services.openai_requirement_extractor import OpenAIRequirementExtractor
from app.services.project_blueprint_service import ProjectBlueprintService
from app.utils.project_name import resolve_project_name


class RequirementExtractorService:
    def __init__(self) -> None:
        self.local_extractor = LocalNLPRequirementExtractor()
        self.openai_extractor = OpenAIRequirementExtractor()
        self.blueprint_service = ProjectBlueprintService()

    def extract(
        self,
        payload: ClientInput,
        selected_model: ModelSelection | None = None,
        prior_requirements: RequirementExtractionResult | None = None,
        regeneration_feedback: str = "",
    ) -> RequirementExtractionResult:
        seeded_payload = payload.model_copy(
            update={
                "project_name": resolve_project_name(
                    provided_name=payload.project_name,
                    raw_text=payload.raw_text,
                )
            }
        )

        local_seed: RequirementExtractionResult | None = None
        if self.local_extractor.enabled:
            local_seed = self.local_extractor.extract(seeded_payload)

        if self.openai_extractor.is_enabled(selected_model):
            try:
                extracted = self.openai_extractor.extract(
                    seeded_payload, 
                    seed_result=local_seed,
                    selected_model=selected_model,
                    prior_requirements=prior_requirements,
                    regeneration_feedback=regeneration_feedback,
                )
            except Exception as exc:
                if regeneration_feedback and prior_requirements is not None:
                    import logging
                    logging.getLogger(__name__).warning(
                        "AI requirement regeneration failed; applying deterministic feedback rules to prior requirements: %s",
                        exc,
                    )
                    extracted = prior_requirements
                elif local_seed is not None:
                    import logging
                    logging.getLogger(__name__).warning(
                        "OpenAI requirement extraction failed; falling back to local NLP seed: %s", exc
                    )
                    extracted = local_seed
                else:
                    raise
        elif regeneration_feedback and prior_requirements is not None:
            extracted = prior_requirements
        elif local_seed is not None:
            extracted = local_seed
        else:
            raise RuntimeError(
                "Requirement extraction is unavailable. Enable OpenAI extraction or provide the local NLP model artifacts."
            )

        return self.blueprint_service.enrich(
            extracted,
            payload,
            regeneration_feedback=regeneration_feedback,
            prior_requirements=prior_requirements,
        )
