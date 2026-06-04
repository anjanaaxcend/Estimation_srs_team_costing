from __future__ import annotations

import re


GENERIC_PROJECT_NAMES = {
    "the project",
    "project",
    "project brief",
    "project draft",
    "new ai project",
    "ai project draft",
    "client project",
    "unknown project",
    "uploaded brief",
    "untitled project",
}

_TITLE_SUFFIX_PATTERN = re.compile(
    r"\s*[-|:]\s*(srs\b.*|software requirements specification[s]?|resource plan.*)$",
    re.IGNORECASE,
)
_TITLE_PREFIX_PATTERN = re.compile(
    r"^(document title|project title|project name|title)\s*[:|-]?\s*",
    re.IGNORECASE,
)


def is_generic_project_name(value: str | None) -> bool:
    if not value or not value.strip():
        return True
    cleaned = re.sub(r"[\s_-]+", " ", value).strip().lower()
    return cleaned in GENERIC_PROJECT_NAMES


def clean_project_name(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.strip().strip("|:-").strip()
    cleaned = _TITLE_PREFIX_PATTERN.sub("", cleaned).strip()
    cleaned = _TITLE_SUFFIX_PATTERN.sub("", cleaned).strip(" -|:")
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned[:120].strip()


def infer_project_name(raw_text: str, fallback: str = "Project Brief") -> str:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    candidate_lines = lines[:40]
    lowered_text = raw_text.lower()
    domain_names = [
        (("hospital", "patient", "doctor", "clinic", "medical", "hms"), "Hospital Management System"),
        (("jewel", "gold", "diamond", "ring", "gem", "necklace"), "Jewellery Management System"),
        (("booking", "reservation", "appointment", "schedule"), "Booking Management System"),
        (("crm", "lead", "sales", "customer"), "CRM System"),
        (("ecommerce", "e-commerce", "shop", "cart", "order"), "E-Commerce Platform"),
        (("school", "student", "teacher", "class", "course", "lms"), "Learning Management System"),
    ]

    for line in candidate_lines:
        lowered = line.lower()
        if any(token in lowered for token in ("document title", "project title", "project name")):
            candidate = clean_project_name(line)
            if candidate and not is_generic_project_name(candidate):
                return candidate

        if "software requirements specification" in lowered or re.search(r"\bsrs\b", lowered):
            candidate = clean_project_name(line)
            if candidate and not is_generic_project_name(candidate):
                return candidate

    for line in candidate_lines:
        candidate = clean_project_name(line)
        if (
            candidate
            and len(candidate.split()) <= 10
            and len(candidate) <= 80
            and not is_generic_project_name(candidate)
        ):
            return candidate

    for terms, name in domain_names:
        if any(term in lowered_text for term in terms):
            return name

    return fallback


def resolve_project_name(
    *,
    extracted_name: str | None = None,
    provided_name: str | None = None,
    raw_text: str = "",
    fallback: str = "Project Brief",
) -> str:
    for candidate in (extracted_name, provided_name):
        cleaned = clean_project_name(candidate)
        if cleaned and not is_generic_project_name(cleaned):
            return cleaned

    inferred = infer_project_name(raw_text, fallback=fallback)
    cleaned_inferred = clean_project_name(inferred)
    if cleaned_inferred and not is_generic_project_name(cleaned_inferred):
        return cleaned_inferred

    # If it is STILL generic, use literal domain names rather than invented brands.
    lowered = raw_text.lower()
    if any(term in lowered for term in ["jewel", "gold", "diamond", "ring", "gem", "necklace"]):
        return "Jewellery Management System"
    if any(term in lowered for term in ["hospital", "patient", "doctor", "clinic", "medical", "hms"]):
        return "Hospital Management System"
    if any(term in lowered for term in ["booking", "reservation", "appointment", "schedule"]):
        return "Booking Management System"
    if any(term in lowered for term in ["crm", "lead", "sales", "customer"]):
        return "CRM System"
    if any(term in lowered for term in ["ecommerce", "e-commerce", "shop", "cart", "order"]):
        return "E-Commerce Platform"
    if any(term in lowered for term in ["school", "student", "teacher", "class", "course", "lms"]):
        return "Learning Management System"
    
    return fallback
