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
import { AxcendEffortEstimation } from "@/components/workflow/AxcendEffortEstimation";

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
  if (lowered.includes("qa") || lowered.includes("tester") || lowered.includes("test engineer") || lowered.includes("testing")) return "testing";
  if (
    lowered.includes("project manager") ||
    lowered.includes("program manager") ||
    lowered.includes("scrum master") ||
    lowered.includes("business analyst") ||
    lowered.includes("product manager") ||
    lowered.includes("project management")
  ) {
    return "management";
  }
  if (
    lowered.includes("devops") ||
    lowered.includes("platform engineer") ||
    lowered.includes("release engineer") ||
    lowered.includes("site reliability") ||
    lowered.includes("sre") ||
    lowered.includes("cloud engineer") ||
    lowered.includes("deployment")
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
  const preEngList = [];
  const engList = [];
  const pmList = [];

  members.forEach((member) => {
    const roleLower = String(member.role || "").toLowerCase();
    if (roleLower.includes("pre-engineering") || roleLower.includes("pre engineering")) {
      preEngList.push(member);
    } else if (
      roleLower.includes("project management") ||
      roleLower.includes("pm") ||
      roleLower.includes("manager") ||
      roleLower.includes("deployment")
    ) {
      pmList.push(member);
    } else {
      engList.push(member);
    }
  });

  return { preEngList, engList, pmList };
};

const withSelectedAllocation = (member) => ({
  ...member,
  selected: member.selected !== false,
});

const CURRENCY_SYMBOLS = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  JPY: "¥"
};

const getCurrencySymbol = (currency) => CURRENCY_SYMBOLS[currency] || "$";

const calculateHourlyPay = (years) => {
  const y = Number(years) || 0;
  if (y >= 10) return 50;
  if (y >= 5) return 45;
  return 40;
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
    const rate = candidate
      ? (candidate.hourly_rate_override != null ? Number(candidate.hourly_rate_override) : calculateHourlyPay(candidate.experience_years))
      : 200;
    return {
      ...withSelectedAllocation(m),
      role: candidate ? `${candidate.name} (${candidate.role})` : m.role,
      hourly_rate: rate,
    };
  });
};

const asArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
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

