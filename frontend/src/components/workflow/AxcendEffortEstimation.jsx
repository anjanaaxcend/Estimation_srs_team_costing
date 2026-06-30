"use client";

/**
 * AxcendEffortEstimation — displayed after SRS approval + Team Allocation.
 * Shows three collapsible panels:
 *   1. Pre-Engineering
 *   2. Engineering (Development)
 *   3. Project Management
 *
 * All percentages are fetched from the backend (which reads them from the
 * team-analysis result). Nothing is hard-coded in the UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Loader2,
  Settings2,
  Users2,
} from "lucide-react";
import { buildAxcendEstimation, saveAxcendDraftApi } from "@/lib/platformApi";
import { saveAxcendEstimationDraft } from "@/lib/axcendEstimationStorage";

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n) => (typeof n === "number" ? Math.round(n).toString() : "—");
const pct = (n) => (typeof n === "number" ? `${Math.round(n * 100)}%` : "—");

const SECTION_META = {
  pre_engineering: {
    label: "Pre-Engineering",
    icon: Settings2,
    color: "#8FA88C",
  },
  engineering: {
    label: "Engineering",
    icon: Code2,
    color: "#0A1C16",
  },
  project_management: {
    label: "Project Management",
    icon: Users2,
    color: "#8EC4A0",
  },
};

// ─── ActivityRow ──────────────────────────────────────────────────────────────

function ActivityRow({ row, accentColor, onHoursChange }) {
  const [editing, setEditing] = useState(false);
  const [localHours, setLocalHours] = useState(String(row.input_hours));
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  const commit = () => {
    const parsed = parseFloat(localHours);
    if (!isNaN(parsed) && parsed >= 0) onHoursChange(parsed);
    else setLocalHours(String(row.input_hours));
    setEditing(false);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 border-b border-parcelles-dark/10 last:border-b-0">
      <span className="font-body text-xs text-parcelles-dark font-medium leading-relaxed">
        {row.activity}
      </span>

      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <span className="font-display text-[9px] px-2 py-0.5 bg-parcelles-dark/5 text-parcelles-dark/65 font-bold uppercase tracking-wider">
          {row.resource_level} · {row.experience_years}y · {row.location}
        </span>

        {editing ? (
          <input
            ref={inputRef}
            type="number"
            min="0"
            step="0.5"
            value={localHours}
            onChange={(e) => setLocalHours(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setLocalHours(String(row.input_hours)); setEditing(false); }
            }}
            className="w-16 border border-parcelles-dark px-1.5 py-0.5 font-display text-xs text-right outline-none bg-parcelles-bg text-parcelles-dark"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="Click to edit hours"
            style={{ color: accentColor }}
            className="w-16 border border-parcelles-dark/25 hover:border-parcelles-dark hover:bg-parcelles-sage/10 px-2 py-0.5 font-display text-xs text-right bg-transparent transition-all font-bold"
          >
            {fmt(row.input_hours)}
          </button>
        )}
      </div>

      <span className="font-display text-[10px] text-parcelles-dark/45 uppercase tracking-wider text-right whitespace-nowrap hidden sm:inline">
        hrs / {fmt(row.input_hours / 8)} d
      </span>
    </div>
  );
}

// ─── SectionPanel ─────────────────────────────────────────────────────────────

function SectionPanel({ sectionKey, rows, onRowHoursChange, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  const total = rows.reduce((s, r) => s + (r.input_hours || 0), 0);

  return (
    <div className="border border-parcelles-dark bg-parcelles-bg/40 chamfer-bottom-right mb-5 overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between p-4 bg-parcelles-sage/5 hover:bg-parcelles-sage/15 border-b border-parcelles-dark/20 text-left transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-parcelles-dark text-parcelles-bg flex items-center justify-center chamfer-bottom-left">
            <Icon size={16} strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-display font-bold text-sm text-parcelles-dark uppercase tracking-wider">
              {meta.label}
            </p>
            <p className="font-body text-xs text-parcelles-dark/60">
              {rows.length} {rows.length === 1 ? "activity" : "activities"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p style={{ color: meta.color }} className="font-display font-bold text-base">
              {fmt(total)} h / {fmt(total / 8)} d
            </p>
            <p className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/45 font-medium">
              total effort
            </p>
          </div>
          {open ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
        </div>
      </button>

      {open && (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2 border-b border-parcelles-dark/15 bg-parcelles-dark/5">
            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-parcelles-dark/50">
              Activity
            </span>
            <span className="font-display text-[10px] font-bold uppercase tracking-wider text-parcelles-dark/50 text-right pr-8">
              Resource Level / Hours
            </span>
          </div>

          <div className="bg-parcelles-bg/20 divide-y divide-parcelles-dark/10">
            {rows.map((row, idx) => (
              <ActivityRow
                key={`${sectionKey}-${idx}`}
                row={row}
                accentColor={meta.color}
                onHoursChange={(newHrs) => onRowHoursChange(sectionKey, idx, newHrs)}
              />
            ))}
          </div>

          {/* Section subtotal */}
          <div className="flex justify-end p-3 border-t border-parcelles-dark/15 gap-2 items-center bg-parcelles-dark/5">
            <span className="font-display text-[10px] uppercase tracking-widest text-parcelles-dark/55 font-semibold">
              Section total:
            </span>
            <span style={{ color: meta.meta || meta.color }} className="font-display font-extrabold text-sm">
              {fmt(total)} h / {fmt(total / 8)} d
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PercentageControls ───────────────────────────────────────────────────────

