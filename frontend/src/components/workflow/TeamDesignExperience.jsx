"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  File,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Users,
  BarChart3
} from "lucide-react";

import { PageIntro } from "@/components/workflow/PageIntro";
import { useWorkflow } from "@/context/WorkflowContext";
import { createCostDraftFromTeamData, saveCostDraft } from "@/lib/costEstimationStorage";
import {
  downloadDeliverableBundle,
  getAvailableDeliverables,
  getDeliverableBundleLabel,
} from "@/lib/deliverableBundle";
import { analyzeTeam, analyzeTeamFromText, exportTeamExcel, exportTeamPdf, exportTeamWord, extractTeamFromFile, extractTeamFromText, saveTeamDraft, triggerAssetDownload } from "@/lib/platformApi";
import { saveApprovedTeam } from "@/lib/workflowArtifacts";

const INPUT_TABS = [
  { id: "approved", label: "Approved SRS", icon: Sparkles },
  { id: "file", label: "Upload File", icon: File },
  { id: "text", label: "Paste Brief", icon: Clipboard },
];

const TEAM_STRATEGY_OPTIONS = [
  { id: "fastest", label: "Fastest", description: "Optimize for shortest delivery timeline." },
  { id: "balanced", label: "Balanced", description: "Blend speed, team size, and maintainability." },
  { id: "lean", label: "Lean", description: "Favor smaller staffing and cost efficiency." },
];

const SUPPORT_COVERAGE_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "standard", label: "Standard" },
  { id: "intensive", label: "Intensive" },
];

const classifyRoleWorkstream = (role = "") => {
  const lowered = (role || "").toLowerCase();
  if (lowered.includes("qa") || lowered.includes("tester") || lowered.includes("test engineer")) return "testing";
  if (
    lowered.includes("project manager") ||
    lowered.includes("program manager") ||
    lowered.includes("scrum master") ||
    lowered.includes("business analyst") ||
    lowered.includes("product manager")
  ) {
    return "management";
  }
  if (
    lowered.includes("devops") ||
    lowered.includes("platform engineer") ||
    lowered.includes("release engineer") ||
    lowered.includes("site reliability") ||
    lowered.includes("sre") ||
    lowered.includes("cloud engineer")
  ) {
    return "deployment";
  }
  if (lowered.includes("ui/ux") || lowered.includes("ux designer") || lowered.includes("ui designer") || lowered.includes("product designer")) {
    return "design";
  }
  if (lowered.includes("developer") || lowered.includes("engineer") || lowered.includes("architect")) return "development";
  return "support";
};

const normalizeRoleTitle = (role = "") =>
  role.replace(/\s*\(\d+(?:\.\d+)?\s*Yrs?\s*Exp\)/i, "").trim().toLowerCase();

const isIntegratedSupportWorkstream = (workstream) => ["management", "deployment"].includes(workstream);

const groupMembersByBox = (members = []) => {
  const devList = [];
  const testList = [];
  const pmDeployList = [];

  members.forEach((member) => {
    const roleLower = String(member.role || "").toLowerCase();
    if (
      roleLower.includes("qa") || 
      roleLower.includes("tester") || 
      roleLower.includes("test engineer") ||
      roleLower.includes("quality assurance") ||
      roleLower.includes("(testing)")
    ) {
      testList.push(member);
    } else if (
      (roleLower.includes("developer") || roleLower.includes("engineer") || roleLower.includes("architect")) &&
      !roleLower.includes("lead") && 
      !roleLower.includes("(deployment)") &&
      !roleLower.includes("devops")
    ) {
      devList.push(member);
    } else {
      pmDeployList.push(member);
    }
  });

  return { devList, testList, pmDeployList };
};