const initializeFeatureList = (srs, companyRoster) => {
  const requirements = srs?.structuredRequirements;
  if (!requirements) return [];

  const modules = requirements.modules || [];
  const features = requirements.features || [];
  const featureList = [];
  let slNo = 1;

  // Classify a roster member to S3 / S2 / S1
  const classifyLevel = (r) => {
    const rLower = (r.role || "").toLowerCase();
    if (rLower.includes("s3") || rLower.includes("lead") || rLower.includes("architect") || r.experience_years >= 10) return "S3";
    if (rLower.includes("s2") || rLower.includes("senior") || (r.experience_years >= 5 && r.experience_years < 10)) return "S2";
    return "S1";
  };

  // Group all roster members by level
  const roster = companyRoster || [];
  const s3Members = roster.filter(r => classifyLevel(r) === "S3");
  const s2Members = roster.filter(r => classifyLevel(r) === "S2");
  const s1Members = roster.filter(r => classifyLevel(r) === "S1");
  const hasS3 = s3Members.length > 0;
  const hasS2 = s2Members.length > 0;
  const hasS1 = s1Members.length > 0;

  // Build raw feature list from SRS modules
  modules.forEach((mod) => {
    const modName = mod.name || mod.module_name || "General";
    const featNames = mod.feature_names || [];
    featNames.forEach((featName) => {
      const featDetail = features.find(
        (f) => (f.name || f.feature_name || "").toLowerCase() === featName.toLowerCase()
      );
      const complexity = featDetail?.complexity || "Medium";
      const description = featDetail?.description || featDetail?.summary || "No description available";
      let baseHours = 24;
      if (complexity.toLowerCase().includes("high")) baseHours = 40;
      else if (complexity.toLowerCase().includes("medium")) baseHours = 24;
      else if (complexity.toLowerCase().includes("low")) baseHours = 8;
      featureList.push({
        id: `${modName}-${featName}`,
        slNo: slNo++,
        moduleName: modName,
        featureName: featName,
        complexity,
        baseHours,
        developer: "S1",
        description,
        hours: baseHours
      });
    });
  });

  // Add any orphan features not already listed
  features.forEach((feat) => {
    const featName = feat.name || feat.feature_name;
    if (!featureList.some((item) => item.featureName.toLowerCase() === featName.toLowerCase())) {
      const complexity = feat.complexity || "Medium";
      const description = feat.description || feat.summary || "No description available";
      let baseHours = 24;
      if (complexity.toLowerCase().includes("high")) baseHours = 40;
      else if (complexity.toLowerCase().includes("medium")) baseHours = 24;
      else if (complexity.toLowerCase().includes("low")) baseHours = 8;
      featureList.push({
        id: `General-${featName}`,
        slNo: slNo++,
        moduleName: "General",
        featureName: featName,
        complexity,
        baseHours,
        developer: "S1",
        description,
        hours: baseHours
      });
    }
  });

  // Compute level slice limits based on which levels are present
  const totalFeatures = featureList.length;
  let s3Limit = 0;
  let s2Limit = 0;
  if (hasS3 && hasS2 && hasS1) {
    s3Limit = Math.round(totalFeatures * 0.20);
    s2Limit = s3Limit + Math.round(totalFeatures * 0.30);
  } else if (hasS2 && hasS1) {
    s2Limit = Math.round(totalFeatures * 0.30);
  } else if (hasS3 && hasS1) {
    s3Limit = Math.round(totalFeatures * 0.30);
    s2Limit = s3Limit;
  } else if (hasS3 && hasS2) {
    s3Limit = Math.round(totalFeatures * 0.40);
    s2Limit = totalFeatures;
  } else if (hasS3) {
    s3Limit = totalFeatures; s2Limit = totalFeatures;
  } else if (hasS2) {
    s2Limit = totalFeatures;
  }

  // Assign actual roster member names via round-robin within each level slice
  let s3Counter = 0, s2Counter = 0, s1Counter = 0;
  featureList.forEach((feat, index) => {
    let assignedMember = null;
    if (index < s3Limit && hasS3) {
      assignedMember = s3Members[s3Counter % s3Members.length];
      s3Counter++;
    } else if (index < s2Limit && hasS2) {
      assignedMember = s2Members[s2Counter % s2Members.length];
      s2Counter++;
    } else if (hasS1) {
      assignedMember = s1Members[s1Counter % s1Members.length];
      s1Counter++;
    } else if (hasS2) {
      assignedMember = s2Members[s2Counter % s2Members.length];
      s2Counter++;
    } else if (hasS3) {
      assignedMember = s3Members[s3Counter % s3Members.length];
      s3Counter++;
    }
    const level = assignedMember ? classifyLevel(assignedMember) : "S1";
    const expYears = assignedMember?.experience_years ?? (level === "S3" ? 12 : level === "S2" ? 8 : 2);
    const multiplier = experienceEffortMultiplier(expYears);
    feat.developer = assignedMember?.name || level;
    feat.hours = Math.round(feat.baseHours * multiplier);
  });

  // Scale dev features to sum to exactly 723 hours (Option A)
  const currentDevTotal = featureList.reduce((acc, f) => acc + (f.hours || 0), 0);
  if (currentDevTotal > 0) {
    const scaleFactor = 723 / currentDevTotal;
    featureList.forEach((f) => {
      f.hours = Math.round(f.hours * scaleFactor);
      f.baseHours = Math.round(f.baseHours * scaleFactor);
    });
  }

  // Engineering subtotal (dev features only, before testing/deployment rows)
  const engTotal = 723;

  // Testing: priority S2 -> S1 -> S3, round-robin across testing-level members
  const testingPool = hasS2 ? s2Members : (hasS1 ? s1Members : s3Members);
  let testCounter = 0;
  const pickTester = () => {
    const m = testingPool[testCounter % testingPool.length];
    testCounter++;
    return m?.name || (hasS2 ? "S2" : hasS1 ? "S1" : "S3");
  };

  featureList.push({
    id: "__internal_testing__",
    slNo: slNo++,
    moduleName: "Testing",
    featureName: "Internal Testing",
    complexity: "Medium",
    baseHours: Math.round(engTotal * 0.20),
    developer: pickTester(),
    description: "Internal testing (20% of development)",
    hours: Math.round(engTotal * 0.20),
    isTesting: true,
  });
  featureList.push({
    id: "__client_testing__",
    slNo: slNo++,
    moduleName: "Testing",
    featureName: "Client Testing",
    complexity: "Medium",
    baseHours: Math.round(engTotal * 0.10),
    developer: pickTester(),
    description: "Client testing and UAT support (10% of development)",
    hours: Math.round(engTotal * 0.10),
    isTesting: true,
  });

  // Deployment: priority S3 -> S2 -> S1
  const deployPool = hasS3 ? s3Members : (hasS2 ? s2Members : s1Members);
  const deployDev = deployPool[0]?.name || (hasS3 ? "S3" : hasS2 ? "S2" : "S1");
  featureList.push({
    id: "__deployment__",
    slNo: slNo++,
    moduleName: "Deployment",
    featureName: "Deployment",
    complexity: "Medium",
    baseHours: Math.round(engTotal * 0.10),
    developer: deployDev,
    description: "Deployment and go-live activities",
    hours: Math.round(engTotal * 0.10),
    isDeployment: true,
  });

  return featureList;
}
const calculateModuleRowSpans = (featureList) => {
  const spans = [];
  let i = 0;
  while (i < featureList.length) {
    let span = 1;
    while (i + span < featureList.length && featureList[i + span].moduleName === featureList[i].moduleName) {
      span++;
    }
    spans.push({ index: i, span: span });
    i += span;
  }
  return spans;
};

