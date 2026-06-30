"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Users,
  Coins,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { PageIntro } from "@/components/workflow/PageIntro";
import { AxcendCostEstimation } from "@/components/workflow/AxcendCostEstimation";
import { useWorkflow } from "@/context/WorkflowContext";
import {
  createCostDraftFromTeamData,
  loadCostDraft,
  saveCostDraft,
} from "@/lib/costEstimationStorage";
import { downloadDeliverableBundle } from "@/lib/deliverableBundle";
import { calculateCostTotals } from "@/lib/costTotals";
import { analyzeCostDocument, saveCostDraftApi } from "@/lib/platformApi";
import { loadApprovedTeam, saveApprovedTeam } from "@/lib/workflowArtifacts";
import { fetchExchangeRates, convertDraftCurrency } from "@/lib/currencyConverter";
import { CostSkeleton } from "@/components/ui/Skeletons";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

const CURRENCIES = {
  AUD: "Australian Dollar",
  BRL: "Brazilian Real",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Renminbi Yuan",
  CZK: "Czech Koruna",
  DKK: "Danish Krone",
  EUR: "Euro",
  GBP: "British Pound",
  HKD: "Hong Kong Dollar",
  HUF: "Hungarian Forint",
  IDR: "Indonesian Rupiah",
  ILS: "Israeli New Shekel",
  INR: "Indian Rupee",
  ISK: "Icelandic Króna",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  MXN: "Mexican Peso",
  MYR: "Malaysian Ringgit",
  NOK: "Norwegian Krone",
  NZD: "New Zealand Dollar",
  PHP: "Philippine Peso",
  PLN: "Polish Złoty",
  RON: "Romanian Leu",
  SEK: "Swedish Krona",
  SGD: "Singapore Dollar",
  THB: "Thai Baht",
  TRY: "Turkish Lira",
  USD: "United States Dollar",
  ZAR: "South African Rand",
};

const createId = () => Math.random().toString(36).slice(2, 10);

const calculateSrsHours = (srsData) => {
  if (!srsData?.structuredRequirements?.delivery_plan?.feature_estimates?.length) return 160;
  let totalHours = 0;
  srsData.structuredRequirements.delivery_plan.feature_estimates.forEach(est => {
    (est.developer_days || []).forEach(d => totalHours += (d.days * 8));
    (est.tester_days || []).forEach(t => totalHours += (t.days * 8));
  });
  return totalHours > 0 ? totalHours : 160;
};

const createEmptyMember = () => ({
  id: createId(),
  role: "",
  count: "1",
  hourly_rate: "",
  weekly_hours: "40",
  hours_per_member: "160",
  notes: "",
});

