"use client";

/**
 * AxcendCostEstimation.jsx
 *
 * Displays the cost estimation sheets that exactly mirror the AXCEND Excel format.
 * Redesigned to show developer totals and module-wise cost breakdown.
 *
 * Layout (top → bottom):
 *   ① Header + Summary strip — In Days, ManDays, ManMonths, ManWeeks, Engineer-Weeks
 *   ② Section A: Developer Effort Summary
 *   ③ Section B: Module-wise Cost Breakdown
 *   ④ Section C: Finance Roll-Up
 *
 * Visual style: Collectif Parcelles design system (chamfer corners, dark green,
 * sage green, uppercase tracking labels, Space Grotesk + Inter typography)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Loader2,
  Settings,
} from "lucide-react";
import { loadApprovedTeam } from "@/lib/workflowArtifacts";
import { exportAxcendExcel, getExchangeRates } from "@/lib/platformApi";
import { loadAxcendEstimationDraft } from "@/lib/axcendEstimationStorage";

// ─── helpers ─────────────────────────────────────────────────────────────────

const sumHours = (rows) => {
  return (rows || []).reduce((acc, row) => {
    return acc + (Number(row.input_hours || row.estimated_hours || row.hours || row.hours_per_member || 0));
  }, 0);
};

const fmtNum  = (n, dp = 0) => {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  if (n % 1 === 0) return Math.round(n).toString();
  return n.toFixed(dp > 0 ? dp : 1).replace(/\.0+$/, '');
};
const fmtCost = (n, curr = "USD") => {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: curr,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
};

const CURRENCY_SYMBOLS = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  AED: "د.إ",
  SGD: "$",
  AUD: "$",
  CAD: "$"
};
const getCurrencySymbol = (currency) => CURRENCY_SYMBOLS[currency] || "$";

const calculateHourlyPay = (years, currency = "INR") => {
  const y = Number(years) || 0;
  if (y >= 10) return 50;
  if (y >= 5) return 45;
  return 40;
};

// ─── S-Level badge ────────────────────────────────────────────────────────────

const SLEVEL_STYLES = {
  S3: { bg: "bg-parcelles-dark/10", text: "text-parcelles-dark border border-parcelles-dark/20" },
  S2: { bg: "bg-parcelles-sage/30", text: "text-emerald-955 border border-parcelles-sage/50" },
  S1: { bg: "bg-parcelles-sage/10", text: "text-emerald-900 border border-parcelles-sage/20" },
};

function SLevelBadge({ level }) {
  const s = SLEVEL_STYLES[level] || SLEVEL_STYLES.S1;
  return (
    <span className={`ml-2 text-[10px] px-2 py-0.5 font-display font-bold uppercase tracking-wider ${s.bg} ${s.text} inline-block`}>
      {level}
    </span>
  );
}

// ─── Editable number cell ─────────────────────────────────────────────────────

function EditCell({ value, onChange, prefix = "", suffix = "", minVal = 0, step = 1, width = "80px", accent = false, title = "Click to edit" }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ""));

  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n) && n >= minVal) onChange(n);
    else setLocal(String(value ?? ""));
    setEditing(false);
  };

  return editing ? (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        min={minVal}
        step={step}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        autoFocus
        style={{ width }}
        className="font-display text-xs border border-parcelles-dark bg-parcelles-bg text-parcelles-dark px-1.5 py-0.5 text-right outline-none transition-colors"
      />
      <button
        onMouseDown={(e) => { e.preventDefault(); commit(); }}
        type="button"
        className="font-display text-[9px] uppercase tracking-wider bg-parcelles-dark text-parcelles-bg px-2 py-0.5 border border-parcelles-dark hover:opacity-90 active:scale-95 transition-all font-bold"
      >
        Save
      </button>
    </div>
  ) : (
    <span
      onClick={() => { setLocal(String(value ?? "")); setEditing(true); }}
      title={title}
      style={{ minWidth: width }}
      className={`cursor-pointer font-display text-xs px-1 py-0.5 text-right underline decoration-dotted decoration-parcelles-dark/30 hover:bg-parcelles-sage/25 inline-block ${accent ? "text-emerald-800 bg-emerald-50/50" : "text-parcelles-dark"}`}
    >
      {prefix}{fmtNum(value, 0)}{suffix}
    </span>
  );
}

// ─── Stat Pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value, unit }) {
  return (
    <div className="p-4 border-r border-parcelles-dark/15 last:border-r-0 flex flex-col gap-1">
      <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/50">
        {label}
      </span>
      <span className="font-display font-bold text-lg text-parcelles-dark">
        {value}
        <span className="font-body font-normal text-xs text-parcelles-dark/50 ml-1.5">
          {unit}
        </span>
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AxcendCostEstimation({ analysisResult, currency = "USD", onCurrencyChange }) {
  const [activeCurrency, setActiveCurrency] = useState(currency || "USD");
  const [rates, setRates] = useState({
    USD: 1.0,
    INR: 83.5,
    EUR: 0.92,
    GBP: 0.78,
    AED: 3.67,
    SGD: 1.35,
    AUD: 1.50,
    CAD: 1.37,
    JPY: 155.0,
  });
  const [loadingRates, setLoadingRates] = useState(false);

  // Sync activeCurrency state with currency prop when it changes
  useEffect(() => {
    if (currency) {
      setActiveCurrency(currency);
    }
  }, [currency]);

  // Fetch real-time exchange rates from public API on mount via our backend proxy
  useEffect(() => {
    const fetchRates = async () => {
      setLoadingRates(true);
      try {
        const liveRates = await getExchangeRates();
        if (liveRates && Object.keys(liveRates).length > 0) {
          setRates(liveRates);
        }
      } catch (e) {
        console.warn("Failed to fetch real-time exchange rates, using fallback rates:", e);
      } finally {
        setLoadingRates(false);
      }
    };
    fetchRates();
  }, []);

  const [preEngHours, setPreEngHours] = useState(128);
  const [s1Hours, setS1Hours] = useState(0);
  const [s2Hours, setS2Hours] = useState(0);
  const [s3DevHours, setS3DevHours] = useState(0);

  const [s1Rate, setS1Rate] = useState(320);
  const [s2Rate, setS2Rate] = useState(360);
  const [s3Rate, setS3Rate] = useState(400);

  const [pmPct, setPmPct]           = useState(10);
  const [financePct, setFinancePct] = useState(1.5);
  const [forexPct, setForexPct]     = useState(1.0);
  const [riskPct, setRiskPct]       = useState(25);
  const [negoPct, setNegoPct]       = useState(0);

  const [showSettings, setShowSettings] = useState(false);
  const [loaded, setLoaded]         = useState(false);
  const [exporting, setExporting] = useState(false);

  const [tempPmPct, setTempPmPct]           = useState(10);
  const [tempFinancePct, setTempFinancePct] = useState(1.5);
  const [tempForexPct, setTempForexPct]     = useState(1.0);
  const [tempRiskPct, setTempRiskPct]       = useState(25);
  const [tempNegoPct, setTempNegoPct]       = useState(0);

  // Sync temp state with committed state when settings panel opens or when main states load/update
  useEffect(() => {
    setTempPmPct(pmPct);
    setTempFinancePct(financePct);
    setTempForexPct(forexPct);
    setTempRiskPct(riskPct);
    setTempNegoPct(negoPct);
  }, [showSettings, pmPct, financePct, forexPct, riskPct, negoPct]);

  const handleSaveSettings = () => {
    setPmPct(tempPmPct);
    setFinancePct(tempFinancePct);
    setForexPct(tempForexPct);
    setRiskPct(tempRiskPct);
    setNegoPct(tempNegoPct);
    setShowSettings(false);
  };

  const handleCurrencyChange = (newCurrency) => {
    if (newCurrency === activeCurrency) return;
    setActiveCurrency(newCurrency);
    if (onCurrencyChange) {
      onCurrencyChange(newCurrency);
    }
  };

  // Initialize values from the saved Axcend estimation first, then fall back to approved team data.
  useEffect(() => {
    const approvedTeam = loadApprovedTeam();
    const estimationDraft = loadAxcendEstimationDraft();

    if (approvedTeam?.pm_pct !== undefined) {
      setPmPct(approvedTeam.pm_pct);
    }
    if (estimationDraft?.effort_percentages?.pm_pct !== undefined) {
      setPmPct(Math.round(Number(estimationDraft.effort_percentages.pm_pct || 0) * 100));
    }

    let rateS1 = calculateHourlyPay(2, activeCurrency) * 8;
    let rateS2 = calculateHourlyPay(8, activeCurrency) * 8;
    let rateS3 = calculateHourlyPay(12, activeCurrency) * 8;

    try {
      const teamDraftRaw = window.localStorage.getItem("ai-project-planner-team-draft-v1");
      if (teamDraftRaw) {
        const teamDraft = JSON.parse(teamDraftRaw);
        const roster = teamDraft.companyRoster || [];
        roster.forEach((r) => {
          const roleLower = (r.role || "").toLowerCase();
          const exp = Number(r.experience_years) || 0;
          const hourlyRate = r.hourly_rate_override != null ? Number(r.hourly_rate_override) : calculateHourlyPay(exp, activeCurrency);
          const rate = hourlyRate * 8;
          if (roleLower.includes("s3") || exp >= 10) rateS3 = rate;
          else if (roleLower.includes("s2") || exp >= 5) rateS2 = rate;
          else rateS1 = rate;
        });
      }
    } catch (e) {
      console.warn("Roster parsing error inside AxcendCostEstimation:", e);
    }

    if (estimationDraft) {
      setPreEngHours(sumHours(estimationDraft.pre_engineering) || 128);
      setS1Hours(sumHours((estimationDraft.engineering || []).filter((row) => row.resource_level === "S1")));
      setS2Hours(sumHours((estimationDraft.engineering || []).filter((row) => row.resource_level === "S2")));
      setS3DevHours(sumHours((estimationDraft.engineering || []).filter((row) => row.resource_level === "S3")));
      setS1Rate(rateS1);
      setS2Rate(rateS2);
      setS3Rate(rateS3);
      setLoaded(true);
      return;
    }

    if (approvedTeam?.members) {
      // Also load roster from teamDraft for name-based level classification
      let rosterForClassify = [];
      try {
        const tdRaw = window.localStorage.getItem("ai-project-planner-team-draft-v1");
        if (tdRaw) {
          const td = JSON.parse(tdRaw);
          rosterForClassify = td.companyRoster || [];
        }
      } catch (e) {}

      // Helper: classify a role string or member name to a level
      const classifyMemberLevel = (roleLower) => {
        if (roleLower.includes("pre-engineering") || roleLower.includes("pre engineering")) return "pre_eng";
        if (roleLower.includes("project management") || roleLower.includes(" pm")) return "pm";
        // Check for explicit S-level codes
        if (roleLower.includes("s3") || roleLower.includes("lead") || roleLower.includes("architect")) return "S3";
        if (roleLower.includes("s2") || roleLower.includes("senior")) return "S2";
        if (roleLower.includes("s1") || roleLower.includes("junior")) return "S1";
        // Fallback: check roster by matching member name (role label often includes member name)
        for (const r of rosterForClassify) {
          const nameInRole = roleLower.includes((r.name || "").toLowerCase()) && r.name;
          if (nameInRole) {
            const rl = (r.role || "").toLowerCase();
            const exp = Number(r.experience_years) || 0;
            if (rl.includes("s3") || rl.includes("lead") || rl.includes("architect") || exp >= 10) return "S3";
            if (rl.includes("s2") || rl.includes("senior") || (exp >= 5 && exp < 10)) return "S2";
            return "S1";
          }
        }
        return "S1"; // default fallback
      };

      let preEngSum = 0;
      let s1Sum = 0;
      let s2Sum = 0;
      let s3Sum = 0;

      approvedTeam.members.forEach((m) => {
        const roleLower = (m.role || "").toLowerCase();
        const hrs = Number(m.hours_per_member) || 0;
        const level = classifyMemberLevel(roleLower);
        if (level === "pre_eng") {
          preEngSum += hrs;
        } else if (level === "S1") {
          s1Sum += hrs;
        } else if (level === "S2") {
          s2Sum += hrs;
        } else if (level === "S3") {
          s3Sum += hrs;
        }
        // "pm" level is intentionally excluded from dev/eng hours
      });

      setPreEngHours(preEngSum || 128);
      setS1Hours(s1Sum);
      setS2Hours(s2Sum);
      setS3DevHours(s3Sum);
      setS1Rate(rateS1);
      setS2Rate(rateS2);
      setS3Rate(rateS3);
      setLoaded(true);
    }
  }, [analysisResult, activeCurrency]);

  // Unified calculations
  const result = useMemo(() => {
    const preEngHoursVal = Math.round(preEngHours);
    const s1HoursVal = Math.round(s1Hours);
    const s2HoursVal = Math.round(s2Hours);
    const s3DevHoursVal = Math.round(s3DevHours);

    const devHours = Math.round(preEngHoursVal + s1HoursVal + s2HoursVal + s3DevHoursVal);
    const pmHours = Math.round(devHours * (pmPct / 100));
    
    // S3 total hours (excluding PM for dev list, PM shown separately)
    const s3TotalHours = Math.round(preEngHoursVal + s3DevHoursVal);
    const s2TotalHours = s2HoursVal;
    const s1TotalHours = s1HoursVal;

    const preEngDays = preEngHoursVal / 8;
    const preEngCost = Math.round(preEngDays * s3Rate);

    const s3DevDays = s3DevHoursVal / 8;
    const s3DevCost = Math.round(s3DevDays * s3Rate);

    const s2ManDays = s2TotalHours / 8;
    const s2Cost = Math.round(s2ManDays * s2Rate);

    const s1ManDays = s1TotalHours / 8;
    const s1Cost = Math.round(s1ManDays * s1Rate);

    const s3ManDays = preEngDays + s3DevDays;
    const s3Cost = preEngCost + s3DevCost;

    const devSubtotal = Math.round(s3Cost + s2Cost + s1Cost);
    const pmManDays = pmHours / 8;
    const pmCost = Math.round(devSubtotal * (pmPct / 100));
    const totalCost = Math.round(devSubtotal + pmCost);

    const totalAllHours = Math.round(devHours + pmHours);
    const totalAllDays = s3ManDays + s2ManDays + s1ManDays + pmManDays;
    const manDaysTotal = totalAllDays;
    const manMonths = Math.round(manDaysTotal / 20);
    const manWeeks = Math.round(manDaysTotal / 5);
    const inDays = s3ManDays + s2ManDays + s1ManDays;

    const engDays = s3DevDays + s2ManDays + s1ManDays;
    const engCost = s3DevCost + s2Cost + s1Cost;

    const financeCost = Math.round(totalCost * (financePct / 100));
    const forexCost = Math.round(totalCost * (forexPct / 100));
    const riskAmount = Math.round(totalCost * (riskPct / 100));
    const subTotal = Math.round(totalCost + financeCost + forexCost + riskAmount);
    const negoAmount = Math.round(subTotal * (negoPct / 100));
    const finalQuote = Math.round(subTotal - negoAmount);
    const ratePerHr = totalAllHours > 0 ? Math.round(finalQuote / totalAllHours) : 0;

    return {
      devHours,
      pmHours,
      s3TotalHours,
      s2TotalHours,
      s1TotalHours,
      s3ManDays,
      s2ManDays,
      s1ManDays,
      s3Cost,
      s2Cost,
      s1Cost,
      devSubtotal,
      pmManDays,
      pmCost,
      totalCost,
      totalAllHours,
      totalAllDays,
      manDaysTotal,
      manMonths,
      manWeeks,
      inDays,
      preEngDays,
      preEngCost,
      engDays,
      engCost,
      financeCost,
      forexCost,
      riskAmount,
      subTotal,
      negoAmount,
      finalQuote,
      ratePerHr,
    };
  }, [preEngHours, s1Hours, s2Hours, s3DevHours, s3Rate, s2Rate, s1Rate, pmPct, financePct, forexPct, riskPct, negoPct]);

  const handleExportAxcend = async () => {
    setExporting(true);
    try {
      const approvedTeam = loadApprovedTeam();
      const estimationDraft = loadAxcendEstimationDraft();
      const prjName = estimationDraft?.project_name || approvedTeam?.project_name || "Axcend Project";

      // ── Load roster & pre-eng breakdown from teamDraft ────────────────────
      let rosterFromDraft = [];
      let preEngBreakdown = { requirementsCollection: 32, queryPreparation: 32, weeklyInteractions: 32, kbReference: 32 };
      let featureAllocsFromDraft = [];
      try {
        const tdRaw = window.localStorage.getItem("ai-project-planner-team-draft-v1");
        if (tdRaw) {
          const td = JSON.parse(tdRaw);
          rosterFromDraft = td.companyRoster || [];
          if (td.preEngHours && typeof td.preEngHours === "object") {
            preEngBreakdown = td.preEngHours;
          }
          featureAllocsFromDraft = td.featureAllocations || [];
        }
      } catch (e) {
        console.warn("Could not load teamDraft for export:", e);
      }

      // ── Roster-based level classifier ─────────────────────────────────────
      const classifyDevByName = (devName) => {
        const member = rosterFromDraft.find((r) => r.name === devName);
        if (member) {
          const rl = (member.role || "").toLowerCase();
          const exp = Number(member.experience_years) || 0;
          if (rl.includes("s3") || rl.includes("lead") || rl.includes("architect") || exp >= 10) return "S3";
          if (rl.includes("s2") || rl.includes("senior") || (exp >= 5 && exp < 10)) return "S2";
          return "S1";
        }
        const dl = String(devName || "").toLowerCase();
        if (dl.includes("s3") || dl.includes("lead") || dl.includes("architect")) return "S3";
        if (dl.includes("s2") || dl.includes("senior")) return "S2";
        return "S1";
      };

      // ── KEY FIX: Use the SAME state values the display uses ───────────────
      // The display is powered by: preEngHours, s1Hours, s2Hours, s3DevHours
      // (loaded from approvedTeam.members). We use those exact values here so
      // the Excel always matches what is shown on screen.
      const preEngTotal = Math.round(preEngHours);          // total pre-engineering
      const s3DisplayHours = Math.round(s3DevHours);        // S3 dev + deployment (as shown)
      const s2DisplayHours = Math.round(s2Hours);           // S2 dev + testing    (as shown)
      const s1DisplayHours = Math.round(s1Hours);           // S1 dev only         (as shown)

      // The display combines (dev+testing) into S2 and (dev+deployment) into S3.
      // For the engineering section rows in Excel we split them back using
      // the standard ratios (testing=30%, deployment=10% of pure-dev-total).
      // pure_dev_total = (s3+s2+s1) / 1.4  because totals include +40% overhead
      const engBundledTotal = s3DisplayHours + s2DisplayHours + s1DisplayHours;
      const pureDevTotal    = Math.round(engBundledTotal / 1.4);
      const internalTesting = Math.round(pureDevTotal * 0.20);
      const clientTesting   = Math.round(pureDevTotal * 0.10);
      const deploymentHours = Math.round(pureDevTotal * 0.10);
      const pureS3Dev = Math.max(0, s3DisplayHours - deploymentHours);
      const pureS2Dev = Math.max(0, s2DisplayHours - internalTesting - clientTesting);
      const pureS1Dev = s1DisplayHours; // no testing/deployment in S1 hours

      // ── Sheet 4 Modules — reconstruct from featureAllocations ─────────────
      let modules = estimationDraft?.modules || [];
      if (!modules.length) {
        const devFeats = featureAllocsFromDraft.filter(
          (f) =>
            f &&
            !f.isDeployment &&
            !f.isTesting &&
            f.id !== "__deployment__" &&
            f.id !== "__internal_testing__" &&
            f.id !== "__client_testing__"
        );
        if (devFeats.length > 0) {
          const groups = {};
          devFeats.forEach((f) => {
            if (!groups[f.moduleName]) groups[f.moduleName] = [];
            groups[f.moduleName].push(f);
          });
          let modSl = 1;
          modules = Object.entries(groups).map(([modName, feats]) => {
            const featuresList = feats.map((f, fIdx) => ({
              sl: fIdx + 1,
              module: modName,
              feature: `${f.featureName} (${f.developer})`,
              description: f.description || "",
              estimated_hours: Number(f.hours) || 0,
              base_hours: Number(f.baseHours) || 0,
              developer: f.developer || "S1",
              resource_level: classifyDevByName(f.developer),
            }));
            return {
              sl: modSl++,
              module_name: modName,
              features: featuresList,
              module_total_hours: featuresList.reduce((s, f) => s + f.estimated_hours, 0),
            };
          });
        }
      }

      // ── Pre-Engineering rows (individual activity breakdown) ───────────────
      const reqColHrs   = Number(preEngBreakdown.requirementsCollection) || Math.round(preEngTotal / 4);
      const queryPrepHrs = Number(preEngBreakdown.queryPreparation)      || Math.round(preEngTotal / 4);
      const weeklyIntHrs = Number(preEngBreakdown.weeklyInteractions)    || Math.round(preEngTotal / 4);
      const kbRefHrs     = Number(preEngBreakdown.kbReference)           || Math.round(preEngTotal / 4);

      const s3Roster = rosterFromDraft.find((r) => {
        const rl = (r.role || "").toLowerCase();
        return rl.includes("s3") || rl.includes("lead") || rl.includes("architect") || Number(r.experience_years) >= 10;
      });
      const s2Roster = rosterFromDraft.find((r) => {
        const rl = (r.role || "").toLowerCase();
        return (rl.includes("s2") || rl.includes("senior")) && Number(r.experience_years) < 10;
      });
      const s1Roster = rosterFromDraft.find((r) => {
        const rl = (r.role || "").toLowerCase();
        return !rl.includes("s3") && !rl.includes("lead") && !rl.includes("architect") && !rl.includes("s2") && !rl.includes("senior");
      });

      const s3ExpYrs  = s3Roster ? Number(s3Roster.experience_years) : 12;
      const s2ExpYrs  = s2Roster ? Number(s2Roster.experience_years) : 8;

      const pre_engineering = estimationDraft?.pre_engineering?.length
        ? estimationDraft.pre_engineering
        : [
            { activity: "Requirement Collection",          location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: reqColHrs,    section: "pre_engineering" },
            { activity: "Query Preparation",               location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: queryPrepHrs,  section: "pre_engineering" },
            { activity: "Weekly Interactions",             location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: weeklyIntHrs,  section: "pre_engineering" },
            { activity: "Time for Referring Knowledge Base", location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: kbRefHrs,   section: "pre_engineering" },
          ];

      // ── Engineering rows — derived from display state values ───────────────
      const engineering = estimationDraft?.engineering?.length
        ? estimationDraft.engineering
        : [
            ...(pureS3Dev > 0 ? [{ activity: "Software Development - S3", location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: pureS3Dev,      section: "engineering" }] : []),
            ...(pureS2Dev > 0 ? [{ activity: "Software Development - S2", location: "India", resource_level: "S2", experience_years: s2ExpYrs, input_hours: pureS2Dev,      section: "engineering" }] : []),
            ...(pureS1Dev > 0 ? [{ activity: "Software Development - S1", location: "India", resource_level: "S1", experience_years: 2,        input_hours: pureS1Dev,      section: "engineering" }] : []),
            { activity: "Internal Testing", location: "India", resource_level: "S2", experience_years: s2ExpYrs, input_hours: internalTesting, section: "engineering" },
            { activity: "Client Testing",   location: "India", resource_level: "S2", experience_years: s2ExpYrs, input_hours: clientTesting,   section: "engineering" },
            { activity: "Deployment",       location: "India", resource_level: "S3", experience_years: s3ExpYrs, input_hours: deploymentHours, section: "engineering" },
          ];

      const project_management = estimationDraft?.project_management?.length
        ? estimationDraft.project_management
        : [
            { activity: "Project Management", location: "India", resource_level: "-", experience_years: 0, input_hours: result.pmHours, section: "project_management" },
          ];

      // ── Cost rows: hours derived from display state (guaranteed to match) ──
      // S3 total = preEng + s3Dev+deployment = preEngTotal + s3DisplayHours (as per display)
      // S2 total = s2Dev+testing = s2DisplayHours (as per display)
      // S1 total = s1Dev = s1DisplayHours (as per display)
      const s3ExportHours = preEngTotal + s3DisplayHours;  // matches result.s3TotalHours in display
      const s2ExportHours = s2DisplayHours;                // matches result.s2TotalHours in display
      const s1ExportHours = s1DisplayHours;                // matches result.s1TotalHours in display

      const buildCostRows = () => {
        const rows = [];
        if (s3ExportHours > 0) {
          rows.push({
            role: s3Roster ? `${s3Roster.name} (${s3Roster.role})` : "Sr. Automation Engg. (S3)",
            count: 1,
            experience_years: s3ExpYrs,
            hours_per_member: s3ExportHours,
            rate_per_day: s3Rate,
            is_pm: false,
            s_level: "S3",
          });
        }
        if (s2ExportHours > 0) {
          rows.push({
            role: s2Roster ? `${s2Roster.name} (${s2Roster.role})` : "Automation Engg. (S2)",
            count: 1,
            experience_years: s2ExpYrs,
            hours_per_member: s2ExportHours,
            rate_per_day: s2Rate,
            is_pm: false,
            s_level: "S2",
          });
        }
        if (s1ExportHours > 0) {
          rows.push({
            role: s1Roster ? `${s1Roster.name} (${s1Roster.role})` : "Jr. Automation Engg. (S1)",
            count: 1,
            experience_years: 2,
            hours_per_member: s1ExportHours,
            rate_per_day: s1Rate,
            is_pm: false,
            s_level: "S1",
          });
        }
        if (!rows.length) {
          rows.push({ role: "Developer (S1)", count: 1, experience_years: 2, hours_per_member: 0, rate_per_day: s1Rate, is_pm: false, s_level: "S1" });
        }
        return rows;
      };

      const payload = {
        project_name: prjName,
        currency: activeCurrency,
        modules,
        pre_engineering,
        engineering,
        project_management,
        cost_rows: buildCostRows(),
        effort_percentages: estimationDraft?.effort_percentages || {
          internal_testing_pct: 0.20,
          client_testing_pct: 0.10,
          deployment_pct: 0.10,
          pm_pct: pmPct / 100,
          risk_pct: 0.10,
          negotiation_pct: 0.05,
        },
        pm_pct: pmPct,
        finance_cost_pct: financePct,
        forex_risk_pct: forexPct,
        risk_pct: riskPct,
        nego_deduction_pct: negoPct,
      };

      await exportAxcendExcel(payload);
    } catch (e) {
      console.error(e);
      alert("Failed to export Excel: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  if (!loaded) {
    return (
      <div className="border border-parcelles-dark bg-parcelles-bg p-8 md:p-12 text-center chamfer-bottom-left">
        <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Axcend Effort Format</p>
        <p className="font-body opacity-60 text-lg">No team data found — approve the team allocation first.</p>
      </div>
    );
  }

  const curr = activeCurrency;

  return (
    <div className="w-full font-sans space-y-6 select-none cursor-default">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="border border-parcelles-dark bg-parcelles-dark p-5 md:p-6 chamfer-bottom-right">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-display uppercase tracking-widest text-[10px] text-parcelles-light/50 mb-1">
              AXCEND EFFORT ESTIMATION FORMAT
            </p>
            <h2 className="font-display font-bold text-xl text-parcelles-light">
              Overall Software Design Efforts
            </h2>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Currency Selector */}
            <div className="flex items-center gap-2 border border-parcelles-light/20 bg-parcelles-light/10 px-3 py-2 text-parcelles-light font-display text-xs uppercase rounded flex-wrap">
              <span className="opacity-60 font-semibold tracking-wider">Currency:</span>
              <select
                value={activeCurrency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                disabled={loadingRates}
                className="bg-transparent border-none outline-none font-bold text-parcelles-light cursor-pointer pr-1 hover:text-white transition-colors"
                style={{ colorScheme: "dark" }}
              >
                <option value="USD" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>USD ($)</option>
                <option value="INR" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>INR (₹)</option>
                <option value="EUR" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>EUR (€)</option>
                <option value="GBP" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>GBP (£)</option>
                <option value="AED" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>AED (د.إ)</option>
                <option value="SGD" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>SGD ($)</option>
                <option value="AUD" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>AUD ($)</option>
                <option value="CAD" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>CAD ($)</option>
                <option value="JPY" className="text-parcelles-dark bg-parcelles-bg" style={{ color: "#0A1C16", backgroundColor: "#F5F3EE" }}>JPY (¥)</option>
              </select>
              {loadingRates && <Loader2 size={12} className="animate-spin opacity-60" />}
            </div>

            {/* Settings button */}
            <button
              onClick={() => setShowSettings((p) => !p)}
              className="px-4 py-2 border border-parcelles-light/20 bg-parcelles-light/10 text-parcelles-light font-display text-xs tracking-wider uppercase hover:bg-parcelles-light/25 transition-colors chamfer-bottom-right flex items-center gap-1.5"
            >
              <Settings size={13} />
              {showSettings ? "Close Rates" : "Edit Rates"}
            </button>
          </div>
        </div>
      </div>

      {/* ── SUMMARY STRIP ──────────────────────────────────────────────────── */}
      <div className="border border-parcelles-dark bg-parcelles-bg grid grid-cols-2 md:grid-cols-4">
        <StatPill label="ManDays"     value={fmtNum(result.manDaysTotal, 0)} unit="Man-Days" />
        <StatPill label="ManMonths"   value={fmtNum(result.manMonths, 0)}    unit="Man-Months" />
        <StatPill label="Man Weeks"   value={fmtNum(result.manWeeks, 0)}     unit="Man-Weeks" />
        <div className="p-4 flex flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/50">
            Eng × Weeks
          </span>
          <span className="font-display font-bold text-lg text-parcelles-dark">
            {fmtNum(result.manWeeks / 3, 0)}
            <span className="font-body font-normal text-xs text-parcelles-dark/50 ml-1.5">
              Weeks / Engineer
            </span>
          </span>
        </div>
      </div>

      {/* ── SETTINGS PANEL ─────────────────────────────────────────────────── */}
      {showSettings && (
        <div className="border border-parcelles-dark bg-parcelles-sage/10 p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <p className="font-display uppercase tracking-widest text-[10px] text-parcelles-dark/60 col-span-full font-bold mb-1">
            Adjust Percentages
          </p>
          {[
            { label: "PM %",          value: tempPmPct,      set: setTempPmPct,       max: 50 },
            { label: "Finance Cost %", value: tempFinancePct, set: setTempFinancePct,  max: 10 },
            { label: "Forex Risk %",   value: tempForexPct,   set: setTempForexPct,    max: 10 },
            { label: "Risk %",         value: tempRiskPct,    set: setTempRiskPct,     max: 100 },
            { label: "Nego Deduct %",  value: tempNegoPct,    set: setTempNegoPct,     max: 50 },
          ].map(({ label, value, set, max }) => (
            <label key={label} className="flex flex-col gap-1.5 select-none">
              <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/60 font-medium">
                {label}
              </span>
              <div className="flex items-center gap-1.5 border-b border-parcelles-dark/20 pb-1 hover:border-parcelles-dark transition-colors select-text cursor-text">
                <input
                  type="number"
                  min="0"
                  max={max}
                  step="0.5"
                  value={value}
                  onChange={(e) => set(parseFloat(e.target.value) || 0)}
                  className="w-16 border-none p-0 font-display font-semibold text-base text-parcelles-dark bg-transparent outline-none text-right select-text cursor-text"
                />
                <span className="font-display text-sm text-parcelles-dark/50 select-none">%</span>
              </div>
            </label>
          ))}
          <div className="col-span-full flex justify-end mt-2">
            <button
              onClick={handleSaveSettings}
              className="px-4 py-2 bg-parcelles-dark text-parcelles-bg font-display text-xs tracking-wider uppercase hover:bg-parcelles-dark/90 active:scale-95 transition-all font-bold rounded"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* ── SECTION A: DEVELOPER EFFORT SUMMARY ───────────────────────────────── */}
      <div className="border border-parcelles-dark overflow-x-auto bg-parcelles-bg">
        <div className="bg-parcelles-dark p-3">
          <h3 className="font-display font-bold text-xs uppercase tracking-wider text-parcelles-light">
            Section A: Developer Effort Summary
          </h3>
        </div>
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-parcelles-dark/5 border-b border-parcelles-dark/20">
              {["Developer", "Total Hours", "Man Days", `Rate (${curr}) / Day`, `Total Dev Cost (${curr})`].map((h, i) => (
                <th
                  key={i}
                  className={`p-2.5 font-display text-[10px] font-bold uppercase tracking-wider text-parcelles-dark/80 border-r border-parcelles-dark/10 last:border-r-0 whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-parcelles-dark/10">
            {/* S3 Developer Row */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Sr. Automation Engg. (S3) <SLevelBadge level="S3" />
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.s3TotalHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {result.s3ManDays}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                <div className="flex flex-col items-end">
                  <span className="font-semibold text-parcelles-dark">{fmtNum(s3Rate, 0)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {getCurrencySymbol(curr)}{Math.round(s3Rate / 8)}/hr × 8h
                  </span>
                </div>
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                <div className="flex flex-col items-end">
                  <span className="font-bold text-parcelles-dark">{fmtCost(result.s3Cost, curr)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {result.s3ManDays}d × {getCurrencySymbol(curr)}{s3Rate}
                  </span>
                </div>
              </td>
            </tr>

            {/* S2 Developer Row */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Automation Engg. (S2) <SLevelBadge level="S2" />
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.s2TotalHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {result.s2ManDays}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                <div className="flex flex-col items-end">
                  <span className="font-semibold text-parcelles-dark">{fmtNum(s2Rate, 0)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {getCurrencySymbol(curr)}{Math.round(s2Rate / 8)}/hr × 8h
                  </span>
                </div>
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                <div className="flex flex-col items-end">
                  <span className="font-bold text-parcelles-dark">{fmtCost(result.s2Cost, curr)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {result.s2ManDays}d × {getCurrencySymbol(curr)}{s2Rate}
                  </span>
                </div>
              </td>
            </tr>

            {/* S1 Developer Row */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Jr. Automation Engg. (S1) <SLevelBadge level="S1" />
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.s1TotalHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {result.s1ManDays}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                <div className="flex flex-col items-end">
                  <span className="font-semibold text-parcelles-dark">{fmtNum(s1Rate, 0)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {getCurrencySymbol(curr)}{Math.round(s1Rate / 8)}/hr × 8h
                  </span>
                </div>
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                <div className="flex flex-col items-end">
                  <span className="font-bold text-parcelles-dark">{fmtCost(result.s1Cost, curr)}</span>
                  <span className="text-[9px] text-parcelles-dark/40 font-mono block mt-0.5 whitespace-nowrap">
                    {result.s1ManDays}d × {getCurrencySymbol(curr)}{s1Rate}
                  </span>
                </div>
              </td>
            </tr>

            {/* TOTAL DEV EFFORTS */}
            <tr className="bg-parcelles-sage/35 border-t border-parcelles-dark font-bold">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left">
                TOTAL EFFORTS (Excl. PM)
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {fmtNum(result.devHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {result.inDays}
              </td>
              <td className="p-2.5 border-r border-parcelles-dark/10 last:border-r-0"></td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-bold">
                {fmtCost(result.devSubtotal, curr)}
              </td>
            </tr>

            {/* Project Management Row */}
            <tr className="bg-parcelles-sage/15">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Project Management <span className="text-[10px] text-parcelles-dark/60 font-body">({pmPct}%)</span>
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {fmtNum(result.pmHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {result.pmManDays}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right text-parcelles-dark/40 font-mono">
                -
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-bold">
                {fmtCost(result.pmCost, curr)}
              </td>
            </tr>

            {/* TOTAL EFFORTS (with PM) */}
            <tr className="bg-parcelles-dark text-parcelles-light font-bold">
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-left">
                GRAND TOTAL (Incl. PM)
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtNum(result.totalAllHours, 0)}
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtNum(result.totalAllDays, 0)}
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right font-normal">
                Total Cost
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtCost(result.totalCost, curr)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── SECTION B: MODULE-WISE COST BREAKDOWN ────────────────────────────── */}
      <div className="border border-parcelles-dark overflow-x-auto bg-parcelles-bg">
        <div className="bg-parcelles-dark p-3">
          <h3 className="font-display font-bold text-xs uppercase tracking-wider text-parcelles-light">
            Section B: Module-wise Cost Breakdown
          </h3>
        </div>
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-parcelles-dark/5 border-b border-parcelles-dark/20">
              {["Module", "Hours", "Days", `Cost (${curr})`].map((h, i) => (
                <th
                  key={i}
                  className={`p-2.5 font-display text-[10px] font-bold uppercase tracking-wider text-parcelles-dark/80 border-r border-parcelles-dark/10 last:border-r-0 whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-parcelles-dark/10">
            {/* Pre-Engineering */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Pre-Engineering
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(preEngHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.preEngDays, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-bold">
                {fmtCost(result.preEngCost, curr)}
              </td>
            </tr>

            {/* Engineering */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Engineering (Development, Testing & Deployment)
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {fmtNum(s1Hours + s2Hours + s3DevHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.engDays, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-bold">
                {fmtCost(result.engCost, curr)}
              </td>
            </tr>

            {/* PM */}
            <tr className="hover:bg-parcelles-sage/5">
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-left font-semibold">
                Project Management ({pmPct}%)
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right">
                {fmtNum(result.pmHours, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-mono">
                {fmtNum(result.pmManDays, 0)}
              </td>
              <td className="p-2.5 font-display text-xs text-parcelles-dark border-r border-parcelles-dark/10 last:border-r-0 text-right font-bold">
                {fmtCost(result.pmCost, curr)}
              </td>
            </tr>

            {/* TOTAL */}
            <tr className="bg-parcelles-dark text-parcelles-light font-bold">
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-left">
                TOTAL
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtNum(result.totalAllHours, 0)}
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtNum(result.totalAllDays, 0)}
              </td>
              <td className="p-3 font-display text-xs text-parcelles-light border-r border-parcelles-light/10 last:border-r-0 text-right">
                {fmtCost(result.totalCost, curr)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── SECTION C: FINANCE ROLL-UP ───────────────────────────────────────── */}
      <div className="border border-parcelles-dark bg-parcelles-bg grid grid-cols-1 md:grid-cols-2 gap-0">
        {/* Left: total hours display */}
        <div className="p-5 md:p-6 border-b md:border-b-0 md:border-r border-parcelles-dark/15 flex flex-col justify-center gap-4">
          <div>
            <p className="font-display uppercase tracking-widest text-[10px] text-parcelles-dark/50 mb-1">
              Total Computed Hours
            </p>
            <p className="font-display font-extrabold text-3xl md:text-4xl text-parcelles-dark tracking-tight">
              {fmtNum(result.totalAllHours, 0)}
            </p>
          </div>
          <div className="flex gap-6 flex-wrap">
            {[
              { l: "ManDays",   v: fmtNum(result.manDaysTotal, 0) },
              { l: "ManMonths", v: fmtNum(result.manMonths, 0) },
              { l: "ManWeeks",  v: fmtNum(result.manWeeks, 0) },
            ].map(({ l, v }) => (
              <div key={l} className="flex flex-col gap-0.5">
                <span className="font-display font-bold text-base text-parcelles-dark">{v}</span>
                <span className="font-display uppercase tracking-widest text-[9px] text-parcelles-dark/40 font-medium">{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: finance roll-up */}
        <div className="p-5 md:p-6 flex flex-col gap-3">
          <p className="font-display uppercase tracking-widest text-[10px] text-parcelles-dark/50 font-bold mb-1">
            Section C: Finance Roll-Up
          </p>
          <table className="w-full border-collapse">
            <tbody className="divide-y divide-parcelles-dark/10">
              {[
                { label: "Credit Period",                   value: null,                         bold: false },
                { label: `Finance Cost (${financePct}%)`,  value: result.financeCost,            bold: false },
                { label: `Forex Risk Cost (${forexPct}%)`, value: result.forexCost,              bold: false },
                { label: `Risk (${riskPct}%)`,             value: result.riskAmount,             bold: false },
                { label: "SubTotal",                        value: result.subTotal,               bold: true  },
                { label: `Nego Deduction (${negoPct}%)`,   value: result.negoAmount > 0 ? -result.negoAmount : null, bold: false },
              ].map(({ label, value, bold }, i) => (
                <tr key={i}>
                  <td className={`py-1.5 font-display text-xs text-parcelles-dark/85 ${bold ? "font-bold" : "font-normal"}`}>
                    {label}
                  </td>
                  <td className={`py-1.5 pl-4 text-right font-display text-xs ${bold ? "font-bold" : "font-normal"} ${value != null && value < 0 ? "text-red-700 font-semibold" : "text-parcelles-dark/85"}`}>
                    {value != null ? fmtCost(Math.abs(value), curr) : "—"}
                  </td>
                </tr>
              ))}

              {/* Final Quote — dark forest styling */}
              <tr className="bg-parcelles-dark">
                <td className="px-3 py-2.5 font-display font-bold text-xs text-parcelles-sage uppercase tracking-wider">
                  Final Quote
                </td>
                <td className="px-3 py-2.5 text-right font-display font-bold text-base text-parcelles-sage">
                  {fmtCost(result.finalQuote, curr)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Rate / hr callout */}
          <div className="mt-3 flex flex-col items-end gap-1 text-right select-none">
            <div className="flex items-center gap-2">
              <span className="font-display uppercase tracking-widest text-[9px] text-parcelles-dark/50 font-medium">
                Effective Rate/hr:
              </span>
              <span className="font-display font-bold text-xs text-parcelles-dark bg-parcelles-dark/5 px-2.5 py-1">
                {curr} {fmtNum(result.ratePerHr, 0)} / hr
              </span>
            </div>
            <span className="text-[9px] text-parcelles-dark/45 font-mono">
              ({fmtCost(result.finalQuote, curr)} Final Quote / {fmtNum(result.totalAllHours, 0)} Total Hours)
            </span>
          </div>
        </div>
      </div>

      {/* ── ACTION FOOTER / EXPORT ───────────────────────────────────────────── */}
      <div className="flex justify-end mt-4 pb-2">
        <button
          onClick={handleExportAxcend}
          disabled={exporting}
          className="px-5 py-2.5 border border-parcelles-dark bg-parcelles-dark text-parcelles-light font-display text-xs tracking-wider uppercase hover:bg-parcelles-dark/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors chamfer-bottom-left flex items-center gap-1.5"
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Export Excel
        </button>
      </div>
    </div>
  );
}
