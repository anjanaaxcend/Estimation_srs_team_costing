import logging

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.team_allocation_service import TeamAllocationService
from app.schemas.team import TeamAllocationDocumentResult, TeamStructure, TeamAnalysisResult, CompanyResource, TeamPlanningPreferences
from app.schemas.srs import ModelSelection
from app.schemas.axcend import AxcendEstimationSheet, AxcendEstimationPercentages
from app.services.axcend_estimation_service import AxcendEstimationService
from app.services.ingestion.utils import normalize_input
from app.services.token_service import check_token_budget, get_effective_api_key, record_token_usage
from pathlib import Path

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/analyze-srs", response_model=TeamAnalysisResult)
async def analyze_srs_endpoint(
    file: UploadFile = File(...),
    selected_provider: str | None = Form(None),
    selected_model: str | None = Form(None),
    selected_base_url: str | None = Form(None),
    selected_api_key: str | None = Form(None),
    company_roster: str | None = Form(None),
    planning_preferences: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> TeamAnalysisResult:
    """Analyze an uploaded SRS file — AI extracts project name from the content."""
    try:
        file_bytes = await file.read()
        normalized = normalize_input(file_bytes, source="file", filename=file.filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read SRS file: {e}")

    hint_name = Path(file.filename).stem.replace("-", " ").replace("_", " ").title()
    provider = selected_provider or "openai"

    model_selection = None
    if selected_provider:
        model_selection = ModelSelection(
            provider=selected_provider,
            model=selected_model or None,
            base_url=selected_base_url or None,
            api_key=selected_api_key or None,
        )

    # Inject BYOK key if available
    byok = get_effective_api_key(db, current_user, provider)
    if byok:
        if model_selection:
            model_selection.api_key = byok
        else:
            model_selection = ModelSelection(provider=provider, api_key=byok)

    check_token_budget(db, current_user, x_session_id, provider)

    parsed_roster = None
    if company_roster:
        try:
            import json
            raw_roster = json.loads(company_roster)
            parsed_roster = [CompanyResource(**item) for item in raw_roster]
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Failed to parse company roster JSON: {e}")

    parsed_preferences = None
    if planning_preferences:
        try:
            import json
            parsed_preferences = TeamPlanningPreferences(**json.loads(planning_preferences))
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Failed to parse planning_preferences JSON: {e}")

    service = TeamAllocationService()
    try:
        result = service.analyze_srs_for_team(
            normalized.cleaned_text,
            hint_name=hint_name,
            selected_model=model_selection,
            company_roster=parsed_roster,
            planning_preferences=parsed_preferences,
        )
        estimated_tokens = max(300, len(normalized.cleaned_text) // 4)
        record_token_usage(db, current_user, x_session_id, provider,
                           getattr(model_selection, "model", None),
                           {"total_tokens": estimated_tokens, "prompt_tokens": int(estimated_tokens*0.6), "completion_tokens": int(estimated_tokens*0.4)},
                           "team", hint_name)
        return result
    except Exception as exc:
        detail = str(exc)
        logger.warning("AI team allocation failed; returning deterministic fallback: %s", detail)
        return service.build_deterministic_team_analysis(
            normalized.cleaned_text,
            hint_name=hint_name,
            company_roster=parsed_roster,
            planning_preferences=parsed_preferences,
            error_detail=detail,
        )


class TextAnalysisRequest(BaseModel):
    project_text: str
    project_name: str = ""  # Optional hint — AI generates the real name from content
    selected_model: ModelSelection | None = None
    company_roster: list[CompanyResource] | None = None
    planning_preferences: TeamPlanningPreferences | None = None


@router.post("/analyze-text", response_model=TeamAnalysisResult)
async def analyze_text_endpoint(
    body: TextAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> TeamAnalysisResult:
    """Analyze a plain-text project description — AI generates the project name and team."""
    if not body.project_text.strip():
        raise HTTPException(status_code=422, detail="project_text must not be empty.")

    provider = (body.selected_model.provider if body.selected_model else "openai") or "openai"
    byok = get_effective_api_key(db, current_user, provider)
    if byok and body.selected_model:
        body.selected_model.api_key = byok
    elif byok:
        body.selected_model = ModelSelection(provider=provider, api_key=byok)

    check_token_budget(db, current_user, x_session_id, provider)

    service = TeamAllocationService()
    try:
        result = service.analyze_srs_for_team(
            body.project_text.strip(),
            hint_name=body.project_name.strip(),
            selected_model=body.selected_model,
            company_roster=body.company_roster,
            planning_preferences=body.planning_preferences,
        )
        estimated_tokens = max(300, len(body.project_text) // 4)
        record_token_usage(db, current_user, x_session_id, provider,
                           getattr(body.selected_model, "model", None),
                           {"total_tokens": estimated_tokens, "prompt_tokens": int(estimated_tokens*0.6), "completion_tokens": int(estimated_tokens*0.4)},
                           "team", body.project_name or "Project")
        return result
    except Exception as exc:
        detail = str(exc)
        logger.warning("AI team allocation failed; returning deterministic fallback: %s", detail)
        return service.build_deterministic_team_analysis(
            body.project_text.strip(),
            hint_name=body.project_name.strip(),
            company_roster=body.company_roster,
            planning_preferences=body.planning_preferences,
            error_detail=detail,
        )


@router.post("/extract-document-team", response_model=TeamAllocationDocumentResult)
async def extract_document_team_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> TeamAllocationDocumentResult:
    try:
        file_bytes = await file.read()
        normalized = normalize_input(file_bytes, source="file", filename=file.filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to read document: {e}")

    hint_name = Path(file.filename or "uploaded-brief").stem.replace("-", " ").replace("_", " ").title()
    
    provider = "openai"
    byok = get_effective_api_key(db, current_user, provider)
    model_selection = ModelSelection(provider=provider, api_key=byok) if byok else None

    check_token_budget(db, current_user, x_session_id, provider)

    service = TeamAllocationService()
    try:
        result = service.extract_team_allocation_from_document(
            normalized.cleaned_text,
            hint_name=hint_name,
            selected_model=model_selection,
        )
        
        # Only record token usage if the heuristic extraction failed and AI was called
        heuristic_members = service._extract_members_heuristically(normalized.cleaned_text)
        if not heuristic_members:
            estimated_tokens = max(300, len(normalized.cleaned_text) // 4)
            from app.core.config import settings
            record_token_usage(
                db,
                current_user,
                x_session_id,
                provider,
                settings.openai_srs_model,
                {
                    "total_tokens": estimated_tokens,
                    "prompt_tokens": int(estimated_tokens * 0.6),
                    "completion_tokens": int(estimated_tokens * 0.4)
                },
                "team",
                hint_name
            )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class TeamAllocationTextRequest(BaseModel):
    project_text: str
    project_name: str = ""


@router.post("/extract-text-team", response_model=TeamAllocationDocumentResult)
async def extract_text_team_endpoint(
    body: TeamAllocationTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> TeamAllocationDocumentResult:
    """Extract a team allocation directly from plain-text brief or copy-pasted roster."""
    if not body.project_text.strip():
        raise HTTPException(status_code=422, detail="project_text must not be empty.")

    provider = "openai"
    byok = get_effective_api_key(db, current_user, provider)
    model_selection = ModelSelection(provider=provider, api_key=byok) if byok else None

    check_token_budget(db, current_user, x_session_id, provider)

    service = TeamAllocationService()
    try:
        result = service.extract_team_allocation_from_document(
            body.project_text.strip(),
            hint_name=body.project_name.strip(),
            selected_model=model_selection,
        )
        
        # Only record token usage if the heuristic extraction failed and AI was called
        heuristic_members = service._extract_members_heuristically(body.project_text.strip())
        if not heuristic_members:
            estimated_tokens = max(300, len(body.project_text) // 4)
            from app.core.config import settings
            record_token_usage(
                db,
                current_user,
                x_session_id,
                provider,
                settings.openai_srs_model,
                {
                    "total_tokens": estimated_tokens,
                    "prompt_tokens": int(estimated_tokens * 0.6),
                    "completion_tokens": int(estimated_tokens * 0.4)
                },
                "team",
                body.project_name or "Project"
            )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# NEW: Build Axcend Effort Estimation from team analysis
# ---------------------------------------------------------------------------

class AxcendEstimationRequest(BaseModel):
    """
    Request to convert an AI TeamAnalysisResult into an AXCEND Effort
    Estimation sheet.  Percentages are always derived from the analysis
    result or user-supplied overrides — never hard-coded.
    """
    analysis: TeamAnalysisResult
    selected_option: str = "balanced"   # "fastest" | "balanced" | "lean"
    company_roster: list[CompanyResource] | None = None
    location: str = "India"
    # User can override any of these ratios; defaults mirror the Excel
    internal_testing_pct: float = 0.20   # 20 % of D&D
    client_testing_pct: float = 0.10     # 10 % of D&D
    deployment_pct: float = 0.10         # 10 % of D&D
    pm_pct: float = 0.10                 # 10 % of base effort
    risk_pct: float = 0.10               # 10 % of total estimation
    negotiation_pct: float = 0.05        # 5  % of total estimation


@router.post("/build-axcend-estimation", response_model=AxcendEstimationSheet)
async def build_axcend_estimation_endpoint(
    body: AxcendEstimationRequest,
    current_user: User = Depends(get_current_user),
) -> AxcendEstimationSheet:
    """
    Convert a completed TeamAnalysisResult into the AXCEND Effort Estimation
    format — three separate panels (Pre-Engineering, Engineering, Project
    Management) — with percentages sourced from the request, not hard-coded.
    """
    pct = AxcendEstimationPercentages(
        internal_testing_pct=body.internal_testing_pct,
        client_testing_pct=body.client_testing_pct,
        deployment_pct=body.deployment_pct,
        pm_pct=body.pm_pct,
        risk_pct=body.risk_pct,
        negotiation_pct=body.negotiation_pct,
    )

    service = AxcendEstimationService()
    try:
        return service.build(
            analysis=body.analysis,
            roster=body.company_roster,
            selected_option=body.selected_option,
            percentages_override=pct,
            location=body.location,
        )
    except Exception as exc:
        logger.error("Failed to build Axcend estimation: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