export function CostEstimationExperience() {
  const router = useRouter();
  const { srsData } = useWorkflow();
  const [draft, setDraft] = useState(null);
  const [docMessage, setDocMessage] = useState("");
  const [error, setError] = useState("");
  const [isAnalyzingDocument, setIsAnalyzingDocument] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [currencyConversionStatus, setCurrencyConversionStatus] = useState(""); // "", "loading", "done", "error"

  const [isPricingExpanded, setIsPricingExpanded] = useState(false);
  const [isPmExpanded, setIsPmExpanded] = useState(false);
  const [isRiskExpanded, setIsRiskExpanded] = useState(false);
  const [isPreviewBreakdownExpanded, setIsPreviewBreakdownExpanded] = useState(false);
  const [pricingFormat, setPricingFormat] = useState("axcend"); // "axcend" | "scopesense"

  useEffect(() => {
    const savedDraft = loadCostDraft();
    if (savedDraft?.members?.length) {
      setDraft({
        ...savedDraft,
        members: savedDraft.members.map((member) => ({
          ...member,
          weekly_hours: member.weekly_hours || "40",
        })),
        project_management_cost: savedDraft.project_management_cost ?? "",
        project_management_percent: savedDraft.project_management_percent ?? "10",
        risk_contingency_percent: savedDraft.risk_contingency_percent ?? "10",
        miscellaneous_costs: [],
      });
      return;
    }

    const approvedTeam = loadApprovedTeam();
    if (approvedTeam?.members?.length) {
      const defaultHours = calculateSrsHours(srsData);
      setDraft(createCostDraftFromTeamData(approvedTeam, defaultHours));
    }
  }, [srsData]);

  useEffect(() => {
    if (draft?.members?.length) {
      saveCostDraft(draft);
      saveCostDraftApi(draft).catch(err => {
        console.warn("Failed to persist cost draft to DB:", err);
      });
    }
  }, [draft]);

  const totals = useMemo(() => {
    return calculateCostTotals({
      members: draft?.members || [],
      miscellaneousCosts: draft?.miscellaneous_costs || [],
      projectManagementCost: draft?.project_management_cost || "",
      projectManagementPercent: draft?.project_management_percent || "",
      riskContingencyPercent: draft?.risk_contingency_percent || "",
    });
  }, [draft]);

  const memberBreakdown = useMemo(() => {
    return totals.memberBreakdown || [];
  }, [totals]);

  const validationErrors = useMemo(() => {
    if (!draft?.members?.length) return [];
    const missing = [];

    if (!draft.project_name?.trim()) missing.push("Project name is required.");
    if (!draft.currency?.trim()) missing.push("Currency is required.");

    return missing;
  }, [draft]);

  const updateDraft = (updater) => {
    setDraft((current) => (typeof updater === "function" ? updater(current) : updater));
  };

  const updateMember = (id, field, value) => {
    updateDraft((current) => ({
      ...current,
      members: current.members.map((member) => (member.id === id ? { ...member, [field]: value } : member)),
    }));
  };

  const handleCurrencyChange = useCallback(async (newCurrency) => {
    if (!draft || draft.currency === newCurrency) return;
    const oldCurrency = draft.currency;

    // Optimistically update currency label immediately
    updateDraft((current) => ({ ...current, currency: newCurrency }));
    setCurrencyConversionStatus("loading");

    try {
      const rates = await fetchExchangeRates(oldCurrency);
      if (!rates) throw new Error("Could not fetch live exchange rates");

      setDraft((current) => convertDraftCurrency(current, oldCurrency, newCurrency, rates));
      setCurrencyConversionStatus("done");
      setTimeout(() => setCurrencyConversionStatus(""), 3000);
    } catch (err) {
      console.warn("[Currency conversion failed]", err.message);
      setCurrencyConversionStatus("error");
      setTimeout(() => setCurrencyConversionStatus(""), 4000);
    }
  }, [draft]);

  const handleCurrencyChangeNoConversion = useCallback((newCurrency) => {
    updateDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        currency: newCurrency,
      };
    });
  }, []);

  const handleDocumentUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAnalyzingDocument(true);
    setError("");
    setDocMessage("");

    try {
      const result = await analyzeCostDocument(file);
      if (!result.has_team_allocation) {
        setDocMessage(
          result.message ||
          "This document does not contain an explicit team allocation. Please complete Team Allocation first.",
        );
        return;
      }

      const nextDraft = createCostDraftFromTeamData(result);
      setDraft(nextDraft);
      saveCostDraft(nextDraft);
      saveApprovedTeam({
        project_name: result.project_name,
        members: result.members,
        total_size: result.total_size,
        logic_summary: result.logic_summary,
        total_project_hours: result.total_project_hours,
        total_working_weeks: result.total_working_weeks,
        weekly_hours_per_member: result.weekly_hours_per_member,
      });
      setDocMessage("Team allocation loaded. Fill in the pricing inputs and export the final bundle.");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to analyze the uploaded document.");
    } finally {
      setIsAnalyzingDocument(false);
      event.target.value = "";
    }
  };

  const buildPayload = () => {
    const misc = [];
    if (totals.riskContingency > 0) {
      misc.push({ label: `Risk Contingency (${totals.riskRate}%)`, amount: totals.riskContingency });
    }
    if (totals.negotiationBuffer > 0) {
      misc.push({ label: `Negotiation Buffer (${totals.negotiationRate}%)`, amount: totals.negotiationBuffer });
    }
    return {
      project_name: draft.project_name.trim(),
      currency: draft.currency.trim(),
      members: draft.members.map((member) => ({
        role: member.role.trim(),
        count: Number(member.count) || 0,
        hourly_rate: Number(member.hourly_rate) || 0,
        weekly_hours: Math.max(Number(member.weekly_hours) || 0, 1),
        hours_per_member: Number(member.hours_per_member) || 0,
        notes: member.notes || "",
      })),
      project_management_cost: totals.projectManagement,
      profit_slabs: [],
      miscellaneous_costs: misc,
    };
  };

  const handleExport = async () => {
    if (!draft) return;
    if (validationErrors.length) {
      setError(validationErrors[0]);
      return;
    }

    setIsExporting(true);
    setError("");

    try {
      await downloadDeliverableBundle({
        srsData,
        costPayload: buildPayload(),
      });
    } catch (exportError) {
      setError(exportError.message || "Unable to export the cost estimation workbook.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", paddingBottom: "3rem" }}>

      {/* ── HEADER ── */}
      <section style={{ paddingTop: "clamp(2rem, 5vw, 4rem)", paddingBottom: "2rem", paddingLeft: "clamp(1.5rem, 5vw, 5rem)", paddingRight: "clamp(1.5rem, 5vw, 5rem)", borderBottom: "1px solid rgba(10,28,22,0.12)" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <PageIntro
            eyebrow="Phase 03 — Cost Estimation"
            title="Price the full project with a"
            titleItalic="strategic lens."
          />
        </div>
      </section>



      <div style={{ paddingTop: "1.5rem", paddingLeft: "clamp(1.5rem, 5vw, 5rem)", paddingRight: "clamp(1.5rem, 5vw, 5rem)" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%", position: "relative", zIndex: 10 }}>

        {error ? (
          <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", color: "#991b1b", padding: "1rem 1.5rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem", marginBottom: "2rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <AlertCircle size={20} />
            {error}
          </div>
        ) : null}

        {docMessage ? (
          <div className="w-full bg-parcelles-sage/50 border border-parcelles-dark text-parcelles-dark p-6 font-body text-lg mb-8 chamfer-bottom-right flex items-center gap-3">
            <AlertCircle size={24} />
            {docMessage}
          </div>
        ) : null}

        {!draft?.members?.length ? (
          <ScrollReveal variant="slide-up" delay={0}>
          <section style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "3rem" }}>
            <div className="border border-parcelles-dark bg-parcelles-bg p-8 md:p-12 text-center chamfer-bottom-left">
              <div className="flex flex-col items-center gap-6">
                <div className="w-20 h-20 border border-parcelles-dark flex items-center justify-center chamfer-bottom-right bg-parcelles-sage/20">
                  <Upload size={32} strokeWidth={1} />
                </div>
                <div>
                  <p className="font-display uppercase tracking-widest text-xs opacity-60">Import Source</p>
                  <h2 className="text-3xl font-display mt-2">Staffing Blueprint</h2>
                </div>
              </div>
              
              <label className="mt-12 flex min-h-[300px] cursor-pointer hover:bg-parcelles-dark/5 transition-colors flex-col items-center justify-center border border-dashed border-parcelles-dark px-8 text-center group">
                <input
                  type="file"
                  accept=".docx,.xlsx,.xls,.pdf,.txt"
                  className="hidden"
                  onChange={handleDocumentUpload}
                  disabled={isAnalyzingDocument}
                />
                <div className="w-24 h-24 border border-parcelles-dark flex items-center justify-center mb-8 chamfer-bottom-left group-hover:bg-parcelles-dark group-hover:text-parcelles-bg transition-colors duration-500">
                  {isAnalyzingDocument ? <Loader2 size={40} className="animate-spin" /> : <Upload size={40} strokeWidth={1} />}
                </div>
                <h2 className="text-2xl font-display mt-4">
                  {isAnalyzingDocument ? "Scanning staffing details..." : "Deposit extraction source"}
                </h2>
                <p className="font-body opacity-80 mt-4 max-w-xl">
                  The document must already contain staffing information. If it does not, open Team Allocation first and approve
                  the resource mix there.
                </p>
              </label>
            </div>

            <div className="border border-parcelles-dark bg-parcelles-sage/20 p-8 md:p-12 flex flex-col items-start gap-6 chamfer-bottom-right h-fit">
              <div className="flex items-center gap-5 border-b border-parcelles-dark pb-6 w-full">
                <div className="w-14 h-14 border border-parcelles-dark flex items-center justify-center chamfer-bottom-left">
                  <Users size={24} strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-display uppercase tracking-widest text-xs opacity-60">Need Staffing First?</p>
                  <h2 className="text-2xl font-display mt-2">Open team allocation</h2>
                </div>
              </div>
              
              <div className="space-y-6 mt-4 font-body opacity-80 leading-relaxed text-lg">
                <p>Costing needs approved roles, headcount, and staffing assumptions before pricing can be added.</p>
                <p>When the team is approved, this page seeds salary, management, and miscellaneous costs from that same structure.</p>
              </div>

              <button onClick={() => router.push("/team-design")} className="w-full mt-12 py-5 bg-parcelles-dark text-parcelles-bg font-display text-xl flex items-center justify-center hover:opacity-90 transition-opacity chamfer-bottom-left">
                Open Team Allocation
              </button>
            </div>
          </section>
          </ScrollReveal>
        ) : (
          <ScrollReveal variant="slide-up" delay={0}>
            <div style={{ marginBottom: "2rem" }}>
              <AxcendCostEstimation currency={draft.currency || "USD"} onCurrencyChange={handleCurrencyChangeNoConversion} />
            </div>
          </ScrollReveal>
        )}
      </div>
      </div>
    </div>
  );
}
