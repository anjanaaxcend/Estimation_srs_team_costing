from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil
import re
from typing import Any

TESTING_ROLE_KEYWORDS = (
    "qa",
    "quality assurance",
    "tester",
    "testing",
    "test engineer",
    "test analyst",
    "sdet",
)

DEPLOYMENT_ROLE_KEYWORDS = (
    "devops",
    "platform engineer",
    "release engineer",
    "site reliability",
    "sre",
    "cloud engineer",
    "deployment",
)



@dataclass
class PlanningInsights:
    total_project_hours: float = 0.0
    total_working_weeks: float = 0.0
    weekly_hours_per_member: float = 40.0
    hours_per_member_by_role: dict[str, float] = field(default_factory=dict)
    weekly_hours_by_role: dict[str, float] = field(default_factory=dict)
    active_weeks_by_role: dict[str, float] = field(default_factory=dict)


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed == parsed else default


def normalize_role_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def extract_planning_insights(text: str, role_names: list[str] | None = None) -> PlanningInsights:
    content = text or ""
    insights = PlanningInsights()
    insights.weekly_hours_per_member = _extract_default_weekly_hours(content) or 40.0
    insights.total_working_weeks = _extract_total_weeks(content)
    insights.total_project_hours = _extract_total_project_hours(content)

    if not role_names:
        return insights

    lines = [line.strip() for line in content.splitlines() if line.strip()]
    for role_name in role_names:
        line = _find_role_line(lines, role_name)
        if not line:
            continue

        weekly_hours = _extract_weekly_hours(line) or insights.weekly_hours_per_member
        active_weeks = _extract_line_weeks(line) or insights.total_working_weeks
        total_hours = _extract_total_hours_from_line(line)
        if total_hours <= 0 and weekly_hours > 0 and active_weeks > 0:
            total_hours = weekly_hours * active_weeks

        role_key = normalize_role_key(role_name)
        if weekly_hours > 0:
            insights.weekly_hours_by_role[role_key] = weekly_hours
        if active_weeks > 0:
            insights.active_weeks_by_role[role_key] = active_weeks
        if total_hours > 0:
            insights.hours_per_member_by_role[role_key] = total_hours

    return insights


