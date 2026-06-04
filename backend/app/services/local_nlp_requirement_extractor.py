from __future__ import annotations

import json
import pickle
import re
from pathlib import Path
from typing import Any

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.multiclass import OneVsRestClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import MultiLabelBinarizer
except ImportError:  # pragma: no cover - optional until dependencies are installed
    TfidfVectorizer = None
    LogisticRegression = None
    OneVsRestClassifier = None
    Pipeline = None
    MultiLabelBinarizer = None

from app.core.config import settings
from app.schemas.client import ClientInput
from app.schemas.requirements import (
    ConstraintItem,
    FeatureItem,
    NonFunctionalRequirementItem,
    RequirementExtractionResult,
    UserRoleItem,
    DataModelItem,
    BackendJobItem,
)
from app.utils.project_name import resolve_project_name


def _split_sentences(raw_text: str) -> list[str]:
    return [chunk.strip(" -\n\t") for chunk in re.split(r"[\n\r]+|(?<=[.!?])\s+", raw_text) if chunk.strip()]


class LocalNLPRequirementExtractor:
    SENTENCE_TYPES = ("problem", "objective", "solution", "feature", "conclusion")

    def __init__(self) -> None:
        self._artifact_path = settings.nlp_model_artifact_path
        self._artifacts = self._load_artifacts()

    @property
    def enabled(self) -> bool:
        return settings.local_nlp_extraction_enabled and self._artifacts is not None and Pipeline is not None

    def extract(self, payload: ClientInput) -> RequirementExtractionResult:
        if not self.enabled or self._artifacts is None:
            raise RuntimeError("Local NLP extraction model is not available.")

        sentences = _split_sentences(payload.raw_text)
        sentence_models = self._artifacts["sentence_models"]
        problem_statement = self._best_sentence(sentences, sentence_models["problem"])
        objectives = self._top_sentences(sentences, sentence_models["objective"], limit=4)
        solution_sentences = self._top_sentences(sentences, sentence_models["solution"], limit=3)
        feature_sentences = self._top_sentences(sentences, sentence_models["feature"], limit=6)
        conclusion = self._best_sentence(sentences, sentence_models["conclusion"])

        technologies = self._predict_multilabel("technology", payload.raw_text)
        tools = self._predict_multilabel("tool", payload.raw_text)
        roles = self._predict_multilabel("role", payload.raw_text)
        nfrs = self._predict_multilabel("nfr", payload.raw_text)
        data_models = self._predict_multilabel("data_model", payload.raw_text)
        backend_jobs = self._predict_multilabel("backend_job", payload.raw_text)

        features = self._build_features(feature_sentences)
        user_roles = self._build_roles(roles)
        constraints = self._build_constraints(sentences)
        non_functional_requirements = self._build_nfrs(nfrs)
        parsed_data_models = self._build_data_models(data_models)
        parsed_backend_jobs = self._build_backend_jobs(backend_jobs)
        proposed_solution = " ".join(solution_sentences) or self._default_solution(features)

        resolved_project_name = resolve_project_name(
            extracted_name=None,
            provided_name=payload.project_name,
            raw_text=payload.raw_text,
        )

        return RequirementExtractionResult(
            project_name=resolved_project_name,
            normalized_text=payload.raw_text,
            problem_statement=problem_statement or self._fallback_problem_statement(sentences),
            project_objectives=objectives or self._fallback_objectives(features),
            proposed_solution=proposed_solution,
            recommended_technologies=technologies,
            recommended_tools=tools,
            executive_summary=self._build_summary(resolved_project_name, features, problem_statement, proposed_solution),
            features=features,
            user_roles=user_roles,
            data_models=parsed_data_models,
            backend_jobs=parsed_backend_jobs,
            constraints=constraints,
            non_functional_requirements=non_functional_requirements,
            assumptions=self._fallback_assumptions(payload),
            ai_observations=["Local scikit-learn NLP model extracted the requirement structure before GenAI SRS generation."],
            conclusion=conclusion or self._fallback_conclusion(features, technologies),
            confidence_score=0.78,
        )

    def _load_artifacts(self) -> dict[str, Any] | None:
        if not self._artifact_path.exists():
            return None
        try:
            with self._artifact_path.open("rb") as handle:
                return pickle.load(handle)
        except Exception:
            return None

    def _best_sentence(self, sentences: list[str], model: Any) -> str:
        ranked = self._rank_sentences(sentences, model)
        return ranked[0][0] if ranked else ""

    def _top_sentences(self, sentences: list[str], model: Any, limit: int) -> list[str]:
        return [sentence for sentence, _score in self._rank_sentences(sentences, model)[:limit]]

    def _rank_sentences(self, sentences: list[str], model: Any) -> list[tuple[str, float]]:
        ranked: list[tuple[str, float]] = []
        for sentence in sentences:
            score = self._positive_score(model, sentence)
            if score >= 0.35:
                ranked.append((sentence, score))
        return sorted(ranked, key=lambda item: item[1], reverse=True)

    def _positive_score(self, model: Any, text: str) -> float:
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba([text])[0]
            return float(probabilities[1]) if len(probabilities) > 1 else float(probabilities[0])
        if hasattr(model, "decision_function"):
            score = float(model.decision_function([text])[0])
            return max(0.0, min(1.0, (score + 2.0) / 4.0))
        return 0.0

    def _predict_multilabel(self, classifier_key: str, text: str) -> list[str]:
        bundle = self._artifacts["multi_label_models"][classifier_key]
        classifier = bundle["classifier"]
        labels: list[str] = bundle["labels"]
        thresholds: dict[str, float] = bundle.get("thresholds", {})
        probabilities = classifier.predict_proba([text])[0]
        matches = [
            label
            for label, probability in zip(labels, probabilities)
            if float(probability) >= float(thresholds.get(label, 0.4))
        ]
        if matches:
            return matches
        ranked = sorted(zip(labels, probabilities), key=lambda item: item[1], reverse=True)
        return [label for label, probability in ranked[:2] if float(probability) >= 0.2]

    def _build_features(self, feature_sentences: list[str]) -> list[FeatureItem]:
        items: list[FeatureItem] = []
        for index, sentence in enumerate(feature_sentences, start=1):
            title = sentence.split(",")[0].split(".")[0].strip().title()[:70] or f"Feature {index}"
            items.append(
                FeatureItem(
                    name=title,
                    description=sentence,
                    priority="high" if index <= 2 else "medium",
                    complexity="medium",
                    acceptance_criteria=[sentence.rstrip(".") + "."],
                )
            )
        return items[:6]

    def _build_roles(self, labels: list[str]) -> list[UserRoleItem]:
        catalog = self._artifacts["metadata"]["role_catalog"]
        roles: list[UserRoleItem] = []
        for label in labels:
            entry = catalog.get(label)
            if entry:
                roles.append(UserRoleItem(name=label, responsibilities=entry["responsibilities"]))
        if not roles:
            roles = [
                UserRoleItem(name="Administrator", responsibilities=["Review extracted requirements", "Approve the generated SRS"]),
                UserRoleItem(name="Business Stakeholder", responsibilities=["Provide the problem brief", "Validate project objectives"]),
            ]
        return roles

    def _build_constraints(self, sentences: list[str]) -> list[ConstraintItem]:
        items: list[ConstraintItem] = []
        for sentence in sentences:
            lowered = sentence.lower()
            if any(keyword in lowered for keyword in ("must", "should", "required", "deadline", "budget")):
                items.append(ConstraintItem(category="Business", description=sentence))
            if any(keyword in lowered for keyword in ("integrate", "api", "erp", "crm")):
                items.append(ConstraintItem(category="Integration", description=sentence))
        return items[:6]

    def _build_nfrs(self, labels: list[str]) -> list[NonFunctionalRequirementItem]:
        catalog = self._artifacts["metadata"]["nfr_catalog"]
        items: list[NonFunctionalRequirementItem] = []
        for label in labels:
            entry = catalog.get(label)
            if entry:
                items.append(
                    NonFunctionalRequirementItem(
                        category=label,
                        description=entry["description"],
                        measurable_target=entry["target"],
                    )
                )
        if not items:
            items = [
                NonFunctionalRequirementItem(
                    category="Performance",
                    description="The generated platform should remain responsive during normal usage.",
                    measurable_target="Primary actions complete within 2 seconds",
                )
            ]
        return items

    def _build_data_models(self, labels: list[str]) -> list[DataModelItem]:
        catalog = self._artifacts["metadata"]["data_model_catalog"]
        items: list[DataModelItem] = []
        for label in labels:
            entry = catalog.get(label)
            if entry:
                items.append(DataModelItem(name=label, description=entry["description"], attributes=entry["attributes"]))
        return items

    def _build_backend_jobs(self, labels: list[str]) -> list[BackendJobItem]:
        catalog = self._artifacts["metadata"]["backend_job_catalog"]
        items: list[BackendJobItem] = []
        for label in labels:
            entry = catalog.get(label)
            if entry:
                items.append(BackendJobItem(name=label, trigger_type=entry["trigger_type"], description=entry["description"]))
        return items

    def _fallback_problem_statement(self, sentences: list[str]) -> str:
        return " ".join(sentences[:2]) if sentences else "The client brief did not provide enough information for a stronger problem statement."

    def _fallback_objectives(self, features: list[FeatureItem]) -> list[str]:
        if features:
            return [f"Deliver {feature.name.lower()} in the initial solution scope." for feature in features[:3]]
        return ["Clarify the uploaded business problem and convert it into a structured SRS."]

    def _default_solution(self, features: list[FeatureItem]) -> str:
        feature_names = ", ".join(feature.name for feature in features[:3]) or "the extracted scope"
        return (
            "The company should deliver a structured digital solution that transforms the uploaded client brief into "
            f"a build-ready platform centered on {feature_names}, supported by document processing and SRS export."
        )

    def _build_summary(self, project_name: str, features: list[FeatureItem], problem_statement: str, proposed_solution: str) -> str:
        feature_names = ", ".join(feature.name for feature in features[:3]) or "the extracted requirements"
        return (
            f"{project_name} requires a structured response to the client problem. "
            f"The local scikit-learn NLP model identified the main scope around {feature_names}. "
            f"Problem context: {problem_statement or 'See normalized problem statement.'} "
            f"Recommended solution: {proposed_solution}"
        )

    def _fallback_assumptions(self, payload: ClientInput) -> list[str]:
        assumptions = [
            "The uploaded document contains the source of truth for the initial problem statement.",
            "The extracted requirement model will be reviewed before implementation starts.",
        ]
        if not payload.integrations:
            assumptions.append("External integrations are assumed to be limited unless they are explicitly described in the brief.")
        return assumptions

    def _fallback_conclusion(self, features: list[FeatureItem], technologies: list[str]) -> str:
        feature_names = ", ".join(feature.name for feature in features[:3]) or "the extracted scope"
        technology_names = ", ".join(technologies[:3]) or "the recommended stack"
        return (
            f"The local scikit-learn NLP extraction indicates that the project should move forward with {feature_names}, "
            f"using {technology_names} as the implementation direction before detailed development planning begins."
        )


