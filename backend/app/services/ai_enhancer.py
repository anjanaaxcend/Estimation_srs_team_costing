from __future__ import annotations

import re


class HybridAIEnhancer:
    """
    Lightweight local heuristic enhancer.

    The service keeps the rule-based system deterministic today while exposing
    a single seam where an external LLM can be integrated later.
    """

    def summarize_signals(self, raw_text: str) -> list[str]:
        text = raw_text.lower()
        observations: list[str] = []

        if any(keyword in text for keyword in ("dashboard", "portal", "panel")):
            observations.append("Client input suggests an operations-focused dashboard experience.")
        if any(keyword in text for keyword in ("approval", "workflow", "escalation")):
            observations.append("Business process automation is likely to be a key adoption driver.")
        if any(keyword in text for keyword in ("mobile", "responsive", "tablet")):
            observations.append("Cross-device usability should be treated as a first-class requirement.")
        if any(keyword in text for keyword in ("audit", "compliance", "gdpr", "hipaa", "soc 2")):
            observations.append("Compliance language indicates stronger security and audit expectations.")
        if re.search(r"\bai\b|\bml\b|\bautomation\b", text):
            observations.append("There is an opportunity to position AI as an assistive layer, not just a backend utility.")

        if not observations:
            observations.append("The request is sufficiently broad that discovery assumptions were added to keep delivery moving.")

        return observations