export function TeamDesignExperience() {
  const router = useRouter();
  const { srsData, cleanedInput, rawInput, projectTitle, selectedEngine, setIsProcessing } = useWorkflow();
  const stableCountsRef = useRef({});
  const [featureAllocations, setFeatureAllocations] = useState([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedOption, setSelectedOption] = useState("option1");
  const [activeModules, setActiveModules] = useState({});
  const [localProjectTitle, setLocalProjectTitle] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [userHasModified, setUserHasModified] = useState(false);
  const [preEngHours, setPreEngHours] = useState({
    requirementsCollection: 32,
    queryPreparation: 32,
    weeklyInteractions: 32,
    kbReference: 32,
  });
  const [pmFactor, setPmFactor] = useState(15);
  const [isDevStaffingExpanded, setIsDevStaffingExpanded] = useState(true);
  const [isTestStaffingExpanded, setIsTestStaffingExpanded] = useState(true);
  const [isPmDeployStaffingExpanded, setIsPmDeployStaffingExpanded] = useState(true);

  const [profiles, setProfiles] = useState(() => {
    try {
      const raw = window.localStorage.getItem("scopesense-company-profiles-v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    const defaultProfiles = [
      {
        id: "profile-default-inr",
        name: "Default INR Profile",
        currency: "INR",
        members: [
          { name: "Resource A", role: "S3 Developer", experience_years: 12, hourly_rate_override: null },
          { name: "Resource B", role: "S2 Developer", experience_years: 8,  hourly_rate_override: null },
          { name: "Resource C", role: "S1 Developer", experience_years: 2,  hourly_rate_override: null },
        ]
      },
      {
        id: "profile-default-usd",
        name: "Default USD Profile",
        currency: "USD",
        members: [
          { name: "Resource A (US)", role: "S3 Developer", experience_years: 12, hourly_rate_override: null },
          { name: "Resource B (US)", role: "S2 Developer", experience_years: 8,  hourly_rate_override: null },
          { name: "Resource C (US)", role: "S1 Developer", experience_years: 2,  hourly_rate_override: null },
        ]
      }
    ];
    try {
      window.localStorage.setItem("scopesense-company-profiles-v1", JSON.stringify(defaultProfiles));
    } catch (e) {}
    return defaultProfiles;
  });

  const [activeProfileId, setActiveProfileId] = useState(() => {
    try {
      const activeId = window.localStorage.getItem("scopesense-active-profile-id-v1");
      if (activeId !== null) {
        if (activeId === "") return "";
        if (profiles.some(p => p.id === activeId)) return activeId;
      }
    } catch (e) {}
    const firstWithDevs = profiles.find(p => p.members && p.members.length > 0);
    return firstWithDevs ? firstWithDevs.id : (profiles[0]?.id || "");
  });

  const [selectedCurrency, setSelectedCurrency] = useState(() => {
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    return activeProfile?.currency || "INR";
  });

  const [companyRoster, setCompanyRoster] = useState(() => {
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    return activeProfile?.members || [];
  });

  const getMemberLevel = (devName) => {
    const member = companyRoster.find(r => r.name === devName);
    if (!member) {
      if (String(devName || "").includes("S3")) return "S3";
      if (String(devName || "").includes("S2")) return "S2";
      return "S1";
    }
    const roleLower = (member.role || "").toLowerCase();
    if (roleLower.includes("s3") || roleLower.includes("lead") || roleLower.includes("architect")) return "S3";
    if (roleLower.includes("s2") || roleLower.includes("senior")) return "S2";
    return "S1";
  };

  const setAndSyncRoster = (nextRoster) => {
    setCompanyRoster(nextRoster);
    if (!activeProfileId) return;
    const nextProfiles = profiles.map(p => {
      if (p.id === activeProfileId) {
        return { ...p, members: nextRoster };
      }
      return p;
    });
    setProfiles(nextProfiles);
    try {
      window.localStorage.setItem("scopesense-company-profiles-v1", JSON.stringify(nextProfiles));
    } catch (e) {}
  };

  const availableLevels = useMemo(() => {
    const levels = [];
    if (!companyRoster || companyRoster.length === 0) {
      return ["S1"];
    }
    companyRoster.forEach((r) => {
      const roleLower = (r.role || "").toLowerCase();
      if (roleLower.includes("s3") || roleLower.includes("lead") || roleLower.includes("architect")) {
        if (!levels.includes("S3")) levels.push("S3");
      } else if (roleLower.includes("s2") || roleLower.includes("senior")) {
        if (!levels.includes("S2")) levels.push("S2");
      } else {
        if (!levels.includes("S1")) levels.push("S1");
      }
    });
    if (levels.length === 0) return ["S1"];
    return levels.sort();
  }, [companyRoster]);

  const getClosestAvailableLevel = (level, available) => {
    if (available.includes(level)) return level;
    if (level === "S3") {
      if (available.includes("S2")) return "S2";
      return available[0] || "S1";
    }
    if (level === "S2") {
      if (available.includes("S3")) return "S3";
      return available[0] || "S1";
    }
    if (level === "S1") {
      if (available.includes("S2")) return "S2";
      return available[0] || "S1";
    }
    return available[0] || "S1";
  };

  // Helper to resolve resource hourly rate, respecting custom rate overrides
  const getRosterResourceRate = (resource) => {
    if (resource && resource.hourly_rate_override != null) {
      return Number(resource.hourly_rate_override);
    }
    return calculateHourlyPay(resource?.experience_years ?? 5);
  };

  // Compute missing developer levels (S1, S2, S3)
  const missingDevLevels = useMemo(() => {
    const hasS3 = companyRoster.some(r => {
      const rLower = (r.role || "").toLowerCase();
      return rLower.includes("s3") || rLower.includes("lead") || rLower.includes("architect");
    });
    const hasS2 = companyRoster.some(r => {
      const rLower = (r.role || "").toLowerCase();
      return rLower.includes("s2") || rLower.includes("senior");
    });
    const hasS1 = companyRoster.some(r => {
      const rLower = (r.role || "").toLowerCase();
      return !rLower.includes("s3") && !rLower.includes("lead") && !rLower.includes("architect") &&
             !rLower.includes("s2") && !rLower.includes("senior");
    });
    const missing = [];
    if (!hasS1) missing.push("S1");
    if (!hasS2) missing.push("S2");
    if (!hasS3) missing.push("S3");
    return missing;
  }, [companyRoster]);

  const resolvedFeatureAllocations = useMemo(() => {
    // Build lookup: member name -> experience_years for per-member multiplier
    const memberExpMap = {};
    companyRoster.forEach(r => { memberExpMap[r.name] = r.experience_years ?? 5; });

    // Resolve any level-code fallbacks ("S1", "S2", "S3") to first matching roster member name
    const levelCodeToName = (code) => {
      const lc = String(code || "").toLowerCase();
      if (lc === "s3" || lc.includes("lead") || lc.includes("architect")) {
        return companyRoster.find(r => {
          const rl = (r.role || "").toLowerCase();
          return rl.includes("s3") || rl.includes("lead") || rl.includes("architect");
        })?.name || code;
      }
      if (lc === "s2" || lc.includes("senior")) {
        return companyRoster.find(r => {
          const rl = (r.role || "").toLowerCase();
          return rl.includes("s2") || rl.includes("senior");
        })?.name || code;
      }
      return companyRoster.find(r => {
        const rl = (r.role || "").toLowerCase();
        return !rl.includes("s3") && !rl.includes("lead") && !rl.includes("architect") &&
               !rl.includes("s2") && !rl.includes("senior");
      })?.name || code;
    };

    // featureAllocations already has actual names + testing/deployment rows from initializeFeatureList.
    // Re-apply per-member experience multiplier to keep hours accurate after roster changes.
    return featureAllocations.map((f, i) => {
      if (!f) return f;
      const devName = companyRoster.some(r => r.name === f.developer)
        ? f.developer
        : levelCodeToName(f.developer);
      const expYears = memberExpMap[devName] ?? 5;
      // Testing/deployment hours are percentages of dev total — keep as-is
      const hours = (f.isDeployment || f.isTesting)
        ? f.hours
        : Math.round((f.baseHours ?? f.hours) * experienceEffortMultiplier(expYears));
      return { ...f, slNo: i + 1, developer: devName, hours };
    });
  }, [featureAllocations, availableLevels, companyRoster]);

  const [moduleAllocations, setModuleAllocations] = useState({});
  const [supportAllocations, setSupportAllocations] = useState([]);
  const [memberOverrides, setMemberOverrides] = useState({});
  const [teamData, setTeamData] = useState(null);
  const [prevTeamData, setPrevTeamData] = useState(null);

  // Restore team draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-project-planner-team-draft-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.teamData) {
          const roster = parsed.companyRoster || [
            { name: "Resource A", role: "S3 Developer", experience_years: 12 },
            { name: "Resource B", role: "S2 Developer", experience_years: 8 },
            { name: "Resource C", role: "S1 Developer", experience_years: 2 }
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
          if (parsed.userHasModified !== undefined) setUserHasModified(parsed.userHasModified);
          let restoredFeatureAllocations = parsed.featureAllocations || [];
          setFeatureAllocations(restoredFeatureAllocations);
          if (parsed.preEngHours) setPreEngHours(parsed.preEngHours);
          if (parsed.pmFactor !== undefined) setPmFactor(parsed.pmFactor);
        }
      }
    } catch (e) {
      console.error("Failed to restore team draft:", e);
    }
  }, []);

  // Initialize feature list from approved SRS if not loaded
  useEffect(() => {
    if (srsData?.structuredRequirements?.features?.length && !featureAllocations.length) {
      const saved = window.localStorage.getItem("ai-project-planner-team-draft-v1");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.featureAllocations && parsed.featureAllocations.length > 0) {
            setFeatureAllocations(parsed.featureAllocations);
            return;
          }
        } catch (e) {}
      }
      setFeatureAllocations(initializeFeatureList(srsData, companyRoster));
    }
  }, [srsData, featureAllocations.length, companyRoster]);

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
        featureAllocations: resolvedFeatureAllocations,
        preEngHours,
        pmFactor,
        userHasModified,
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
    featureAllocations,
    preEngHours,
    pmFactor,
    userHasModified,
  ]);

  const handleFeatureDevChange = (featureId, newDev) => {
    setUserHasModified(true);
    setFeatureAllocations((prev) =>
      prev.map((item) => {
        if (item.id === featureId) {
          const lvl = getMemberLevel(newDev);
          const multiplier = lvl === "S3" ? 0.75 : lvl === "S2" ? 1.0 : 1.30;
          return {
            ...item,
            developer: newDev,
            hours: Math.round(item.baseHours * multiplier)
          };
        }
        return item;
      })
    );
  };

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
  const [newMemberRole, setNewMemberRole] = useState("S3 Developer");
  const [newMemberExp, setNewMemberExp] = useState(5);
  const [isRosterCollapsed, setIsRosterCollapsed] = useState(false);
  const [planningPreferences, setPlanningPreferences] = useState({
    preferred_strategy: "balanced",
    project_management_coverage: "standard",
    deployment_coverage: "standard",
  });

  const handleAddRosterMember = () => {
    if (!newMemberName.trim()) return;
    const nextRoster = [
      ...companyRoster,
      {
        name: newMemberName.trim(),
        role: newMemberRole,
        experience_years: Number(newMemberExp) || 0
      }
    ];
    setAndSyncRoster(nextRoster);
    setNewMemberName("");
    setNewMemberExp(5);
  };

  const handleRemoveRosterMember = (index) => {
    const nextRoster = [...companyRoster];
    nextRoster.splice(index, 1);
    setAndSyncRoster(nextRoster);
  };

  const handleUpdateRosterMemberExp = (index, value) => {
    const nextRoster = [...companyRoster];
    const member = nextRoster[index];
    const newExp = Math.max(0, Number(value) || 0);
    member.experience_years = newExp;
    setAndSyncRoster(nextRoster);

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
    if (resolvedFeatureAllocations.length > 0) {
      resolvedFeatureAllocations.forEach((f) => {
        totalHours += f.hours;
      });
      maxWeeks = Math.max(1, Math.ceil(totalHours / 40));
    }
    return {
      maxWeeks,
      totalHours,
    };
  }, [resolvedFeatureAllocations]);

  const mathBreakdown = useMemo(() => {
    let leadDevHours = 0;
    let midHours = 0;
    let juniorHours = 0;

    // Filter dev features (exclude testing and deployment)
    const devFeats = resolvedFeatureAllocations.filter(f => !f.isDeployment && !f.isTesting);
    devFeats.forEach((f) => {
      const lvl = getMemberLevel(f.developer);
      if (lvl === "S3") leadDevHours += f.hours;
      else if (lvl === "S2") midHours += f.hours;
      else juniorHours += f.hours;
    });

    const totalDevHours = leadDevHours + midHours + juniorHours || 160;

    const testingInternal = Math.round(totalDevHours * 0.20);
    const testingExternal = Math.round(totalDevHours * 0.10);
    const deployment = Math.round(totalDevHours * 0.10);
    const preEngineering = 32.0;

    const totalEngineeringHours = totalDevHours + testingInternal + testingExternal + deployment;
    const pmHours = 0;
    const totalEffortsEstimation = preEngineering + totalEngineeringHours;
    const riskHours = 0;
    const negotiationHours = 0;
    const grandTotalHours = totalEffortsEstimation;

    // Group module-wise effort sum
    const moduleEffortsMap = {};
    resolvedFeatureAllocations.forEach((f) => {
      moduleEffortsMap[f.moduleName] = (moduleEffortsMap[f.moduleName] || 0) + f.hours;
    });
    const moduleEfforts = Object.entries(moduleEffortsMap).map(([name, hours]) => ({
      name,
      hours
    }));

    return {
      moduleEfforts,
      totalDevHours,
      leadDevHours,
      midHours,
      juniorHours,
      testingInternal,
      testingExternal,
      deployment,
      preEngineering,
      totalEngineeringHours,
      totalBaseEffort: preEngineering + totalEngineeringHours,
      pmHours,
      totalEffortsEstimation,
      riskHours,
      negotiationHours,
      grandTotalHours
    };
  }, [resolvedFeatureAllocations]);

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
          active_weeks: Math.round(pmHrs / 40),
          hours_per_member: pmHrs,
          weekly_hours: 40,
          description: `Project Manager effort is calculated as 15% of the total engineering time (development, testing, and deployment). Planned as ~${Math.round(pmHrs / maxWeeks)} hrs/week over ${maxWeeks} weeks.`,
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
    setUserHasModified(false);

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
    setUserHasModified(false);
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
      let leadDevHours = 0;
      let midHours = 0;
      let juniorHours = 0;

      if (resolvedFeatureAllocations.length > 0) {
        resolvedFeatureAllocations.forEach((f) => {
          const lvl = getMemberLevel(f.developer);
          if (lvl === "S3") leadDevHours += f.hours;
          else if (lvl === "S2") midHours += f.hours;
          else juniorHours += f.hours;
        });
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

      const resSenior = findRosterResource(["s3", "lead", "architect"], 10.01, 100, "S3 Developer", 12);
      const resMid = findRosterResource(["s2", "senior"], 5, 10, "S2 Developer", 8);
      const resJunior = findRosterResource(["s1", "junior"], 0, 4.99, "S1 Developer", 2);

      const reqColHours = Number(preEngHours.requirementsCollection) || 32;
      const queryPrepHours = Number(preEngHours.queryPreparation) || 32;
      const weeklyIntHours = Number(preEngHours.weeklyInteractions) || 32;
      const kbRefHours = Number(preEngHours.kbReference) || 32;

      const preEngineeringTotal = reqColHours + queryPrepHours + weeklyIntHours + kbRefHours;
      const engineeringTotal = leadDevHours + midHours + juniorHours;
      const pmTotalHours = (preEngineeringTotal + engineeringTotal) * (pmFactor / 100);

      allMembers.push({
        role: "Requirements Collection (Pre-Engineering)",
        count: 1,
        description: "Gather and compile functional and non-functional requirements.",
        weekly_hours: 40,
        active_weeks: Math.round(reqColHours / 40),
        hours_per_member: reqColHours,
        hourly_rate: getRosterResourceRate(resSenior)
      });

      allMembers.push({
        role: "Query Preparation (Pre-Engineering)",
        count: 1,
        description: "Prepare queries and clarify assumptions with business stakeholders.",
        weekly_hours: 40,
        active_weeks: Math.round(queryPrepHours / 40),
        hours_per_member: queryPrepHours,
        hourly_rate: getRosterResourceRate(resSenior)
      });

      allMembers.push({
        role: "Weekly Interactions (Pre-Engineering)",
        count: 1,
        description: "Participate in weekly design review and alignment interactions.",
        weekly_hours: 40,
        active_weeks: Math.round(weeklyIntHours / 40),
        hours_per_member: weeklyIntHours,
        hourly_rate: getRosterResourceRate(resSenior)
      });

      allMembers.push({
        role: "Time for Referring Knowledge Base (Pre-Engineering)",
        count: 1,
        description: "Research historical patterns and architectural knowledge bases.",
        weekly_hours: 40,
        active_weeks: Math.round(kbRefHours / 40),
        hours_per_member: kbRefHours,
        hourly_rate: getRosterResourceRate(resSenior)
      });

      // Build one row per actual roster member, grouped by their level bucket
      // Only add rows for levels that have hours AND a matching roster member
      const rosterByLevel = { S1: null, S2: null, S3: null };
      companyRoster.forEach(r => {
        const rLower = (r.role || "").toLowerCase();
        if (rLower.includes("s3") || rLower.includes("lead") || rLower.includes("architect")) {
          if (!rosterByLevel.S3) rosterByLevel.S3 = r;
        } else if (rLower.includes("s2") || rLower.includes("senior")) {
          if (!rosterByLevel.S2) rosterByLevel.S2 = r;
        } else {
          if (!rosterByLevel.S1) rosterByLevel.S1 = r;
        }
      });

      // If roster is empty, fall back to generic labels with standard rates
      const hasAnyRoster = companyRoster.length > 0;

      if (juniorHours > 0) {
        const member = rosterByLevel.S1;
        const label = member ? `${member.name} (${member.role})` : "S1 Developer";
        const rate = member ? getRosterResourceRate(member) : getRosterResourceRate(resJunior);
        const expYears = member ? (member.experience_years || 2) : 2;
        allMembers.push({
          role: label,
          count: 1,
          description: `Junior/S1 developer engineering effort${member ? ` — ${expYears} yrs exp` : ""}.`,
          weekly_hours: 40,
          active_weeks: Math.round(juniorHours / 40),
          hours_per_member: juniorHours,
          hourly_rate: rate,
        });
      }

      if (midHours > 0) {
        const member = rosterByLevel.S2;
        const label = member ? `${member.name} (${member.role})` : "S2 Developer";
        const rate = member ? getRosterResourceRate(member) : getRosterResourceRate(resMid);
        const expYears = member ? (member.experience_years || 8) : 8;
        allMembers.push({
          role: label,
          count: 1,
          description: `Mid/S2 developer engineering effort${member ? ` — ${expYears} yrs exp` : ""}.`,
          weekly_hours: 40,
          active_weeks: Math.round(midHours / 40),
          hours_per_member: midHours,
          hourly_rate: rate,
        });
      }

      if (leadDevHours > 0) {
        const member = rosterByLevel.S3;
        const label = member ? `${member.name} (${member.role})` : "S3 Developer";
        const rate = member ? getRosterResourceRate(member) : getRosterResourceRate(resSenior);
        const expYears = member ? (member.experience_years || 12) : 12;
        allMembers.push({
          role: label,
          count: 1,
          description: `Lead/S3 developer engineering effort${member ? ` — ${expYears} yrs exp` : ""}.`,
          weekly_hours: 40,
          active_weeks: Math.round(leadDevHours / 40),
          hours_per_member: leadDevHours,
          hourly_rate: rate,
        });
      }

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
  }, [resolvedFeatureAllocations, memberOverrides, selectedOption, companyRoster, analysisResult, preEngHours, pmFactor]);

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
        hourly_rate: resource.hourly_rate_override != null ? Number(resource.hourly_rate_override) : calculateHourlyPay(resource.experience_years),
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

  const validateDeveloperAllocation = () => {
    return null;
  };

  const proceedToCosting = () => {
    const validationError = validateDeveloperAllocation();
    if (userHasModified && validationError) {
      setError(validationError);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const approvedTeam = buildApprovedTeamPayload(teamData);
    approvedTeam.pm_pct = pmFactor;
    approvedTeam.currency = selectedCurrency;
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
                      {/* Profiles Selection Dropdown & Management */}
                      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-parcelles-dark/15 pb-3">
                        <div className="flex items-center gap-2 border border-parcelles-dark/30 px-3 py-1 bg-transparent text-[11px] font-display uppercase tracking-wider text-parcelles-dark">
                          <span className="opacity-60">Project Profile:</span>
                          <select
                            value={activeProfileId}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              setActiveProfileId(nextId);
                              const p = profiles.find((p) => p.id === nextId);
                              if (p) {
                                setCompanyRoster(p.members || []);
                                setSelectedCurrency(p.currency || "INR");
                                try {
                                  window.localStorage.setItem("scopesense-active-profile-id-v1", nextId);
                                } catch (err) {}
                              }
                            }}
                            className="bg-transparent border-none outline-none font-bold cursor-pointer text-parcelles-dark"
                          >
                            {profiles.length === 0 ? (
                              <option value="">No Profiles Created</option>
                            ) : (
                              <>
                                <option value="">-- Select Profile --</option>
                                {profiles.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.currency})
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>
                      </div>



                      {/* Caution block if S1, S2, or S3 developer missing */}
                      {missingDevLevels.length > 0 && (
                        <div className="bg-yellow-500/10 border border-yellow-500/35 text-yellow-800 text-xs p-3 font-body flex items-start gap-2.5 animate-fade-in" style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)" }}>
                          <span className="text-yellow-600 font-bold text-sm">⚠️</span>
                          <div>
                            <span className="font-bold">Roster Warning:</span> The selected profile does not contain any developers of level(s): <strong>{missingDevLevels.join(", ")}</strong>. Developer allocations of these levels will fallback automatically.
                          </div>
                        </div>
                      )}

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
                              <div className="col-span-3 flex items-center gap-1 font-mono font-medium text-parcelles-dark">
                                <span>{getCurrencySymbol(selectedCurrency)}</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={member.hourly_rate_override != null ? member.hourly_rate_override : calculateHourlyPay(member.experience_years)}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const nextRoster = [...companyRoster];
                                    nextRoster[index] = {
                                      ...nextRoster[index],
                                      hourly_rate_override: val === "" ? null : Number(val) || 0
                                    };
                                    setAndSyncRoster(nextRoster);
                                  }}
                                  className="w-16 border border-parcelles-dark/30 px-1 py-0.5 text-center bg-transparent focus:border-parcelles-dark outline-none font-mono"
                                />
                                <span className="text-[10px] opacity-60">/hr</span>
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
                              <option value="S3 Developer">S3 Developer</option>
                              <option value="S2 Developer">S2 Developer</option>
                              <option value="S1 Developer">S1 Developer</option>
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
                          <div className="col-span-3 flex items-center gap-1 font-mono font-medium text-parcelles-dark/70">
                            <span>{getCurrencySymbol(selectedCurrency)}</span>
                            <span>{calculateHourlyPay(newMemberExp)}</span>
                            <span className="text-[10px] opacity-60">/hr</span>
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
                  </div>

                </div>



                <div className="bg-parcelles-bg border border-parcelles-dark p-5 md:p-6 chamfer-bottom-right">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-parcelles-dark pb-4 mb-4">
                    <div>
                      <p className="font-display uppercase tracking-widest text-[9px] opacity-60">Final Review</p>
                      <h2 className="text-2xl font-display mt-0.5">Confirm &amp; Approve Team Architecture</h2>
                    </div>
                  </div>

                  {(() => {
                    const reqColHours = Number(preEngHours.requirementsCollection) || 32;
                    const queryPrepHours = Number(preEngHours.queryPreparation) || 32;
                    const weeklyIntHours = Number(preEngHours.weeklyInteractions) || 32;
                    const kbRefHours = Number(preEngHours.kbReference) || 32;
                    const preEngTotal = Math.round(reqColHours + queryPrepHours + weeklyIntHours + kbRefHours);
                    const engineeringTotal = Math.round(resolvedFeatureAllocations.reduce((acc, row) => acc + (Number(row.hours) || 0), 0));
                    const pmTotal = 0;
                    const grandTotal = Math.round(preEngTotal + engineeringTotal);

                    // Build per-member hour breakdown from roster across ALL allocations
                    const memberHourMap = {};
                    resolvedFeatureAllocations.forEach((f) => {
                      const key = f.developer || "Unknown";
                      memberHourMap[key] = (memberHourMap[key] || 0) + (Number(f.hours) || 0);
                    });

                    // Find S3/lead developer to attribute Pre-Engineering total hours, fallback to first available
                    const s3Dev = companyRoster.find(r => {
                      const roleLower = (r.role || "").toLowerCase();
                      return roleLower.includes("s3") || roleLower.includes("lead") || roleLower.includes("architect");
                    }) || companyRoster[0];

                    if (s3Dev && preEngTotal > 0) {
                      memberHourMap[s3Dev.name] = (memberHourMap[s3Dev.name] || 0) + preEngTotal;
                    }

                    // Members with hours, resolved to display info
                    const memberSummaryRows = Object.entries(memberHourMap)
                      .filter(([, hrs]) => hrs > 0)
                      .map(([devKey, hrs]) => {
                        const rosterMember = companyRoster.find(r => r.name === devKey);
                        const label = rosterMember
                          ? `${rosterMember.name} (${rosterMember.role})`
                          : devKey;
                        return { label, hrs: Math.round(hrs) };
                      });

                    const validationError = validateDeveloperAllocation();

                    return (
                      <div className="space-y-6 mb-4">
                        {/* 1. Pre-Engineering Module */}
                        <div className="border border-parcelles-dark/30 p-4 bg-parcelles-sage/5 rounded space-y-3 shadow-sm">
                          <div
                            onClick={() => setIsDevStaffingExpanded(!isDevStaffingExpanded)}
                            style={{ cursor: "pointer" }}
                            className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1"
                          >
                            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Pre-Engineering Module</span>
                            {isDevStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                          </div>
                          {isDevStaffingExpanded && (
                            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                              {[
                                { key: "requirementsCollection", label: "Requirements Collection" },
                                { key: "queryPreparation", label: "Query Preparation" },
                                { key: "weeklyInteractions", label: "Weekly Interactions" },
                                { key: "kbReference", label: "Time for Referring Knowledge Base" }
                              ].map(({ key, label }) => (
                                <div key={key} className="p-3 border border-parcelles-dark/15 bg-parcelles-bg rounded flex flex-col justify-between">
                                  <span className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/70 font-bold block mb-2">{label}</span>
                                  <div className="flex items-center gap-2 mt-2">
                                    <input
                                      type="number"
                                      min="32"
                                      value={preEngHours[key] ?? 32}
                                      onChange={(e) => {
                                        const val = Math.max(32, parseInt(e.target.value) || 32);
                                        setPreEngHours(prev => ({ ...prev, [key]: val }));
                                      }}
                                      className="w-full border border-parcelles-dark/30 px-2 py-1 text-center bg-parcelles-bg focus:border-parcelles-dark outline-none font-mono text-xs rounded"
                                    />
                                    <span className="opacity-60 text-[10px] uppercase tracking-wider text-parcelles-dark whitespace-nowrap">hrs / {Math.ceil((preEngHours[key] ?? 32) / 8)} days</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="text-right pt-2 border-t border-parcelles-dark/10">
                            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/60 font-bold">Total Pre-Engineering Effort: </span>
                            <span className="font-mono text-xs font-bold text-parcelles-dark">{preEngTotal} hrs / {Math.ceil(preEngTotal / 8)} days</span>
                          </div>
                        </div>

                        {/* 2. Engineering Module */}
                        <div className="border border-parcelles-dark/30 p-4 bg-parcelles-sage/5 rounded space-y-3 shadow-sm">
                          <div
                            onClick={() => setIsTestStaffingExpanded(!isTestStaffingExpanded)}
                            style={{ cursor: "pointer" }}
                            className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1"
                          >
                            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Engineering Module</span>
                            {isTestStaffingExpanded ? <ChevronUp size={14} className="text-parcelles-dark" /> : <ChevronDown size={14} className="text-parcelles-dark" />}
                          </div>
                          {isTestStaffingExpanded && (
                            <div className="space-y-4">
                                              {resolvedFeatureAllocations?.length ? (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between border-b border-parcelles-dark/15 pb-1.5 mb-2">
                                    <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/70 font-bold block">Feature Estimation &amp; Developer Allocation Sheet</span>
                                  </div>

                                  <div className="overflow-auto border border-parcelles-dark/20 rounded" style={{ maxHeight: "420px" }}>
                                    <table className="w-full border-collapse" style={{ minWidth: "900px" }}>
                                      <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                                        <tr className="bg-parcelles-dark text-parcelles-bg font-display text-[9px] uppercase tracking-wider">
                                          <th className="p-2 border-r border-parcelles-light/10 text-center w-[50px]">Sl No</th>
                                          <th className="p-2 border-r border-parcelles-light/10 text-left w-[150px]">Module Names</th>
                                          <th className="p-2 border-r border-parcelles-light/10 text-left w-[180px]">Features</th>
                                          <th className="p-2 border-r border-parcelles-light/10 text-left">Description</th>
                                          <th className="p-2 border-r border-parcelles-light/10 text-left w-[100px]">Developer</th>
                                          <th className="p-2 border-r border-parcelles-light/10 text-right w-[90px]">Est. Hours</th>
                                          <th className="p-2 text-right w-[70px]">Days</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-parcelles-dark/10">
                                        {(() => {
                                          const rowSpans = calculateModuleRowSpans(resolvedFeatureAllocations);
                                          // Build module groups for subtotal rows
                                          const moduleGroups = {};
                                          resolvedFeatureAllocations.forEach((row) => {
                                            if (!moduleGroups[row.moduleName]) moduleGroups[row.moduleName] = [];
                                            moduleGroups[row.moduleName].push(row);
                                          });
                                          const rows = [];
                                          let lastModule = null;
                                          resolvedFeatureAllocations.forEach((row, idx) => {
                                            const spanInfo = rowSpans.find((s) => s.index === idx);
                                            const isDeployRow = row.isDeployment === true;
                                            const isTestingRow = row.isTesting === true;
                                            rows.push(
                                              <tr key={row.id} className={`hover:bg-parcelles-sage/5 transition-colors font-body text-xs text-parcelles-dark ${isDeployRow || isTestingRow ? "bg-parcelles-dark/5" : "bg-parcelles-bg"}`}>
                                                <td className="p-2 border-r border-parcelles-dark/10 text-center align-middle font-mono text-[10px]">
                                                  {row.slNo}
                                                </td>
                                                {spanInfo ? (
                                                  <td
                                                    rowSpan={spanInfo.span}
                                                    className={`p-2 border-r border-parcelles-dark/10 font-display font-bold align-middle text-xs ${isDeployRow || isTestingRow ? "bg-parcelles-dark/10 text-parcelles-dark" : "bg-parcelles-sage/5"}`}
                                                  >
                                                    {row.moduleName}
                                                  </td>
                                                ) : null}
                                                <td className="p-2 border-r border-parcelles-dark/10 align-middle">
                                                  {row.featureName}
                                                </td>
                                                <td className="p-2 border-r border-parcelles-dark/10 align-middle text-[11px] text-parcelles-dark/75 leading-relaxed">
                                                  {row.description || "No description available"}
                                                </td>
                                                <td className="p-2 border-r border-parcelles-dark/10 align-middle">
                                                  <select
                                                      value={row.developer}
                                                      onChange={(e) => handleFeatureDevChange(row.id, e.target.value)}
                                                      className="w-full border border-parcelles-dark/20 rounded px-2 py-1 bg-parcelles-bg text-parcelles-dark font-display text-[10px] focus:border-parcelles-dark outline-none cursor-pointer"
                                                    >
                                                      {companyRoster.length > 0 ? (
                                                        companyRoster.map((member) => (
                                                          <option key={member.name} value={member.name}>
                                                            {member.name} ({member.role})
                                                          </option>
                                                        ))
                                                      ) : (
                                                        ["S1", "S2", "S3"].map((lvl) => (
                                                          <option key={lvl} value={lvl}>{lvl}</option>
                                                        ))
                                                      )}
                                                    </select>
                                                </td>
                                                <td className="p-2 border-r border-parcelles-dark/10 text-right align-middle font-mono font-bold">
                                                  {Math.round(row.hours)}
                                                </td>
                                                <td className="p-2 text-right align-middle font-mono text-[10px] text-parcelles-dark/60">
                                                  {Math.ceil(row.hours / 8)}d
                                                </td>
                                              </tr>
                                            );
                                          });
                                          return rows;
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-2 border-t border-parcelles-dark/10">
                            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/60 font-bold">Total Engineering Effort:</span>
                            <span className="font-mono text-xs font-bold text-parcelles-dark">{Math.round(engineeringTotal)} hrs / {Math.ceil(engineeringTotal / 8)} days</span>
                          </div>
                        </div>


                        {/* Grand Total Box */}
                        <div className="border border-parcelles-dark bg-parcelles-dark text-parcelles-bg p-4 flex justify-between items-center rounded shadow-sm">
                          <span className="font-display text-sm uppercase tracking-wider font-bold">Grand Total of Project Team Allocation Efforts Estimation</span>
                          <span className="font-mono text-xl font-bold">{Math.round(grandTotal)} hrs / {Math.ceil(grandTotal / 8)} days</span>
                        </div>

                        {/* Last Box: Developer Effort Summary and Action */}
                        <div className="border border-parcelles-dark/25 p-4 bg-parcelles-sage/10 rounded space-y-4">
                          <div className="border-b border-parcelles-dark/15 pb-2">
                            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark font-bold block">Developer Effort Summary</span>
                            <div className={`grid gap-4 mt-4 ${memberSummaryRows.length === 1 ? 'grid-cols-1' : memberSummaryRows.length === 2 ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
                             {memberSummaryRows.length > 0 ? memberSummaryRows.map(({ label, hrs }) => (
                               <div key={label} className="p-3 border border-parcelles-dark/10 bg-parcelles-bg text-center rounded">
                                 <span className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/65 font-bold block">{label}</span>
                                 <p className="text-xl font-display font-extrabold text-parcelles-dark mt-1.5">{hrs} h</p>
                                 <span className="text-[9px] font-body opacity-50 block mt-0.5">({Math.ceil(hrs / 8)} days)</span>
                               </div>
                             )) : (
                               <div className="p-3 border border-parcelles-dark/10 bg-parcelles-bg text-center rounded col-span-3">
                                 <span className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/65">No developer hours allocated yet</span>
                               </div>
                             )}
                           </div>
                          </div>

                          {userHasModified && validationError && (
                            <div style={{
                              background: "rgba(220,38,38,0.08)",
                              border: "1px solid rgba(220,38,38,0.25)",
                              color: "#991b1b",
                              padding: "0.75rem 1rem",
                              fontFamily: "var(--font-sans)",
                              fontSize: "0.85rem",
                              marginTop: "1rem",
                              borderRadius: "4px"
                            }}>
                              <strong>Estimation Restriction Warning:</strong> {validationError}
                            </div>
                          )}

                          <div className="flex justify-center mt-4">
                            <button
                              onClick={(userHasModified && validationError) ? undefined : proceedToCosting}
                              disabled={userHasModified && !!validationError}
                              className={`px-6 py-4 font-display text-lg tracking-wider uppercase transition-colors chamfer-bottom-left flex items-center gap-3 w-full sm:w-auto justify-center ${
                                (userHasModified && validationError)
                                  ? "bg-parcelles-dark/30 text-parcelles-bg/50 cursor-not-allowed opacity-50"
                                  : "bg-parcelles-dark hover:bg-parcelles-dark/95 text-parcelles-bg"
                              }`}
                            >
                              Proceed to Costing <ArrowRight size={20} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
