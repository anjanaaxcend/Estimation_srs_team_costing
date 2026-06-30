from __future__ import annotations

import json
import datetime
import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User, UserHistory, TemporarySRS, ApprovedSRS, UploadedDocument
from app.schemas.client import ClientInput
from app.schemas.requirements import RequirementExtractionResult
from app.schemas.srs import ModelSelection, SRSGenerationRequest, SRSGenerationResult, SRSSection, SRSTextGenerationRequest
from app.services.ingestion.utils import normalize_input
from app.services.planning_sync import extract_requested_delivery_weeks
from app.services.proposal_orchestrator import ProposalOrchestratorService
from app.services.user_history_service import record_srs_history
from app.services.token_service import check_token_budget, get_effective_api_key, record_token_usage
from app.utils.project_name import resolve_project_name

router = APIRouter()


def _clean_project_name_from_title(raw_title: str) -> str:
    """Strip the SRS title suffix to get just the project name."""
    if not raw_title:
        return raw_title
    for suffix in [
        " - SRS Software Requirements Specifications",
        " - Software Requirements Specification",
        " - SRS",
    ]:
        if raw_title.endswith(suffix):
            return raw_title[: -len(suffix)].strip()
    return raw_title.strip()


def convert_camel_to_snake(data):
    import re
    def camel_to_snake_str(name: str) -> str:
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    if isinstance(data, dict):
        return {camel_to_snake_str(k): convert_camel_to_snake(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [convert_camel_to_snake(x) for x in data]
    else:
        return data



def compute_text_hash(text: str) -> str:
    if not text:
        return ""
    cleaned = "".join(char.lower() for char in text if char.isalnum())
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()

def save_uploaded_document(
    db: Session,
    filename: str,
    content_text: str,
    user: User | None = None,
    session_id: str | None = None,
) -> str:
    h = compute_text_hash(content_text)
    if not h:
        return ""
    
    query = db.query(UploadedDocument).filter(UploadedDocument.hash == h)
    if user:
        query = query.filter(UploadedDocument.user_id == user.id)
    else:
        query = query.filter(UploadedDocument.session_id == session_id)
        
    existing = query.first()
    if not existing:
        new_doc = UploadedDocument(
            user_id=user.id if user else None,
            session_id=session_id if not user else None,
            filename=filename,
            content_text=content_text,
            hash=h
        )
        db.add(new_doc)
        db.commit()
    return h

def save_temp_draft_full(
    db: Session,
    user: User | None,
    session_id: str | None,
    project_name: str | None,
    content: str,
    team_content: str | None,
    cost_content: str | None,
    axcend_estimation_content: str | None,
    document_hash: str | None,
):
    if not user and not session_id:
        return

    query = db.query(TemporarySRS)
    if user:
        query = query.filter(TemporarySRS.user_id == user.id)
    else:
        query = query.filter(TemporarySRS.session_id == session_id)

    existing_draft = query.first()

    if existing_draft:
        existing_draft.content = content
        if project_name:
            existing_draft.project_name = _clean_project_name_from_title(project_name)
        existing_draft.team_content = team_content
        existing_draft.cost_content = cost_content
        existing_draft.axcend_estimation_content = axcend_estimation_content
        existing_draft.document_hash = document_hash
    else:
        new_draft = TemporarySRS(
            user_id=user.id if user else None,
            session_id=session_id if not user else None,
            project_name=_clean_project_name_from_title(project_name) if project_name else None,
            content=content,
            team_content=team_content,
            cost_content=cost_content,
            axcend_estimation_content=axcend_estimation_content,
            document_hash=document_hash,
        )
        db.add(new_draft)
    db.commit()

def get_existing_srs_for_hash(
    db: Session,
    h: str,
    user: User | None,
    session_id: str | None,
) -> SRSGenerationResult | None:
    # 1. Search in ApprovedSRS
    query_approved = db.query(ApprovedSRS).filter(ApprovedSRS.document_hash == h)
    if user:
        query_approved = query_approved.filter(ApprovedSRS.user_id == user.id)
    else:
        query_approved = query_approved.filter(ApprovedSRS.session_id == session_id)
    approved = query_approved.order_by(ApprovedSRS.created_at.desc()).first()
    
    if approved:
        try:
            srs_data = json.loads(approved.content)
            srs_data = convert_camel_to_snake(srs_data)
            # Sanitize project_name inside structured_requirements if it
            # was previously stored with the full SRS title suffix.
            if isinstance(srs_data.get("structured_requirements"), dict):
                raw_pname = srs_data["structured_requirements"].get("project_name", "")
                srs_data["structured_requirements"]["project_name"] = _clean_project_name_from_title(raw_pname)
            save_temp_draft_full(
                db=db,
                user=user,
                session_id=session_id,
                project_name=approved.project_name,
                content=approved.content,
                team_content=approved.team_content,
                cost_content=approved.cost_content,
                axcend_estimation_content=approved.axcend_estimation_content,
                document_hash=h,
            )
            return SRSGenerationResult(**srs_data)
        except Exception as e:
            print(f"Error loading approved SRS: {e}")

    # 2. Search in TemporarySRS
    query_temp = db.query(TemporarySRS).filter(TemporarySRS.document_hash == h)
    if user:
        query_temp = query_temp.filter(TemporarySRS.user_id == user.id)
    else:
        query_temp = query_temp.filter(TemporarySRS.session_id == session_id)
    temp = query_temp.order_by(TemporarySRS.updated_at.desc()).first()
    
    if temp:
        try:
            srs_data = json.loads(temp.content)
            srs_data = convert_camel_to_snake(srs_data)
            save_temp_draft_full(
                db=db,
                user=user,
                session_id=session_id,
                project_name=temp.project_name,
                content=temp.content,
                team_content=temp.team_content,
                cost_content=temp.cost_content,
                axcend_estimation_content=temp.axcend_estimation_content,
                document_hash=h,
            )
            return SRSGenerationResult(**srs_data)
        except Exception as e:
            print(f"Error loading temporary SRS: {e}")

    return None


TRAINING_DATA_PATH = Path(__file__).parent.parent.parent.parent.parent / "training" / "requirements_training_data.json"


class RegenerateRequest(BaseModel):
    raw_text: str
    project_name: str | None = None
    user_feedback: str = ""
    feedback_history: list[str] = Field(default_factory=list)
    attempt: int = 1
    previous_output: list[SRSSection] = Field(default_factory=list)
    selected_model: ModelSelection | None = None
    prior_requirements: RequirementExtractionResult | None = None


class SaveFeedbackRequest(BaseModel):
    raw_input: str
    extracted: dict
    user_feedback: str = ""
    session_id: str | None = None

def clean_for_comparison(text: str) -> str:
    if not text:
        return ""
    return "".join(char.lower() for char in text if char.isalnum())


def find_existing_matching_srs(
    db: Session,
    current_user: User | None,
    x_session_id: str | None,
    normalized_input_text: str,
) -> SRSGenerationResult | None:
    if not normalized_input_text:
        return None
        
    cleaned_input = clean_for_comparison(normalized_input_text)
    
    # ── CHECK TEMPORARY SRS ──
    temp_query = db.query(TemporarySRS)
    if current_user:
        temp_query = temp_query.filter(TemporarySRS.user_id == current_user.id)
    else:
        temp_query = temp_query.filter(TemporarySRS.session_id == x_session_id)
        
    for draft in temp_query.order_by(TemporarySRS.updated_at.desc()).all():
        try:
            draft_data = json.loads(draft.content)
            draft_data = convert_camel_to_snake(draft_data)
            draft_cleaned = draft_data.get("cleaned_text") or ""
            if not draft_cleaned and draft_data.get("structured_requirements"):
                draft_cleaned = draft_data["structured_requirements"].get("normalized_text") or ""
                
            if clean_for_comparison(draft_cleaned) == cleaned_input:
                return SRSGenerationResult(**draft_data)
        except Exception:
            pass
            
    # ── CHECK APPROVED SRS ──
    if current_user:
        approved_query = db.query(ApprovedSRS).filter(ApprovedSRS.user_id == current_user.id)
        for app_srs in approved_query.order_by(ApprovedSRS.created_at.desc()).all():
            try:
                app_data = json.loads(app_srs.content)
                app_data = convert_camel_to_snake(app_data)
                app_cleaned = app_data.get("cleaned_text") or ""
                if not app_cleaned:
                    app_cleaned = app_data.get("normalized_text") or ""
                if not app_cleaned and app_data.get("structured_requirements"):
                    app_cleaned = app_data["structured_requirements"].get("normalized_text") or ""
                    
                if clean_for_comparison(app_cleaned) == cleaned_input:
                    if "sections" in app_data:
                        return SRSGenerationResult(**app_data)
                    else:
                        title = app_data.get("project_name", "Project Blueprint")
                        executive_summary = app_data.get("executive_summary", "")
                        problem_statement = app_data.get("problem_statement", "")
                        proposed_solution = app_data.get("proposed_solution", "")
                        conclusion = app_data.get("conclusion", "")
                        
                        sections = [
                            {"title": "1. Executive Summary", "body": executive_summary or "An executive summary of the project blueprint."},
                            {"title": "2. Problem Statement", "body": problem_statement or "Problem statement and goals."},
                            {"title": "3. Proposed Solution", "body": proposed_solution or "The proposed system solution architecture."},
                            {"title": "4. Conclusion", "body": conclusion or "Project blueprint conclusions and next steps."}
                        ]
                        return SRSGenerationResult(
                            title=title,
                            sections=sections,
                            cleaned_text=app_data.get("normalized_text", ""),
                            structured_requirements=app_data,
                        )
            except Exception:
                pass
                
    return None


@router.post("/generate", response_model=SRSGenerationResult)
def generate_srs(
    payload: SRSGenerationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> SRSGenerationResult:
    provider = (payload.selected_model.provider if payload.selected_model else "openai") or "openai"
    h = compute_text_hash(payload.client_input.raw_text)
    existing_match = get_existing_srs_for_hash(db, h, current_user, x_session_id)
    if existing_match:
        return existing_match

    existing_match = find_existing_matching_srs(db, current_user, x_session_id, payload.client_input.raw_text)
    if existing_match:
        return existing_match

    # ── BUDGET CHECK (skipped for BYOK users) ──
    check_token_budget(db, current_user, x_session_id, provider)

    # ── INJECT BYOK KEY if user has one ──
    byok = get_effective_api_key(db, current_user, provider)
    if byok and payload.selected_model:
        payload.selected_model.api_key = byok
    elif byok:
        payload.selected_model = ModelSelection(provider=provider, api_key=byok)

    save_uploaded_document(db, "brief.txt", payload.client_input.raw_text, current_user, x_session_id)

    orchestrator = ProposalOrchestratorService()
    try:
        result = orchestrator.run(
            payload.client_input,
            references=payload.references,
            appendices=payload.appendices,
            selected_model=payload.selected_model,
            prior_requirements=payload.requirements,
        )
        record_srs_history(db, current_user, result, action="Generated SRS Draft")
        save_temporary_srs_draft(db, result, current_user, x_session_id, document_hash=h)
        # ── RECORD TOKEN USAGE (estimated from text length since orchestrator wraps LLM) ──
        estimated_tokens = max(500, len(payload.client_input.raw_text) // 3)
        record_token_usage(db, current_user, x_session_id, provider,
                           getattr(payload.selected_model, "model", None), 
                           {"total_tokens": estimated_tokens, "prompt_tokens": int(estimated_tokens*0.6), "completion_tokens": int(estimated_tokens*0.4)},
                           "srs", result.title)
        return result
    except (RuntimeError, Exception) as exc:
        detail = str(exc)
        if "quota" in detail.lower() or "rate limit" in detail.lower():
            raise HTTPException(status_code=429, detail=f"AI Provider Rate Limit: {detail}") from exc
        raise HTTPException(status_code=503, detail=detail) from exc


@router.post("/generate-from-text", response_model=SRSGenerationResult)
def generate_srs_from_text(
    payload: SRSTextGenerationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> SRSGenerationResult:
    provider = (payload.selected_model.provider if payload.selected_model else "openai") or "openai"
    normalized = normalize_input(payload.raw_text, source="text")
    h = compute_text_hash(normalized.cleaned_text)
    existing_match = get_existing_srs_for_hash(db, h, current_user, x_session_id)
    if existing_match:
        return existing_match

    existing_match = find_existing_matching_srs(db, current_user, x_session_id, normalized.cleaned_text)
    if existing_match:
        return existing_match

    check_token_budget(db, current_user, x_session_id, provider)
    byok = get_effective_api_key(db, current_user, provider)
    if byok and payload.selected_model:
        payload.selected_model.api_key = byok
    elif byok:
        payload.selected_model = ModelSelection(provider=provider, api_key=byok)

    save_uploaded_document(db, payload.project_name or "brief.txt", normalized.cleaned_text, current_user, x_session_id)

    client_input = _build_client_input(
        project_name=resolve_project_name(
            provided_name=payload.project_name,
            raw_text=normalized.cleaned_text,
        ),
        raw_text=normalized.cleaned_text,
        client_name=payload.client_name,
        industry=payload.industry,
        business_goals=payload.business_goals,
        timeline_expectation=payload.timeline_expectation,
        budget_range=payload.budget_range,
        integrations=payload.integrations,
        compliance_requirements=payload.compliance_requirements,
        deployment_preferences=payload.deployment_preferences,
    )
    try:
        result = ProposalOrchestratorService().run(
            client_input,
            selected_model=payload.selected_model,
        )
        record_srs_history(db, current_user, result, action="Generated SRS Draft")
        save_temporary_srs_draft(db, result, current_user, x_session_id, document_hash=h)
        estimated_tokens = max(500, len(payload.raw_text) // 3)
        record_token_usage(db, current_user, x_session_id, provider,
                           getattr(payload.selected_model, "model", None),
                           {"total_tokens": estimated_tokens, "prompt_tokens": int(estimated_tokens*0.6), "completion_tokens": int(estimated_tokens*0.4)},
                           "srs", result.title)
        return result
    except (RuntimeError, Exception) as exc:
        detail = str(exc)
        if "quota" in detail.lower() or "rate limit" in detail.lower():
            raise HTTPException(status_code=429, detail=f"AI Provider Rate Limit: {detail}") from exc
        raise HTTPException(status_code=503, detail=detail) from exc


@router.post("/generate-from-file", response_model=SRSGenerationResult)
async def generate_srs_from_file(
    file: UploadFile = File(...),
    project_name: str | None = Form(None),
    client_name: str | None = Form(None),
    industry: str | None = Form(None),
    selected_provider: str | None = Form(None),
    selected_model: str | None = Form(None),
    selected_base_url: str | None = Form(None),
    selected_api_key: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> SRSGenerationResult:
    try:
        file_bytes = await file.read()
        normalized = normalize_input(file_bytes, source="file", filename=file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"File extraction failed: {exc}") from exc

    h = compute_text_hash(normalized.cleaned_text)
    existing_match = get_existing_srs_for_hash(db, h, current_user, x_session_id)
    if existing_match:
        return existing_match

    # ── CHECK FOR RECENT MATCHING DRAFT OR APPROVED BLUEPRINT ──
    existing_match = find_existing_matching_srs(db, current_user, x_session_id, normalized.cleaned_text)
    if existing_match:
        return existing_match

    save_uploaded_document(db, file.filename, normalized.cleaned_text, current_user, x_session_id)

    filename_hint = Path(file.filename or "uploaded-brief").stem.replace("-", " ").replace("_", " ").title()
    derived_project_name = resolve_project_name(
        provided_name=project_name or filename_hint,
        raw_text=normalized.cleaned_text,
    )
    client_input = _build_client_input(
        project_name=derived_project_name,
        raw_text=normalized.cleaned_text,
        client_name=client_name,
        industry=industry,
        business_goals=["Generate a software requirements specification from the uploaded source document."],
    )
    model_selection = None
    if selected_provider:
        model_selection = ModelSelection(
            provider=selected_provider,
            model=selected_model or None,
            base_url=selected_base_url or None,
            api_key=selected_api_key or None,
        )

    try:
        result = ProposalOrchestratorService().run(
            client_input,
            selected_model=model_selection,
        )
        record_srs_history(db, current_user, result, action="Generated SRS Draft")
        save_temporary_srs_draft(db, result, current_user, x_session_id, document_hash=h)
        estimated_tokens = max(500, len(normalized.cleaned_text) // 3)
        provider_name = (model_selection.provider if model_selection else "openai") or "openai"
        record_token_usage(db, current_user, x_session_id, provider_name,
                           getattr(model_selection, "model", None),
                           {"total_tokens": estimated_tokens, "prompt_tokens": int(estimated_tokens*0.6), "completion_tokens": int(estimated_tokens*0.4)},
                           "srs", result.title)
        return result
    except (RuntimeError, Exception) as exc:
        detail = str(exc)
        if "quota" in detail.lower() or "rate limit" in detail.lower():
            raise HTTPException(status_code=429, detail=f"AI Provider Rate Limit: {detail}") from exc
        raise HTTPException(status_code=503, detail=detail) from exc


@router.post("/regenerate", response_model=SRSGenerationResult)
def regenerate_srs(
    payload: RegenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
) -> SRSGenerationResult:
    """Re-run extraction with user feedback to produce a progressively improved version."""
    has_feedback = bool(payload.user_feedback.strip())
    previous_feedback = [item.strip() for item in payload.feedback_history if item.strip()]
    feedback_history_block = ""
    if previous_feedback:
        feedback_history_block = (
            "\n\nPREVIOUS APPROVED REGENERATION INSTRUCTIONS (carry all of these forward):\n"
            + "\n".join(f"- {item}" for item in previous_feedback)
        )
    
    if has_feedback:
        improvement_instructions = (
            f"\n\nSPECIFIC USER FEEDBACK TO ADDRESS (Attempt #{payload.attempt}):\n"
            f"{payload.user_feedback}\n"
            "CRITICAL: Preserve all previously requested changes unless the new feedback explicitly replaces them."
        )
    else:
        improvement_instructions = (
            f"\n\nIMPROVEMENT MANDATE (Attempt #{payload.attempt}):\n"
            "Produce a more comprehensive and professional version of the previous extraction.\n"
            "- Add more detail to feature descriptions.\n"
            "- Ensure module boundaries are clear and logical.\n"
            "- Detect any missing implied features that a senior system architect would expect.\n"
        )

    previous_output_block = ""
    if payload.previous_output:
        filtered_sections = [
            section for section in payload.previous_output
            if not any(kw in section.title.lower() for kw in ["team", "delivery", "working hours", "allocation", "7."])
        ]
        if filtered_sections:
            previous_output_block = (
                "\n\nPREVIOUS GENERATED PROPOSAL PREVIEW:\n"
                + "\n\n".join(f"{section.title}\n{section.body}" for section in filtered_sections)
            )

    enhanced_text = payload.raw_text + previous_output_block + feedback_history_block + improvement_instructions
    effective_feedback_parts = [*previous_feedback]
    if has_feedback:
        effective_feedback_parts.append(payload.user_feedback.strip())
    effective_feedback = "\n".join(item for item in effective_feedback_parts if item)
    requested_weeks = extract_requested_delivery_weeks(
        "\n\n".join([payload.user_feedback, *previous_feedback])
    )
    normalized = normalize_input(enhanced_text, source="text")
    client_input = _build_client_input(
        project_name=resolve_project_name(
            provided_name=payload.project_name,
            raw_text=payload.raw_text,
        ),
        raw_text=normalized.cleaned_text,
        timeline_expectation=f"{requested_weeks:g} weeks" if requested_weeks > 0 else None,
    )
    try:
        result = ProposalOrchestratorService().run(
            client_input,
            selected_model=payload.selected_model,
            prior_requirements=payload.prior_requirements,
            prior_sections=payload.previous_output,
            regeneration_feedback=effective_feedback,
        )
        record_srs_history(db, current_user, result, action="Regenerated SRS Draft")
        save_temporary_srs_draft(db, result, current_user, x_session_id)

        # Save the improved extraction to training data for future learning
        if result.structured_requirements is not None:
            _save_to_training(payload.raw_text, result.structured_requirements.model_dump(), payload.user_feedback)

        return result
    except (RuntimeError, Exception) as exc:
        detail = str(exc)
        if "quota" in detail.lower() or "rate limit" in detail.lower():
            raise HTTPException(status_code=429, detail=f"AI Provider Rate Limit: {detail}") from exc
        raise HTTPException(status_code=503, detail=detail) from exc


@router.post("/save-feedback")
def save_feedback(
    payload: SaveFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save user-approved extractions to training data file."""
    _save_to_training(payload.raw_input, payload.extracted, payload.user_feedback)
    
    project_name = ""
    if isinstance(payload.extracted, dict):
        if "structured_requirements" in payload.extracted and payload.extracted["structured_requirements"]:
            project_name = str(payload.extracted["structured_requirements"].get("project_name") or "").strip()
        if not project_name:
            project_name = str(payload.extracted.get("title") or "").strip()
            if project_name and " - " in project_name:
                project_name = project_name.split(" - ")[0].strip()
        if not project_name:
            project_name = str(payload.extracted.get("project_name") or "").strip()

    # Find the temporary draft to retrieve hash, team, and cost content
    temp_query = db.query(TemporarySRS)
    if current_user:
        temp_query = temp_query.filter(TemporarySRS.user_id == current_user.id)
    elif payload.session_id:
        temp_query = temp_query.filter(TemporarySRS.session_id == payload.session_id)
    else:
        temp_query = None

    temp_draft = temp_query.first() if temp_query else None
    doc_hash = temp_draft.document_hash if temp_draft else None
    team_content = temp_draft.team_content if temp_draft else None
    cost_content = temp_draft.cost_content if temp_draft else None
    axcend_estimation_content = temp_draft.axcend_estimation_content if temp_draft else None
        
    if current_user:
        history = UserHistory(
            user_id=current_user.id,
            action="Approved SRS Blueprint",
            project_name=project_name or None,
            details=(
                f"Approved SRS blueprint for {project_name}."
                if project_name
                else "Approved SRS blueprint."
            ),
        )
        db.add(history)
        
        # Save the full approved SRS document to the DB under the registered user's ID
        approved_srs_record = ApprovedSRS(
            user_id=current_user.id,
            project_name=project_name or "Project Blueprint",
            content=json.dumps(payload.extracted),
            team_content=team_content,
            cost_content=cost_content,
            axcend_estimation_content=axcend_estimation_content,
            document_hash=doc_hash,
        )
        db.add(approved_srs_record)
        db.commit()

    # Clear from TemporarySRS table
    if temp_query:
        temp_query.delete()
        db.commit()

    return {"status": "saved"}



def save_temporary_srs_draft(
    db: Session,
    result: SRSGenerationResult,
    user: User | None = None,
    session_id: str | None = None,
    document_hash: str | None = None,
):
    if not user and not session_id:
        return

    # Use the clean project name — NOT the full title string — so the DB
    # never poisons requirements.project_name with the SRS suffix.
    clean_name = _clean_project_name_from_title(result.title)

    # Try to find existing draft for the user or session
    query = db.query(TemporarySRS)
    if user:
        query = query.filter(TemporarySRS.user_id == user.id)
    else:
        query = query.filter(TemporarySRS.session_id == session_id)
    
    existing_draft = query.first()
    
    # Serialize the result to JSON
    content_json = result.model_dump_json()

    if existing_draft:
        existing_draft.content = content_json
        existing_draft.project_name = clean_name
        if document_hash:
            existing_draft.document_hash = document_hash
    else:
        new_draft = TemporarySRS(
            user_id=user.id if user else None,
            session_id=session_id if not user else None,
            project_name=clean_name,
            content=content_json,
            document_hash=document_hash,
        )
        db.add(new_draft)
    
    db.commit()


class SaveTempDraftRequest(BaseModel):
    session_id: str | None = None
    result: SRSGenerationResult


@router.get("/temp-draft")
def get_temp_draft(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    if not current_user and not x_session_id:
        return {"draft": None}
    
    query = db.query(TemporarySRS)
    if current_user:
        query = query.filter(TemporarySRS.user_id == current_user.id)
    else:
        query = query.filter(TemporarySRS.session_id == x_session_id)
        
    draft = query.order_by(TemporarySRS.updated_at.desc()).first()
    if not draft:
        return {"draft": None}
        
    return {
        "draft": json.loads(draft.content),
        "team_draft": json.loads(draft.team_content) if draft.team_content else None,
        "cost_draft": json.loads(draft.cost_content) if draft.cost_content else None,
        "axcend_draft": json.loads(draft.axcend_estimation_content) if draft.axcend_estimation_content else None,
        "updated_at": draft.updated_at.isoformat() if draft.updated_at else None
    }


@router.post("/temp-draft")
def post_temp_draft(
    payload: SaveTempDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    session_id = payload.session_id or x_session_id
    save_temporary_srs_draft(
        db=db,
        result=payload.result,
        user=current_user,
        session_id=session_id,
    )
    return {"status": "saved"}


class SaveTeamDraftRequest(BaseModel):
    draft: dict


@router.post("/temp-draft/team")
def save_temp_team_draft(
    payload: SaveTeamDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    query = db.query(TemporarySRS)
    if current_user:
        query = query.filter(TemporarySRS.user_id == current_user.id)
    else:
        query = query.filter(TemporarySRS.session_id == x_session_id)
    
    draft = query.first()
    if not draft:
        project_name = None
        if payload.draft:
            project_name = (
                payload.draft.get("localProjectTitle")
                or payload.draft.get("teamData", {}).get("project_name")
                or "Unnamed Project"
            )
        else:
            project_name = "Unnamed Project"
            
        draft = TemporarySRS(
            user_id=current_user.id if current_user else None,
            session_id=x_session_id if not current_user else None,
            project_name=project_name,
            content="{}",
        )
        db.add(draft)
    
    draft.team_content = json.dumps(payload.draft)
    db.commit()
    return {"status": "saved"}


class SaveCostDraftRequest(BaseModel):
    draft: dict


@router.post("/temp-draft/cost")
def save_temp_cost_draft(
    payload: SaveCostDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    query = db.query(TemporarySRS)
    if current_user:
        query = query.filter(TemporarySRS.user_id == current_user.id)
    else:
        query = query.filter(TemporarySRS.session_id == x_session_id)
    
    draft = query.first()
    if not draft:
        project_name = None
        if payload.draft:
            project_name = (
                payload.draft.get("projectName")
                or payload.draft.get("project_name")
                or "Unnamed Project"
            )
        else:
            project_name = "Unnamed Project"
            
        draft = TemporarySRS(
            user_id=current_user.id if current_user else None,
            session_id=x_session_id if not current_user else None,
            project_name=project_name,
            content="{}",
        )
        db.add(draft)
    
    draft.cost_content = json.dumps(payload.draft)
    db.commit()
    return {"status": "saved"}


class SaveAxcendDraftRequest(BaseModel):
    draft: dict


@router.post("/temp-draft/axcend")
def save_temp_axcend_draft(
    payload: SaveAxcendDraftRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    query = db.query(TemporarySRS)
    if current_user:
        query = query.filter(TemporarySRS.user_id == current_user.id)
    else:
        query = query.filter(TemporarySRS.session_id == x_session_id)
    
    draft = query.first()
    if not draft:
        project_name = None
        if payload.draft:
            project_name = (
                payload.draft.get("projectName")
                or payload.draft.get("project_name")
                or "Unnamed Project"
            )
        else:
            project_name = "Unnamed Project"
            
        draft = TemporarySRS(
            user_id=current_user.id if current_user else None,
            session_id=x_session_id if not current_user else None,
            project_name=project_name,
            content="{}",
        )
        db.add(draft)
    
    draft.axcend_estimation_content = json.dumps(payload.draft)
    db.commit()
    return {"status": "saved"}


@router.delete("/temp-draft")
def delete_temp_draft(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    x_session_id: str | None = Header(None),
):
    query = db.query(TemporarySRS)
    if current_user:
        query = query.filter(TemporarySRS.user_id == current_user.id)
    else:
        if not x_session_id:
            return {"status": "no session_id provided"}
        query = query.filter(TemporarySRS.session_id == x_session_id)
        
    query.delete()
    db.commit()
    return {"status": "deleted"}



@router.get("/approved")
def get_approved_srs_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    docs = (
        db.query(ApprovedSRS)
        .filter(ApprovedSRS.user_id == current_user.id)
        .order_by(ApprovedSRS.created_at.desc())
        .all()
    )
    
    return [
        {
            "id": doc.id,
            "project_name": doc.project_name,
            "content": json.loads(doc.content),
            "created_at": doc.created_at.isoformat() if doc.created_at else None
        }
        for doc in docs
    ]


@router.post("/approved/{approved_id}/restore")
def restore_approved_srs(
    approved_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    approved = db.query(ApprovedSRS).filter(ApprovedSRS.id == approved_id, ApprovedSRS.user_id == current_user.id).first()
    if not approved:
        raise HTTPException(status_code=404, detail="Approved SRS not found")
        
    save_temp_draft_full(
        db=db,
        user=current_user,
        session_id=None,
        project_name=approved.project_name,
        content=approved.content,
        team_content=approved.team_content,
        cost_content=approved.cost_content,
        axcend_estimation_content=approved.axcend_estimation_content,
        document_hash=approved.document_hash,
    )
    return {"status": "restored"}


def _save_to_training(raw_input: str, extracted: dict, feedback: str = "") -> None:
    """Append a training example to the requirements_training_data.json file."""
    try:
        if TRAINING_DATA_PATH.exists():
            data = json.loads(TRAINING_DATA_PATH.read_text(encoding="utf-8"))
        else:
            data = []

        entry = {
            "timestamp": datetime.datetime.utcnow().isoformat(),
            "raw_input": raw_input,
            "user_feedback": feedback,
            "extracted": extracted,
        }
        if isinstance(data, list):
            data.append(entry)
        else:
            data = [entry]

        TRAINING_DATA_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass  # Never crash the API on training save failure


def _build_client_input(
    *,
    project_name: str,
    raw_text: str,
    client_name: str | None = None,
    industry: str | None = None,
    business_goals: list[str] | None = None,
    timeline_expectation: str | None = None,
    budget_range: str | None = None,
    integrations: list[str] | None = None,
    compliance_requirements: list[str] | None = None,
    deployment_preferences: list[str] | None = None,
) -> ClientInput:
    return ClientInput(
        project_name=project_name,
        client_name=client_name or "Prospective Client",
        industry=industry or "General",
        raw_text=raw_text,
        business_goals=business_goals or ["Generate a software requirements specification from the source material."],
        timeline_expectation=timeline_expectation,
        budget_range=budget_range,
        integrations=integrations or [],
        compliance_requirements=compliance_requirements or [],
        deployment_preferences=deployment_preferences or ["Cloud"],
    )
