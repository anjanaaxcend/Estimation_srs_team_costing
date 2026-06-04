from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.user import User, UserHistory
from app.schemas.srs import SRSGenerationResult


def record_srs_history(
    db: Session,
    current_user: User | None,
    result: SRSGenerationResult,
    *,
    action: str,
) -> None:
    if current_user is None:
        return

    requirements = result.structured_requirements
    selected_model = result.selected_model
    project_name = None
    if requirements and requirements.project_name:
        project_name = requirements.project_name
    elif result.title:
        project_name = result.title.split(" - ", 1)[0].strip()

    provider_label = selected_model.provider if selected_model else "openai"
    model_label = selected_model.model if selected_model and selected_model.model else "default"
    sections_count = len(result.sections or [])
    details = (
        f"{action} for {project_name or 'Untitled Project'} using "
        f"{provider_label}/{model_label} with {sections_count} sections."
    )

    history = UserHistory(
        user_id=current_user.id,
        action=action,
        project_name=project_name,
        provider=provider_label,
        sections_count=sections_count,
        details=details,
    )
    db.add(history)
    db.commit()
