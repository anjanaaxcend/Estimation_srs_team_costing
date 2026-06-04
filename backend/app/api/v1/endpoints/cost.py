from __future__ import annotations

import io
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, Depends, Header
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.deps import get_optional_user
from app.models.user import User, UserHistory
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.schemas.cost import CostEstimationExportRequest
from app.schemas.team import TeamAllocationDocumentResult
from app.schemas.srs import ModelSelection
from app.core.config import settings
from app.services.token_service import check_token_budget, get_effective_api_key, record_token_usage
from app.services.ingestion.utils import normalize_input
from app.services.planning_sync import calculate_cost_totals
from app.services.team_allocation_service import TeamAllocationService
from app.utils.project_name import resolve_project_name

router = APIRouter()


def _styles() -> dict[str, object]:
    thin = Side(border_style="thin", color="CBD5E1")
    return {
        "title_font": Font(name="Calibri", size=18, bold=True, color="FFFFFF"),
        "header_font": Font(name="Calibri", size=11, bold=True, color="FFFFFF"),
        "bold_font": Font(name="Calibri", size=11, bold=True),
        "body_font": Font(name="Calibri", size=10),
        "title_fill": PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid"),
        "header_fill": PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid"),
        "alt_fill": PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid"),
        "accent_fill": PatternFill(start_color="059669", end_color="059669", fill_type="solid"),
        "border": Border(top=thin, left=thin, right=thin, bottom=thin),
        "center": Alignment(horizontal="center", vertical="center", wrap_text=True),
        "left": Alignment(horizontal="left", vertical="center", wrap_text=True),
    }


def _team_cost(member) -> float:
    return round(member.count * member.hourly_rate * member.hours_per_member, 2)


@router.post("/analyze-document", response_model=TeamAllocationDocumentResult)
async def analyze_cost_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
    x_session_id: str | None = Header(None),
) -> TeamAllocationDocumentResult:
    try:
        file_bytes = await file.read()
        normalized = normalize_input(file_bytes, source="file", filename=file.filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to read document: {exc}") from exc

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
                "cost",
                hint_name
            )
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/export-excel")
async def export_cost_excel(
    payload: CostEstimationExportRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user)
) -> Response:
    project_name = resolve_project_name(provided_name=payload.project_name, fallback="Project Costing")

    if current_user:
        history = UserHistory(
            user_id=current_user.id,
            action="Downloaded Cost Excel",
            details=f"Exported Cost Excel for: {project_name}"
        )
        db.add(history)
        db.commit()

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Cost Summary"
    s = _styles()
    totals = calculate_cost_totals(payload)

    sheet.merge_cells("A1:G1")
    sheet["A1"] = f"Project Cost Estimation: {project_name}"
    sheet["A1"].font = s["title_font"]
    sheet["A1"].fill = s["title_fill"]
    sheet["A1"].alignment = s["center"]

    headers = [
        "Role",
        "Count",
        f"Hourly Rate ({payload.currency})",
        "Weekly Hours",
        "Hours / Member",
        f"Cost / Employee ({payload.currency})",
        f"Total ({payload.currency})",
    ]
    for col, text in enumerate(headers, start=1):
        cell = sheet.cell(row=3, column=col, value=text)
        cell.font = s["header_font"]
        cell.fill = s["header_fill"]
        cell.border = s["border"]
        cell.alignment = s["center"]

    row = 4
    for index, member in enumerate(payload.members):
        total_cost = _team_cost(member)
        cost_per_employee = round(member.hourly_rate * member.hours_per_member, 2)
        values = [
            member.role,
            member.count,
            member.hourly_rate,
            member.weekly_hours,
            member.hours_per_member,
            cost_per_employee,
            total_cost,
        ]
        for col, value in enumerate(values, start=1):
            cell = sheet.cell(row=row, column=col, value=value)
            cell.font = s["body_font"]
            cell.border = s["border"]
            cell.alignment = s["left"] if col == 1 else s["center"]
            if index % 2 == 0:
                cell.fill = s["alt_fill"]
        row += 1

    summary_start = row + 2
    summary_rows = [
        ("Development Total Cost", totals["development_total"]),
        ("Testing Total Cost", totals["testing_total"]),
        ("Deployment Total Cost", totals["deployment_total"]),
        ("Team Salary Total", totals["salary_total"]),
        ("Project Management (15%)", totals["project_management"]),
        ("Risk Contingency (10%)", totals["risk_contingency"]),
        ("Negotiation Buffer (5%)", totals["negotiation_buffer"]),
        ("Company Profit Slabs", totals["profit_total"]),
        ("Miscellaneous", totals["misc_total"]),
        ("Project Total Cost Estimation", totals["project_total_estimation"]),
        ("Grand Total", totals["grand_total"]),
    ]
    for offset, (label, value) in enumerate(summary_rows):
        current_row = summary_start + offset
        label_cell = sheet.cell(row=current_row, column=1, value=label)
        value_cell = sheet.cell(row=current_row, column=2, value=value)
        label_cell.font = s["bold_font"]
        value_cell.font = s["bold_font"]
        label_cell.border = s["border"]
        value_cell.border = s["border"]
        label_cell.alignment = s["left"]
        value_cell.alignment = s["center"]
        if label == "Grand Total":
            label_cell.fill = s["accent_fill"]
            value_cell.fill = s["accent_fill"]
            label_cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
            value_cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

    details_sheet = workbook.create_sheet(title="Additional Costs")
    detail_headers = ["Category", "Label", f"Amount ({payload.currency})"]
    for col, text in enumerate(detail_headers, start=1):
        cell = details_sheet.cell(row=1, column=col, value=text)
        cell.font = s["header_font"]
        cell.fill = s["header_fill"]
        cell.border = s["border"]
        cell.alignment = s["center"]

    detail_row = 2
    additional_items = [
        ("Project Management", [("Management overhead (15%)", totals["project_management"])]),
        ("Risk Contingency", [("Risk Contingency (10%)", totals["risk_contingency"])]),
        ("Negotiation Buffer", [("Negotiation Buffer (5%)", totals["negotiation_buffer"])]),
        ("Profit Slab", [(item.label, item.amount) for item in payload.profit_slabs]),
        ("Miscellaneous", [(item.label, item.amount) for item in payload.miscellaneous_costs if not any(x in item.label.lower() for x in ["risk", "negotiation"])]),
    ]
    for category, items in additional_items:
        for label, amount in items:
            for col, value in enumerate((category, label, amount), start=1):
                cell = details_sheet.cell(row=detail_row, column=col, value=value)
                cell.font = s["body_font"]
                cell.border = s["border"]
                cell.alignment = s["left"] if col < 3 else s["center"]
            detail_row += 1

    for target_sheet in (sheet, details_sheet):
        target_sheet.column_dimensions["A"].width = 30
        target_sheet.column_dimensions["B"].width = 18
        target_sheet.column_dimensions["C"].width = 22
        target_sheet.column_dimensions["D"].width = 18
        target_sheet.column_dimensions["E"].width = 18
        target_sheet.column_dimensions["F"].width = 20
        target_sheet.column_dimensions["G"].width = 18

    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)

    filename = f"{project_name.replace(' ', '_')}_Cost_Estimation.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