function PercentageControls({ percentages, onChange, onRefresh, refreshing }) {
  const fields = [
    { key: "internal_testing_pct", label: "Internal Testing (% of D&D)" },
    { key: "client_testing_pct",   label: "Client Testing (% of D&D)" },
    { key: "deployment_pct",       label: "Deployment (% of D&D)" },
    { key: "pm_pct",               label: "Project Management (% of engineering)" },
  ];

  return (
    <div className="border border-parcelles-dark bg-parcelles-bg/60 p-5 chamfer-bottom-left mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-parcelles-dark/20 pb-3 mb-4">
        <div>
          <p className="font-display font-bold text-sm text-parcelles-dark uppercase tracking-wider">
            Estimation Percentages
          </p>
          <p className="font-body text-xs text-parcelles-dark/50 mt-0.5">
            Adjust ratios then click Re-calculate
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1.5">
            <span className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/65 font-bold">
              {label}
            </span>
            <div className="flex items-center gap-1.5 border-b border-parcelles-dark/20 pb-1">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round((percentages[key] ?? 0) * 100)}
                onChange={(e) =>
                  onChange({ ...percentages, [key]: parseFloat(e.target.value) / 100 })
                }
                className="w-16 border-none p-0 font-display font-semibold text-sm text-parcelles-dark bg-transparent outline-none text-right"
              />
              <span className="font-display text-xs text-parcelles-dark/50">%</span>
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-5 py-2.5 bg-parcelles-dark hover:bg-parcelles-dark/90 text-parcelles-bg disabled:opacity-50 disabled:cursor-not-allowed font-display text-xs tracking-wider uppercase transition-colors chamfer-bottom-left flex items-center gap-2"
      >
        {refreshing ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />}
        Re-calculate
      </button>
    </div>
  );
}

// ─── Grand Total Summary Bar ──────────────────────────────────────────────────

