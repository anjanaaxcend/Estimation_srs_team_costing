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
        project_management_percent: savedDraft.project_management_percent ?? "15",
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
            copy="Reuse existing team architecture or import source documents. The final export dynamically bundles all approved deliverables into a professional projection."
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
          <section style={{ display: "grid", gap: "2rem", gridTemplateColumns: "1.3fr 0.7fr" }}>
            <div className="space-y-6">
              
              {/* General Project Info */}
              <div 
                className="border border-parcelles-dark bg-parcelles-bg p-5 md:p-6 chamfer-bottom-left"
                style={{
                  paddingBottom: isCurrencyDropdownOpen ? "290px" : ""
                }}
              >
                <div className="grid gap-8 md:grid-cols-2">
                  <div>
                    <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Project Name</p>
                    <input
                      value={draft.project_name}
                      onChange={(event) => updateDraft((current) => ({ ...current, project_name: event.target.value }))}
                      placeholder="Project name"
                      className="w-full text-2xl font-display bg-transparent border-b border-parcelles-dark outline-none py-2"
                    />
                  </div>
                  <div className="relative">
                    <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Currency</p>
                    <button
                      type="button"
                      onClick={() => setIsCurrencyDropdownOpen(!isCurrencyDropdownOpen)}
                      className="w-full flex items-center justify-between gap-3 text-left font-display bg-parcelles-bg border border-parcelles-dark px-4 py-3 outline-none hover:bg-parcelles-sage/20 transition-colors chamfer-bottom-right"
                    >
                      <span className={`min-w-0 truncate text-base ${draft.currency ? "text-parcelles-dark" : "text-parcelles-dark/40"}`}>
                        {draft.currency ? `${draft.currency} - ${CURRENCIES[draft.currency]}` : "Select Currency"}
                      </span>
                      <ChevronDown size={18} className={`shrink-0 transition-transform ${isCurrencyDropdownOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isCurrencyDropdownOpen && (
                      <div className="absolute left-0 top-full mt-2 z-50 max-h-[280px] w-full overflow-y-auto border border-parcelles-dark bg-parcelles-bg shadow-xl chamfer-bottom-left">
                        {Object.entries(CURRENCIES).map(([code, name]) => (
                          <button
                            key={code}
                            onClick={() => {
                              handleCurrencyChange(code);
                              setIsCurrencyDropdownOpen(false);
                            }}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-parcelles-sage/30 ${
                              draft.currency === code 
                                ? "bg-parcelles-dark text-parcelles-bg" 
                                : "text-parcelles-dark font-display"
                            }`}
                          >
                            <span className="font-display text-sm">{code}</span>
                            <span className="font-body text-xs opacity-70 truncate">{name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {currencyConversionStatus === "loading" && (
                      <p className="mt-2 text-xs font-display tracking-widest text-parcelles-dark/60 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin inline-block" /> Fetching live rates &amp; converting values…
                      </p>
                    )}
                    {currencyConversionStatus === "done" && (
                      <p className="mt-2 text-xs font-display tracking-widest text-green-700">
                        ✓ All values converted using live market rates
                      </p>
                    )}
                    {currencyConversionStatus === "error" && (
                      <p className="mt-2 text-xs font-display tracking-widest text-red-600">
                        ⚠ Could not fetch live rates — currency label updated, values unchanged
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Role Pricing */}
              <div className="border border-parcelles-dark bg-parcelles-bg p-5 md:p-6 chamfer-bottom-right">
                <div 
                  onClick={() => setIsPricingExpanded(!isPricingExpanded)}
                  style={{ cursor: "pointer" }}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-parcelles-dark pb-4 mb-4"
                >
                  <div>
                    <p className="font-display uppercase tracking-widest text-xs opacity-60">Team Cost Inputs</p>
                    <h2 className="text-xl font-display mt-1">Role by role pricing</h2>
                  </div>
                  <div className="flex items-center gap-4">
                    {!draft.isFromApprovedTeam && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          updateDraft((current) => ({ ...current, members: [...current.members, createEmptyMember()] }));
                        }}
                        className="px-6 py-3 border border-parcelles-dark font-display hover:bg-parcelles-dark hover:text-parcelles-bg transition-colors flex items-center gap-2 chamfer-bottom-left"
                      >
                        <Plus size={18} />
                        Add Role
                      </button>
                    )}
                    {isPricingExpanded ? <ChevronUp size={24} className="text-parcelles-dark" /> : <ChevronDown size={24} className="text-parcelles-dark" />}
                  </div>
                </div>

                {isPricingExpanded && (
                  <div>
                    {isAnalyzingDocument ? (
                      <CostSkeleton />
                    ) : (
                      <div className="space-y-8">
                        <AnimatePresence>
                        {draft.members.filter(m => !m.role.includes("Contingency") && !m.role.includes("Buffer")).map((member, index) => (
                          <motion.div 
                            layout
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
                            transition={{ duration: 0.3, delay: index * 0.05 }}
                            key={member.id} 
                            className="border border-parcelles-dark bg-parcelles-sage/10 p-6 md:p-8 chamfer-bottom-left"
                          >
                            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
                              <div className="lg:col-span-2">
                                <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Role</p>
                                <input
                                  value={member.role}
                                  onChange={(event) => updateMember(member.id, "role", event.target.value)}
                                  placeholder="Role"
                                  className="w-full text-xl font-display bg-transparent border-b border-parcelles-dark/30 focus:border-parcelles-dark outline-none py-1 disabled:opacity-50"
                                  disabled={draft.isFromApprovedTeam}
                                />
                              </div>
                              <div>
                                <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Count</p>
                                <input
                                  type="number"
                                  min="0"
                                  value={member.count}
                                  onChange={(event) => updateMember(member.id, "count", event.target.value)}
                                  placeholder="Qty"
                                  className="w-full text-xl font-display bg-transparent border-b border-parcelles-dark/30 focus:border-parcelles-dark outline-none py-1 disabled:opacity-50"
                                  disabled={draft.isFromApprovedTeam}
                                />
                              </div>
                              <div>
                                <p className="font-display uppercase tracking-widest text-xs font-bold mb-2">Hourly Rate</p>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={member.hourly_rate}
                                  onChange={(event) => updateMember(member.id, "hourly_rate", event.target.value)}
                                  placeholder="Rate"
                                  className="w-full text-xl font-display bg-parcelles-bg border border-parcelles-dark outline-none p-2 chamfer-bottom-right"
                                />
                              </div>
                              <div>
                                <p className="font-display uppercase tracking-widest text-xs opacity-60 mb-2">Total Hrs/Mbr</p>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={member.hours_per_member}
                                  onChange={(event) => updateMember(member.id, "hours_per_member", event.target.value)}
                                  placeholder="Hours"
                                  className="w-full text-xl font-display bg-transparent border-b border-parcelles-dark/30 focus:border-parcelles-dark outline-none py-1"
                                />
                              </div>
                            </div>

                            <div className="mt-8 flex gap-4">
                              <textarea
                                value={member.notes}
                                onChange={(event) => updateMember(member.id, "notes", event.target.value)}
                                rows={2}
                                placeholder="Optional role notes..."
                                className="flex-1 w-full p-3 border border-parcelles-dark bg-transparent outline-none font-body resize-none"
                              />
                              {!draft.isFromApprovedTeam && (
                                <button
                                  onClick={() =>
                                    updateDraft((current) => ({
                                      ...current,
                                      members: current.members.filter((item) => item.id !== member.id),
                                    }))
                                  }
                                  className="w-12 h-12 flex shrink-0 items-center justify-center border border-transparent hover:border-red-500 hover:text-red-500 transition-colors chamfer-bottom-right"
                                >
                                  <Trash2 size={20} />
                                </button>
                              )}
                            </div>
                          </motion.div>
                        ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* PM Cost */}
                <div className="border border-parcelles-dark bg-parcelles-bg p-5 chamfer-bottom-left">
                  <div
                    onClick={() => setIsPmExpanded(!isPmExpanded)}
                    style={{ cursor: "pointer" }}
                    className="flex justify-between items-center border-b border-parcelles-dark pb-3 mb-3"
                  >
                    <div>
                      <p className="font-display uppercase tracking-widest text-xs opacity-60">Project Management</p>
                      <h2 className="text-lg font-display mt-0.5">Management percentage</h2>
                    </div>
                    {isPmExpanded ? <ChevronUp size={18} className="text-parcelles-dark" /> : <ChevronDown size={18} className="text-parcelles-dark" />}
                  </div>
                  {isPmExpanded && (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex items-center gap-3 border-b border-parcelles-dark">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={draft.project_management_percent ?? ""}
                          onChange={(event) => updateDraft((current) => ({ ...current, project_management_percent: event.target.value, project_management_cost: "" }))}
                          placeholder="15"
                          className="w-full text-xl font-display bg-transparent outline-none py-2"
                        />
                        <span className="font-display text-xl">%</span>
                      </div>
                      <p className="font-body opacity-80 text-sm leading-relaxed">
                        Leave this blank to use <span className="font-bold">15%</span> of the staffing subtotal. Enter a percentage, not a currency value.
                      </p>
                    </div>
                  )}
                </div>

                {/* Risk Contingency */}
                <div className="border border-parcelles-dark bg-parcelles-bg p-5 chamfer-bottom-right">
                  <div
                    onClick={() => setIsRiskExpanded(!isRiskExpanded)}
                    style={{ cursor: "pointer" }}
                    className="flex justify-between items-center border-b border-parcelles-dark pb-3 mb-3"
                  >
                    <div>
                      <p className="font-display uppercase tracking-widest text-xs opacity-60">Risk Contingency</p>
                      <h2 className="text-lg font-display mt-0.5">Reserve percentage</h2>
                    </div>
                    {isRiskExpanded ? <ChevronUp size={18} className="text-parcelles-dark" /> : <ChevronDown size={18} className="text-parcelles-dark" />}
                  </div>
                  {isRiskExpanded && (
                    <div className="mt-3 flex flex-col gap-3">
                      <div className="flex items-center gap-3 border-b border-parcelles-dark">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={draft.risk_contingency_percent ?? ""}
                          onChange={(event) => updateDraft((current) => ({ ...current, risk_contingency_percent: event.target.value }))}
                          placeholder="10"
                          className="w-full text-xl font-display bg-transparent outline-none py-2"
                        />
                        <span className="font-display text-xl">%</span>
                      </div>
                      <p className="font-body opacity-80 text-sm leading-relaxed">
                        Applies a contingency reserve to staffing and project management totals. Leave blank to use <span className="font-bold">10%</span>.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Aside: Preview & Export */}
            <aside className="h-fit sticky top-4">
              <div className="border border-parcelles-dark bg-parcelles-sage/20 p-5 md:p-6 chamfer-bottom-left">
                <div className="flex items-center gap-4 border-b border-parcelles-dark pb-4 mb-4">
                  <div className="w-10 h-10 border border-parcelles-dark flex items-center justify-center chamfer-bottom-right bg-parcelles-bg shrink-0">
                    <Coins size={18} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="font-display uppercase tracking-widest text-xs opacity-60">Live Estimate</p>
                    <h2 className="text-xl font-display mt-0.5">Cost Preview</h2>
                  </div>
                </div>

                <div 
                  onClick={() => setIsPreviewBreakdownExpanded(!isPreviewBreakdownExpanded)}
                  style={{ cursor: "pointer" }}
                  className="flex items-center justify-between border-b border-parcelles-dark/20 pb-4 mb-4"
                >
                  <span className="font-display text-sm uppercase tracking-wider text-parcelles-dark/70 font-semibold">Role Breakdown</span>
                  {isPreviewBreakdownExpanded ? <ChevronUp size={16} className="text-parcelles-dark" /> : <ChevronDown size={16} className="text-parcelles-dark" />}
                </div>
                {isPreviewBreakdownExpanded && (
                  <div className="space-y-6">
                    {memberBreakdown.filter(m => !m.role.includes("Contingency") && !m.role.includes("Buffer")).map((member, index) => {
                      const rolePercent = totals.grandTotal > 0 ? (member.total / totals.grandTotal) * 100 : 0;
                      return (
                        <div key={member.id} className="border border-parcelles-dark/30 bg-parcelles-bg p-6 chamfer-bottom-right">
                          <div className="flex items-center justify-between gap-3 mb-6">
                            <span className="font-display text-xl">{member.role || "Untitled role"}</span>
                            <span className="font-display bg-parcelles-dark text-parcelles-bg px-3 py-1 text-sm">x{member.count}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-y-4 gap-x-4 font-body text-sm opacity-80 mb-6">
                            <div className="flex flex-col border-r border-parcelles-dark/20">
                              <span className="font-display uppercase tracking-widest text-[10px]">Per employee</span>
                              <span className="font-display text-lg mt-1 text-parcelles-dark">
                                {draft.currency || "--"} {member.costPerEmployee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex flex-col text-right">
                              <span className="font-display uppercase tracking-widest text-[10px]">Role Total</span>
                              <span className="font-display text-lg mt-1 text-parcelles-dark font-bold">
                                {draft.currency || "--"} {member.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                          
                          <div className="space-y-2 pt-4 border-t border-parcelles-dark/20">
                            <div className="flex justify-between font-display text-sm">
                              <span>{draft.currency || "--"} {member.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              <span className="font-bold">{rolePercent.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-parcelles-dark/10">
                              <div className="h-full bg-parcelles-dark transition-all" style={{ width: `${rolePercent}%` }}></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-4 border border-parcelles-dark bg-parcelles-bg p-5 chamfer-bottom-left">
                  {[ 
                    ["Development", totals.developmentTotal],
                    ["Testing", totals.testingTotal],
                    ["Deployment", totals.deploymentTotal],
                    ["Team Salary", totals.salaryTotal],
                    [`Project Mgmt (${totals.projectManagementRate}%)`, totals.projectManagement],
                    [`Risk Contingency (${totals.riskRate}%)`, totals.riskContingency],
                    [`Negotiation Buffer (${totals.negotiationRate}%)`, totals.negotiationBuffer],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2 font-display border-b border-parcelles-dark/20 last:border-0 text-sm">
                      <span className="opacity-80">{label}</span>
                      <span>
                        {draft.currency || "--"} {value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  
                  <div className="mt-4 border-t-2 border-parcelles-dark pt-4">
                    <div className="flex flex-col">
                      <span className="font-display uppercase tracking-widest text-xs opacity-60 mb-1">Grand Total Estimation</span>
                      <span className="font-display text-3xl font-bold tracking-tight">
                        {draft.currency || "--"} {totals.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <button onClick={handleExport} disabled={isExporting} className="w-full py-4 bg-parcelles-dark text-parcelles-bg font-display text-base flex items-center justify-center gap-3 hover:opacity-90 transition-opacity chamfer-bottom-right">
                    {isExporting ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
                    {isExporting ? "Exporting..." : "Download Deliverables"}
                  </button>
                </div>

                {validationErrors.length ? (
                  <div className="mt-8 border border-parcelles-dark bg-parcelles-bg p-4 font-display text-sm text-red-600 chamfer-bottom-right">
                    {validationErrors[0]}
                  </div>
                ) : null}
              </div>
            </aside>
          </section>
          </ScrollReveal>
        )}
      </div>
      </div>
    </div>
  );
}
