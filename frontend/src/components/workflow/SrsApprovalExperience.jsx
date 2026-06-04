"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileSpreadsheet,
  Globe,
  Layers3,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
  Loader2,
} from "lucide-react";

import { PageIntro } from "@/components/workflow/PageIntro";
import { useWorkflow } from "@/context/WorkflowContext";
import { useAuth } from "@/context/AuthContext";
import { regenerateSrs, saveFeedback } from "@/lib/platformApi";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { HorizontalMarquee } from "@/components/ui/HorizontalMarquee";

const MODULE_SECTION_HINTS = ["project modules", "modules and features", "module"];
const UI_SECTION_HINTS = ["ui pages", "screen design", "user interface", "ui page"];

const findUiPagesSectionIdx = (sections = []) =>
  sections.findIndex((section) => {
    const title = section.title?.toLowerCase() || "";
    return UI_SECTION_HINTS.some((hint) => title.includes(hint));
  });

const buildUiPagesSectionBody = (uiPages = []) =>
  uiPages
    .map((page) => {
      const mod = page.primary_module ? ` (${page.primary_module})` : "";
      const desc = page.description ? `: ${page.description}` : "";
      return `\u2022 ${page.name}${mod}${desc}`;
    })
    .join("\n");

const normalizeName = (value = "") =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (value = "") =>
  value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 && ["and", "or", "the", "for", "of"].includes(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");

const cleanModuleHeading = (value = "") =>
  titleCase(
    value
      .replace(/^\s*(?:module\s*)?(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[\).\:-]\s*/i, "")
      .replace(/\bmodule\b/gi, "")
      .replace(/[:\-]\s*$/, "")
      .trim(),
  );

const looksLikeModuleHeading = (line = "") => {
  const cleaned = line.trim();
  if (!cleaned || cleaned.length > 90) return null;

  const match =
    cleaned.match(/^MODULE\s*[:\-]\s*(.+)$/i) ||
    cleaned.match(/^(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[\).\:-]\s*(?:module\s*[:\-]\s*)?(.+)$/i) ||
    cleaned.match(/^([A-Z][A-Z0-9 &/()'\-]{2,})\s*:\s*$/) ||
    cleaned.match(/^([A-Z][a-zA-Z0-9 &/()'\-]{2,})\s*:\s*$/);

  if (!match?.[1]) return null;
  const candidate = cleanModuleHeading(match[1]);
  if (/\b(consists of|following modules|includes the following|functional requirements by)\b/i.test(candidate)) {
    return null;
  }
  if (!candidate || /^(description|acceptance criteria|priority|complexity|features?|screen|page)$/i.test(candidate)) {
    return null;
  }
  return candidate;
};

const extractPreviewModules = (sections = []) => {
  const moduleSection = sections.find((section) => {
    const title = section.title?.toLowerCase() || "";
    return MODULE_SECTION_HINTS.some((hint) => title.includes(hint));
  });
  if (!moduleSection?.body) return [];

  const lines = moduleSection.body.split(/\r?\n/);
  const modules = [];
  let current = null;

  const commit = () => {
    if (current?.name) {
      modules.push({
        ...current,
        feature_names: Array.from(new Set(current.feature_names || [])),
      });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/\b(consists of|following modules|includes the following|functional requirements by)\b/i.test(line)) {
      continue;
    }

    const colonModuleMatch = line.match(/^([^:]{2,70}):\s+(.+)$/);
    if (colonModuleMatch && /\bmodule\b/i.test(colonModuleMatch[2])) {
      commit();
      current = {
        name: cleanModuleHeading(colonModuleMatch[1]),
        summary: colonModuleMatch[2].trim(),
        feature_names: [],
      };
      continue;
    }

    const headingName = looksLikeModuleHeading(line);

    if (headingName) {
      commit();
      current = {
        name: headingName,
        summary: "",
        feature_names: [],
      };
      continue;
    }

    if (!current) continue;

    const broadBulletMatch = line.match(/^(?:[-•*]|\d+[\).])\s*([^:|]+)(?:[:|]\s*(.*))?$/);
    if (broadBulletMatch) {
      const featureName = broadBulletMatch[1].trim();
      if (featureName && !/^(the|this|description|acceptance criteria|priority|complexity)\s/i.test(featureName)) {
        current.feature_names.push(titleCase(featureName));
      }
      continue;
    }

    const bulletMatch = line.match(/^[-•]\s*([^:]+):?\s*(.*)$/);
    if (bulletMatch) {
      const featureName = bulletMatch[1].trim();
      if (featureName && !/^(the|this)\s/i.test(featureName)) {
        current.feature_names.push(featureName);
      }
      continue;
    }

    if (!current.summary) {
      current.summary = line;
    }
  }
  commit();

  return modules;
};

const reconcileModulesWithPreview = ({ structuredModules = [], previewModules = [] }) => {
  if (!previewModules.length) return structuredModules;

  const structuredByKey = new Map(
    structuredModules.map((module) => [normalizeName(module.name), module]),
  );

  return previewModules.map((previewModule) => {
    const key = normalizeName(previewModule.name);
    const structured = structuredByKey.get(key);
    return {
      ...(structured || {}),
      name: structured?.name || previewModule.name,
      summary: previewModule.summary || structured?.summary || "",
      feature_names: previewModule.feature_names?.length
        ? previewModule.feature_names
        : structured?.feature_names || [],
    };
  });
};

const extractPreviewUiPages = (sections = []) => {
  const uiSection = sections.find((section) => {
    const title = section.title?.toLowerCase() || "";
    return UI_SECTION_HINTS.some((hint) => title.includes(hint));
  });
  if (!uiSection?.body) return [];

  const lines = uiSection.body.split(/\r?\n/);
  const pages = [];
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    const bulletMatch = line.match(/^[\-•\*]\s*(.+)$/);
    if (bulletMatch) {
      const pageLine = bulletMatch[1].trim();
      if (pageLine) {
        const modMatch = pageLine.match(/^([^(:\n]+)(?:\s*\(([^)]+)\))?(?:\s*:\s*(.*))?$/);
        if (modMatch) {
          pages.push({
            name: titleCase(modMatch[1].trim()),
            primary_module: modMatch[2] ? titleCase(modMatch[2].trim()) : "",
            description: modMatch[3] ? modMatch[3].trim() : "",
          });
        } else {
          pages.push({
            name: titleCase(pageLine),
            primary_module: "",
            description: "",
          });
        }
      }
    }
  }
  return pages;
};

const reconcileUiPagesWithPreview = ({ structuredUiPages = [], previewUiPages = [] }) => {
  if (!previewUiPages.length) return structuredUiPages;

  const structuredByKey = new Map(
    structuredUiPages.map((page) => [normalizeName(page.name), page]),
  );

  return previewUiPages.map((previewPage) => {
    const key = normalizeName(previewPage.name);
    const structured = structuredByKey.get(key);
    return {
      ...(structured || {}),
      name: structured?.name || previewPage.name,
      primary_module: previewPage.primary_module || structured?.primary_module || "",
      description: previewPage.description || structured?.description || "",
    };
  });
};

const buildApprovedFeatures = ({ modules = [], structuredFeatures = [] }) => {
  const structuredByKey = new Map(
    structuredFeatures.map((feature) => [normalizeName(feature.name), feature]),
  );
  const approved = [];
  const seen = new Set();

  modules.forEach((module) => {
    (module.feature_names ?? []).forEach((featureName) => {
      const key = normalizeName(featureName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const existing = structuredByKey.get(key);
      approved.push(
        existing || {
          name: featureName,
          description: `Supports the ${module.name} module.`,
          priority: "medium",
          complexity: "medium",
          acceptance_criteria: [],
        },
      );
    });
  });

  return approved;
};

const buildApprovedUiPages = ({ modules = [], structuredUiPages = [], previewUiPages = [] }) => {
  const moduleKeys = new Set(modules.map((module) => normalizeName(module.name)));
  const candidates = [...structuredUiPages, ...previewUiPages];
  const approved = [];
  const seen = new Set();

  candidates.forEach((page) => {
    const pageKey = normalizeName(page.name);
    const moduleKey = normalizeName(page.primary_module);
    if (!pageKey || seen.has(pageKey)) return;
    if (moduleKey && !moduleKeys.has(moduleKey)) return;
    seen.add(pageKey);
    approved.push(page);
  });

  if (approved.length) return approved;

  return modules.map((module) => ({
    name: `${module.name} Workspace`,
    description: `Primary screen for ${module.name} workflows.`,
    primary_module: module.name,
  }));
};

const PRIORITY_STYLES = {
  high: {
    card: "border-parcelles-dark bg-parcelles-dark text-parcelles-bg",
    badge: "bg-red-500 text-white",
    text: "text-parcelles-bg",
    subtext: "text-parcelles-bg/80",
  },
  medium: {
    card: "border-parcelles-dark bg-parcelles-bg",
    badge: "bg-parcelles-sage text-parcelles-dark",
    text: "text-parcelles-dark",
    subtext: "text-parcelles-dark/80",
  },
  low: {
    card: "border-parcelles-dark bg-parcelles-sage/30",
    badge: "bg-transparent border border-parcelles-dark text-parcelles-dark",
    text: "text-parcelles-dark/80",
    subtext: "text-parcelles-dark/60",
  },
};

export function SrsApprovalExperience() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const { srsData, rawInput, cleanedInput, projectTitle, setProjectTitle, updateSrsData, undoChange, canUndo, selectedEngine } = useWorkflow();

  const requirements = srsData?.structuredRequirements ?? {};
  const sections = srsData?.sections ?? [];
  const previewModules = useMemo(() => extractPreviewModules(sections), [sections]);
  const reconciledRequirementModules = useMemo(
    () => reconcileModulesWithPreview({
      structuredModules: requirements.modules ?? [],
      previewModules,
    }),
    [previewModules, requirements.modules],
  );
  const [modules, setModules] = useState(reconciledRequirementModules);

  useEffect(() => {
    setModules(reconciledRequirementModules);
  }, [reconciledRequirementModules]);

  const [editingIdx, setEditingIdx] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [preEditExpandedIdx, setPreEditExpandedIdx] = useState(null);
  const [expandedScreens, setExpandedScreens] = useState({});
  const [isExperienceMapExpanded, setIsExperienceMapExpanded] = useState(false);
  const [isScopeExpanded, setIsScopeExpanded] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [regenAttempt, setRegenAttempt] = useState(1);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [tempProjectName, setTempProjectName] = useState("");

  const previewUiPages = useMemo(() => extractPreviewUiPages(sections), [sections]);
  const reconciledRequirementUiPages = useMemo(
    () => reconcileUiPagesWithPreview({
      structuredUiPages: requirements.ui_pages ?? [],
      previewUiPages,
    }),
    [previewUiPages, requirements.ui_pages],
  );
  const uiPages = reconciledRequirementUiPages;
  const features = requirements.features ?? [];
  const featureLookup = useMemo(
    () => Object.fromEntries(features.map((feature) => [feature.name, feature])),
    [features],
  );

  // Keep SRS Preview's UI pages section body in sync with structured ui_pages
  const syncedSections = useMemo(() => {
    if (!sections.length || !uiPages.length) return sections;
    const idx = findUiPagesSectionIdx(sections);
    if (idx === -1) return sections;
    const updated = [...sections];
    updated[idx] = { ...updated[idx], body: buildUiPagesSectionBody(uiPages) };
    return updated;
  }, [sections, uiPages]);
  const projectName = requirements.project_name || projectTitle || srsData?.title || "Project Brief";

  useEffect(() => {
    setTempProjectName(projectName);
  }, [projectName]);

  const saveProjectNameEdit = () => {
    if (!tempProjectName.trim()) return;
    setProjectTitle(tempProjectName);

    const nextRequirements = {
      ...requirements,
      project_name: tempProjectName,
    };

    let updatedSections = [...sections];
    if (projectName && projectName !== tempProjectName) {
      updatedSections = updatedSections.map((sec) => {
        let body = sec.body || "";
        body = body.replaceAll(projectName, tempProjectName);
        return { ...sec, body };
      });
    }

    updateSrsData({
      ...srsData,
      title: `${tempProjectName} - SRS Software Requirements Specifications`,
      sections: updatedSections,
      structuredRequirements: nextRequirements,
    });

    setIsEditingProjectName(false);
  };


  const summaryStats = [
    { label: "Modules", value: modules.length },
    { label: "Features", value: features.length },
    { label: "UI Pages", value: uiPages.length },
  ];

  const startEdit = (index) => {
    setPreEditExpandedIdx(expandedIdx);
    setEditingIdx(index);
    setEditDraft({
      ...modules[index],
      feature_names: [...(modules[index]?.feature_names ?? [])],
    });
    setExpandedIdx(index);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditDraft(null);
    setExpandedIdx(preEditExpandedIdx);
    setPreEditExpandedIdx(null);
  };

  const saveEdit = (index) => {
    const oldModule = modules[index];
    const newModule = editDraft;

    const oldModuleName = oldModule.name;
    const newModuleName = newModule.name;

    // 1. Prepare updated modules list
    const updatedModules = [...modules];
    updatedModules[index] = newModule;

    // 2. Prepare updated UI Pages
    let updatedUiPages = [...(requirements.ui_pages ?? [])];
    if (normalizeName(oldModuleName) !== normalizeName(newModuleName)) {
      updatedUiPages = updatedUiPages.map((page) => {
        if (normalizeName(page.primary_module) === normalizeName(oldModuleName)) {
          return { ...page, primary_module: newModuleName };
        }
        return page;
      });
    }

    // 3. Sync Features
    let updatedFeatures = [...(requirements.features ?? [])];
    
    // Check for renamed features by comparing arrays element-by-element
    const oldFeaturesList = oldModule.feature_names ?? [];
    const newFeaturesList = newModule.feature_names ?? [];
    
    const renamedMap = new Map(); // oldName -> newName
    
    oldFeaturesList.forEach((oldFeatureName, idx) => {
      const newFeatureName = newFeaturesList[idx];
      if (newFeatureName && oldFeatureName !== newFeatureName) {
        renamedMap.set(oldFeatureName, newFeatureName);
        
        // Update feature name in flat list
        updatedFeatures = updatedFeatures.map((f) => {
          if (f.name === oldFeatureName) {
            return { ...f, name: newFeatureName };
          }
          return f;
        });
      }
    });

    // Add any completely new features that aren't in the flat features list yet
    newFeaturesList.forEach((featureName) => {
      const exists = updatedFeatures.some((f) => f.name === featureName);
      if (!exists) {
        updatedFeatures.push({
          name: featureName,
          description: `Feature supporting the ${newModuleName} module.`,
          priority: "medium",
          complexity: "medium",
          acceptance_criteria: []
        });
      }
    });

    // Filter features list to only keep those referenced in modules
    const allReferencedFeatures = new Set(
      updatedModules.flatMap((m) => m.feature_names ?? [])
    );
    updatedFeatures = updatedFeatures.filter((f) => allReferencedFeatures.has(f.name));

    // Filter UI pages to only keep those referenced in modules
    const allModuleNamesNormalized = new Set(
      updatedModules.map((m) => normalizeName(m.name))
    );
    updatedUiPages = updatedUiPages.filter((page) =>
      allModuleNamesNormalized.has(normalizeName(page.primary_module))
    );

    // 4. Update the sections text to reflect name changes
    let updatedSections = [...sections];
    
    // Rename module in section body text
    if (normalizeName(oldModuleName) !== normalizeName(newModuleName)) {
      updatedSections = updatedSections.map((sec) => {
        let body = sec.body || "";
        body = body.replaceAll(oldModuleName, newModuleName);
        return { ...sec, body };
      });
    }
    
    // Rename features in section body text
    renamedMap.forEach((newFeatureName, oldFeatureName) => {
      updatedSections = updatedSections.map((sec) => {
        let body = sec.body || "";
        body = body.replaceAll(oldFeatureName, newFeatureName);
        return { ...sec, body };
      });
    });

    // Always rebuild the UI pages section body from structured data so it
    // stays in sync with the Experience Map panel
    const uiSectionIdx = findUiPagesSectionIdx(updatedSections);
    if (uiSectionIdx !== -1) {
      updatedSections = [...updatedSections];
      updatedSections[uiSectionIdx] = {
        ...updatedSections[uiSectionIdx],
        body: buildUiPagesSectionBody(updatedUiPages),
      };
    }

    // 5. Update SRS Data in the context
    const nextRequirements = {
      ...requirements,
      modules: updatedModules,
      features: updatedFeatures,
      ui_pages: updatedUiPages,
    };

    updateSrsData({
      ...srsData,
      sections: updatedSections,
      structuredRequirements: nextRequirements,
    });

    setModules(updatedModules);
    setEditingIdx(null);
    setEditDraft(null);
    setPreEditExpandedIdx(null);
  };

  const handleRegenerate = async () => {
    const fallbackText = sections.length > 0 ? sections.map((s) => `${s.title}\n${s.body}`).join("\n\n") : "";
    const sourceText = (rawInput || cleanedInput || srsData?.cleanedText || fallbackText).trim();
    if (!sourceText) {
      setRegenError("Original project brief not found in this session. Please go back to Intake and generate the SRS again.");
      return;
    }

    setIsRegenerating(true);
    setRegenError("");

    try {
      const currentRequirements = {
        ...requirements,
        modules,
        features: (requirements.features ?? []).filter((feature) =>
          modules.some((module) => (module.feature_names ?? []).includes(feature.name)),
        ),
        ui_pages: (requirements.ui_pages ?? []).filter((page) =>
          modules.some((module) => normalizeName(module.name) === normalizeName(page.primary_module)),
        ),
      };

      const result = await regenerateSrs({
        rawText: sourceText,
        projectTitle,
        userFeedback: feedback || "",
        feedbackHistory,
        attempt: regenAttempt,
        previousOutput: sections,
        selectedEngine,
        priorRequirements: currentRequirements,
      });

      updateSrsData(result.srs);
      if (result.srs?.structuredRequirements?.project_name) {
        setProjectTitle(result.srs.structuredRequirements.project_name);
      }
      const nextPreviewModules = extractPreviewModules(result.srs?.sections ?? []);
      setModules(
        reconcileModulesWithPreview({
          structuredModules: result.srs?.structuredRequirements?.modules ?? [],
          previewModules: nextPreviewModules,
        }),
      );
      setRegenAttempt((current) => current + 1);
      if (feedback.trim()) {
        setFeedbackHistory((current) => [...current, feedback.trim()]);
      }
      setShowRegenModal(false);
      setFeedback("");
    } catch (error) {
      setRegenError(error.message || "Regeneration failed. Please try again.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApprove = async () => {
    const approvedFeatures = buildApprovedFeatures({
      modules,
      structuredFeatures: requirements.features ?? [],
    });
    const approvedUiPages = buildApprovedUiPages({
      modules,
      structuredUiPages: requirements.ui_pages ?? [],
      previewUiPages,
    });
    const nextRequirements = {
      ...requirements,
      project_name: projectName,
      modules,
      features: approvedFeatures,
      ui_pages: approvedUiPages,
    };

    const nextSrsData = {
      ...srsData,
      title: `${projectName} - SRS Software Requirements Specifications`,
      structuredRequirements: nextRequirements,
    };

    setIsApproving(true);
    updateSrsData(nextSrsData);

    try {
      await saveFeedback({
        rawInput: rawInput || "",
        extracted: nextSrsData,
        userFeedback: "",
      });
      await refreshUser();
    } catch {
      // Best effort analytics only.
    } finally {
      setIsApproving(false);
      router.push("/download");
    }
  };

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", paddingTop: "4.5rem", paddingBottom: "3rem", paddingLeft: "clamp(1.5rem, 5vw, 5rem)", paddingRight: "clamp(1.5rem, 5vw, 5rem)" }}>
      {showRegenModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,28,22,0.85)", backdropFilter: "blur(8px)", padding: "1rem" }}>
          <div style={{ width: "100%", maxWidth: "640px", background: "#EBEBEB", border: "1px solid #0A1C16", padding: "2.5rem", clipPath: "polygon(0 0, 100% 0, 100% 100%, 28px 100%, 0 calc(100% - 28px))" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "1px solid #0A1C16" }}>
              <div>
                <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.5)", marginBottom: "0.75rem" }}>Regenerate SRS</p>
                <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "2rem", letterSpacing: "-0.02em", color: "#0A1C16", lineHeight: 1.1 }}>
                  Tell ScopeSense{" "}
                  <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, opacity: 0.6 }}>what to improve</em>
                </h2>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.9rem", color: "rgba(10,28,22,0.6)", marginTop: "0.75rem", lineHeight: 1.65, fontWeight: 300 }}>
                  Use this when the extraction missed, added, or misunderstood a module, page, or key requirement.
                </p>
              </div>
              <button onClick={() => setShowRegenModal(false)} style={{ padding: "0.5rem", border: "1px solid rgba(10,28,22,0.3)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}>
                <X size={20} />
              </button>
            </div>

            {regenError && (
              <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", color: "#991b1b", fontFamily: "var(--font-sans)", fontSize: "0.9rem" }}>
                {regenError}
              </div>
            )}

            <textarea
              autoFocus
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={5}
              placeholder="Optional: Add invoice workflow, mention admin dashboard, make QA requirements more explicit…"
              style={{ width: "100%", padding: "1.25rem", border: "1px solid rgba(10,28,22,0.4)", background: "transparent", outline: "none", fontFamily: "var(--font-sans)", fontSize: "1rem", lineHeight: 1.7, resize: "none", color: "#0A1C16", fontWeight: 300 }}
            />
            <p style={{ marginTop: "0.75rem", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "0.8rem", color: "rgba(10,28,22,0.45)" }}>
              Leave empty to let the AI enrich the extraction automatically.
            </p>

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(10,28,22,0.15)" }}>
              <button onClick={handleRegenerate} disabled={isRegenerating} style={{ flex: 1, padding: "1rem 1.5rem", background: "#0A1C16", color: "#EBEBEB", fontFamily: "var(--font-display)", fontSize: "0.9rem", letterSpacing: "0.1em", textTransform: "uppercase", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", opacity: isRegenerating ? 0.6 : 1, clipPath: "polygon(0 0, 100% 0, 100% 100%, 18px 100%, 0 calc(100% - 18px))" }}>
                {isRegenerating ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                {isRegenerating ? "Regenerating…" : "Regenerate SRS"}
              </button>
              <button onClick={() => setShowRegenModal(false)} style={{ padding: "1rem 1.5rem", border: "1px solid rgba(10,28,22,0.35)", background: "transparent", fontFamily: "var(--font-display)", fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A1C16" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%" }}>
        <PageIntro
          eyebrow="Phase 02 — SRS Approval"
          title="Approve the generated"
          titleItalic="blueprint."
          copy="Review extracted modules and the SRS side-by-side. Regenerate when scope needs correction, or approve to send the blueprint to deliverables."
        />

        <div className="flex flex-col xl:flex-row gap-6 items-start">

          {/* Main Content - Module Workbench */}
          <main style={{ flex: 2, minWidth: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>

            <ScrollReveal variant="slide-up" delay={0}>
              <header style={{ borderBottom: "1px solid #0A1C16", paddingBottom: "1rem" }}>
                <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.45)", marginBottom: "1rem" }}>Blueprint Approval</p>
                {isEditingProjectName ? (
                  <div className="flex items-center gap-4 mb-4">
                    <input
                      value={tempProjectName}
                      onChange={(event) => setTempProjectName(event.target.value)}
                      className="flex-1 text-3xl sm:text-4xl font-display bg-transparent border-b border-[#0A1C16] outline-none pb-2"
                      style={{ color: "#0A1C16" }}
                      autoFocus
                    />
                    <button
                      onClick={saveProjectNameEdit}
                      className="p-3 bg-parcelles-dark text-parcelles-bg hover:opacity-90 transition-opacity"
                      style={{ background: "#0A1C16", color: "#EBEBEB" }}
                    >
                      <Save size={20} />
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingProjectName(false);
                        setTempProjectName(projectName);
                      }}
                      className="p-3 border border-[#0A1C16] hover:bg-[#0A1C16]/5 transition-colors"
                      style={{ color: "#0A1C16" }}
                    >
                      <X size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 mb-4 group">
                    <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(2rem, 4vw, 3.5rem)", letterSpacing: "-0.03em", color: "#0A1C16", lineHeight: 1 }}>
                      {projectName}
                    </h2>
                    <button
                      onClick={() => setIsEditingProjectName(true)}
                      className="p-2 border border-transparent hover:border-[#0A1C16]/20 rounded hover:bg-[#0A1C16]/5 text-[#0A1C16]/40 hover:text-[#0A1C16] transition-all"
                      title="Edit project name"
                    >
                      <Edit3 size={18} />
                    </button>
                  </div>
                )}
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "1rem", color: "rgba(10,28,22,0.65)", marginTop: "1rem", maxWidth: "640px", lineHeight: 1.75, fontWeight: 300 }}>
                  {requirements.executive_summary || "Review the scope model and manuscript side by side. Edit what needs tuning, regenerate if the extraction missed intent, or approve when the blueprint is ready."}
                </p>
              </header>
            </ScrollReveal>

            <section>
              <ScrollReveal variant="slide-up" delay={80}>
                <div 
                  onClick={() => setIsScopeExpanded(!isScopeExpanded)}
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between", 
                    borderBottom: "1px solid #0A1C16", 
                    paddingBottom: "1rem", 
                    marginBottom: isScopeExpanded ? "1rem" : "0", 
                    cursor: "pointer" 
                  }}
                >
                  <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <Layers3 size={24} strokeWidth={1.5} />
                    Shape the{" "}
                    <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, opacity: 0.6 }}>scope</em>
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="section-tag" style={{ border: "1px solid #0A1C16", padding: "0.25rem 0.75rem", fontSize: "0.75rem", fontFamily: "var(--font-display)", textTransform: "uppercase" }}>{modules.length} modules</span>
                    {isScopeExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
              </ScrollReveal>

              {isScopeExpanded && (
                <div className="space-y-3">
                  {modules.length === 0 && (
                    <div className="p-12 border border-dashed border-parcelles-dark/40 text-center font-body text-parcelles-dark/60">
                      No modules were extracted yet.
                    </div>
                  )}

                  {modules.map((module, index) => {

                    const isEditing = editingIdx === index;
                    const isExpanded = expandedIdx === index;
                    const draft = isEditing ? editDraft : module;

                    return (
                      <article
                        key={`${module.name}-${index}`}
                        className={`border border-parcelles-dark transition-all duration-300 ${isExpanded ? "bg-parcelles-sage/20" : "bg-transparent"} chamfer-bottom-right`}
                      >
                        <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4 items-start">
                          <div className="w-12 h-12 shrink-0 bg-parcelles-dark text-parcelles-bg flex items-center justify-center font-display text-lg chamfer-bottom-left">
                            {index + 1}
                          </div>

                          <div className="flex-1 min-w-0">
                            {isEditing ? (
                              <input
                                value={draft.name}
                                onChange={(event) => setEditDraft({ ...draft, name: event.target.value })}
                                className="w-full text-3xl font-display bg-transparent border-b border-parcelles-dark outline-none pb-2 mb-4"
                              />
                            ) : (
                              <button
                                onClick={() => setExpandedIdx(isExpanded ? null : index)}
                                className="w-full flex items-start justify-between text-left group"
                              >
                                <div>
                                  <h4 className="text-2xl sm:text-3xl font-display group-hover:opacity-70 transition-opacity">{module.name}</h4>
                                  <p className="font-body text-sm opacity-60 mt-1">{(module.feature_names || []).length} features linked</p>
                                </div>
                                {isExpanded ? <ChevronUp size={24} className="opacity-50 mt-1" /> : <ChevronDown size={24} className="opacity-50 mt-1" />}
                              </button>
                            )}

                            {isEditing ? (
                              <textarea
                                value={draft.summary || ""}
                                onChange={(event) => setEditDraft({ ...draft, summary: event.target.value })}
                                rows={3}
                                className="w-full mt-4 p-4 border border-parcelles-dark bg-transparent outline-none font-body resize-none"
                              />
                            ) : (
                              <p className="mt-4 font-body text-lg opacity-80 leading-relaxed max-w-3xl">
                                {module.summary || "No summary available."}
                              </p>
                            )}
                          </div>

                          <div className="shrink-0 flex gap-2">
                            {isEditing ? (
                              <>
                                <button onClick={() => saveEdit(index)} className="p-3 bg-parcelles-dark text-parcelles-bg hover:opacity-90 transition-opacity">
                                  <Save size={20} />
                                </button>
                                <button onClick={cancelEdit} className="p-3 border border-parcelles-dark hover:bg-parcelles-dark/5 transition-colors">
                                  <X size={20} />
                                </button>
                              </>
                            ) : (
                              <button onClick={() => startEdit(index)} className="p-3 border border-parcelles-dark hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors">
                                <Edit3 size={20} />
                              </button>
                            )}
                          </div>
                        </div>

                        {(isExpanded || isEditing) && (
                          <div className="border-t border-parcelles-dark p-4 sm:p-5 bg-parcelles-bg/50">
                            <h5 className="font-display flex items-center gap-2 mb-6">
                              <Sparkles size={16} /> Feature Links
                            </h5>

                            {isEditing ? (
                              <div className="space-y-4">
                                {(draft.feature_names || []).map((featureName, featureIndex) => (
                                  <div key={featureIndex} className="flex items-center gap-3">
                                    <input
                                      value={featureName}
                                      onChange={(event) => {
                                        const nextFeatures = [...(draft.feature_names || [])];
                                        nextFeatures[featureIndex] = event.target.value;
                                        setEditDraft({ ...draft, feature_names: nextFeatures });
                                      }}
                                      className="flex-1 p-4 border border-parcelles-dark bg-transparent outline-none font-body"
                                    />
                                    <button
                                      onClick={() =>
                                        setEditDraft({
                                          ...draft,
                                          feature_names: draft.feature_names.filter((_, currentIndex) => currentIndex !== featureIndex),
                                        })
                                      }
                                      className="p-4 border border-parcelles-dark hover:bg-red-500 hover:text-white transition-colors"
                                    >
                                      <X size={20} />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  onClick={() => setEditDraft({ ...draft, feature_names: [...(draft.feature_names || []), "New Feature"] })}
                                  className="w-full p-4 border border-dashed border-parcelles-dark font-display flex items-center justify-center gap-2 hover:bg-parcelles-dark/5"
                                >
                                  <Sparkles size={16} /> Add Feature
                                </button>
                              </div>
                            ) : (
                              <div className="grid gap-4">
                                {(module.feature_names || []).map((featureName, featureIndex) => {
                                  const feature = featureLookup[featureName];
                                  const style = PRIORITY_STYLES[feature?.priority] || PRIORITY_STYLES.low;

                                  return (
                                    <div key={featureIndex} className={`p-5 sm:p-6 border ${style.card} chamfer-bottom-right transition-colors`}>
                                      <div className="flex flex-wrap items-center justify-between gap-4">
                                        <p className={`font-display text-xl ${style.text}`}>{featureName}</p>
                                        <span className={`px-3 py-1 text-xs font-display uppercase tracking-wider rounded-full ${style.badge}`}>
                                          {feature?.priority || "planned"}
                                        </span>
                                      </div>
                                      {feature?.description && (
                                        <p className={`mt-3 font-body ${style.subtext}`}>{feature.description}</p>
                                      )}
                                      {feature?.acceptance_criteria?.length > 0 && (
                                        <p className={`mt-4 pt-4 border-t border-current/20 font-mono text-sm ${style.subtext} opacity-70`}>
                                          {feature.acceptance_criteria.join(" | ")}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {uiPages.length > 0 && (
              <section style={{ marginTop: "1rem" }}>
                <ScrollReveal variant="slide-up" delay={0}>
                  <div 
                    onClick={() => setIsExperienceMapExpanded(!isExperienceMapExpanded)}
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "space-between", 
                      borderBottom: "1px solid #0A1C16", 
                      paddingBottom: "1rem", 
                      marginBottom: isExperienceMapExpanded ? "1.5rem" : "0", 
                      cursor: "pointer" 
                    }}
                  >
                    <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <Globe size={24} strokeWidth={1.5} />
                      Experience{" "}
                      <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, opacity: 0.6 }}>Map</em>
                    </h3>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="section-tag" style={{ border: "1px solid #0A1C16", padding: "0.25rem 0.75rem", fontSize: "0.75rem", fontFamily: "var(--font-display)", textTransform: "uppercase" }}>{uiPages.length} screens</span>
                      {isExperienceMapExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </ScrollReveal>
                {isExperienceMapExpanded && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" style={{ width: "100%" }}>
                    {uiPages.map((page, index) => {
                      const isScreenExpanded = !!expandedScreens[index];
                      return (
                        <ScrollReveal key={index} variant="scale-in" delay={index * 60}>
                          <div
                            className="card-invert"
                            onClick={() => {
                              setExpandedScreens((prev) => ({
                                ...prev,
                                [index]: !prev[index],
                              }));
                            }}
                            style={{
                              padding: "1rem 1.25rem",
                              border: "1px solid #0A1C16",
                              transition: "all 0.4s ease",
                              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
                              height: isScreenExpanded ? "auto" : "75px",
                              minHeight: "75px",
                              cursor: "pointer",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "space-between",
                            }}
                          >
                            <p className="text-eyebrow" style={{ opacity: 0.45, marginBottom: "0.25rem", fontSize: "0.6rem" }}>
                              Screen {String(index + 1).padStart(2, "0")}
                            </p>
                            <p
                              style={{
                                fontFamily: "var(--font-display)",
                                fontWeight: 300,
                                fontSize: "1rem",
                                letterSpacing: "-0.01em",
                                display: "-webkit-box",
                                WebkitLineClamp: isScreenExpanded ? "none" : 1,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                lineHeight: 1.2
                              }}
                            >
                              {page.name}
                            </p>
                          </div>
                        </ScrollReveal>
                      );
                    })}
                  </div>
                )}
              </section>
            )}


            {/* Action Bar */}
            <ScrollReveal variant="slide-up" delay={0}>
              <div style={{ padding: "2.5rem", border: "1px solid #0A1C16", background: "#0A1C16", color: "#EBEBEB", display: "flex", flexWrap: "wrap", gap: "2rem", alignItems: "center", justifyContent: "space-between", clipPath: "polygon(0 0, 100% 0, 100% 100%, 28px 100%, 0 calc(100% - 28px))" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                  <div style={{ width: "52px", height: "52px", border: "1px solid rgba(235,235,235,0.25)", display: "flex", alignItems: "center", justifyContent: "center", clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)" }}>
                    <ShieldCheck size={26} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "1.1rem", letterSpacing: "-0.01em" }}>Review Deck</p>
                    <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "0.8rem", color: "rgba(235,235,235,0.55)", marginTop: "0.2rem" }}>Approving sends this exact SRS to deliverables.</p>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                  {canUndo && (
                    <button onClick={undoChange} style={{ padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: "none", color: "rgba(235,235,235,0.6)", transition: "opacity 0.2s ease" }}>
                      <Undo2 size={16} /> Undo
                    </button>
                  )}
                  <button onClick={() => setShowRegenModal(true)} style={{ padding: "0.75rem 1.5rem", border: "1px solid rgba(235,235,235,0.25)", background: "transparent", color: "#EBEBEB", fontFamily: "var(--font-display)", fontSize: "0.8rem", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "0.5rem", transition: "background 0.25s ease" }}>
                    <RefreshCw size={16} /> Regenerate
                  </button>
                  <button onClick={handleApprove} disabled={isApproving} style={{ padding: "0.875rem 2rem", background: "#8EC4A0", color: "#0A1C16", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "0.85rem", letterSpacing: "0.12em", textTransform: "uppercase", border: "none", display: "flex", alignItems: "center", gap: "0.75rem", opacity: isApproving ? 0.6 : 1, clipPath: "polygon(0 0, 100% 0, 100% 100%, 18px 100%, 0 calc(100% - 18px))", transition: "opacity 0.2s ease" }}>
                    {isApproving ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} strokeWidth={1.5} />}
                    {isApproving ? "Saving…" : "Approve Blueprint"}
                  </button>
                </div>
              </div>
            </ScrollReveal>

          </main>

          {/* Right Aside - Generated SRS Preview */}
          <aside className="flex-[1] min-w-0 w-full xl:sticky xl:top-24 h-auto xl:h-[calc(100vh-8rem)] flex flex-col border border-parcelles-dark bg-parcelles-bg chamfer-bottom-right">
            <div className="p-6 border-b border-parcelles-dark bg-parcelles-sage/20">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-display text-sm uppercase tracking-widest opacity-60">Generated Document</p>
                  <h3 className="font-display text-2xl mt-1">SRS Preview</h3>
                </div>
                <span className="font-display text-sm border border-parcelles-dark px-3 py-1 rounded-full">
                  {syncedSections.length} sections
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth hide-scrollbar">
              {sections.length === 0 && (
                <div className="p-8 border border-dashed border-parcelles-dark/30 text-center font-body opacity-60">
                  No SRS preview is available yet.
                </div>
              )}
              {syncedSections.map((section, index) => (
                <article key={index} className="pb-8 border-b border-parcelles-dark/20 last:border-0 last:pb-0">
                  <div className="flex items-center gap-4 mb-4">
                    <span className="font-display text-xl opacity-40">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h4 className="font-display text-xl">{section.title}</h4>
                  </div>
                  <div className="font-body text-base opacity-80 leading-relaxed whitespace-pre-line">
                    {section.body}
                  </div>
                </article>
              ))}
            </div>
          </aside>

        </div>
      </div>
    </div>
  );
}