def _build_binary_sentence_model(positive_examples: list[str], negative_examples: list[str]) -> Any:
    if Pipeline is None or TfidfVectorizer is None or LogisticRegression is None:
        raise RuntimeError("scikit-learn is not installed.")
    texts = positive_examples + negative_examples
    labels = [1] * len(positive_examples) + [0] * len(negative_examples)
    model = Pipeline(
        [
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), lowercase=True)),
            ("clf", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
        ]
    )
    model.fit(texts, labels)
    return model


def _build_multilabel_classifier(samples: list[dict[str, Any]], label_set: list[str]) -> tuple[Any, list[str]]:
    if TfidfVectorizer is None or LogisticRegression is None or OneVsRestClassifier is None or MultiLabelBinarizer is None:
        raise RuntimeError("scikit-learn is not installed.")
    texts = [sample["text"] for sample in samples]
    labels = [sample["labels"] for sample in samples]
    mlb = MultiLabelBinarizer(classes=label_set)
    y = mlb.fit_transform(labels)
    classifier = Pipeline(
        [
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), lowercase=True)),
            ("clf", OneVsRestClassifier(LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42))),
        ]
    )
    classifier.fit(texts, y)
    return classifier, list(mlb.classes_)


def train_local_nlp_model(training_data_path: Path, output_path: Path) -> None:
    raw_data = json.loads(training_data_path.read_text(encoding="utf-8"))

    problem_examples = raw_data.get("problem_examples", [])
    objective_examples = raw_data.get("objective_examples", [])
    solution_examples = raw_data.get("solution_examples", [])
    technology_examples = raw_data.get("technology_examples", [])
    feature_examples = raw_data.get("feature_examples", [])
    conclusion_examples = raw_data.get("conclusion_examples", [])

    sentence_groups = {
        "problem": problem_examples,
        "objective": objective_examples,
        "solution": solution_examples,
        "feature": feature_examples,
        "conclusion": conclusion_examples,
    }

    sentence_models: dict[str, Any] = {}
    for group_name, positive_examples in sentence_groups.items():
        negative_examples = [
            example
            for other_name, examples in sentence_groups.items()
            if other_name != group_name
            for example in examples
        ] or ["This sentence does not belong to the target class."]
        sentence_models[group_name] = _build_binary_sentence_model(positive_examples, negative_examples)

    technology_catalog = raw_data.get("technology_catalog", [])
    tool_catalog = raw_data.get("tool_catalog", [])
    role_catalog = raw_data.get("role_catalog", [])
    nfr_catalog = raw_data.get("nfr_catalog", [])
    data_model_catalog = raw_data.get("data_model_catalog", [])
    backend_job_catalog = raw_data.get("backend_job_catalog", [])

    technology_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in technology_catalog
    ] + [{"text": text, "labels": [technology_catalog[0]["label"], technology_catalog[3]["label"]]} for text in technology_examples[:1]]

    tool_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in tool_catalog
    ] + [{"text": "openai llm ai content generation", "labels": ["OpenAI Responses API"]}]

    role_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in role_catalog
    ] + [{"text": "admin manager business client approval review", "labels": ["Administrator", "Business Stakeholder"]}]

    nfr_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in nfr_catalog
    ] + [{"text": "secure responsive tracking compliance", "labels": ["Security", "Performance", "Auditability"]}]

    data_model_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in data_model_catalog
    ] + [{"text": "database customer info data store mapping properties fields attributes", "labels": ["Client Profile", "Document / File"]}]

    backend_job_samples = [
        {"text": " ".join(entry["keywords"]), "labels": [entry["label"]]}
        for entry in backend_job_catalog
    ] + [{"text": "nightly worker batch sync daily scheduled monthly report export background", "labels": ["Daily Reminder", "Report Generation"]}]

    technology_classifier, technology_labels = _build_multilabel_classifier(
        technology_samples,
        [entry["label"] for entry in technology_catalog],
    )
    tool_classifier, tool_labels = _build_multilabel_classifier(
        tool_samples,
        [entry["label"] for entry in tool_catalog],
    )
    role_classifier, role_labels = _build_multilabel_classifier(
        role_samples,
        [entry["label"] for entry in role_catalog],
    )
    nfr_classifier, nfr_labels = _build_multilabel_classifier(
        nfr_samples,
        [entry["label"] for entry in nfr_catalog],
    )
    data_model_classifier, data_model_labels = _build_multilabel_classifier(
        data_model_samples,
        [entry["label"] for entry in data_model_catalog],
    )
    backend_job_classifier, backend_job_labels = _build_multilabel_classifier(
        backend_job_samples,
        [entry["label"] for entry in backend_job_catalog],
    )

    artifacts = {
        "sentence_models": sentence_models,
        "multi_label_models": {
            "technology": {
                "classifier": technology_classifier,
                "labels": technology_labels,
                "thresholds": {label: 0.35 for label in technology_labels},
            },
            "tool": {
                "classifier": tool_classifier,
                "labels": tool_labels,
                "thresholds": {label: 0.35 for label in tool_labels},
            },
            "role": {
                "classifier": role_classifier,
                "labels": role_labels,
                "thresholds": {label: 0.35 for label in role_labels},
            },
            "nfr": {
                "classifier": nfr_classifier,
                "labels": nfr_labels,
                "thresholds": {label: 0.35 for label in nfr_labels},
            },
            "data_model": {
                "classifier": data_model_classifier,
                "labels": data_model_labels,
                "thresholds": {label: 0.35 for label in data_model_labels},
            },
            "backend_job": {
                "classifier": backend_job_classifier,
                "labels": backend_job_labels,
                "thresholds": {label: 0.35 for label in backend_job_labels},
            },
        },
        "metadata": {
            "role_catalog": {
                entry["label"]: {"responsibilities": entry.get("responsibilities", [])}
                for entry in role_catalog
            },
            "nfr_catalog": {
                entry["label"]: {
                    "description": entry["description"],
                    "target": entry["target"],
                }
                for entry in nfr_catalog
            },
            "data_model_catalog": {
                entry["label"]: {
                    "description": entry["description"],
                    "attributes": entry.get("attributes", []),
                }
                for entry in data_model_catalog
            },
            "backend_job_catalog": {
                entry["label"]: {
                    "description": entry["description"],
                    "trigger_type": entry.get("trigger_type", "Scheduled Job"),
                }
                for entry in backend_job_catalog
            },
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        pickle.dump(artifacts, handle)