function GrandTotalBar({ estimation }) {
  if (!estimation) return null;
  const { total_pre_hours, total_dd_hours, internal_testing_hours, client_testing_hours, deployment_hours, grand_total_hours, percentages } = estimation;

  const segments = [
    { label: "Pre-Engineering", hours: total_pre_hours, bgClass: "bg-parcelles-sage" },
    { label: "Design & Development", hours: total_dd_hours, bgClass: "bg-parcelles-dark" },
    { label: `Internal Testing (${pct(percentages?.internal_testing_pct)})`, hours: internal_testing_hours, bgClass: "bg-parcelles-olive" },
    { label: `Client Testing (${pct(percentages?.client_testing_pct)})`, hours: client_testing_hours, bgClass: "bg-emerald-950" },
    { label: `Deployment (${pct(percentages?.deployment_pct)})`, hours: deployment_hours, bgClass: "bg-parcelles-dark/65" },
  ];

  return (
    <div className="border border-parcelles-dark bg-parcelles-bg/80 p-5 chamfer-bottom-right mb-6">
      <div className="flex items-end justify-between mb-4 gap-4">
        <div>
          <p className="font-display font-bold text-sm text-parcelles-dark uppercase tracking-wider">
            Effort Summary
          </p>
          <p className="font-body text-xs text-parcelles-dark/50 mt-0.5">
            Pre-Engineering + Design & Development + Testing + Deployment
          </p>
        </div>
        <div className="text-right">
          <p className="font-display font-extrabold text-2xl text-parcelles-dark tracking-tight">
            {fmt(grand_total_hours)} h
          </p>
          <p className="font-display text-[9px] uppercase tracking-widest text-parcelles-dark/45 font-medium">
            grand total
          </p>
        </div>
      </div>

      {/* Proportional Stacked Bar */}
      <div className="flex h-3 border border-parcelles-dark/20 overflow-hidden mb-4">
        {segments.map(({ hours, bgClass }, i) => (
          <div key={i} style={{ flex: Math.max(hours, 0.5) }} className={`${bgClass} transition-all duration-300`} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {segments.map(({ label, hours, bgClass }, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-3 h-3 ${bgClass} shrink-0 border border-parcelles-dark/10`} />
            <span className="font-body text-xs text-parcelles-dark/85">
              {label}: <strong className="font-mono">{fmt(hours)} h</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Module Feature Table (Sheet 1 preview) ──────────────────────────────────

function ModuleFeatureTable({ modules, percentages, preEngHours = 128 }) {
  const [open, setOpen] = useState(false);
  const totalDDHours = modules.reduce((s, m) => s + (m.module_total_hours || 0), 0);
  const intPct = percentages?.internal_testing_pct ?? 0.20;
  const cliPct = percentages?.client_testing_pct ?? 0.10;
  const depPct = percentages?.deployment_pct ?? 0.10;
  const grandTotalEffort = preEngHours + totalDDHours * (1 + intPct + cliPct + depPct);

  return (
    <div className="border border-parcelles-dark bg-parcelles-bg/40 chamfer-bottom-left mt-5 overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex flex-wrap items-center justify-between p-4 bg-parcelles-sage/5 hover:bg-parcelles-sage/15 transition-colors border-b border-parcelles-dark/15 text-left"
      >
        <div className="flex items-center gap-3">
          <Clock size={16} className="text-parcelles-dark/60" />
          <span className="font-display font-bold text-sm text-parcelles-dark uppercase tracking-wider">
            Module Feature Estimation (Sheet 1 Preview)
          </span>
          <span className="font-display text-[9px] px-2 py-0.5 bg-parcelles-dark/10 text-parcelles-dark/70 font-semibold uppercase tracking-wider">
            {modules.length} modules
          </span>
        </div>
        <div className="flex items-center gap-4 mt-2 sm:mt-0">
          <span className="font-display font-extrabold text-base text-parcelles-dark">
            {Math.round(grandTotalEffort).toString()} h
          </span>
          {open ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
        </div>
      </button>

      {open && (
        <div>
          {/* Table header */}
          <div className="grid grid-cols-[40px_1.5fr_2fr_3.5fr_80px] gap-2 px-4 py-2 border-b border-parcelles-dark/15 bg-parcelles-dark/5">
            {["SL", "Module", "Feature / Role", "Description", "Hours"].map((h, i) => (
              <span
                key={i}
                className={`font-display text-[10px] font-bold uppercase tracking-wider text-parcelles-dark/50 ${i === 4 ? "text-right" : "text-left"}`}
              >
                {h}
              </span>
            ))}
          </div>

          {/* Feature rows */}
          <div className="max-h-[350px] overflow-y-auto divide-y divide-parcelles-dark/10 bg-parcelles-bg/25">
            {modules.map((mod, mIdx) =>
              mod.features.map((feat, fIdx) => (
                <div
                  key={`${mIdx}-${fIdx}`}
                  className={`grid grid-cols-[40px_1.5fr_2fr_3.5fr_80px] gap-2 px-4 py-2.5 items-start transition-colors hover:bg-parcelles-sage/5 ${mIdx % 2 === 0 ? "bg-transparent" : "bg-parcelles-dark/[0.02]"}`}
                >
                  <span className="font-display text-[10px] text-parcelles-dark/45">
                    {fIdx === 0 ? mod.sl : ""}
                  </span>
                  <span className="font-display text-xs font-semibold text-parcelles-dark truncate">
                    {fIdx === 0 ? mod.module_name : ""}
                  </span>
                  <span className="font-body text-xs text-parcelles-dark font-medium leading-normal">
                    {feat.feature}
                  </span>
                  <span className="font-body text-xs text-parcelles-dark/65 leading-relaxed">
                    {feat.description}
                  </span>
                  <span className="font-display text-xs text-parcelles-dark font-bold text-right pr-1">
                    {Math.round(feat.estimated_hours).toString()}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Effort breakdown summary cards */}
          <div className="border-t border-parcelles-dark/15 divide-y divide-parcelles-dark/10 bg-parcelles-dark/[0.03]">
            {(() => {
              const summaryItems = [
                { label: "Pre-Engineering",          value: preEngHours,            bold: false, colorClass: "text-parcelles-dark/70" },
                { label: "Design and Development",  value: totalDDHours,            bold: false, colorClass: "text-parcelles-dark" },
                { label: `Internal Testing (${Math.round(intPct * 100)}%)`,  value: totalDDHours * intPct,     bold: false, colorClass: "text-parcelles-olive" },
                { label: `Client Testing (${Math.round(cliPct * 100)}%)`,    value: totalDDHours * cliPct,     bold: false, colorClass: "text-emerald-900" },
                { label: `Deployment (${Math.round(depPct * 100)}%)`,         value: totalDDHours * depPct,    bold: false, colorClass: "text-parcelles-dark/80" },
                { label: "Grand Total",              value: grandTotalEffort,                          bold: true,  colorClass: "text-parcelles-dark" },
              ];

              return summaryItems.map(({ label, value, bold, colorClass }, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center px-4 py-2 font-display text-xs ${bold ? "font-bold bg-parcelles-dark/5 border-t border-parcelles-dark/20" : "font-normal"}`}
                >
                  <span className="text-parcelles-dark/75">{label}</span>
                  <span className={`${bold ? "text-base font-extrabold" : "font-bold"} ${colorClass}`}>
                    {Math.round(value).toString()} h
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function AxcendEffortEstimation({
  analysisResult,
  selectedOption,
  companyRoster,
  location = "India",
}) {
  const [estimation, setEstimation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [percentages, setPercentages] = useState({
    internal_testing_pct: 0.20,
    client_testing_pct:   0.10,
    deployment_pct:       0.10,
    pm_pct:               0.10,
    risk_pct:             0.0,
    negotiation_pct:      0.0,
  });

  // Row-level hour overrides (client-side, no API round-trip needed)
  const [rowOverrides, setRowOverrides] = useState({
    pre_engineering:    {},
    engineering:        {},
    project_management: {},
  });

  const fetchEstimation = useCallback(
    async (pct) => {
      if (!analysisResult) return;
      setLoading(true);
      setError("");
      try {
        const result = await buildAxcendEstimation({
          analysis: analysisResult,
          selectedOption,
          companyRoster,
          location,
          percentages: pct,
        });
        setEstimation(result);
        setRowOverrides({ pre_engineering: {}, engineering: {}, project_management: {} });
      } catch (err) {
        setError(err.message || "Failed to build effort estimation.");
      } finally {
        setLoading(false);
      }
    },
    [analysisResult, selectedOption, companyRoster, location]
  );

  // Auto-fetch when analysis changes
  useEffect(() => {
    if (analysisResult?.feature_complexity_analysis?.length) {
      fetchEstimation(percentages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisResult, selectedOption]);

  // Merge server rows with local overrides
  const resolvedRows = useMemo(() => {
    if (!estimation) return { pre_engineering: [], engineering: [], project_management: [] };
    const apply = (section) =>
      (estimation[section] || []).map((row, idx) => ({
        ...row,
        input_hours:
          rowOverrides[section][idx] !== undefined
            ? rowOverrides[section][idx]
            : row.input_hours,
      }));
    return {
      pre_engineering:    apply("pre_engineering"),
      engineering:        apply("engineering"),
      project_management: apply("project_management"),
    };
  }, [estimation, rowOverrides]);

  const handleRowHoursChange = (section, idx, newHrs) => {
    setRowOverrides((prev) => ({
      ...prev,
      [section]: { ...prev[section], [idx]: newHrs },
    }));
  };

  // Recompute display totals from resolved rows (no API needed)
  const displayEstimation = useMemo(() => {
    if (!estimation) return estimation;
    const preHours = resolvedRows.pre_engineering
      .reduce((s, r) => s + (r.input_hours || 0), 0);
    const devHours = resolvedRows.engineering
      .filter((r) => r.activity.toLowerCase().includes("software development"))
      .reduce((s, r) => s + (r.input_hours || 0), 0);
    const intTest = resolvedRows.engineering.find((r) => r.activity.toLowerCase().includes("internal"))?.input_hours || 0;
    const clientT = resolvedRows.engineering.find((r) => r.activity.toLowerCase().includes("client") || r.activity.toLowerCase().includes("external"))?.input_hours || 0;
    const deploy  = resolvedRows.engineering.find((r) => r.activity.toLowerCase().includes("deployment"))?.input_hours || 0;
    const grandTotal = preHours + devHours + intTest + clientT + deploy;
    return { ...estimation, total_pre_hours: preHours, total_dd_hours: devHours, internal_testing_hours: intTest, client_testing_hours: clientT, deployment_hours: deploy, grand_total_hours: grandTotal };
  }, [estimation, resolvedRows]);

  useEffect(() => {
    if (!estimation) return;
    const draft = {
      project_name: estimation.project_name || analysisResult?.project_name || "Axcend Project",
      modules: estimation.modules || [],
      pre_engineering: resolvedRows.pre_engineering || [],
      engineering: resolvedRows.engineering || [],
      project_management: resolvedRows.project_management || [],
      effort_percentages: estimation.percentages || percentages,
      total_dd_hours: displayEstimation?.total_dd_hours || 0,
      internal_testing_hours: displayEstimation?.internal_testing_hours || 0,
      client_testing_hours: displayEstimation?.client_testing_hours || 0,
      deployment_hours: displayEstimation?.deployment_hours || 0,
      grand_total_hours: displayEstimation?.grand_total_hours || 0,
      selected_option: selectedOption,
      location,
    };

    saveAxcendEstimationDraft(draft);
    saveAxcendDraftApi(draft).catch((err) => {
      console.warn("Failed to persist Axcend estimation draft:", err);
    });
  }, [analysisResult?.project_name, displayEstimation, estimation, location, percentages, resolvedRows, selectedOption]);

  if (!analysisResult) {
    return (
      <div className="p-8 text-center text-parcelles-dark/50 font-sans text-sm">
        Complete Team Allocation first to view Effort Estimation.
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Title */}
      <div className="mb-5">
        <p className="font-sans text-[10px] text-parcelles-dark/50 uppercase tracking-widest font-bold mb-1">
          AXCEND Format — Fixed Price Projects
        </p>
        <h2 className="font-display font-bold text-xl text-parcelles-dark">
          Effort Estimation
        </h2>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-800 text-xs font-sans mb-4">
          <AlertCircle size={14} className="text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 p-6 justify-center text-parcelles-dark/50 font-sans text-xs">
          <Loader2 size={16} className="animate-spin" />
          Building effort estimation…
        </div>
      )}

      {!loading && estimation && (
        <>
          {/* Percentage controls */}
          <PercentageControls
            percentages={percentages}
            onChange={setPercentages}
            onRefresh={() => fetchEstimation(percentages)}
            refreshing={loading}
          />

          {/* Grand total summary bar */}
          <GrandTotalBar estimation={displayEstimation} />

          {/* ── Three Panels ── */}
          <SectionPanel
            sectionKey="pre_engineering"
            rows={resolvedRows.pre_engineering}
            onRowHoursChange={handleRowHoursChange}
            defaultOpen={true}
          />
          <SectionPanel
            sectionKey="engineering"
            rows={resolvedRows.engineering}
            onRowHoursChange={handleRowHoursChange}
            defaultOpen={true}
          />
          <SectionPanel
            sectionKey="project_management"
            rows={resolvedRows.project_management}
            onRowHoursChange={handleRowHoursChange}
            defaultOpen={false}
          />

          {/* Module feature table (Sheet 1 preview) */}
          {estimation.modules?.length > 0 && (
            <ModuleFeatureTable modules={estimation.modules} percentages={estimation.percentages} preEngHours={displayEstimation?.total_pre_hours || 128} />
          )}
        </>
      )}
    </div>
  );
}