const withSelectedAllocation = (member) => ({
  ...member,
  selected: member.selected !== false,
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const calculateHourlyPay = (years) => {
  const y = Number(years) || 0;
  if (y > 10) return 400;
  if (y >= 8) return 350;
  if (y >= 5) return 300;
  return 200;
};

const getExperienceFromRole = (role = "") => {
  const match = role.match(/(\d+(?:\.\d+)?)\s*Yrs?\s*Exp/i);
  return match ? Number(match[1]) : null;
};

const resolveRosterExperience = (role = "", roster = []) => {
  const parsed = getExperienceFromRole(role);
  if (parsed != null) return parsed;

  const loweredRole = role.toLowerCase();
  const match = roster.find((resource) => {
    const name = (resource.name || "").toLowerCase();
    const resourceRole = (resource.role || "").toLowerCase();
    return (
      (name && loweredRole.includes(name)) ||
      (resourceRole && (loweredRole.includes(resourceRole) || resourceRole.includes(loweredRole)))
    );
  });
  return Number(match?.experience_years) || 5;
};

const coverageMultiplier = (coverage = "standard") => {
  if (coverage === "light") return 0.7;
  if (coverage === "intensive") return 1.3;
  return 1;
};

const experienceEffortMultiplier = (years) => {
  const exp = Number(years) || 5;
  if (exp >= 12) return 0.74;
  if (exp >= 10) return 0.8;
  if (exp >= 8) return 0.88;
  if (exp >= 5) return 1;
  if (exp >= 3) return 1.12;
  return 1.28;
};

const buildSupportEffort = ({ member, workstream, deliveryHours, deliveryWeeks, planningPreferences, companyRoster }) => {
  const count = Math.max(1, Number(member.count) || 1);
  const safeDeliveryHours = Math.max(80, Number(deliveryHours) || 0);
  const safeDeliveryWeeks = Math.max(1, Number(deliveryWeeks) || 1);
  const experienceYears = resolveRosterExperience(member.role, companyRoster);
  const coverage =
    workstream === "deployment"
      ? planningPreferences.deployment_coverage
      : planningPreferences.project_management_coverage;
  const coverageFactor = coverageMultiplier(coverage);
  const expFactor = experienceEffortMultiplier(experienceYears);

  const effortRatio = workstream === "deployment" ? 0.07 : 0.09;
  const weeklyContinuityHours = workstream === "deployment" ? 1.5 : 2.5;
  const maxWeeklyHours = workstream === "deployment" ? 18 : 22;
  const minimumHours = workstream === "deployment" ? 24 : 32;

  const scopedHours = safeDeliveryHours * effortRatio * coverageFactor * expFactor;
  const continuityHours = safeDeliveryWeeks * weeklyContinuityHours * coverageFactor;
  const cappedHours = Math.min(scopedHours + continuityHours, safeDeliveryWeeks * maxWeeklyHours * count);
  const totalHours = Math.max(minimumHours * coverageFactor, cappedHours);
  const hoursPerMember = Math.max(8, Math.round(totalHours / count));
  const weeklyHours = Math.max(1, Math.round(hoursPerMember / safeDeliveryWeeks));

  const workstreamLabel = workstream === "deployment" ? "DevOps" : "Project Manager";
  const coverageLabel = (coverage || "standard").toLowerCase();
  const description =
    `${workstreamLabel} effort is calculated from ${Math.round(safeDeliveryHours)} delivery hours over ` +
    `${safeDeliveryWeeks} weeks with ${coverageLabel} coverage and ${experienceYears} years of experience. ` +
    `Planned as ~${weeklyHours} hrs/week, not a full-time 40 hrs/week allocation.`;

  return {
    active_weeks: safeDeliveryWeeks,
    hours_per_member: hoursPerMember,
    weekly_hours: weeklyHours,
    description,
  };
};

const findBestRosterMatch = (roster = [], allocRole = "") => {
  if (!allocRole) return null;
  const clean = (r) => {
    return String(r || "").toLowerCase()
      .replace(/\s*\(\d+(?:\.\d+)?\s*Yrs?\s*Exp\)/i, "")
      .replace(/full\s*stack/g, "")
      .replace(/full-stack/g, "")
      .replace(/software/g, "")
      .replace(/engineer/g, "developer")
      .replace(/developer/g, "")
      .replace(/architect/g, "")
      .trim();
  };
  const allocClean = clean(allocRole);
  if (!allocClean) return null;
  
  // 1. Try exact cleaned match
  let match = roster.find((c) => c && c.role && clean(c.role) === allocClean);
  if (match) return match;

  // 2. Try includes match
  match = roster.find((c) => {
    if (!c || !c.role) return false;
    const cClean = clean(c.role);
    return cClean.includes(allocClean) || allocClean.includes(cClean);
  });
  if (match) return match;

  // 3. Try level word match (lead, senior, junior)
  match = roster.find((c) => {
    if (!c || !c.role) return false;
    const cClean = clean(c.role);
    if (allocClean.includes("lead") && cClean.includes("lead")) return true;
    if (allocClean.includes("senior") && cClean.includes("senior") && !allocClean.includes("lead") && !cClean.includes("lead")) return true;
    if (allocClean.includes("junior") && cClean.includes("junior")) return true;
    // Map mid-level / mid to senior (which has experience between 5 and 10)
    if ((allocClean.includes("mid") || allocClean.includes("mid-level")) && cClean.includes("senior")) return true;
    return false;
  });
  if (match) return match;

  // 4. Try matching standard roles like QA or PM
  if (allocClean.includes("qa") || allocClean.includes("test")) {
    match = roster.find((c) => {
      if (!c || !c.role) return false;
      const cClean = clean(c.role);
      return cClean.includes("qa") || cClean.includes("test");
    });
    if (match) return match;
  }
  if (allocClean.includes("pm") || allocClean.includes("manag")) {
    match = roster.find((c) => {
      if (!c || !c.role) return false;
      const cClean = clean(c.role);
      return cClean.includes("pm") || cClean.includes("manag");
    });
    if (match) return match;
  }

  return null;
};

const mapSupportMembersWithRates = (membersList, companyRoster) => {
  return (membersList || []).filter(Boolean).filter((m) =>
    m && m.role && isIntegratedSupportWorkstream(classifyRoleWorkstream(m.role))
  ).map((m) => {
    const candidate = findBestRosterMatch(companyRoster, m.role);
    const rate = candidate ? calculateHourlyPay(candidate.experience_years) : 200;
    return {
      ...withSelectedAllocation(m),
      role: candidate ? `${candidate.name} (${candidate.role})` : m.role,
      hourly_rate: rate,
    };
  });
};

const getItemName = (item, fallback = "") => {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return fallback;
  return item.name || item.title || item.module_name || item.feature_name || fallback;
};

const buildBlueprintText = ({ srsData, cleanedInput, rawInput, projectTitle }) => {
  const requirements = srsData?.structuredRequirements;
  const deliveryPlanRoot = srsData?.delivery_plan;
  const deliveryPlanReq = requirements?.delivery_plan;
  const uiPages = asArray(requirements?.ui_pages);

  const uiPagesSection = asArray(srsData?.sections).find(
    (s) =>
      s.title?.toLowerCase().includes("ui page") ||
      s.title?.toLowerCase().includes("screen design"),
  );
  const uiPagesLine =
    uiPages.length
      ? `UI Pages Required (${uiPages.length} screens): ${uiPages.map((page, index) => getItemName(page, `Screen ${index + 1}`)).join(", ")}`
      : uiPagesSection
        ? `UI Pages: ${uiPagesSection.body.substring(0, 400)}`
        : "";

  // If we have approved SRS data, we MUST read and serialize the efforts and timelines from it!
  if (requirements) {
    const lines = [
      `Project Name: ${requirements.project_name || projectTitle || "Untitled Project"}`,
      requirements.executive_summary ? `Executive Summary: ${requirements.executive_summary}` : "",
    ];

    // Extract total project duration
    const estimatedProjectDays = asArray(deliveryPlanReq?.estimated_project_days);
    const totalDays = deliveryPlanRoot?.total_duration_days ||
      (estimatedProjectDays.length
        ? Math.round(estimatedProjectDays.reduce((sum, d) => sum + (Number(d.days) || 0), 0))
        : 0);
    const totalWeeks = totalDays ? Math.max(1, Math.round(totalDays / 5)) : 0;

    if (totalDays > 0) {
      lines.push(`Approved Project Duration: ${totalDays} days (${totalWeeks} working weeks)`);
    }

    // Extract modules and sprint timelines if available
    const modulesWithTimeline = asArray(deliveryPlanRoot?.modules);
    if (modulesWithTimeline.length > 0) {
      const moduleTimelineLines = modulesWithTimeline.map(
        (mod) =>
          `- Module "${getItemName(mod, "General Module")}": Dev Days: ${mod?.total_days ?? 0}, Test Days: ${mod?.testing_days ?? 0}, Active: Week ${mod?.start_week ?? "TBD"} to Week ${mod?.end_week ?? "TBD"}`
      );
      lines.push(`Approved Module Sprints & Efforts:\n${moduleTimelineLines.join("\n")}`);
    }

    // Extract total project effort level estimates
    if (estimatedProjectDays.length > 0) {
      const effortLines = estimatedProjectDays.map(
        (item) => `- ${item.level}: ${item.days} days (${Math.round(item.days * 8)} hours)`
      );
      lines.push(`Approved Total Project Effort Level Estimates:\n${effortLines.join("\n")}`);
    }

    // Extract feature delivery allocations
    const featureEstimates = asArray(deliveryPlanReq?.feature_estimates);
    if (featureEstimates.length > 0) {
      const featLines = featureEstimates.map((feat) => {
        const devDaysStr = asArray(feat?.developer_days).map((d) => `${d.level}: ${d.days}d`).join(", ");
        const testDaysStr = asArray(feat?.tester_days).map((d) => `${d.level}: ${d.days}d`).join(", ");
        return `- Feature "${getItemName(feat, "Feature")}" in Module "${feat?.module_name || "General"}": Dev Seniority: ${feat?.recommended_developer_level || "TBD"} (${devDaysStr}), Test Seniority: ${feat?.recommended_tester_level || "TBD"} (${testDaysStr})`;
      });
      lines.push(`Approved Feature Delivery Effort Estimates:\n${featLines.join("\n")}`);
    }

    // Standard list info
    const modules = asArray(requirements.modules);
    if (modules.length) {
      lines.push(
        `Modules: ${modules
          .map((module, index) => `${getItemName(module, `Module ${index + 1}`)}${module?.summary ? ` - ${module.summary}` : ""}`)
          .join("; ")}`
      );
    }

    const features = asArray(requirements.features);
    if (features.length) {
      lines.push(
        `Features: ${features
          .map((feature, index) => `${getItemName(feature, `Feature ${index + 1}`)}${feature?.description ? ` - ${feature.description}` : ""}`)
          .join("; ")}`
      );
    }

    if (uiPagesLine) {
      lines.push(uiPagesLine);
    }

    const nonFunctionalRequirements = asArray(requirements.non_functional_requirements);
    if (nonFunctionalRequirements.length) {
      lines.push(
        `Non Functional Requirements: ${nonFunctionalRequirements
          .map((item) => `${item.category}: ${item.description}`)
          .join("; ")}`
      );
    }

    const recommendedTechnologies = asArray(requirements.recommended_technologies);
    if (recommendedTechnologies.length) {
      lines.push(`Recommended Technologies: ${recommendedTechnologies.join(", ")}`);
    }

    if (rawInput?.trim()) {
      lines.push(`Source Brief: ${rawInput.trim()}`);
    }

    return lines.filter(Boolean).join("\n\n");
  }

  // Fallback to cleanedInput/rawInput if no approved SRS structure
  if (cleanedInput?.trim()) {
    return uiPagesLine
      ? `${cleanedInput.trim()}\n\n${uiPagesLine}`
      : cleanedInput.trim();
  }

  return rawInput?.trim() || "";
};

const buildApprovedTeamPayload = (teamData) => {
  const members = (teamData?.members || [])
    .map((member) => {
      const cleanMember = { ...member };
      delete cleanMember.selected;
      return {
        ...cleanMember,
        count: Number(cleanMember.count) || 0,
      };
    })
    .filter((member) => member.count > 0 && (Number(member.hours_per_member) || 0) > 0);

  return {
    ...teamData,
    members,
    total_size: members.reduce((total, member) => total + member.count, 0),
  };
};

export function TeamDesignExperience() {
  const router = useRouter();
  const { srsData, cleanedInput, rawInput, projectTitle, selectedEngine, setIsProcessing } = useWorkflow();

  const [localProjectTitle, setLocalProjectTitle] = useState(projectTitle || "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [teamData, setTeamData] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedOption, setSelectedOption] = useState("balanced");
  const [prevTeamData, setPrevTeamData] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [isComplexityExpanded, setIsComplexityExpanded] = useState(false);
  const [isSupportExpanded, setIsSupportExpanded] = useState(false);
  const [expandedModules, setExpandedModules] = useState({});
  const [activeModules, setActiveModules] = useState({});

  const [isDevStaffingExpanded, setIsDevStaffingExpanded] = useState(true);
  const [isTestStaffingExpanded, setIsTestStaffingExpanded] = useState(true);
  const [isPmDeployStaffingExpanded, setIsPmDeployStaffingExpanded] = useState(true);
  // stable ref so reactive recalc never reads stale counts set by updateMemberCount
  const stableCountsRef = useRef({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState("");

  const [companyRoster, setCompanyRoster] = useState([
    { name: "Resource A", role: "Lead Full Stack Developer", experience_years: 12 },
    { name: "Resource B", role: "Senior Full Stack Developer", experience_years: 8 },
    { name: "Resource C", role: "Junior Full Stack Developer", experience_years: 2 },
    { name: "Resource D", role: "QA Tester", experience_years: 4 },
    { name: "Resource E", role: "Project Manager", experience_years: 10 },
    { name: "Resource F", role: "DevOps Engineer", experience_years: 7 }
  ]);

  const [moduleAllocations, setModuleAllocations] = useState({});
  const [supportAllocations, setSupportAllocations] = useState([]);
  const [memberOverrides, setMemberOverrides] = useState({});

  // Restore team draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-project-planner-team-draft-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.teamData) {
          const roster = parsed.companyRoster || [
            { name: "Resource A", role: "Lead Full Stack Developer", experience_years: 12 },
            { name: "Resource B", role: "Senior Full Stack Developer", experience_years: 8 },
            { name: "Resource C", role: "Junior Full Stack Developer", experience_years: 2 },
            { name: "Resource D", role: "QA Tester", experience_years: 4 },
            { name: "Resource E", role: "Project Manager", experience_years: 10 },
            { name: "Resource F", role: "DevOps Engineer", experience_years: 7 }
          ];

          let migratedModuleAllocations = parsed.moduleAllocations || {};
          if (parsed.moduleAllocations) {
            migratedModuleAllocations = {};
            Object.entries(parsed.moduleAllocations).forEach(([moduleName, allocList]) => {
              if (Array.isArray(allocList)) {
                migratedModuleAllocations[moduleName] = allocList.map((alloc) => {
                  if (alloc && alloc.name === "Unassigned" && alloc.role) {
                    const match = findBestRosterMatch(roster, alloc.role);
                    if (match) {
                      return {
                        ...alloc,
                        name: match.name,
                        role: match.role,
                        experience_years: match.experience_years,
                      };
                    }
                  }
                  return alloc;
                });
              } else {
                migratedModuleAllocations[moduleName] = allocList;
              }
            });
          }

          setTeamData(parsed.teamData);
          if (parsed.selectedOption) setSelectedOption(parsed.selectedOption);
          setModuleAllocations(migratedModuleAllocations);
          if (parsed.supportAllocations) setSupportAllocations(parsed.supportAllocations);
          if (parsed.activeModules) setActiveModules(parsed.activeModules);
          if (parsed.companyRoster) setCompanyRoster(parsed.companyRoster);
          if (parsed.step) setStep(parsed.step);
          if (parsed.localProjectTitle) setLocalProjectTitle(parsed.localProjectTitle);
          if (parsed.analysisResult) setAnalysisResult(parsed.analysisResult);
          if (parsed.memberOverrides) setMemberOverrides(parsed.memberOverrides);
        }
      }
    } catch (e) {
      console.error("Failed to restore team draft:", e);
    }
  }, []);

  // Save team draft to localStorage and temporary DB on change
  useEffect(() => {
    if (step >= 2 && teamData) {
      const draftPayload = {
        teamData,
        selectedOption,
        moduleAllocations,
        supportAllocations,
        activeModules,
        companyRoster,
        step,
        localProjectTitle,
        analysisResult,
        memberOverrides,
      };
      window.localStorage.setItem("ai-project-planner-team-draft-v1", JSON.stringify(draftPayload));
      saveTeamDraft(draftPayload).catch((err) => {
        console.warn("Failed to persist team draft to DB:", err);
      });
    }
  }, [
    teamData,
    selectedOption,
    moduleAllocations,
    supportAllocations,
    activeModules,
    companyRoster,
    step,
    localProjectTitle,
    analysisResult,
    memberOverrides,
  ]);

  // Seniority-based hours estimation function
  const estimateResourceHours = (moduleEstimatedHours, resource) => {
    const role = resource.role.toLowerCase();
    let multiplier = 1.0;
    if (role.includes("lead")) multiplier = 0.7;
    else if (role.includes("senior")) multiplier = 0.85;
    else if (role.includes("mid-level") || role.includes("mid")) multiplier = 1.0;
    else if (role.includes("junior")) multiplier = 1.3;
    else if (role.includes("full stack") || role.includes("fullstack")) multiplier = 0.8;
    else if (role.includes("ui/ux") || role.includes("designer")) multiplier = 0.9;
    else if (role.includes("qa") || role.includes("tester")) multiplier = 1.1;
    else if (role.includes("devops")) multiplier = 0.9;
    else if (role.includes("pm") || role.includes("project manager")) multiplier = 1.0;

    const expYears = resource.experience_years ?? 5;
    const expFactor = Math.max(0.7, 1 - (expYears - 5) * 0.02);
    return Math.round(moduleEstimatedHours * multiplier * expFactor);
  };

  const recalculateModuleAllocations = (assignedResources, moduleEstimatedHours, activeAllocation = []) => {
    let updatedResources = assignedResources.map((resource) => {
      if (resource.selected === false) {
        return { ...resource, hours: 0 };
      }
      return resource;
    });

    const activeResources = updatedResources.filter((r) => r.selected !== false);
    if (activeResources.length === 0) return updatedResources;

    // Filter dev resources (experience <= 10, not containing lead or testing/deployment descriptions)
    const devResources = activeResources.filter((resource) => {
      const roleLower = (resource.role || "").toLowerCase();
      const descLower = (resource.description || "").toLowerCase();
      if (roleLower.includes("lead") || descLower.includes("testing") || descLower.includes("deployment")) {
        return false;
      }
      return true;
    });

    const devWeights = devResources.map((resource) => {
      if (resource.manuallyEdited) {
        return { resource, weight: Number(resource.hours) || 0, isManual: true };
      }
      // Split equally: all non-manual developers get equal weight (1.0)
      return { resource, weight: 1.0, isManual: false };
    });

    const manualHoursSum = devWeights.filter(w => w.isManual).reduce((sum, w) => sum + w.weight, 0);
    const remainingDevHours = Math.max(0, moduleEstimatedHours - manualHoursSum);

    const nonManualDevWeights = devWeights.filter(w => !w.isManual);
    const nonManualWeightSum = nonManualDevWeights.reduce((sum, w) => sum + w.weight, 0);

    const computedDevHours = {};
    if (nonManualWeightSum > 0) {
      let distributedSum = 0;
      nonManualDevWeights.forEach((w, idx) => {
        let hrs = Math.round(remainingDevHours * (w.weight / nonManualWeightSum));
        if (idx === nonManualDevWeights.length - 1) {
          hrs = remainingDevHours - distributedSum;
        }
        distributedSum += hrs;
        computedDevHours[w.resource.name] = hrs;
      });
    } else if (nonManualDevWeights.length > 0) {
      let distributedSum = 0;
      nonManualDevWeights.forEach((w, idx) => {
        let hrs = Math.round(remainingDevHours / nonManualDevWeights.length);
        if (idx === nonManualDevWeights.length - 1) {
          hrs = remainingDevHours - distributedSum;
        }
        distributedSum += hrs;
        computedDevHours[w.resource.name] = hrs;
      });
    }

    return updatedResources.map((resource) => {
      if (resource.selected === false) {
        return { ...resource, hours: 0 };
      }

      if (resource.manuallyEdited) {
        return resource;
      }

      const roleLower = (resource.role || "").toLowerCase();
      const descLower = (resource.description || "").toLowerCase();

      // Senior Developer (Lead Full Stack Developer) testing/deployment
      if (roleLower.includes("lead") || descLower.includes("testing") || descLower.includes("deployment")) {
        if (descLower.includes("internal testing")) {
          return { ...resource, hours: Math.round(moduleEstimatedHours * 0.15) };
        }
        if (descLower.includes("external testing")) {
          return { ...resource, hours: Math.round(moduleEstimatedHours * 0.15) };
        }
        if (descLower.includes("deployment")) {
          return { ...resource, hours: Math.round(moduleEstimatedHours * 0.10) };
        }
        return { ...resource, hours: Math.round(moduleEstimatedHours * 0.15) };
      }

      if (computedDevHours[resource.name] !== undefined) {
        return { ...resource, hours: computedDevHours[resource.name] };
      }

      return { ...resource, hours: Math.round(moduleEstimatedHours * 0.5) };
    });
  };

  const getInitialAllocationsForOption = (optionKey, result, roster) => {
    if (!result?.feature_complexity_analysis) return {};
    const allocs = {};
    result.feature_complexity_analysis.forEach((module) => {
      const activeAllocation =
        optionKey === "fastest" ? module.fastest_allocation :
          optionKey === "lean" ? module.lean_allocation :
            module.balanced_allocation;

      const rawList = (activeAllocation || [])
        .filter((alloc) => !isIntegratedSupportWorkstream(classifyRoleWorkstream(alloc.role)))
        .map((alloc) => {
          const candidate = findBestRosterMatch(roster, alloc.role) || { name: "Unassigned", role: alloc.role, experience_years: 5 };

          return {
            name: candidate.name,
            role: candidate.role,
            experience_years: candidate.experience_years,
            description: alloc.description || "",
            selected: true,
          };
        });

      allocs[module.module_name] = recalculateModuleAllocations(rawList, module.estimated_hours, activeAllocation);
    });
    return allocs;
  };

  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("Lead Full Stack Developer");
  const [newMemberExp, setNewMemberExp] = useState(5);
  const [isRosterCollapsed, setIsRosterCollapsed] = useState(false);
  const [planningPreferences, setPlanningPreferences] = useState({
    preferred_strategy: "balanced",
    project_management_coverage: "standard",
    deployment_coverage: "standard",
  });

  const handleAddRosterMember = () => {
    if (!newMemberName.trim()) return;
    setCompanyRoster([
      ...companyRoster,
      {
        name: newMemberName.trim(),
        role: newMemberRole,
        experience_years: Number(newMemberExp) || 0
      }
    ]);
    setNewMemberName("");
    setNewMemberExp(5);
  };

  const handleRemoveRosterMember = (index) => {
    const nextRoster = [...companyRoster];
    nextRoster.splice(index, 1);
    setCompanyRoster(nextRoster);
  };

  const handleUpdateRosterMemberExp = (index, value) => {
    const nextRoster = [...companyRoster];
    const member = nextRoster[index];
    const newExp = Math.max(0, Number(value) || 0);
    member.experience_years = newExp;
    setCompanyRoster(nextRoster);

    // Dynamic reactive updates: re-calculate hours for all matching assignments
    setModuleAllocations((current) => {
      const next = { ...current };
      Object.entries(next).forEach(([modName, allocList]) => {
        const moduleObj = analysisResult?.feature_complexity_analysis?.find(m => m.module_name === modName);
        const baseHours = moduleObj ? moduleObj.estimated_hours : 40;
        const activeAllocation = moduleObj
          ? (selectedOption === "fastest" ? moduleObj.fastest_allocation :
             selectedOption === "lean" ? moduleObj.lean_allocation :
             moduleObj.balanced_allocation)
          : [];
        const updatedList = allocList.map((alloc) => {
          if (alloc.name === member.name) {
            return {
              ...alloc,
              experience_years: newExp,
            };
          }
          return alloc;
        });
        next[modName] = recalculateModuleAllocations(updatedList, baseHours, activeAllocation);
      });
      return next;
    });
  };



  const approvedBlueprintText = useMemo(
    () => buildBlueprintText({ srsData, cleanedInput, rawInput, projectTitle: localProjectTitle || projectTitle }),
    [cleanedInput, localProjectTitle, projectTitle, rawInput, srsData],
  );

  const hasApprovedSrs = Boolean(approvedBlueprintText.trim());

  const approvedSrsStats = {
    modules: asArray(srsData?.structuredRequirements?.modules).length,
    features: asArray(srsData?.structuredRequirements?.features).length,
    uiPages: asArray(srsData?.structuredRequirements?.ui_pages).length,
  };

  const availableDeliverables = getAvailableDeliverables({ srsData, teamData });
  const downloadLabel = getDeliverableBundleLabel({
    hasSrs: availableDeliverables.hasSrs,
    hasTeam: availableDeliverables.hasTeam,
    hasCost: false,
  });

  const deliveryMetrics = useMemo(() => {
    let maxWeeks = 6;
    let totalHours = 0;
    const activeAllocs = Object.entries(moduleAllocations).filter(
      ([modName]) => activeModules[modName] !== false
    );
    const deliveryAllocationsByRole = {};
    activeAllocs.forEach(([modName, allocList]) => {
      (allocList || []).filter(Boolean).forEach((alloc) => {
        if (alloc.selected === false) return;
        const roleKey = alloc.role;
        if (!deliveryAllocationsByRole[roleKey]) {
          deliveryAllocationsByRole[roleKey] = {
            role: roleKey,
            totalHours: 0,
            assignedResources: new Set(),
            resourceHours: {},
          };
        }
        deliveryAllocationsByRole[roleKey].totalHours += Number(alloc.hours) || 0;
        totalHours += Number(alloc.hours) || 0;
        deliveryAllocationsByRole[roleKey].assignedResources.add(alloc.name);
        deliveryAllocationsByRole[roleKey].resourceHours[alloc.name] =
          (deliveryAllocationsByRole[roleKey].resourceHours[alloc.name] || 0) + (Number(alloc.hours) || 0);
      });
    });

    Object.values(deliveryAllocationsByRole).forEach((group) => {
      const count = Math.max(1, group.assignedResources.size);
      let maxWeeksForResource = 1;
      Object.values(group.resourceHours).forEach((hrs) => {
        const wks = Math.max(1, Math.ceil(hrs / 40));
        if (wks > maxWeeksForResource) maxWeeksForResource = wks;
      });
      const cleanRole = (group.role || "").replace(/\s*\(\d+(?:\.\d+)?\s*Yrs?\s*Exp\)/i, '').trim();
      let totalExp = 0;
      let expCount = 0;
      group.assignedResources.forEach((name) => {
        const rosterItem = companyRoster.find(r => r.name === name);
        if (rosterItem) {
          totalExp += rosterItem.experience_years;
          expCount++;
        }
      });
      const avgExp = expCount > 0 ? Math.round(totalExp / expCount) : 5;
      const roleWithExp = `${cleanRole} (${avgExp} Yrs Exp)`;
      const override = memberOverrides[roleWithExp];
      const finalHoursPerMember = override && override.hours_per_member !== undefined ? override.hours_per_member : Math.round(group.totalHours / count);
      const finalWeeks = override && override.active_weeks !== undefined ? override.active_weeks : Math.max(1, Math.ceil(finalHoursPerMember / 40));
      if (finalWeeks > maxWeeks) maxWeeks = finalWeeks;
    });
    return {
      maxWeeks,
      totalHours,
    };
  }, [moduleAllocations, activeModules, companyRoster, memberOverrides]);

  const mathBreakdown = useMemo(() => {
    if (!analysisResult) return null;

    // Gather active delivery allocations
    const activeAllocs = Object.entries(moduleAllocations).filter(
      ([modName]) => activeModules[modName] !== false
    );

    let totalDevHours = 0;
    const moduleEfforts = [];

    activeAllocs.forEach(([modName, allocList]) => {
      let modDevHrs = 0;
      allocList.forEach((alloc) => {
        if (alloc.selected === false) return;
        const ws = classifyRoleWorkstream(alloc.role);
        const exp = resolveRosterExperience(alloc.role, companyRoster);
        if (ws === "development" && exp <= 10) {
          modDevHrs += Number(alloc.hours) || 0;
        }
      });
      
      // fallback
      if (modDevHrs === 0) {
        const moduleObj = analysisResult?.feature_complexity_analysis?.find(m => m.module_name === modName);
        if (moduleObj) {
          modDevHrs = Number(moduleObj.estimated_hours) || 0;
        }
      }
      
      totalDevHours += modDevHrs;
      moduleEfforts.push({ name: modName, hours: modDevHrs });
    });

    if (totalDevHours === 0) {
      totalDevHours = 160;
    }

    const testingInternal = totalDevHours * 0.15;
    const testingExternal = totalDevHours * 0.15;
    const deployment = totalDevHours * 0.10;
    const reqFetch = 16.0;
    const weeklyMeetings = 16.0;
    const kt = 8.0;

    const seniorDeveloperHours = testingInternal + testingExternal + deployment + reqFetch + weeklyMeetings + kt;
    const totalBaseEffort = totalDevHours + seniorDeveloperHours;
    const pmHours = totalBaseEffort * 0.15;
    const totalEffortsEstimation = totalBaseEffort + pmHours;
    const riskHours = totalEffortsEstimation * 0.10;
    const negotiationHours = totalEffortsEstimation * 0.05;
    const grandTotalHours = totalEffortsEstimation + riskHours + negotiationHours;

    return {
      moduleEfforts,
      totalDevHours,
      testingInternal,
      testingExternal,
      deployment,
      reqFetch,
      weeklyMeetings,
      kt,
      seniorDeveloperHours,
      totalBaseEffort,
      pmHours,
      totalEffortsEstimation,
      riskHours,
      negotiationHours,
      grandTotalHours
    };
  }, [moduleAllocations, activeModules, companyRoster, analysisResult]);

  const integratedSupportMembers = useMemo(() => {
    return supportAllocations.map((m) => {
      if (m.manuallyEdited) {
        return m;
      }
      const workstream = classifyRoleWorkstream(m.role);
      let effort;
      if (workstream === "management" && mathBreakdown) {
        const pmHrs = Math.round(mathBreakdown.pmHours);
        const maxWeeks = Math.max(1, Number(deliveryMetrics.maxWeeks) || 1);
        effort = {
          active_weeks: Math.round((pmHrs / 40) * 100) / 100,
          hours_per_member: pmHrs,
          weekly_hours: 40,
          description: `Project Manager effort is calculated as 15% of the total base effort (development, testing, and deployment). Planned as ~${(pmHrs / maxWeeks).toFixed(1)} hrs/week over ${maxWeeks} weeks.`,
        };
      } else {
        effort = buildSupportEffort({
          member: m,
          workstream,
          deliveryHours: deliveryMetrics.totalHours,
          deliveryWeeks: deliveryMetrics.maxWeeks,
          planningPreferences,
          companyRoster,
        });
      }
      return {
        ...m,
        ...effort,
      };
    });
  }, [supportAllocations, deliveryMetrics, planningPreferences, companyRoster, mathBreakdown]);

  const runAnalysis = async ({ file: nextFile, text, title, skipDirectExtraction = false }) => {
    setIsAnalyzing(true);
    setIsProcessing(true);
    setError("");
    setMemberOverrides({});

    try {
      // --- Step 1: try direct team extraction first (file & text tabs only) ---
      if (!skipDirectExtraction && (nextFile || text)) {
        try {
          const directRes = nextFile
            ? await extractTeamFromFile(nextFile)
            : await extractTeamFromText({ text, title });

          if (directRes?.has_team_allocation) {
            // Build a synthetic "custom" option wrapping the extracted plan
            const customOption = {
              project_name: directRes.project_name || title || localProjectTitle,
              logic_summary: directRes.logic_summary || directRes.message || "Loaded directly from your uploaded staffing plan.",
              members: directRes.members || [],
              total_size: directRes.total_size || 0,
              total_working_weeks: directRes.total_working_weeks || 0,
              total_project_hours: directRes.total_project_hours || 0,
              weekly_hours_per_member: directRes.weekly_hours_per_member || 40,
            };

            // Merge into a standard analysisResult shape with no generative options
            const syntheticResult = {
              project_name: customOption.project_name,
              options: { custom: customOption },
              feature_complexity_analysis: [],
            };

            setAnalysisResult(syntheticResult);
            setSelectedOption("custom");
            stableCountsRef.current = {};
            (directRes.members || []).forEach((m) => {
              stableCountsRef.current[m.role] = Number(m.count) || 1;
            });
            setTeamData(JSON.parse(JSON.stringify(customOption)));

            // Initialize for custom path
            setModuleAllocations({});
            setSupportAllocations(
              (directRes.members || []).filter((m) =>
                isIntegratedSupportWorkstream(classifyRoleWorkstream(m.role))
              ).map(withSelectedAllocation)
            );

            setLocalProjectTitle(customOption.project_name);
            setActiveModules({});
            setStep(2);
            return;
          }
        } catch {
          // Direct extraction failed – fall through to generative analysis
        }
      }

      // --- Step 2: full AI generative analysis ---
      const result = nextFile
        ? await analyzeTeam(nextFile, selectedEngine, companyRoster, planningPreferences)
        : await analyzeTeamFromText({ text, title, selectedEngine, companyRoster, planningPreferences });

      setAnalysisResult(result);
      const preferredOption = result.recommended_option || planningPreferences.preferred_strategy;
      const defaultOption = result.options?.[preferredOption]
        ? preferredOption
        : result.options?.balanced
          ? "balanced"
          : (Object.keys(result.options ?? {})[0] || "balanced");
      setSelectedOption(defaultOption);

      const activeTeam = result.options?.[defaultOption] || result;
      const freshTeam = JSON.parse(JSON.stringify(activeTeam));
      stableCountsRef.current = {};
      (freshTeam.members || []).forEach((m) => {
        stableCountsRef.current[m.role] = Number(m.count) || 1;
      });
      setTeamData(freshTeam);

      // Initialize moduleAllocations and supportAllocations
      const initialAllocs = getInitialAllocationsForOption(defaultOption, result, companyRoster);
      setModuleAllocations(initialAllocs);

      const supportMembers = mapSupportMembersWithRates(freshTeam.members, companyRoster);
      setSupportAllocations(supportMembers);

      setLocalProjectTitle(result.project_name || title || localProjectTitle);

      // initialise all modules as active
      const initialActive = {};
      (result.feature_complexity_analysis || []).forEach((mod) => {
        initialActive[mod.module_name] = true;
      });
      setActiveModules(initialActive);

      setStep(2);
    } catch (analysisError) {
      setError(analysisError.message || "Failed to analyze the project for team allocation.");
    } finally {
      setIsAnalyzing(false);
      setIsProcessing(false);
    }
  };

  const handleOptionChange = (optionKey) => {
    setSelectedOption(optionKey);
    setMemberOverrides({});
    if (analysisResult?.options?.[optionKey]) {
      const nextTeam = JSON.parse(JSON.stringify(analysisResult.options[optionKey]));
      // preserve user-edited counts across scenario switches
      nextTeam.members = nextTeam.members.map((m) => ({
        ...m,
        count: stableCountsRef.current[m.role] ?? m.count,
      }));
      setTeamData(nextTeam);

      // Initialize moduleAllocations and supportAllocations
      const initialAllocs = getInitialAllocationsForOption(optionKey, analysisResult, companyRoster);
      setModuleAllocations(initialAllocs);

      const supportMembers = mapSupportMembersWithRates(nextTeam.members, companyRoster);
      setSupportAllocations(supportMembers);
    }
  };

  const toggleModule = (moduleName) => {
    setActiveModules((prev) => ({ ...prev, [moduleName]: !prev[moduleName] }));
  }

  // ---- Reactive aggregation of module allocations and support roles ----
  useEffect(() => {
    let allMembers = [];

    if (selectedOption === "custom") {
      const initialCustomMembers = analysisResult?.options?.custom?.members || [];
      allMembers = initialCustomMembers.map((m) => {
        const isSupport = isIntegratedSupportWorkstream(classifyRoleWorkstream(m.role));
        if (isSupport) {
          const matchedSupport = integratedSupportMembers.find(
            (s) => normalizeRoleTitle(s.role) === normalizeRoleTitle(m.role)
          );
          if (matchedSupport) {
            return {
              ...m,
              count: matchedSupport.count,
              hours_per_member: matchedSupport.hours_per_member,
              active_weeks: matchedSupport.active_weeks,
              description: matchedSupport.description || m.description,
            };
          }
        } else {
          const override = memberOverrides[m.role];
          if (override) {
            return {
              ...m,
              count: override.count !== undefined ? override.count : m.count,
              hours_per_member: override.hours_per_member !== undefined ? override.hours_per_member : m.hours_per_member,
              active_weeks: override.active_weeks !== undefined ? override.active_weeks : m.active_weeks,
            };
          }
        }
        return m;
      });
    } else {
      // Gather active delivery allocations
      const activeAllocs = Object.entries(moduleAllocations).filter(
        ([modName]) => activeModules[modName] !== false
      );

      let totalDevHours = 0;
      activeAllocs.forEach(([modName, allocList]) => {
        allocList.forEach((alloc) => {
          if (alloc.selected === false) return;
          const ws = classifyRoleWorkstream(alloc.role);
          const exp = resolveRosterExperience(alloc.role, companyRoster);
          if (ws === "development" && exp <= 10) {
            totalDevHours += Number(alloc.hours) || 0;
          }
        });
      });

      if (totalDevHours === 0) {
        activeAllocs.forEach(([modName]) => {
          const moduleObj = analysisResult?.feature_complexity_analysis?.find(m => m.module_name === modName);
          if (moduleObj) {
            totalDevHours += Number(moduleObj.estimated_hours) || 0;
          }
        });
      }
      if (totalDevHours === 0) {
        totalDevHours = 160;
      }

      // Calculations based on user requested rules
      const testingInternalHours = totalDevHours * 0.15;
      const testingExternalHours = totalDevHours * 0.15;
      const deploymentHours = totalDevHours * 0.10;
      const reqFetchHours = 16.0;
      const weeklyMeetingsHours = 16.0;
      const ktHours = 8.0;

      const seniorHours = testingInternalHours + testingExternalHours + deploymentHours + reqFetchHours + weeklyMeetingsHours + ktHours;
      const totalBaseEffort = totalDevHours + seniorHours;
      const pmHours = totalBaseEffort * 0.15;
      const totalEffortsEstimation = totalBaseEffort + pmHours;
      const riskHours = totalEffortsEstimation * 0.10;
      const negotiationHours = totalEffortsEstimation * 0.05;

      let midHours = 0;
      let juniorHours = 0;
      let midCount = 1;
      let juniorCount = 1;

      if (selectedOption === "fastest") {
        midHours = totalDevHours;
        juniorHours = 0;
        midCount = 2;
        juniorCount = 0;
      } else if (selectedOption === "lean") {
        midHours = totalDevHours * 0.50;
        juniorHours = totalDevHours * 0.50;
        midCount = 1;
        juniorCount = 1;
      } else { // balanced
        midHours = totalDevHours * 0.50;
        juniorHours = totalDevHours * 0.50;
        midCount = 1;
        juniorCount = 1;
      }

      // Roster matching
      const findRosterResource = (keywords, minExp = 0, maxExp = 100, fallbackRole = "Developer", fallbackExp = 5) => {
        const candidates = companyRoster.filter(r => {
          const roleLower = (r.role || "").toLowerCase();
          return keywords.some(kw => roleLower.includes(kw)) && r.experience_years >= minExp && r.experience_years <= maxExp;
        });
        if (candidates.length > 0) {
          return candidates.sort((a, b) => b.experience_years - a.experience_years)[0];
        }
        const candidatesAny = companyRoster.filter(r => r.experience_years >= minExp && r.experience_years <= maxExp);
        if (candidatesAny.length > 0) {
          return candidatesAny.sort((a, b) => b.experience_years - a.experience_years)[0];
        }
        return { name: "Fallback", role: fallbackRole, experience_years: fallbackExp };
      };

      const resSenior = findRosterResource(["developer", "engineer", "architect"], 10.01, 100, "Lead Full Stack Developer", 12);
      const resMid = findRosterResource(["developer", "engineer", "architect"], 5, 10, "Senior Full Stack Developer", 8);
      const resJunior = findRosterResource(["developer", "engineer", "architect"], 0, 4.99, "Junior Full Stack Developer", 2);
      const resPm = findRosterResource(["manager", "pm", "scrum", "analyst"], 0, 100, "Project Manager", 10);

      const seniorTestingRole = `${resSenior.name} (${resSenior.role} (Testing))`;
      const seniorDeploymentRole = `${resSenior.name} (${resSenior.role} (Deployment))`;
      const midRole = `${resMid.name} (${resMid.role})`;
      const juniorRole = `${resJunior.name} (${resJunior.role})`;
      const pmRole = `${resPm.name} (${resPm.role})`;

      // Apply overrides if any exist
      const testingSeniorHours = Math.round(testingInternalHours + testingExternalHours + reqFetchHours + weeklyMeetingsHours + ktHours);
      const deploymentSeniorHours = Math.round(deploymentHours);

      const testingOverride = memberOverrides[seniorTestingRole];
      const finalTestingCount = testingOverride ? testingOverride.count : 1;
      const finalTestingHours = testingOverride && testingOverride.hours_per_member !== undefined ? testingOverride.hours_per_member : testingSeniorHours;
      const finalTestingWeeks = testingOverride && testingOverride.active_weeks !== undefined ? testingOverride.active_weeks : Number(((finalTestingHours / 40) * 0.75).toFixed(2));

      allMembers.push({
        role: seniorTestingRole,
        count: finalTestingCount,
        description: "Handles internal testing (15%), external testing (15%), client requirements (16h), weekly meetings (16h), and KT (8h).",
        weekly_hours: 40,
        active_weeks: finalTestingWeeks,
        hours_per_member: finalTestingHours,
        hourly_rate: calculateHourlyPay(resSenior.experience_years)
      });

      const deploymentOverride = memberOverrides[seniorDeploymentRole];
      const finalDeploymentCount = deploymentOverride ? deploymentOverride.count : 1;
      const finalDeploymentHours = deploymentOverride && deploymentOverride.hours_per_member !== undefined ? deploymentOverride.hours_per_member : deploymentSeniorHours;
      const finalDeploymentWeeks = deploymentOverride && deploymentOverride.active_weeks !== undefined ? deploymentOverride.active_weeks : Number(((finalDeploymentHours / 40) * 0.75).toFixed(2));

      allMembers.push({
        role: seniorDeploymentRole,
        count: finalDeploymentCount,
        description: "Handles deployment activities (10%).",
        weekly_hours: 40,
        active_weeks: finalDeploymentWeeks,
        hours_per_member: finalDeploymentHours,
        hourly_rate: calculateHourlyPay(resSenior.experience_years)
      });

      if (midHours > 0) {
        const midOverride = memberOverrides[midRole];
        const finalMidCount = midOverride ? midOverride.count : midCount;
        const finalMidHours = midOverride && midOverride.hours_per_member !== undefined ? midOverride.hours_per_member : Math.round(midHours / midCount);
        const finalMidWeeks = midOverride && midOverride.active_weeks !== undefined ? midOverride.active_weeks : Number(((finalMidHours) / 40).toFixed(2));

        allMembers.push({
          role: midRole,
          count: finalMidCount,
          description: "Handles core module development tasks.",
          weekly_hours: 40,
          active_weeks: finalMidWeeks,
          hours_per_member: finalMidHours,
          hourly_rate: calculateHourlyPay(resMid.experience_years)
        });
      }

      if (juniorHours > 0) {
        const juniorOverride = memberOverrides[juniorRole];
        const finalJuniorCount = juniorOverride ? juniorOverride.count : juniorCount;
        const finalJuniorHours = juniorOverride && juniorOverride.hours_per_member !== undefined ? juniorOverride.hours_per_member : Math.round(juniorHours / juniorCount);
        const finalJuniorWeeks = juniorOverride && juniorOverride.active_weeks !== undefined ? juniorOverride.active_weeks : Number((((finalJuniorHours) / 40) * 1.30).toFixed(2));

        allMembers.push({
          role: juniorRole,
          count: finalJuniorCount,
          description: "Assists with module development tasks under supervision.",
          weekly_hours: 40,
          active_weeks: finalJuniorWeeks,
          hours_per_member: finalJuniorHours,
          hourly_rate: calculateHourlyPay(resJunior.experience_years)
        });
      }

      const pmOverride = memberOverrides[pmRole];
      const finalPmCount = pmOverride ? pmOverride.count : 1;
      const finalPmHours = pmOverride && pmOverride.hours_per_member !== undefined ? pmOverride.hours_per_member : Math.round(pmHours);
      const finalPmWeeks = pmOverride && pmOverride.active_weeks !== undefined ? pmOverride.active_weeks : Number((finalPmHours / 40).toFixed(2));

      allMembers.push({
        role: pmRole,
        count: finalPmCount,
        description: "Provides project management and delivery governance (15% of total base effort).",
        weekly_hours: 40,
        active_weeks: finalPmWeeks,
        hours_per_member: finalPmHours,
        hourly_rate: calculateHourlyPay(resPm.experience_years)
      });

      // Add Risk Contingency
      const riskOverride = memberOverrides["Risk Contingency (10%)"];
      const finalRiskHours = riskOverride && riskOverride.hours_per_member !== undefined ? riskOverride.hours_per_member : Math.round(riskHours);
      allMembers.push({
        role: "Risk Contingency (10%)",
        count: 1,
        description: "Calculated contingency buffer (10% of efforts estimation).",
        weekly_hours: 40,
        active_weeks: Number((finalRiskHours / 40).toFixed(2)),
        hours_per_member: finalRiskHours,
        hourly_rate: 0
      });

      // Add Negotiation Buffer
      const negOverride = memberOverrides["Negotiation Buffer (5%)"];
      const finalNegHours = negOverride && negOverride.hours_per_member !== undefined ? negOverride.hours_per_member : Math.round(negotiationHours);
      allMembers.push({
        role: "Negotiation Buffer (5%)",
        count: 1,
        description: "Calculated negotiation buffer (5% of efforts estimation).",
        weekly_hours: 40,
        active_weeks: Number((finalNegHours / 40).toFixed(2)),
        hours_per_member: finalNegHours,
        hourly_rate: 0
      });
    }

    const totalSize = allMembers.reduce((s, m) => s + (m.role.includes("Contingency") || m.role.includes("Buffer") ? 0 : (Number(m.count) || 0)), 0);
    const totalProjHours = allMembers.reduce((s, m) => s + (Number(m.count) || 0) * (Number(m.hours_per_member) || 0), 0);
    const maxWeeks = allMembers.reduce((mx, m) => Math.max(mx, Number(m.active_weeks) || 0), 0);

    setTeamData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: allMembers,
        total_size: totalSize,
        total_project_hours: totalProjHours,
        total_working_weeks: maxWeeks,
      };
    });
  }, [moduleAllocations, integratedSupportMembers, memberOverrides, activeModules, selectedOption, companyRoster, analysisResult]);

  const handleApprovedSrsAnalysis = async () => {
    if (!hasApprovedSrs) {
      setError("Approve an SRS first so team allocation can inherit the scope.");
      return;
    }

    await runAnalysis({
      text: approvedBlueprintText,
      title: srsData?.structuredRequirements?.project_name || localProjectTitle || projectTitle,
      skipDirectExtraction: true, // SRS blueprints are always full generative analysis
    });
  };


  const updateMemberCount = (index, delta) => {
    const memberToUpdate = teamData.members[index];
    const sIndex = supportAllocations.findIndex(s => s.role === memberToUpdate.role);
    if (sIndex !== -1) {
      const nextSupport = [...supportAllocations];
      nextSupport[sIndex].count = Math.max(0, (Number(nextSupport[sIndex].count) || 0) + delta);
      setSupportAllocations(nextSupport);
    } else {
      setMemberOverrides((prev) => {
        const existing = prev[memberToUpdate.role] || {
          count: memberToUpdate.count,
          active_weeks: memberToUpdate.active_weeks,
        };
        return {
          ...prev,
          [memberToUpdate.role]: {
            ...existing,
            count: Math.max(0, existing.count + delta),
          },
        };
      });
    }
  };

  const updateSupportAllocation = (index, patch) => {
    setSupportAllocations((current) => {
      const next = [...current];
      const existing = next[index];
      if (!existing) return current;
      const updated = { ...existing, ...patch };
      if (patch.active_weeks !== undefined) {
        updated.active_weeks = Math.max(0, Number(patch.active_weeks) || 0);
        updated.hours_per_member = Math.round((updated.active_weeks || 0) * (Number(updated.weekly_hours) || 40));
        updated.manuallyEdited = true;
      }
      if (patch.hours_per_member !== undefined) {
        updated.hours_per_member = Math.max(0, Number(patch.hours_per_member) || 0);
        updated.active_weeks = Math.max(1, Number(deliveryMetrics.maxWeeks) || 1);
        updated.weekly_hours = Math.max(1, Math.round(updated.hours_per_member / updated.active_weeks));
        updated.manuallyEdited = true;
      }
      if (patch.count !== undefined) {
        updated.count = Math.max(0, Number(patch.count) || 0);
      }
      next[index] = updated;
      return next;
    });
  };

  const addSupportFromRoster = (resource) => {
    if (!resource) return;

    const workstream = classifyRoleWorkstream(resource.role);
    const baseMember = {
      role: `${resource.name} (${resource.role})`,
      count: 1,
    };
    const effort = buildSupportEffort({
      member: baseMember,
      workstream,
      deliveryHours: deliveryMetrics.totalHours,
      deliveryWeeks: deliveryMetrics.maxWeeks,
      planningPreferences,
      companyRoster,
    });

    setSupportAllocations((current) => [
      ...current,
      {
        ...baseMember,
        count: 1,
        ...effort,
        selected: true,
        hourly_rate: calculateHourlyPay(resource.experience_years),
      },
    ]);
  };

  const handleApprove = () => {
    setPrevTeamData(teamData);
    const approvedTeam = buildApprovedTeamPayload(teamData);
    saveApprovedTeam(approvedTeam);
    setTeamData(approvedTeam);
    setStep(3);
  };

  const handleUndo = () => {
    if (!prevTeamData) return;
    setTeamData(prevTeamData);
    setStep(2);
  };

  const handleBundleDownload = async () => {
    if (!teamData) return;

    setIsDownloading(true);
    setError("");

    try {
      await downloadDeliverableBundle({
        srsData,
        teamData: buildApprovedTeamPayload(teamData),
      });
    } catch (downloadError) {
      setError(downloadError.message || "Unable to download the deliverables bundle.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFormatDownload = async (format) => {
    if (!teamData) return;

    setDownloadingFormat(format);
    setError("");

    try {
      const approvedTeam = buildApprovedTeamPayload(teamData);
      if (format === "excel") {
        await handleBundleDownload();
        return;
      }

      if (format === "pdf") {
        const srsPdf = srsData?.pdfPath || srsData?.pdf_path;
        if (srsPdf) triggerAssetDownload(srsPdf);
        await exportTeamPdf(approvedTeam);
        return;
      }

      if (format === "word") {
        const srsWord = srsData?.docxPath || srsData?.docx_path;
        if (srsWord) triggerAssetDownload(srsWord);
        await exportTeamWord(approvedTeam);
      }
    } catch (downloadError) {
      setError(downloadError.message || "Unable to download the selected format.");
    } finally {
      setDownloadingFormat("");
    }
  };

  const proceedToCosting = () => {
    const approvedTeam = buildApprovedTeamPayload(teamData);
    saveApprovedTeam(approvedTeam);
    saveCostDraft(createCostDraftFromTeamData(approvedTeam));
    router.push("/cost-estimation");
  };

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", paddingBottom: "1.5rem" }}>

      {/* HEADER */}
      <section
        style={{
          paddingTop: "clamp(4rem, 5vw, 4.5rem)",
          paddingBottom: "1.25rem",
          paddingLeft: "clamp(1.5rem, 5vw, 5rem)",
          paddingRight: "clamp(1.5rem, 5vw, 5rem)",
          borderBottom: "1px solid rgba(10,28,22,0.12)",
        }}
      >
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.5)" }}>
              Phase 02 — Team Allocation
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 300,
                fontSize: "clamp(1.6rem, 3vw, 2.5rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                color: "#0A1C16",
              }}
            >
              Turn the approved SRS into an{" "}
              <em
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontWeight: 400,
                  opacity: 0.65,
                }}
              >
                editable team.
              </em>
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.95rem",
                maxWidth: "640px",
                color: "rgba(10,28,22,0.7)",
                lineHeight: 1.6,
                fontWeight: 300,
              }}
            >
              Connects directly to the approved SRS - so the staffing recommendation is generated from the exact blueprint you approved.
            </p>
          </div>
        </div>
      </section>

      <div style={{ paddingTop: "1rem", paddingBottom: "0", paddingLeft: "clamp(1.5rem, 5vw, 5rem)", paddingRight: "clamp(1.5rem, 5vw, 5rem)" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%", position: "relative", zIndex: 10 }}>

          {error ? (
            <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", color: "#991b1b", padding: "1rem 1.5rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem", marginBottom: "1.5rem", clipPath: "polygon(0 0, 100% 0, 100% 100%, 18px 100%, 0 calc(100% - 18px))" }}>
              {error}
            </div>
          ) : null}

          {/* NO APPROVED SRS FALLBACK */}
          {!hasApprovedSrs && !isAnalyzing ? (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", minHeight: "65vh", justifyContent: "center", alignItems: "center", background: "#F5F3EE", padding: "2rem" }}>
              <div style={{ maxWidth: "600px", width: "100%", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", border: "1px solid #0A1C16", padding: "2.5rem", background: "rgba(196,215,201,0.1)", clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%)" }}>
                <div style={{ width: "70px", height: "70px", border: "1px solid rgba(10,28,22,0.2)", display: "flex", alignItems: "center", justifyContent: "center", clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)" }}>
                  <Users size={28} strokeWidth={1} style={{ opacity: 0.4 }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.5)", textTransform: "uppercase", letterSpacing: "0.15em", fontSize: "0.75rem" }}>
                    Awaiting Requirement Approval
                  </p>
                  <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.6rem", color: "#0A1C16", letterSpacing: "-0.01em" }}>
                    SRS Document Pending Approval
                  </h2>
                  <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.9rem", color: "rgba(10,28,22,0.65)", lineHeight: 1.5, maxWidth: "420px", margin: "0.5rem auto 0 auto" }}>
                    To generate a precise staffing and effort analysis, you must first approve your SRS specifications in Phase 01.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/srs-approval")}
                  style={{
                    padding: "0.75rem 1.75rem",
                    border: "1px solid #0A1C16",
                    background: "#0A1C16",
                    color: "#F5F2E8",
                    fontFamily: "var(--font-display)",
                    fontSize: "0.8rem",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    transition: "all 0.3s ease",
                    cursor: "pointer",
                    clipPath: "polygon(0 0, 100% 0, 100% 100%, 16px 100%, 0 calc(100% - 16px))"
                  }}
                >
                  Go to SRS Approval
                </button>
              </div>
            </div>
          ) : null}

          {/* STEP 1: Connected Input / Approved SRS Card */}
          {hasApprovedSrs && !isAnalyzing && step === 1 ? (
             <div className="space-y-4">
               {/* Collapsible Company Resource Roster in Step 1 */}
               <div className="border border-parcelles-dark bg-parcelles-bg/40 p-4 sm:p-5 animate-fade-in" style={{ clipPath: "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%)" }}>
                 <div className="flex items-center justify-between border-b border-parcelles-dark pb-3 mb-4">
                   <div className="flex items-center gap-3">
                     <Users size={20} className="text-parcelles-dark" />
                     <div>
                       <h3 className="font-display text-lg">Company Resource Roster</h3>
                       <p className="font-body text-[10px] opacity-60 mt-0.5">Staffing candidates used to map skills & seniority</p>
                     </div>
                   </div>
                   <button
                     type="button"
                     onClick={() => setIsRosterCollapsed(!isRosterCollapsed)}
                     className="font-display text-xs uppercase tracking-widest border border-parcelles-dark px-3 py-1 hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors"
                   >
                     {isRosterCollapsed ? "Show Roster" : "Hide Roster"}
                   </button>
                 </div>

                 {!isRosterCollapsed && (
                   <div className="space-y-4">
                     <div className="bg-parcelles-sage/10 border border-parcelles-dark/20 p-3 font-body text-xs leading-relaxed text-parcelles-dark/80">
                       <strong>Seniority & Allocation Logic:</strong> The AI allocates resources from this roster. It assigns <strong>Lead/Senior</strong> members (6+ Yrs Exp) to High complexity modules, <strong>Mid-level</strong> members (3-5 Yrs Exp) to Medium modules, and <strong>Junior</strong> members (1-2 Yrs Exp) to Low complexity modules.
                     </div>

                     <div className="border border-parcelles-dark divide-y divide-parcelles-dark/20">
                       <div className="grid grid-cols-12 gap-3 items-center bg-parcelles-sage/20 p-2.5 font-display uppercase tracking-wider text-[10px]">
                         
                         
                         <div className="col-span-3">Name</div>
                          <div className="col-span-3">Designated Role</div>
                          <div className="col-span-2">Experience (Yrs)</div>
                          <div className="col-span-3">Hourly Pay</div>
                         <div className="col-span-1 text-right">Action</div>
                       </div>

                       <div className="divide-y divide-parcelles-dark/10 max-h-[200px] overflow-y-auto">
                         {companyRoster.map((member, index) => (
                           <div key={index} className="grid grid-cols-12 gap-3 items-center p-2 font-body text-xs hover:bg-parcelles-sage/5 transition-colors">
                             <div className="col-span-3 font-medium text-parcelles-dark">{member.name}</div>
                             <div className="col-span-3 text-parcelles-dark/70">{member.role}</div>
                             <div className="col-span-2 flex items-center gap-2">
                               <input
                                 type="number"
                                 min="0"
                                 max="50"
                                 step="0.5"
                                 value={member.experience_years}
                                 onChange={(e) => handleUpdateRosterMemberExp(index, e.target.value)}
                                 className="w-14 border border-parcelles-dark/30 px-2 py-0.5 text-center bg-transparent focus:border-parcelles-dark outline-none transition-colors font-mono"
                               />
                               <span className="text-[10px] text-parcelles-dark/50">yrs</span>
                             </div>
                             <div className="col-span-3 font-mono font-medium text-parcelles-dark">
                               ₹{calculateHourlyPay(member.experience_years)}/hr
                             </div>
                             <div className="col-span-1 text-right">
                               <button
                                 type="button"
                                 onClick={() => handleRemoveRosterMember(index)}
                                 className="text-red-700 hover:text-red-900 transition-colors p-1"
                                 title="Remove resource"
                               >
                                 <Trash2 size={14} />
                               </button>
                             </div>
                           </div>
                         ))}
                       </div>

                       {/* Add new member form row */}
                       <div className="grid grid-cols-12 gap-3 items-center p-2 bg-parcelles-sage/10 font-body text-xs">
                         <div className="col-span-3">
                           <input
                             type="text"
                             placeholder="Resource Name"
                             value={newMemberName}
                             onChange={(e) => setNewMemberName(e.target.value)}
                             className="w-full border border-parcelles-dark/30 px-2 py-1 bg-transparent focus:border-parcelles-dark outline-none transition-colors"
                           />
                         </div>
                         <div className="col-span-3">
                           <select
                             value={newMemberRole}
                             onChange={(e) => setNewMemberRole(e.target.value)}
                             className="w-full border border-parcelles-dark/30 px-2 py-1 bg-parcelles-bg focus:border-parcelles-dark outline-none transition-colors"
                             style={{ cursor: "pointer" }}
                           >
                             <option value="Lead Full Stack Developer">Lead Full Stack Developer</option>
                             <option value="Senior Full Stack Developer">Senior Full Stack Developer</option>
                             <option value="Junior Full Stack Developer">Junior Full Stack Developer</option>
                             <option value="QA Tester">QA Tester</option>
                             <option value="Project Manager">Project Manager</option>
                             <option value="DevOps Engineer">DevOps Engineer</option>
                           </select>
                         </div>
                         <div className="col-span-2 flex items-center gap-2">
                           <input
                             type="number"
                             min="0"
                             max="50"
                             value={newMemberExp}
                             onChange={(e) => setNewMemberExp(e.target.value)}
                             className="w-14 border border-parcelles-dark/30 px-2 py-0.5 text-center bg-transparent focus:border-parcelles-dark outline-none transition-colors font-mono"
                           />
                           <span className="text-[10px] text-parcelles-dark/50">yrs</span>
                         </div>
                         <div className="col-span-3 font-mono font-medium text-parcelles-dark/70">
                           ₹{calculateHourlyPay(newMemberExp)}/hr
                         </div>
                         <div className="col-span-1 text-right">
                           <button
                             type="button"
                             onClick={handleAddRosterMember}
                             disabled={!newMemberName.trim()}
                             className="border border-parcelles-dark bg-parcelles-dark text-parcelles-bg px-2 py-0.5 hover:opacity-90 disabled:opacity-30 transition-opacity font-display text-[10px] uppercase"
                           >
                             Add
                           </button>
                         </div>
                       </div>
                     </div>
                   </div>
                 )}
               </div>

                 {/* Intake Card (No Tabs, just Approved SRS) */}
                 <section style={{ background: "rgba(196,215,201,0.25)", border: "1px solid #0A1C16", padding: "1.25rem", clipPath: "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%)" }}>
                   <div className="bg-parcelles-bg border border-parcelles-dark flex flex-col chamfer-bottom-left">
                     <div className="p-5 sm:p-6 space-y-5">
                       <div className="flex flex-wrap items-start justify-between gap-4 border-b border-parcelles-dark pb-4">
                         <div>
                           <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Connected Input</p>
                           <h2 className="text-xl font-display mt-1">Use the approved SRS</h2>
                           <p className="font-body text-xs opacity-80 mt-2 max-w-xl leading-relaxed">
                             ScopeSense AI will generate the staffing model from the approved blueprint so team allocation stays
                             aligned with the exact modules, features, and pages already reviewed.
                           </p>
                         </div>
                         <span className="px-3 py-0.5 text-xs font-display uppercase tracking-widest border border-parcelles-dark rounded-full bg-parcelles-dark text-parcelles-bg">
                           Connected
                         </span>
                       </div>

                       <div className="grid grid-cols-3 gap-4">
                         {[
                           { label: "Modules", value: approvedSrsStats.modules },
                           { label: "Features", value: approvedSrsStats.features },
                           { label: "UI Pages", value: approvedSrsStats.uiPages },
                         ].map(stat => (
                           <div key={stat.label} className="p-4 border border-parcelles-dark chamfer-bottom-right transition-colors hover:bg-parcelles-sage/20 text-center">
                             <p className="font-display uppercase tracking-widest text-[9px] opacity-60">{stat.label}</p>
                             <p className="text-3xl font-display mt-2">{stat.value}</p>
                           </div>
                         ))}
                       </div>

                       <button
                         type="button"
                         onClick={handleApprovedSrsAnalysis}
                         disabled={isAnalyzing || !hasApprovedSrs}
                         className="w-full sm:w-auto mt-4 px-6 py-3 bg-parcelles-dark text-parcelles-bg flex justify-center items-center gap-2.5 font-display text-sm chamfer-bottom-left hover:opacity-90 disabled:opacity-50"
                       >
                         {isAnalyzing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                         {isAnalyzing ? "Analyzing blueprint..." : "Generate Team from Approved SRS"}
                       </button>
                     </div>
                   </div>
                 </section>
             </div>
          ) : null}

          {hasApprovedSrs && !isAnalyzing && step === 2 && teamData ? (
            <div>
              <section style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-parcelles-dark pb-4">
                  <div>
                    <p className="font-display uppercase tracking-widest text-[10px] opacity-65">AI Recommendation</p>
                    <h2 className="text-3xl font-display mt-1">{teamData.project_name}</h2>
                    <div className="mt-2.5 flex flex-wrap gap-2.5 font-display text-xs">
                      <div className="px-2.5 py-0.5 border border-parcelles-dark rounded-full flex items-center gap-1.5">
                        <Users size={14} />
                        {teamData.members.length} roles
                      </div>
                      <div className="px-2.5 py-0.5 bg-parcelles-dark text-parcelles-bg rounded-full">
                        {teamData.members.reduce((total, member) => total + (Number(member.count) || 0), 0)} people total
                      </div>
                      {teamData.total_working_weeks ? (
                        <div className="px-2.5 py-0.5 border border-parcelles-dark rounded-full">
                          {Math.round(teamData.total_working_weeks * 40)} hrs ({Math.ceil(teamData.total_working_weeks * 5)} days) duration
                        </div>
                      ) : null}
                      {teamData.total_project_hours ? (
                        <div className="px-2.5 py-0.5 border border-parcelles-dark rounded-full">
                          {parseFloat(teamData.total_project_hours.toFixed(1))} hrs ({Math.ceil(teamData.total_project_hours / 8)} days) total
                        </div>
                      ) : null}
                      {analysisResult?.feature_complexity_analysis?.length ? (() => {
                        const total = analysisResult.feature_complexity_analysis.length;
                        const active = analysisResult.feature_complexity_analysis.filter(
                          (m) => activeModules[m.module_name] !== false
                        ).length;
                        return (
                          <div className={`px-2.5 py-0.5 rounded-full border transition-colors ${active < total ? "bg-amber-100 border-amber-500 text-amber-800" : "border-parcelles-dark"}`}>
                            {active}/{total} modules in scope
                          </div>
                        );
                      })() : null}
                    </div>
                  </div>

                </div>

                {/* DYNAMIC ROSTER EFFORT SUMMARY */}
                <div className="border border-parcelles-dark bg-parcelles-bg p-4 sm:p-5 chamfer-bottom-right space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-parcelles-dark pb-3">
                    <div>
                      <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Company Roster Metrics</p>
                      <h2 className="text-lg font-display mt-0.5">Dynamic Roster Effort Summary</h2>
                    </div>
                    <span className="px-3 py-0.5 text-[10px] font-display uppercase tracking-widest bg-parcelles-dark text-parcelles-bg rounded-full">
                      Real-time Allocation
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div 
                      style={{
                        background: "linear-gradient(135deg, #052D21 0%, #0A1C16 100%)",
                        borderColor: "#10B981",
                        boxShadow: "0 8px 20px -4px rgba(16, 185, 129, 0.12)",
                        color: "#D1FAE5"
                      }}
                      className="p-4 sm:p-5 border chamfer-bottom-right flex flex-col justify-between"
                    >
                      <div>
                        <h3 className="font-serif italic text-xl mt-3 leading-tight">Project Duration</h3>
                        <p className="font-body text-[11px] mt-1.5 opacity-80 leading-relaxed">
                          The timeline required to deliver the active module scope, driven reactively by the longest active resource assignment.
                        </p>
                      </div>
                      <div className="mt-5 pt-3 border-t border-emerald-800/40 flex items-baseline justify-between font-display text-sm">
                        <span className="opacity-60 text-[9px] uppercase tracking-wider">Total Duration</span>
                        <div className="text-right">
                          <span className="text-xl font-bold">{Math.round(teamData.total_working_weeks * 40)} hrs</span>
                          <span className="text-[11px] opacity-70 ml-1.5">/ {Math.ceil(teamData.total_working_weeks * 5)} days</span>
                        </div>
                      </div>
                    </div>

                    <div 
                      style={{
                        background: "linear-gradient(135deg, #05262D 0%, #0A1C16 100%)",
                        borderColor: "#06B6D4",
                        boxShadow: "0 8px 20px -4px rgba(6, 182, 212, 0.12)",
                        color: "#CFFAFE"
                      }}
                      className="p-4 sm:p-5 border chamfer-bottom-right flex flex-col justify-between"
                    >
                      <div>
                        <h3 className="font-serif italic text-xl mt-3 leading-tight">Engineering Effort</h3>
                        <p className="font-body text-[11px] mt-1.5 opacity-80 leading-relaxed">
                          The total engineering hours calculated in real-time across all assigned developers, testers, and release workflows.
                        </p>
                      </div>
                      <div className="mt-5 pt-3 border-t border-cyan-800/40 flex items-baseline justify-between font-display text-sm">
                        <span className="opacity-60 text-[9px] uppercase tracking-wider">Total Effort</span>
                        <div className="text-right">
                          <span className="text-xl font-bold">{parseFloat(teamData.total_project_hours.toFixed(1))} hrs</span>
                          <span className="text-[11px] opacity-70 ml-1.5">/ {Math.ceil(teamData.total_project_hours / 8)} days</span>
                        </div>
                      </div>
                    </div>

                    <div 
                      style={{
                        background: "linear-gradient(135deg, #1C1C1C 0%, #0A1C16 100%)",
                        borderColor: "#8B5CF6",
                        boxShadow: "0 8px 20px -4px rgba(139, 92, 246, 0.12)",
                        color: "#EDE9FE"
                      }}
                      className="p-4 sm:p-5 border chamfer-bottom-right flex flex-col justify-between"
                    >
                      <div>
                        <Users className="w-6 h-6 text-purple-300" />
                        <h3 className="font-serif italic text-xl mt-3 leading-tight">Roster Size</h3>
                        <p className="font-body text-[11px] mt-1.5 opacity-80 leading-relaxed">
                          The count of distinct allocated professionals from the company roster currently operating in active roles.
                        </p>
                      </div>
                      <div className="mt-5 pt-3 border-t border-purple-800/40 flex items-baseline justify-between font-display text-sm">
                        <span className="opacity-60 text-[9px] uppercase tracking-wider">Total Size</span>
                        <span className="text-xl font-bold">
                          {teamData.members.reduce((total, member) => total + (Number(member.count) || 0), 0)} members
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* EFFORT CALCULATIONS & MATHEMATICAL BREAKDOWN */}
                {mathBreakdown && (
                  <div className="border border-parcelles-dark bg-parcelles-bg p-6 sm:p-8 chamfer-bottom-right space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-parcelles-dark pb-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 border border-parcelles-dark flex items-center justify-center chamfer-bottom-left bg-parcelles-sage/20">
                          <BarChart3 className="w-5 h-5 text-parcelles-dark" />
                        </div>
                        <div>
                          <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Formula &amp; Effort Traceability</p>
                          <h2 className="text-xl font-display mt-0.5">Effort Calculations &amp; Mathematical Breakdown</h2>
                        </div>
                      </div>
                      <span className="px-3 py-0.5 text-[10px] font-display uppercase tracking-widest bg-parcelles-dark/10 border border-parcelles-dark/20 text-parcelles-dark rounded-full">
                        Strict Equation Model
                      </span>
                    </div>

                    <div className="grid lg:grid-cols-[1fr_1.2fr] gap-8">
                      {/* Left: Module-wise Effort Analysis */}
                      <div className="space-y-4">
                        <div>
                          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-parcelles-dark">Module-wise Development Effort</h3>
                          <p className="font-body text-xs text-parcelles-dark/70 mt-1">
                            Sum of development hours across active feature modules.
                          </p>
                        </div>
                        <div className="border border-parcelles-dark divide-y divide-parcelles-dark/15 max-h-[350px] overflow-y-auto pr-2">
                          {mathBreakdown.moduleEfforts.map((mod, idx) => (
                            <div key={idx} className="p-3 flex justify-between items-center hover:bg-parcelles-sage/5 transition-colors">
                              <span className="font-body text-xs text-parcelles-dark font-medium line-clamp-1">{mod.name}</span>
                              <span className="font-mono text-xs font-bold text-parcelles-dark shrink-0 ml-3">
                                {mod.hours} hrs <span className="font-normal opacity-55 text-[10px]">({Math.ceil(mod.hours / 8)}d)</span>
                              </span>
                            </div>
                          ))}
                          <div className="p-3 bg-parcelles-sage/15 flex justify-between items-center font-bold">
                            <span className="font-display text-xs uppercase tracking-wider">Total Development Hours</span>
                            <span className="font-mono text-sm">
                              {mathBreakdown.totalDevHours} hrs <span className="font-normal opacity-65 text-[11px]">({Math.ceil(mathBreakdown.totalDevHours / 8)}d)</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Step-by-Step Mathematical Calculations */}
                      <div className="space-y-5 lg:border-l lg:border-parcelles-dark/15 lg:pl-8">
                        <div>
                          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-parcelles-dark">Calculation Steps</h3>
                          <p className="font-body text-xs text-parcelles-dark/70 mt-1">
                            How development effort is converted to testing, deployment, management, and buffer hours.
                          </p>
                        </div>

                        <div className="space-y-3.5">
                          {/* Step 1: Dev Hours */}
                          <div className="bg-parcelles-sage/5 border border-parcelles-dark/10 p-3 rounded space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="font-display text-xs font-bold uppercase tracking-wider">1. Base Development Effort</span>
                              <span className="font-mono text-xs font-bold">{mathBreakdown.totalDevHours} hrs</span>
                            </div>
                          </div>

                          {/* Step 2: Senior Developer Testing */}
                          <div className="bg-parcelles-sage/5 border border-parcelles-dark/10 p-3 rounded space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-display text-xs font-bold uppercase tracking-wider">2. Testing &amp; Governance</span>
                              <span className="font-mono text-xs font-bold text-indigo-950">{(mathBreakdown.testingInternal + mathBreakdown.testingExternal + mathBreakdown.reqFetch + mathBreakdown.weeklyMeetings + mathBreakdown.kt).toFixed(1)} hrs</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[10px] text-parcelles-dark/85">
                              <div>• Internal Testing: <span className="font-bold">{mathBreakdown.testingInternal.toFixed(1)} hrs</span></div>
                              <div>• External Testing: <span className="font-bold">{mathBreakdown.testingExternal.toFixed(1)} hrs</span></div>
                              <div>• Requirement Fetch: <span className="font-bold">{mathBreakdown.reqFetch} hrs</span></div>
                              <div>• Weekly Meetings: <span className="font-bold">{mathBreakdown.weeklyMeetings} hrs</span></div>
                              <div>• KT Session: <span className="font-bold">{mathBreakdown.kt} hrs</span></div>
                            </div>
                          </div>

                          {/* Step 3: Senior Developer Deployment */}
                          <div className="bg-parcelles-sage/5 border border-parcelles-dark/10 p-3 rounded space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-display text-xs font-bold uppercase tracking-wider">3. Deployment</span>
                              <span className="font-mono text-xs font-bold text-blue-950">{mathBreakdown.deployment.toFixed(1)} hrs</span>
                            </div>
                          </div>

                          {/* Step 4: Base Effort & PM */}
                          <div className="bg-parcelles-sage/5 border border-parcelles-dark/10 p-3 rounded space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-display text-xs font-bold uppercase tracking-wider">4. Base Effort &amp; Project Management</span>
                              <span className="font-mono text-xs font-bold text-amber-950">{mathBreakdown.pmHours.toFixed(1)} hrs</span>
                            </div>
                          </div>

                          {/* Step 4: Contingencies */}
                          <div className="bg-parcelles-sage/5 border border-parcelles-dark/10 p-3 rounded space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-display text-xs font-bold uppercase tracking-wider">5. Contingencies &amp; Buffers</span>
                              <span className="font-mono text-xs font-bold text-emerald-950">{(mathBreakdown.riskHours + mathBreakdown.negotiationHours).toFixed(1)} hrs</span>
                            </div>
                          </div>

                          {/* Grand Total */}
                          <div className="bg-parcelles-dark text-parcelles-bg p-4 flex justify-between items-center font-bold">
                            <span className="font-display text-sm uppercase tracking-wider">Grand Total Effort Hours</span>
                            <span className="font-mono text-lg">{mathBreakdown.grandTotalHours.toFixed(1)} hrs</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* AI FEATURE COMPLEXITY & TIMELINE GRID */}
                {analysisResult?.feature_complexity_analysis?.length ? (
                  <div className="border border-parcelles-dark bg-parcelles-bg p-6 sm:p-8 chamfer-bottom-right space-y-6">
                    <div 
                      onClick={() => setIsComplexityExpanded(!isComplexityExpanded)}
                      style={{ cursor: "pointer" }}
                      className="flex flex-wrap items-center justify-between gap-4 border-b border-parcelles-dark pb-4 mb-6"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 border border-parcelles-dark flex items-center justify-center chamfer-bottom-left bg-parcelles-sage/20">
                          <Sparkles size={18} className="text-parcelles-dark" />
                        </div>
                        <div>
                          <p className="font-display uppercase tracking-widest text-[9px] opacity-60">AI Real-time Scope Analysis</p>
                          <h2 className="text-xl font-display mt-0.5">Feature Complexity &amp; Staffing Analysis</h2>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="px-4 py-1 text-xs font-display uppercase tracking-widest bg-parcelles-dark/10 border border-parcelles-dark/20 text-parcelles-dark rounded-full">
                          Roster Allocation: <span className="font-bold underline">Real-time</span>
                        </span>
                        {isComplexityExpanded ? <ChevronUp size={20} className="text-parcelles-dark" /> : <ChevronDown size={20} className="text-parcelles-dark" />}
                      </div>
                    </div>

                    {isComplexityExpanded && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {analysisResult.feature_complexity_analysis.map((module, idx) => {
                        const complexityColors = {
                          High: { bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.25)", text: "#991b1b" },
                          Medium: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", text: "#92400e" },
                          Low: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", text: "#065f46" }
                        };
                        const col = complexityColors[module.complexity] || complexityColors.Medium;
                        const isModuleActive = activeModules[module.module_name] !== false;

                        return (
                          <div
                            key={idx}
                            style={{ opacity: isModuleActive ? 1 : 0.45, transition: "opacity 0.3s ease" }}
                            className="border border-parcelles-dark bg-parcelles-bg/40 hover:bg-parcelles-sage/5 transition-all duration-300 p-6 flex flex-col justify-between chamfer-bottom-right group"
                          >
                            <div>
                              <div className="flex justify-between items-start gap-4">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {/* Active-in-scope toggle */}
                                  <button
                                    type="button"
                                    onClick={() => toggleModule(module.module_name)}
                                    title={isModuleActive ? "Click to exclude from scope" : "Click to include in scope"}
                                    className="shrink-0 flex items-center gap-1.5 px-2 py-0.5 border font-display text-[9px] uppercase tracking-wider rounded-full transition-all duration-200"
                                    style={{
                                      borderColor: isModuleActive ? "#0A1C16" : "rgba(10,28,22,0.3)",
                                      background: isModuleActive ? "#0A1C16" : "transparent",
                                      color: isModuleActive ? "#F5F2E8" : "rgba(10,28,22,0.5)",
                                    }}
                                  >
                                    <span style={{ fontSize: "8px" }}>{isModuleActive ? "✓" : "○"}</span>
                                    {isModuleActive ? "In Scope" : "Excluded"}
                                  </button>
                                  <h3 className="font-display text-lg text-parcelles-dark font-bold line-clamp-2">{module.module_name}</h3>
                                </div>
                                <span
                                  className="shrink-0 inline-block px-2.5 py-0.5 font-display text-[9px] uppercase tracking-wider rounded-full border"
                                  style={{ backgroundColor: col.bg, borderColor: col.border, color: col.text }}
                                >
                                  {module.complexity}
                                </span>
                              </div>

                              <div className="mt-4 flex items-center justify-between border-y border-parcelles-dark/10 py-2.5">
                                <span className="font-body text-xs opacity-70">Estimated Effort:</span>
                                <span className="font-display text-sm font-bold text-parcelles-dark">
                                  {parseFloat(Number(module.estimated_hours).toFixed(1))} hrs
                                  <span className="font-normal opacity-60 text-[11px] ml-1">/ {Math.ceil(Number(module.estimated_hours) / 8)} days</span>
                                </span>
                              </div>

                              <p className="mt-4 font-body text-xs text-parcelles-dark/80 leading-relaxed min-h-[40px]">
                                {module.reasoning}
                              </p>

                              {/* Screen Designs section */}
                              {module.screen_designs && module.screen_designs.length > 0 && (
                                <div className="mt-5 space-y-2">
                                  <span className="font-display text-[10px] uppercase tracking-wider opacity-60 block">Screen Designs & UI Layouts</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {module.screen_designs.map((screen, sIdx) => (
                                      <span key={sIdx} className="px-2 py-0.5 border border-parcelles-dark/20 bg-parcelles-sage/10 text-[10px] font-body text-parcelles-dark rounded">
                                        {screen}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Dynamic allocations listing */}
                              {(() => {
                                const assignedResources = moduleAllocations[module.module_name] || [];
                                const devAllocations = assignedResources.filter(alloc => {
                                  const roleLower = (alloc.role || "").toLowerCase();
                                  const descLower = (alloc.description || "").toLowerCase();
                                  return !descLower.includes("deployment") && !descLower.includes("testing") && !roleLower.includes("lead");
                                });

                                return (
                                  <div className="mt-5 border-t border-parcelles-dark/15 pt-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="font-display text-[10px] uppercase tracking-wider opacity-60 block">Staffing Assignment</span>
                                      <span className="text-[10px] font-mono text-parcelles-dark/60 font-bold">
                                        {devAllocations.filter(alloc => alloc.selected !== false).length}/{devAllocations.length} active
                                      </span>
                                    </div>

                                    <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                                      <div className="space-y-2">
                                        <span className="font-display text-[9px] uppercase tracking-wider text-parcelles-dark/70 font-semibold block">Development Allocation</span>
                                        {devAllocations.length > 0 ? (
                                          <div className="space-y-2">
                                            {devAllocations.map((alloc, aIdx) => {
                                              const originalIdx = assignedResources.findIndex(r => r === alloc);
                                              const share = Math.min(100, Math.round((alloc.hours / (module.estimated_hours || 1)) * 100));
                                              return (
                                                <div
                                                  key={aIdx}
                                                  className="p-3 border border-parcelles-dark/10 bg-parcelles-bg rounded space-y-2 transition-all"
                                                  style={{ opacity: alloc.selected === false ? 0.55 : 1 }}
                                                >
                                                  <div className="flex justify-between items-start text-xs font-display gap-2">
                                                    <div className="min-w-0 flex-1">
                                                      <label className="flex items-start gap-2 cursor-pointer">
                                                        <input
                                                          type="checkbox"
                                                          checked={alloc.selected !== false}
                                                          onChange={(e) => {
                                                            const nextList = [...assignedResources];
                                                            nextList[originalIdx].selected = e.target.checked;
                                                            if (!e.target.checked) {
                                                              delete nextList[originalIdx].manuallyEdited;
                                                            }
                                                            const activeAllocation =
                                                              selectedOption === "fastest" ? module.fastest_allocation :
                                                                selectedOption === "lean" ? module.lean_allocation :
                                                                  module.balanced_allocation;
                                                            const recalculatedList = recalculateModuleAllocations(nextList, module.estimated_hours, activeAllocation);
                                                            setModuleAllocations({
                                                              ...moduleAllocations,
                                                              [module.module_name]: recalculatedList
                                                            });
                                                          }}
                                                          className="mt-0.5"
                                                        />
                                                        <span>
                                                          <span className="font-bold text-parcelles-dark block truncate" title={alloc.name}>
                                                            {alloc.name}
                                                          </span>
                                                          <span className="text-[9px] text-parcelles-dark/55 block mt-1">
                                                            {parseFloat(Number(alloc.hours).toFixed(1))} hrs / {Math.ceil(Number(alloc.hours) / 8)} days
                                                          </span>
                                                        </span>
                                                      </label>
                                                    </div>

                                                    <div className="flex items-center gap-1">
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        max="1000"
                                                        value={alloc.hours}
                                                        onChange={(e) => {
                                                          const val = Math.max(0, parseInt(e.target.value) || 0);
                                                          const nextList = [...assignedResources];
                                                          nextList[originalIdx].hours = val;
                                                          nextList[originalIdx].manuallyEdited = true;
                                                          const activeAllocation =
                                                            selectedOption === "fastest" ? module.fastest_allocation :
                                                              selectedOption === "lean" ? module.lean_allocation :
                                                                module.balanced_allocation;
                                                          const recalculatedList = recalculateModuleAllocations(nextList, module.estimated_hours, activeAllocation);
                                                          setModuleAllocations({
                                                            ...moduleAllocations,
                                                            [module.module_name]: recalculatedList
                                                          });
                                                        }}
                                                        className="w-14 border border-parcelles-dark/30 px-1 py-0.5 text-center bg-transparent focus:border-parcelles-dark outline-none font-mono text-[11px]"
                                                      />
                                                      <span className="text-[9px] text-parcelles-dark/50">hrs</span>

                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          const nextList = assignedResources.filter((_, idx) => idx !== originalIdx);
                                                          const activeAllocation =
                                                            selectedOption === "fastest" ? module.fastest_allocation :
                                                              selectedOption === "lean" ? module.lean_allocation :
                                                                module.balanced_allocation;
                                                          const recalculatedList = recalculateModuleAllocations(nextList, module.estimated_hours, activeAllocation);
                                                          setModuleAllocations({
                                                            ...moduleAllocations,
                                                            [module.module_name]: recalculatedList
                                                          });
                                                        }}
                                                        className="text-red-700 hover:text-red-950 p-0.5 ml-1 transition-colors"
                                                        title="Remove resource"
                                                      >
                                                        <Trash2 size={13} />
                                                      </button>
                                                    </div>
                                                  </div>

                                                  {alloc.description && (
                                                    <p className="text-[10px] text-parcelles-dark/70 leading-relaxed">
                                                      {alloc.description}
                                                    </p>
                                                  )}

                                                  <div className="w-full bg-parcelles-dark/5 h-1 rounded-full overflow-hidden">
                                                    <div
                                                      className="bg-parcelles-dark h-full transition-all duration-300"
                                                      style={{ width: `${share}%` }}
                                                      title={`${share}% of estimated module hours`}
                                                    />
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <p className="text-[10px] text-parcelles-dark/50 italic text-center py-2 bg-parcelles-dark/5 rounded">
                                            No developers assigned.
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    
                                    {/* Assign resources to this module with checkboxes */}
                                    {(() => {
                                      const hasFullStack = assignedResources.some(r => (r.role || "").toLowerCase().includes("full stack") || (r.role || "").toLowerCase().includes("full-stack"));
                                      const hasUIUX = assignedResources.some(r => (r.role || "").toLowerCase().includes("ui/ux") || (r.role || "").toLowerCase().includes("designer"));

                                      const deliveryCandidates = companyRoster.filter(candidate => {
                                        if (isIntegratedSupportWorkstream(classifyRoleWorkstream(candidate.role))) return false;
                                        if (candidate.experience_years > 10) return false;
                                        return true;
                                      });

                                      const toggleResourceForModule = (candidate, checked) => {
                                        const currentList = assignedResources;
                                        let newList = [];
                                        if (!checked) {
                                          newList = currentList.filter((resource) => resource.name !== candidate.name);
                                        } else {
                                          if (currentList.some((resource) => resource.name === candidate.name)) {
                                            return;
                                          }
                                          newList = [
                                            ...currentList,
                                            {
                                              name: candidate.name,
                                              role: candidate.role,
                                              experience_years: candidate.experience_years,
                                              description: `Assigned to ${module.module_name}`,
                                              selected: true,
                                            },
                                          ];
                                        }
                                        const activeAllocation =
                                          selectedOption === "fastest" ? module.fastest_allocation :
                                            selectedOption === "lean" ? module.lean_allocation :
                                              module.balanced_allocation;
                                        const recalculatedList = recalculateModuleAllocations(newList, module.estimated_hours, activeAllocation);
                                        setModuleAllocations({
                                          ...moduleAllocations,
                                          [module.module_name]: recalculatedList,
                                        });
                                      };

                                      return (
                                        <div className="mt-2 pt-2 border-t border-dashed border-parcelles-dark/10">
                                          {deliveryCandidates.length > 0 ? (
                                            <div className="space-y-2">
                                              <label className="text-[9px] font-display uppercase tracking-wider opacity-60 block">Add / Remove Members</label>
                                              <div className="grid gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                                                {deliveryCandidates.map(candidate => {
                                                  const alreadyAssigned = assignedResources.some((resource) => resource.name === candidate.name);
                                                  const blocked =
                                                    !alreadyAssigned &&
                                                    (((candidate.role || "").toLowerCase().includes("ui/ux") && hasFullStack) ||
                                                      ((candidate.role || "").toLowerCase().includes("full stack") && hasUIUX));
                                                  const estHours = estimateResourceHours(module.estimated_hours, candidate);
                                                  return (
                                                    <label
                                                      key={candidate.name}
                                                      className={`flex items-center justify-between gap-2 border px-2 py-1.5 text-[10px] font-body transition-colors cursor-pointer ${alreadyAssigned
                                                          ? "border-parcelles-dark bg-parcelles-sage/15"
                                                          : blocked
                                                            ? "border-parcelles-dark/10 bg-parcelles-dark/5 opacity-50 cursor-not-allowed"
                                                            : "border-parcelles-dark/20 hover:border-parcelles-dark"
                                                        }`}
                                                    >
                                                      <span className="flex items-center gap-2 min-w-0">
                                                        <input
                                                          type="checkbox"
                                                          checked={alreadyAssigned}
                                                          disabled={blocked}
                                                          onChange={(event) => toggleResourceForModule(candidate, event.target.checked)}
                                                          className="cursor-pointer disabled:cursor-not-allowed"
                                                        />
                                                        <span className="min-w-0">
                                                          <span className="font-bold block truncate">{candidate.name}</span>
                                                          <span className="opacity-60 block truncate">{candidate.role} - {candidate.experience_years} yrs</span>
                                                        </span>
                                                      </span>
                                                      <span className="font-mono opacity-70 shrink-0">{estHours}h</span>
                                                    </label>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          ) : (
                                            <p className="text-[9px] text-amber-800 bg-amber-50 border border-amber-200/50 p-1.5 rounded text-center leading-tight">
                                              No compatible resource available in roster
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                ) : null}

                <div className="border border-parcelles-dark bg-parcelles-bg p-4 sm:p-5 chamfer-bottom-left space-y-4">
                  <div 
                    onClick={() => setIsSupportExpanded(!isSupportExpanded)}
                    style={{ cursor: "pointer" }}
                    className="flex flex-wrap items-center justify-between gap-4 border-b border-parcelles-dark pb-3 mb-4"
                  >
                    <div>
                      <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Integrated Delivery Support</p>
                      <h2 className="text-lg font-display mt-0.5">Project Management &amp; Deployment Coverage</h2>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="px-3 py-0.5 text-[10px] font-display uppercase tracking-widest border border-parcelles-dark/20 bg-parcelles-dark/5 rounded-full">
                        Included in total team hours
                      </span>
                      {isSupportExpanded ? <ChevronUp size={20} className="text-parcelles-dark" /> : <ChevronDown size={20} className="text-parcelles-dark" />}
                    </div>
                  </div>

                  {isSupportExpanded && (
                    <>
                      <div className="grid lg:grid-cols-[1fr_280px] gap-4 items-end">
                    <p className="font-body text-xs opacity-75 leading-relaxed">
                      These roles are planned separately from module build cards, but they remain inside the same allocation, duration, and effort totals.
                    </p>
                    <div className="grid gap-2">
                      <select
                        value=""
                        onChange={(event) => {
                          const selected = companyRoster.find((candidate) => candidate.name === event.target.value);
                          addSupportFromRoster(selected);
                        }}
                        className="w-full text-xs font-body bg-parcelles-bg border border-parcelles-dark/30 px-3 py-2 outline-none focus:border-parcelles-dark"
                        style={{ cursor: "pointer" }}
                      >
                        <option value="">Add PM / DevOps from roster</option>
                        {companyRoster
                          .filter((candidate) => {
                            return !integratedSupportMembers.some((member) => member.role.includes(candidate.name));
                          })
                          .map((candidate) => (
                            <option key={candidate.name} value={candidate.name}>
                              {candidate.name} ({candidate.role}, {candidate.experience_years} yrs)
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {integratedSupportMembers.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      {integratedSupportMembers.map((member, index) => {
                        const workstream = classifyRoleWorkstream(member.role);
                        const tag = workstream === "management" ? "Project Management" : "Deployment / DevOps";
                        const isSelected = member.selected !== false;
                        return (
                          <div
                            key={`${member.role}-${index}`}
                            className="border border-parcelles-dark/15 bg-parcelles-sage/10 p-3 space-y-3 transition-opacity"
                            style={{ opacity: isSelected ? 1 : 0.55 }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <label className="flex items-start gap-3 min-w-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(event) => updateSupportAllocation(index, { selected: event.target.checked })}
                                  className="mt-1"
                                />
                                <div className="min-w-0">
                                  <div className="font-display text-base truncate" title={member.role}>{member.role}</div>
                                  <div className="font-display text-[9px] uppercase tracking-widest opacity-60 mt-0.5">{tag}</div>
                                </div>
                              </label>
                              <button
                                type="button"
                                onClick={() => setSupportAllocations((current) => current.filter((_, idx) => idx !== index))}
                                className="text-red-700 hover:text-red-950 p-1 transition-colors"
                                title="Remove support role"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            <textarea
                              value={member.description || ""}
                              onChange={(event) => updateSupportAllocation(index, { description: event.target.value })}
                              rows={2}
                              className="w-full text-xs font-body bg-parcelles-bg/70 border border-parcelles-dark/20 px-2 py-1 outline-none focus:border-parcelles-dark resize-none"
                            />

                            <div className="grid grid-cols-2 gap-3 border-t border-parcelles-dark/10 pt-2">
                              <label className="grid gap-1">
                                <span className="font-display text-[9px] uppercase tracking-widest opacity-60">People</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={member.count ?? 0}
                                  onChange={(event) => updateSupportAllocation(index, { count: event.target.value })}
                                  className="w-full border border-parcelles-dark/25 bg-parcelles-bg px-2 py-0.5 text-center font-mono text-xs outline-none focus:border-parcelles-dark"
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="font-display text-[9px] uppercase tracking-widest opacity-60">Hours ({Math.ceil((member.hours_per_member ?? 0) / 8)} days)</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={member.hours_per_member ?? 0}
                                  onChange={(event) => updateSupportAllocation(index, { hours_per_member: event.target.value })}
                                  className="w-full border border-parcelles-dark/25 bg-parcelles-bg px-2 py-0.5 text-center font-mono text-xs outline-none focus:border-parcelles-dark"
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border border-dashed border-parcelles-dark/25 p-4 text-center font-body text-xs opacity-65">
                      No project management or deployment coverage is selected yet.
                    </div>
                  )}
                  </>
                  )}
                </div>

                <div className="bg-parcelles-bg border border-parcelles-dark p-5 md:p-6 chamfer-bottom-right">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-parcelles-dark pb-4 mb-4">
                    <div>
                      <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Final Review</p>
                      <h2 className="text-2xl font-display mt-0.5">Confirm &amp; Approve Team Architecture</h2>
                      <p className="font-body text-xs opacity-75 mt-1 leading-relaxed max-w-2xl">
                        Review the aggregated team below. Approving locks the allocation and seeds Cost Estimation with these exact roles and hours.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 font-display text-xs shrink-0">
                      <div className="px-3 py-1 border border-parcelles-dark rounded-full">
                        {teamData.members.reduce((t, m) => t + (Number(m.count) || 0), 0)} members
                      </div>
                      <div className="px-3 py-1 bg-parcelles-dark text-parcelles-bg rounded-full flex items-center gap-1.5">
                        <span>{Math.round(teamData.total_project_hours || 0)} hrs</span>
                        <span className="opacity-60 text-[10px]">/ {Math.ceil((teamData.total_project_hours || 0) / 8)} effort days</span>
                      </div>
                    </div>
                  </div>

                  {(() => {
                    const renderStep2MemberCard = (member, mIdx) => {
                      const expMatchA = member.role?.match(/(\d+(?:\.\d+)?)\s*Yrs?\s*Exp/i);
                      const expYearsA = expMatchA ? parseFloat(expMatchA[1]) : null;
                      const cleanRoleA = member.role?.replace(/\s*\(\d+(?:\.\d+)?\s*Yrs?\s*Exp\)/i, '').trim() || member.role;
                      const isSupportEditable = isIntegratedSupportWorkstream(classifyRoleWorkstream(member.role));

                      return (
                        <div
                          key={`approve-${mIdx}`}
                          className="p-3 border border-parcelles-dark/25 bg-parcelles-bg flex flex-col justify-between gap-2.5 rounded transition-all shadow-sm"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <div className="font-display text-xs font-bold truncate text-parcelles-dark" title={cleanRoleA}>
                                {cleanRoleA}
                              </div>
                              {expYearsA != null && (
                                <div className="text-[9px] text-parcelles-dark/50 mt-0.5">{expYearsA} Yrs Exp</div>
                              )}
                              {member.description && (
                                <div className="text-[10px] text-parcelles-dark/70 mt-1.5 leading-relaxed font-body">
                                  {member.description}
                                </div>
                              )}
                            </div>

                            {/* Headcount adjustment */}
                            <div className="flex items-center gap-1 shrink-0 bg-parcelles-bg border border-parcelles-dark/35 px-1 py-0.5 rounded">
                              <button
                                type="button"
                                onClick={() => updateMemberCount(mIdx, -1)}
                                className="w-4 h-4 flex items-center justify-center font-display text-xs hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors"
                              >
                                −
                              </button>
                              <span className="font-display text-xs w-5 text-center font-bold text-parcelles-dark">
                                {member.count}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateMemberCount(mIdx, 1)}
                                className="w-4 h-4 flex items-center justify-center font-display text-xs hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between border-t border-parcelles-dark/10 pt-2 text-[10px] font-display">
                            <span className="opacity-60 text-[8px] uppercase tracking-widest text-parcelles-dark">Hours:</span>
                            <div className="flex items-center gap-1.5">
                              <div className="flex items-center gap-1 font-mono">
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={Math.round(member.hours_per_member || (member.active_weeks * 40))}
                                  onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value, 10) || 1);

                                    if (isSupportEditable) {
                                      const sIndex = supportAllocations.findIndex(
                                        (s) => normalizeRoleTitle(s.role) === normalizeRoleTitle(member.role)
                                      );
                                      if (sIndex !== -1) {
                                        updateSupportAllocation(sIndex, { hours_per_member: val });
                                      }
                                    } else {
                                      setMemberOverrides((prev) => {
                                        const existing = prev[member.role] || {
                                          count: member.count,
                                          hours_per_member: member.hours_per_member,
                                        };
                                        return {
                                          ...prev,
                                          [member.role]: {
                                            ...existing,
                                            hours_per_member: val,
                                            active_weeks: val / 40,
                                          },
                                        };
                                      });
                                    }
                                  }}
                                  className="w-14 border border-parcelles-dark/30 px-1 py-0.5 text-center bg-parcelles-bg focus:border-parcelles-dark outline-none font-mono text-[9px] rounded"
                                />
                                <span className="opacity-60 text-[8px] uppercase tracking-wider text-parcelles-dark">hrs</span>
                              </div>
                              <span className="opacity-50 text-[8px] text-parcelles-dark">/ {Math.ceil((member.hours_per_member || (member.active_weeks * 40)) / 8)} days ({parseFloat(Number(member.active_weeks).toFixed(2))} wks)</span>
                            </div>
                          </div>
                        </div>
                      );
                    };

                    const { devList, testList, pmDeployList } = groupMembersByBox(teamData.members);

                    return (
                      <div className="space-y-6 mb-4">
                        {/* Development Box */}
                        {devList.length > 0 && (
                          <div className="border border-parcelles-dark/30 p-4 bg-parcelles-sage/5 rounded space-y-3 shadow-sm">
                            <div
                              onClick={() => setIsDevStaffingExpanded(!isDevStaffingExpanded)}
                              style={{ cursor: "pointer" }}
                              className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1"
                            >
                              <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Development Staffing</span>
                              {isDevStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                            </div>
                            {isDevStaffingExpanded && (
                              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {devList.map((member) => {
                                  const mIdx = teamData.members.findIndex((m) => m.role === member.role);
                                  return renderStep2MemberCard(member, mIdx);
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Testing Box */}
                        {testList.length > 0 && (
                          <div className="border border-parcelles-dark/30 p-4 bg-parcelles-sage/5 rounded space-y-3 shadow-sm">
                            <div
                              onClick={() => setIsTestStaffingExpanded(!isTestStaffingExpanded)}
                              style={{ cursor: "pointer" }}
                              className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1"
                            >
                              <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Testing Staffing</span>
                              {isTestStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                            </div>
                            {isTestStaffingExpanded && (
                              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {testList.map((member) => {
                                  const mIdx = teamData.members.findIndex((m) => m.role === member.role);
                                  return renderStep2MemberCard(member, mIdx);
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* PM & Deployment Box */}
                        {pmDeployList.length > 0 && (
                          <div className="border border-parcelles-dark/30 p-4 bg-parcelles-sage/5 rounded space-y-3 shadow-sm">
                            <div
                              onClick={() => setIsPmDeployStaffingExpanded(!isPmDeployStaffingExpanded)}
                              style={{ cursor: "pointer" }}
                              className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1"
                            >
                              <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Project Management &amp; Deployment</span>
                              {isPmDeployStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                            </div>
                            {isPmDeployStaffingExpanded && (
                              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {pmDeployList.map((member) => {
                                  const mIdx = teamData.members.findIndex((m) => m.role === member.role);
                                  return renderStep2MemberCard(member, mIdx);
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <button
                    onClick={handleApprove}
                    className="w-full py-4 bg-parcelles-dark text-parcelles-bg font-display text-lg flex items-center justify-center gap-3 hover:opacity-90 transition-opacity chamfer-bottom-left"
                  >
                    <CheckCircle2 size={24} /> Approve Team Architecture
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {step === 3 && teamData ? (
            <div>
              <section style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr", gap: "1.25rem" }}>
                <div className="border border-parcelles-dark bg-parcelles-bg p-5 md:p-6 chamfer-bottom-right">
                  <div className="flex items-start gap-4 mb-6 border-b border-parcelles-dark pb-4">
                    <div className="w-12 h-12 shrink-0 border border-parcelles-dark flex items-center justify-center chamfer-bottom-left bg-parcelles-sage/30">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Approved Architecture</p>
                      <h2 className="text-2xl font-display mt-0.5">Team locked for {teamData.project_name}</h2>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {(() => {
                      const renderStep3MemberRow = (member, index) => {
                        const expMatch3 = member.role?.match(/\((\d+(?:\.\d+)?)\s*Yrs?\s*Exp\)/i);
                        const expYears3 = expMatch3 ? parseFloat(expMatch3[1]) : null;
                        const cleanTitle3 = member.role?.replace(/\s*\(\d+(?:\.\d+)?\s*Yrs?\s*Exp\)/i, '').trim() || member.role;
                        const totalHours = Math.round((member.hours_per_member || (member.active_weeks * 40)) * member.count);
                        const activeWeeks = parseFloat(Number(member.active_weeks).toFixed(2));

                        return (
                          <div
                            key={`${member.role}-${index}`}
                            className="py-3 last:pb-0 first:pt-0 border-b border-parcelles-dark/10 last:border-0 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-1.5 h-1.5 bg-parcelles-dark rounded-full" />
                                <span className="font-display text-base font-bold">{cleanTitle3}</span>
                                {expYears3 != null && (
                                  <span className="px-2 py-0.5 font-display text-[9px] uppercase tracking-widest rounded-full border border-parcelles-dark bg-parcelles-dark/10 text-parcelles-dark whitespace-nowrap">
                                    {expYears3} Yrs Exp
                                  </span>
                                )}
                              </div>
                              <span className="font-display text-base bg-parcelles-dark text-parcelles-bg px-2.5 py-0.5 font-bold">x{member.count}</span>
                            </div>

                            {member.description && (
                              <p className="font-body text-xs text-parcelles-dark/80 pl-4 leading-relaxed">
                                {member.description}
                              </p>
                            )}

                            <div className="pl-4 flex gap-4 text-[11px] font-mono text-parcelles-dark/60 font-semibold">
                              <span>Per member: {Math.round(member.hours_per_member || (member.active_weeks * 40))} hrs ({activeWeeks} wks)</span>
                              <span>•</span>
                              <span>Total effort: {totalHours} hrs</span>
                            </div>
                          </div>
                        );
                      };

                      const { devList, testList, pmDeployList } = groupMembersByBox(teamData.members);

                      return (
                        <div className="space-y-6">
                          {/* Development Box */}
                          {devList.length > 0 && (
                            <div className="border border-parcelles-dark/20 p-4 bg-parcelles-sage/5 rounded space-y-2">
                              <div
                                onClick={() => setIsDevStaffingExpanded(!isDevStaffingExpanded)}
                                style={{ cursor: "pointer" }}
                                className="flex items-center justify-between pb-1 border-b border-parcelles-dark/10"
                              >
                                <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Development Staffing</span>
                                {isDevStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                              </div>
                              {isDevStaffingExpanded && (
                                <div className="divide-y divide-parcelles-dark/10">
                                  {devList.map((member) => {
                                    const index = teamData.members.findIndex((m) => m.role === member.role);
                                    return renderStep3MemberRow(member, index);
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Testing Box */}
                          {testList.length > 0 && (
                            <div className="border border-parcelles-dark/20 p-4 bg-parcelles-sage/5 rounded space-y-2">
                              <div
                                onClick={() => setIsTestStaffingExpanded(!isTestStaffingExpanded)}
                                style={{ cursor: "pointer" }}
                                className="flex items-center justify-between pb-1 border-b border-parcelles-dark/10"
                              >
                                <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Testing Staffing</span>
                                {isTestStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                              </div>
                              {isTestStaffingExpanded && (
                                <div className="divide-y divide-parcelles-dark/10">
                                  {testList.map((member) => {
                                    const index = teamData.members.findIndex((m) => m.role === member.role);
                                    return renderStep3MemberRow(member, index);
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* PM & Deployment Box */}
                          {pmDeployList.length > 0 && (
                            <div className="border border-parcelles-dark/20 p-4 bg-parcelles-sage/5 rounded space-y-2">
                              <div
                                onClick={() => setIsPmDeployStaffingExpanded(!isPmDeployStaffingExpanded)}
                                style={{ cursor: "pointer" }}
                                className="flex items-center justify-between pb-1 border-b border-parcelles-dark/10"
                              >
                                <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Project Management &amp; Deployment</span>
                                {isPmDeployStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                              </div>
                              {isPmDeployStaffingExpanded && (
                                <div className="divide-y divide-parcelles-dark/10">
                                  {pmDeployList.map((member) => {
                                    const index = teamData.members.findIndex((m) => m.role === member.role);
                                    return renderStep3MemberRow(member, index);
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="border border-parcelles-dark bg-parcelles-sage/20 p-5 md:p-6 chamfer-bottom-left h-fit">
                  <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Next Actions</p>
                  <h2 className="text-2xl font-display mt-0.5">Download or calculate costs</h2>

                  <p className="font-body text-xs opacity-80 mt-4 leading-relaxed">
                    The download action respects whichever steps exist in the current flow. If the SRS exists, it is included here.
                    If not, only the team allocation leaves this step. Cost estimation will open with these approved roles already seeded.
                  </p>

                  <div className="mt-5 p-4 border border-parcelles-dark bg-parcelles-bg font-display text-base">
                    <span className="opacity-60 uppercase tracking-widest text-xs block mb-1">Bundle</span>
                    {downloadLabel}
                  </div>

                  <div className="mt-6 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button onClick={handleUndo} className="flex-1 py-3 border border-parcelles-dark font-display text-base flex items-center justify-center gap-2 hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors chamfer-bottom-right">
                        <Undo2 size={18} /> Edit
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "pdf", label: "PDF", detail: "Report" },
                        { id: "excel", label: "Excel", detail: "Workbook" },
                        { id: "word", label: "Word", detail: "Docx" },
                      ].map((format) => {
                        const isBusy = downloadingFormat === format.id || (format.id === "excel" && isDownloading);
                        return (
                          <button
                            key={format.id}
                            type="button"
                            onClick={() => handleFormatDownload(format.id)}
                            disabled={Boolean(downloadingFormat) || isDownloading}
                            className="border border-parcelles-dark/70 bg-parcelles-bg px-3 py-2 text-left hover:bg-parcelles-sage/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            style={{
                              clipPath: "polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
                            }}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-display text-sm">{format.label}</span>
                              {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            </span>
                            <span className="block font-display uppercase tracking-widest text-[8px] opacity-50 mt-1">{format.detail}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={proceedToCosting} className="w-full py-4 bg-parcelles-dark text-parcelles-bg font-display text-lg flex items-center justify-center gap-3 hover:opacity-90 transition-opacity chamfer-bottom-right mt-1">
                      Proceed to Costing <ArrowRight size={20} />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