def extract_requested_delivery_weeks(text: str) -> float:
    """Extract user-requested delivery windows without treating sprint cadence as duration."""
    content = text or ""
    range_match = re.search(
        r"(?:in|within|under|for|duration|timeline)?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*weeks?\b",
        content,
        flags=re.IGNORECASE,
    )
    if range_match:
        return safe_float(range_match.group(2))

    patterns = (
        r"(?:complete|finish|deliver|build|ready|make|launch|ship|implement)[^.!\n]{0,90}?\b(?:in|within|under|by)\s+(\d+(?:\.\d+)?)\s*weeks?\b",
        r"\b(?:in|within|under|max(?:imum)?|no more than|not more than|only)\s+(\d+(?:\.\d+)?)\s*weeks?\b",
        r"\b(\d+(?:\.\d+)?)\s*weeks?\s+for\s+(?:the\s+)?project\b",
        r"\b(\d+(?:\.\d+)?)\s*weeks?\s*(?:deadline|timeline|duration|delivery|only)\b",
        r"\b(\d+(?:\.\d+)?)\s*week\s+(?:project|delivery|timeline)\b",
    )
    for pattern in patterns:
        match = re.search(pattern, content, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return 0.0


def enrich_team_members_with_planning(members: list[Any], text: str) -> tuple[list[Any], float, float, float]:
    insights = extract_planning_insights(text, [getattr(member, "role", "") for member in members])
    total_headcount = sum(max(0, int(getattr(member, "count", 0) or 0)) for member in members)
    default_hours_per_member = 0.0
    if insights.total_project_hours > 0 and total_headcount > 0:
        default_hours_per_member = insights.total_project_hours / total_headcount
    elif insights.weekly_hours_per_member > 0 and insights.total_working_weeks > 0:
        default_hours_per_member = insights.weekly_hours_per_member * insights.total_working_weeks

    enriched_members: list[Any] = []
    computed_total_hours = 0.0
    computed_weeks: list[float] = []

    for member in members:
        role_key = normalize_role_key(getattr(member, "role", ""))
        weekly_hours = insights.weekly_hours_by_role.get(role_key) or insights.weekly_hours_per_member or 40.0
        hours_per_member = insights.hours_per_member_by_role.get(role_key) or default_hours_per_member
        active_weeks = insights.active_weeks_by_role.get(role_key) or (
            hours_per_member / weekly_hours if weekly_hours > 0 and hours_per_member > 0 else insights.total_working_weeks
        )

        total_member_hours = max(0.0, safe_float(getattr(member, "count", 0))) * max(0.0, hours_per_member)
        computed_total_hours += total_member_hours
        if active_weeks > 0:
            computed_weeks.append(active_weeks)

        enriched_members.append(
            member.model_copy(
                update={
                    "weekly_hours": round(weekly_hours, 2) if weekly_hours > 0 else None,
                    "active_weeks": round(active_weeks, 2) if active_weeks > 0 else None,
                    "hours_per_member": round(hours_per_member, 2) if hours_per_member > 0 else None,
                }
            )
        )

    explicit_total = insights.total_project_hours
    if explicit_total > 0 and computed_total_hours > 0:
        mismatch = abs(explicit_total - computed_total_hours) / max(explicit_total, computed_total_hours)
        total_project_hours = explicit_total if mismatch <= 0.15 else computed_total_hours
    else:
        total_project_hours = explicit_total or computed_total_hours

    total_working_weeks = insights.total_working_weeks or (max(computed_weeks) if computed_weeks else 0.0)
    return (
        enriched_members,
        round(total_project_hours, 2),
        round(total_working_weeks, 2),
        round(insights.weekly_hours_per_member or 40.0, 2),
    )


def calculate_cost_totals(cost: Any) -> dict[str, Any]:
    development_total = 0.0
    testing_total = 0.0
    deployment_total = 0.0
    management_salary_total = 0.0
    salary_total = 0.0
    total_project_hours = 0.0
    member_breakdown: list[dict[str, Any]] = []

    for member in getattr(cost, "members", []):
        count = safe_float(member.count)
        hourly_rate = safe_float(member.hourly_rate)
        hours_per_member = safe_float(member.hours_per_member)
        cost_per_employee = round(hourly_rate * hours_per_member, 2)
        role_total = round(
            count * cost_per_employee,
            2,
        )
        role_name = getattr(member, "role", "")
        
        total_project_hours += count * hours_per_member

        if is_management_role(role_name):
            management_salary_total += role_total
        else:
            salary_total += role_total
            if is_testing_role(role_name):
                testing_total += role_total
            elif is_deployment_role(role_name):
                deployment_total += role_total
            else:
                development_total += role_total

        member_breakdown.append(
            {
                "id": getattr(member, "id", None),
                "role": role_name,
                "count": int(count),
                "hourly_rate": round(hourly_rate, 2),
                "weekly_hours": round(safe_float(getattr(member, "weekly_hours", 40.0), 40.0), 2),
                "hours_per_member": round(hours_per_member, 2),
                "cost_per_employee": cost_per_employee,
                "role_total": role_total,
                "total": role_total,
            }
        )

    development_total = round(development_total, 2)
    testing_total = round(testing_total, 2)
    deployment_total = round(deployment_total, 2)
    salary_total = round(
        salary_total,
        2,
    )

    other_misc_costs = []
    risk_contingency_cost = 0.0
    negotiation_buffer_cost = 0.0

    for item in getattr(cost, "miscellaneous_costs", []):
        label_lower = getattr(item, "label", "").lower()
        amount = safe_float(item.amount)
        if "risk" in label_lower:
            risk_contingency_cost = amount
        elif "negotiation" in label_lower:
            negotiation_buffer_cost = amount
        else:
            other_misc_costs.append(item)

    misc_total = round(sum(safe_float(item.amount) for item in other_misc_costs), 2)
    profit_total = round(sum(safe_float(item.amount) for item in getattr(cost, "profit_slabs", [])), 2)
    
    project_management_input = round(safe_float(getattr(cost, "project_management_cost", 0.0)), 2)
    if project_management_input > 0:
        project_management = project_management_input
    elif management_salary_total > 0:
        project_management = round(management_salary_total, 2)
    else:
        project_management = round(salary_total * 0.15, 2)

    effort_subtotal = salary_total + project_management + misc_total

    if risk_contingency_cost <= 0:
        risk_contingency_cost = round(effort_subtotal * 0.10, 2)

    if negotiation_buffer_cost <= 0:
        negotiation_buffer_cost = round(effort_subtotal * 0.05, 2)

    project_total_estimation = round(effort_subtotal + risk_contingency_cost + negotiation_buffer_cost, 2)
    grand_total = round(project_total_estimation + profit_total, 2)
    total_project_hours = round(total_project_hours, 2)

    return {
        "member_breakdown": member_breakdown,
        "development_total": development_total,
        "testing_total": testing_total,
        "deployment_total": deployment_total,
        "salary_total": salary_total,
        "misc_total": misc_total,
        "profit_total": profit_total,
        "project_management": project_management,
        "risk_contingency": risk_contingency_cost,
        "negotiation_buffer": negotiation_buffer_cost,
        "project_total_estimation": project_total_estimation,
        "grand_total": grand_total,
        "total_project_hours": total_project_hours,
    }


def is_testing_role(role_name: str) -> bool:
    role = normalize_role_key(role_name)
    return any(keyword in role for keyword in TESTING_ROLE_KEYWORDS)


def is_deployment_role(role_name: str) -> bool:
    role = normalize_role_key(role_name)
    return any(keyword in role for keyword in DEPLOYMENT_ROLE_KEYWORDS)


def is_dev_role(role_name: str) -> bool:
    role = normalize_role_key(role_name)
    return (
        any(kw in role for kw in ["developer", "engineer", "architect"])
        and "lead" not in role
        and not is_testing_role(role_name)
        and not is_deployment_role(role_name)
    )


def is_management_role(role_name: str) -> bool:
    role = normalize_role_key(role_name)
    keywords = (
        "project manager",
        "program manager",
        "scrum master",
        "business analyst",
        "product manager",
        "pm",
    )
    return any(keyword in role for keyword in keywords)


def determine_project_weeks(cost: Any, fallback_weeks: float = 0.0) -> int:
    inferred_weeks = [
        safe_float(member.hours_per_member) / max(1.0, safe_float(getattr(member, "weekly_hours", 40.0), 40.0))
        for member in getattr(cost, "members", [])
        if safe_float(member.hours_per_member) > 0
    ]
    max_inferred = max(inferred_weeks, default=0.0)
    resolved = fallback_weeks or max_inferred
    return max(1, int(ceil(resolved or 1)))


def build_module_timeline(requirements: Any, total_project_hours: float, total_project_cost: float, total_weeks: int) -> list[dict[str, Any]]:
    base_rows = _build_base_timeline_rows(requirements)
    if not base_rows:
        base_rows = [
            {"label": "Phase 1: Foundation", "weight": 120.0},
            {"label": "Phase 2: Core Features", "weight": 160.0},
            {"label": "Phase 3: Finalization", "weight": 80.0},
        ]

    total_weight = sum(row["weight"] for row in base_rows) or float(len(base_rows))
    allocated_hours: list[int] = []
    allocated_costs: list[float] = []

    for index, row in enumerate(base_rows):
        if index == len(base_rows) - 1:
            hours = int(round(total_project_hours - sum(allocated_hours)))
            cost = round(total_project_cost - sum(allocated_costs), 2)
        else:
            ratio = row["weight"] / total_weight if total_weight > 0 else 1 / len(base_rows)
            hours = int(round(total_project_hours * ratio))
            cost = round(total_project_cost * ratio, 2)
        allocated_hours.append(max(0, hours))
        allocated_costs.append(max(0.0, cost))

    week_columns = max(6, total_weeks)
    start_week = 0
    rows: list[dict[str, Any]] = []
    remaining_weeks = week_columns

    for index, row in enumerate(base_rows):
        remaining_rows = len(base_rows) - index
        if index == len(base_rows) - 1:
            span = max(1, remaining_weeks)
        else:
            ratio = allocated_hours[index] / max(1, sum(allocated_hours))
            proposed = int(round(week_columns * ratio))
            span = max(1, min(remaining_weeks - (remaining_rows - 1), proposed or 1))

        markers = [""] * week_columns
        end_week = min(week_columns, start_week + span)
        for column in range(start_week, end_week):
            markers[column] = "[####]"

        rows.append(
            {
                "label": row["label"],
                "hours": allocated_hours[index],
                "cost": allocated_costs[index],
                "markers": markers,
            }
        )
        start_week = end_week
        remaining_weeks = max(1, week_columns - start_week)

    return rows


def build_synced_team_section(project_name: str, cost: Any, total_project_hours: float, total_weeks: int) -> str:
    lines = [
        "",
        "SYNCHRONIZED DELIVERY SUMMARY:",
        f"- Project: {project_name}",
        f"- Total project hours: {int(round(total_project_hours))}",
        f"- Total working weeks: {total_weeks}",
        "- Role breakdown:",
    ]
    for member in getattr(cost, "members", []):
        role_total_hours = safe_float(member.count) * safe_float(member.hours_per_member)
        lines.append(
            f"- {member.role}: headcount {int(safe_float(member.count))}, "
            f"hours/member {safe_float(member.hours_per_member):.2f}, "
            f"total hours {role_total_hours:.2f}"
        )
    return "\n".join(lines)


def _build_base_timeline_rows(requirements: Any) -> list[dict[str, Any]]:
    delivery_plan = getattr(requirements, "delivery_plan", None)
    feature_estimates = getattr(delivery_plan, "feature_estimates", []) if delivery_plan else []
    module_weights: dict[str, float] = {}
    for estimate in feature_estimates:
        module_name = getattr(estimate, "module_name", None) or "General"
        module_weights.setdefault(module_name, 0.0)
        module_weights[module_name] += sum(safe_float(day.days) * 8 for day in getattr(estimate, "developer_days", []))
        module_weights[module_name] += sum(safe_float(day.days) * 8 for day in getattr(estimate, "tester_days", []))

    if module_weights:
        return [{"label": label, "weight": weight} for label, weight in module_weights.items()]

    modules = getattr(requirements, "modules", []) if requirements else []
    if modules:
        return [{"label": getattr(module, "name", "General"), "weight": 1.0} for module in modules]
    return []


def _find_role_line(lines: list[str], role_name: str) -> str:
    role_tokens = [token for token in re.findall(r"[a-z0-9]+", role_name.lower()) if len(token) > 2]
    if not role_tokens:
        return ""
    for line in lines:
        line_tokens = set(re.findall(r"[a-z0-9]+", line.lower()))
        matches = sum(1 for token in role_tokens if token in line_tokens)
        if matches >= max(1, len(role_tokens) - 1):
            return line
    return ""


def _extract_total_project_hours(text: str) -> float:
    patterns = (
        r"total\s+project\s+hours?\s*[:=-]?\s*(\d+(?:\.\d+)?)",
        r"overall\s+project\s+hours?\s*[:=-]?\s*(\d+(?:\.\d+)?)",
        r"project\s+hours?\s*[:=-]?\s*(\d+(?:\.\d+)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return 0.0


def _extract_total_hours_from_line(text: str) -> float:
    patterns = (
        r"(\d+(?:\.\d+)?)\s*total\s+hours?",
        r"total\s+hours?\s*[:=-]?\s*(\d+(?:\.\d+)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return 0.0


def _extract_default_weekly_hours(text: str) -> float:
    direct = _extract_weekly_hours(text)
    if direct > 0:
        return direct

    day_match = re.search(r"(\d+(?:\.\d+)?)\s*hours?\s*/\s*day", text, flags=re.IGNORECASE)
    week_match = re.search(r"(\d+(?:\.\d+)?)\s*days?\s*/\s*week", text, flags=re.IGNORECASE)
    if day_match and week_match:
        return safe_float(day_match.group(1)) * safe_float(week_match.group(1))
    return 0.0


def _extract_weekly_hours(text: str) -> float:
    patterns = (
        r"(\d+(?:\.\d+)?)\s*hours?\s*(?:/|per)\s*week",
        r"weekly\s*(\d+(?:\.\d+)?)\s*hours?",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return 0.0


def _extract_total_weeks(text: str) -> float:
    patterns = (
        r"(?:overall|estimated|planned|total|full)\s+project\s+duration\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*weeks?",
        r"(?:project|delivery|implementation)\s+duration\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*weeks?",
        r"timeline\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*weeks?",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))

    ranges = re.findall(r"week\s*(\d+)\s*-\s*(\d+)", text, flags=re.IGNORECASE)
    if ranges:
        return float(max(int(end) for _, end in ranges))
    return 0.0


def _extract_line_weeks(text: str) -> float:
    patterns = (
        r"for\s+(\d+(?:\.\d+)?)\s*weeks?",
        r"(\d+(?:\.\d+)?)\s*weeks?\s+duration",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return 0.0
