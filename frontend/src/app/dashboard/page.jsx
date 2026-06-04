"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Users, DollarSign, LogOut, Activity, CheckCircle, Lock, FileSpreadsheet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { loadApprovedTeam } from "@/lib/workflowArtifacts";
import { loadCostDraft } from "@/lib/costEstimationStorage";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

const CORE_SERVICES = [
  { href: "/input", label: "SRS Generation", icon: FileText, tag: "Phase 01", desc: "Synthesize project descriptions and briefs into structured, production-grade Software Requirements Specifications.", color: "#8EC4A0" },
  { href: "/team-design", label: "Team Allocation", icon: Users, tag: "Phase 02", desc: "Formulate experience-weighted team staffing structures, timeline hours, and task complexity analysis.", color: "#A8D4B8" },
  { href: "/cost-estimation", label: "Cost Estimation", icon: DollarSign, tag: "Phase 03", desc: "Calculate full financial projections, map hourly resource rates, set buffers, and generate draft budgets.", color: "#C4DCC8" },
];

function StatCard({ label, value, sub, icon: Icon, delay }) {
  return (
    <ScrollReveal variant="slide-up" delay={delay}>
      <div
        style={{
          background: "#fff",
          border: "1px solid rgba(10,28,22,0.1)",
          padding: "2rem",
          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "0.65rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(10,28,22,0.4)",
            }}
          >
            {label}
          </span>
          <div
            style={{
              width: "36px",
              height: "36px",
              background: "rgba(142,196,160,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
            }}
          >
            <Icon size={16} strokeWidth={1.5} color="#0A1C16" />
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 300,
            fontSize: "2.5rem",
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: "#0A1C16",
            marginBottom: "0.5rem",
          }}
        >
          {value}
        </div>
        {sub && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", color: "rgba(10,28,22,0.45)" }}>
            {sub}
          </p>
        )}
      </div>
    </ScrollReveal>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { srsData, projectTitle, resetWorkflow } = useWorkflow();
  const [freshUser, setFreshUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approvedTeam, setApprovedTeam] = useState(null);
  const [costDraft, setCostDraft] = useState(null);
  const [activeTab, setActiveTab] = useState("intake");

  // Load client-only storage artifacts on mount
  useEffect(() => {
    setApprovedTeam(loadApprovedTeam());
    setCostDraft(loadCostDraft());
  }, []);

  const hasSrs = Boolean(srsData?.xlsxPath);
  const hasTeam = Boolean(approvedTeam?.members?.length);
  const hasCost = Boolean(costDraft);

  const TABS = [
    {
      id: "intake",
      phase: "Phase 01",
      label: "Intake & SRS",
      icon: FileText,
      status: hasSrs ? "completed" : "ready",
    },
    {
      id: "team",
      phase: "Phase 02",
      label: "Team Design",
      icon: Users,
      status: hasTeam ? "completed" : (hasSrs ? "ready" : "locked"),
    },
    {
      id: "costs",
      phase: "Phase 03",
      label: "Cost Estimation",
      icon: DollarSign,
      status: hasCost ? "completed" : (hasTeam ? "ready" : "locked"),
    },
    {
      id: "export",
      phase: "Phase 04",
      label: "Final Export",
      icon: FileSpreadsheet,
      status: (hasSrs || hasTeam) ? "ready" : "locked",
    },
  ];

  const handleStartOver = () => {
    resetWorkflow();
  };

  // Update default active tab once data is hydrated/loaded
  useEffect(() => {
    if (!hasSrs) {
      setActiveTab("intake");
    } else if (!hasTeam) {
      setActiveTab("team");
    } else if (!hasCost) {
      setActiveTab("costs");
    } else {
      setActiveTab("export");
    }
  }, [hasSrs, hasTeam, hasCost]);

  const formatHistoryDetails = (item) => {
    if (!item.details) return "";
    let details = item.details;
    details = details.replace(/using\s+[^\s]+\s+with/gi, "with");
    details = details.replace(/using\s+[^\s]+/gi, "");
    return details;
  };

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load profile");
        }
        return response.json();
      })
      .then((profile) => {
        setFreshUser(profile);
      })
      .catch(() => setFreshUser(user))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  const profile = freshUser || user;
  const history = [...(profile.history || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const registeredDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "—";

  const generatedDrafts = history.filter(
    (item) => item.action === "Generated SRS Draft" || item.action === "Regenerated SRS Draft"
  );
  const approvedBlueprints = history.filter((item) => item.action === "Approved SRS Blueprint");
  const uniqueProjects = new Set(history.map((item) => item.project_name).filter(Boolean));

  const initials = (profile.name || profile.email || "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: "#F5F3EE", paddingBottom: "6rem" }}>

      {/* ── HEADER BANNER ── */}
      <div
        style={{
          background: "#0A1C16",
          padding: "2.5rem clamp(1.5rem, 5vw, 5rem)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Grid texture */}
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            backgroundImage: "linear-gradient(rgba(196,215,201,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(196,215,201,0.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            pointerEvents: "none",
          }}
        />
        <div style={{ maxWidth: "1300px", margin: "0 auto", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1.5rem" }}>

            {/* Left: avatar + greeting */}
            <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
              <div
                style={{
                  width: "64px", height: "64px",
                  background: "linear-gradient(135deg, #8EC4A0, #4a9e6e)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.4rem", color: "#0A1C16" }}>
                  {initials}
                </span>
              </div>
              <div>
                <p style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(196,215,201,0.5)", marginBottom: "0.3rem" }}>
                  Welcome back
                </p>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(1.4rem, 3vw, 2rem)", letterSpacing: "-0.03em", color: "#EBEBEB", lineHeight: 1 }}>
                  {profile.name || "User"}&nbsp;
                  <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "#8EC4A0" }}>Dashboard</em>
                </h1>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", color: "rgba(235,235,235,0.4)", marginTop: "0.3rem" }}>
                  {profile.email} · Member since {registeredDate}
                </p>
              </div>
            </div>

            {/* Right: nav + logout */}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <Link
                href="/input"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.6rem 1.4rem",
                  background: "#8EC4A0", color: "#0A1C16",
                  fontFamily: "var(--font-display)", fontSize: "0.72rem",
                  letterSpacing: "0.15em", textTransform: "uppercase", textDecoration: "none",
                  clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                  transition: "opacity 0.2s ease",
                }}
              >
                New Project <ArrowRight size={14} />
              </Link>
              <button
                onClick={logout}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.6rem 1.2rem",
                  background: "transparent", color: "rgba(235,235,235,0.5)",
                  border: "1px solid rgba(235,235,235,0.15)",
                  fontFamily: "var(--font-display)", fontSize: "0.72rem",
                  letterSpacing: "0.15em", textTransform: "uppercase",
                  cursor: "pointer", transition: "all 0.2s ease",
                }}
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: "3rem clamp(1.5rem, 5vw, 5rem)" }}>

        {/* Stats row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1px",
            marginBottom: "3rem",
            background: "rgba(10,28,22,0.1)",
            border: "1px solid rgba(10,28,22,0.1)",
          }}
        >
          <StatCard label="SRS Drafts" value={loading ? "—" : generatedDrafts.length} sub="Generated or regenerated proposals" icon={FileText} delay={0} />
          <StatCard label="Approved Blueprints" value={loading ? "—" : approvedBlueprints.length} sub="Ready for export workflows" icon={CheckCircle} delay={80} />
          <StatCard label="Tracked Projects" value={loading ? "—" : uniqueProjects.size} sub="Distinct projects in your history" icon={Activity} delay={160} />
        </div>



        {/* ── WORKSPACE PIPELINE ── */}
        <ScrollReveal variant="slide-up" delay={0}>
          <div
            style={{
              background: "#fff",
              border: "1px solid rgba(10,28,22,0.12)",
              padding: "2.5rem",
              marginBottom: "3rem",
              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%)",
            }}
          >
            {/* Pipeline Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: "1rem",
                borderBottom: "1px solid rgba(10,28,22,0.1)",
                paddingBottom: "1.5rem",
                marginBottom: "2rem",
              }}
            >
              <div>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "rgba(10,28,22,0.4)",
                  }}
                >
                  Interactive Workspace
                </span>
                <h2
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 300,
                    fontSize: "clamp(1.5rem, 3vw, 2.2rem)",
                    letterSpacing: "-0.03em",
                    color: "#0A1C16",
                    marginTop: "0.5rem",
                  }}
                >
                  Project Planning{" "}
                  <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "#8EC4A0" }}>
                    Pipeline
                  </em>
                </h2>
              </div>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", color: "rgba(10,28,22,0.5)" }}>
                Track progress and navigate across planning phases
              </span>
            </div>

            {/* Horizontal Tabs Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
                marginBottom: "2rem",
              }}
            >
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      background: isActive ? "#0A1C16" : "rgba(10,28,22,0.02)",
                      border: isActive ? "1px solid #0A1C16" : "1px solid rgba(10,28,22,0.08)",
                      padding: "1.25rem 1.5rem",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                      clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(142,196,160,0.1)";
                        e.currentTarget.style.borderColor = "rgba(142,196,160,0.4)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(10,28,22,0.02)";
                        e.currentTarget.style.borderColor = "rgba(10,28,22,0.08)";
                      }
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "0.6rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          color: isActive ? "rgba(196,215,201,0.6)" : "rgba(10,28,22,0.4)",
                        }}
                      >
                        {tab.phase}
                      </span>
                      {/* Status Badge */}
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "0.55rem",
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          padding: "0.2rem 0.5rem",
                          background: tab.status === "completed"
                            ? "rgba(74,222,128,0.15)"
                            : tab.status === "ready"
                              ? "rgba(96,165,250,0.15)"
                              : "rgba(10,28,22,0.05)",
                          color: tab.status === "completed"
                            ? "#166534"
                            : tab.status === "ready"
                              ? "#1e40af"
                              : "rgba(10,28,22,0.4)",
                          border: `1px solid ${
                            tab.status === "completed"
                              ? "rgba(74,222,128,0.3)"
                              : tab.status === "ready"
                                ? "rgba(96,165,250,0.3)"
                                : "rgba(10,28,22,0.1)"
                          }`,
                          borderRadius: "2px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                        }}
                      >
                        {tab.status === "locked" && <Lock size={9} strokeWidth={2} />}
                        {tab.status === "completed" && <CheckCircle size={9} strokeWidth={2} />}
                        {tab.status}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.25rem" }}>
                      <Icon size={18} strokeWidth={1.5} color={isActive ? "#8EC4A0" : "#0A1C16"} />
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 500,
                          fontSize: "0.95rem",
                          color: isActive ? "#EBEBEB" : "#0A1C16",
                        }}
                      >
                        {tab.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Tab Panel Content */}
            <div
              style={{
                background: "rgba(196,215,201,0.04)",
                border: "1px solid rgba(10,28,22,0.06)",
                padding: "2rem",
                clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              {activeTab === "intake" && (
                <>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(10,28,22,0.45)",
                        marginBottom: "0.4rem",
                        display: "block",
                      }}
                    >
                      PHASE 01 — SCOPE & SPECIFICATION
                    </span>
                    <h3
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: "1.3rem",
                        color: "#0A1C16",
                        marginBottom: "0.75rem",
                      }}
                    >
                      Intake & Requirements Synthesis
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.88rem",
                        color: "rgba(10,28,22,0.65)",
                        lineHeight: 1.6,
                        maxWidth: "800px",
                      }}
                    >
                      Synthesize your raw project description, wireframes, or feature brief into a structured, production-grade Software Requirements Specification (SRS) workbook. Powered by Google Gemini's context window, this stage establishes the baseline modules, requirements, and user stories.
                    </p>
                  </div>

                  {hasSrs ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid rgba(10,28,22,0.08)",
                        padding: "1.25rem 1.5rem",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,28,22,0.4)" }}>
                          Synthesized Blueprint
                        </p>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "#0A1C16", marginTop: "0.2rem" }}>
                          {srsData?.structuredRequirements?.project_name || projectTitle || "Active Project"}
                        </p>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.75rem", color: "rgba(10,28,22,0.5)", marginTop: "0.2rem" }}>
                          Contains {srsData?.sections?.length || 0} modules and comprehensive scope sheets.
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem" }}>
                        <Link
                          href="/srs"
                          style={{
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            border: "1px solid rgba(10,28,22,0.25)",
                            fontFamily: "var(--font-display)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            textDecoration: "none",
                            color: "#0A1C16",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                          }}
                        >
                          Modify SRS
                        </Link>
                        <button
                          onClick={handleStartOver}
                          style={{
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            border: "1px solid rgba(220, 38, 38, 0.25)",
                            fontFamily: "var(--font-display)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "#dc2626",
                            cursor: "pointer",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                          }}
                        >
                          Start Over
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Link
                        href="/input"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem 1.5rem",
                          background: "#0A1C16",
                          color: "#EBEBEB",
                          fontFamily: "var(--font-display)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          textDecoration: "none",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        }}
                      >
                        Start Intake Process <ArrowRight size={14} />
                      </Link>
                    </div>
                  )}
                </>
              )}

              {activeTab === "team" && (
                <>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(10,28,22,0.45)",
                        marginBottom: "0.4rem",
                        display: "block",
                      }}
                    >
                      PHASE 02 — ROSTER ARCHITECTURE & TIMELINE
                    </span>
                    <h3
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: "1.3rem",
                        color: "#0A1C16",
                        marginBottom: "0.75rem",
                      }}
                    >
                      Dynamic Team Allocation
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.88rem",
                        color: "rgba(10,28,22,0.65)",
                        lineHeight: 1.6,
                        maxWidth: "800px",
                      }}
                    >
                      Design your development team based on complex project realities. Our cognitive model recommends a timeline length, staffing mix, and member seniorities based on task complexity. Roster sizes and timelines are dynamic, avoiding rigid placeholders and preset templates.
                    </p>
                  </div>

                  {hasTeam ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid rgba(10,28,22,0.08)",
                        padding: "1.25rem 1.5rem",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,28,22,0.4)" }}>
                          Allocated Staffing Structure
                        </p>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "#0A1C16", marginTop: "0.2rem" }}>
                          {approvedTeam?.members?.length || 0} Professional Roles · {approvedTeam?.duration_weeks ? Math.round(approvedTeam.duration_weeks * 40) : "—"} Hours Timeline
                        </p>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.75rem", color: "rgba(10,28,22,0.5)", marginTop: "0.2rem" }}>
                          Allocated with dynamic seniorities (1–15+ years experience) and total effort of {approvedTeam?.total_project_hours || 0} hours.
                        </p>
                      </div>
                      <div>
                        <Link
                          href="/team-design"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            border: "1px solid rgba(10,28,22,0.25)",
                            fontFamily: "var(--font-display)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            textDecoration: "none",
                            color: "#0A1C16",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                          }}
                        >
                          Manage Team Design
                        </Link>
                      </div>
                    </div>
                  ) : hasSrs ? (
                    <div>
                      <Link
                        href="/team-design"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem 1.5rem",
                          background: "#0A1C16",
                          color: "#EBEBEB",
                          fontFamily: "var(--font-display)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          textDecoration: "none",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        }}
                      >
                        Generate Team Recommendation <ArrowRight size={14} />
                      </Link>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "1.25rem 1.5rem",
                        background: "rgba(10,28,22,0.02)",
                        border: "1px solid rgba(10,28,22,0.06)",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                      }}
                    >
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "rgba(10,28,22,0.5)" }}>
                        💡 <strong>Bypass Route Available:</strong> This phase normally evaluates an approved SRS workbook. If you already have requirements or want to model a team roster directly from a document upload/text paste, click below to bypass SRS.
                      </p>
                      <div>
                        <Link
                          href="/team-design"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            border: "1px solid rgba(10,28,22,0.3)",
                            color: "#0A1C16",
                            fontFamily: "var(--font-display)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            textDecoration: "none",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                            transition: "all 0.2s ease",
                          }}
                        >
                          Bypass & Design Team <ArrowRight size={12} />
                        </Link>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === "costs" && (
                <>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(10,28,22,0.45)",
                        marginBottom: "0.4rem",
                        display: "block",
                      }}
                    >
                      PHASE 03 — FINANCIAL MODELLING & PROJECTIONS
                    </span>
                    <h3
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: "1.3rem",
                        color: "#0A1C16",
                        marginBottom: "0.75rem",
                      }}
                    >
                      Strategic Cost Projections
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.88rem",
                        color: "rgba(10,28,22,0.65)",
                        lineHeight: 1.6,
                        maxWidth: "800px",
                      }}
                    >
                      Translate team architecture and efforts directly into financial projections. Map standard hourly rates, assign weekly hours, set overhead buffers, and assign miscellaneous expenses to build complete project budgets.
                    </p>
                  </div>

                  {hasCost ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid rgba(10,28,22,0.08)",
                        padding: "1.25rem 1.5rem",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,28,22,0.4)" }}>
                          Financial Projection Model
                        </p>
                        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", color: "#0A1C16", marginTop: "0.2rem" }}>
                          Cost Draft Loaded ({costDraft?.currency || "USD"})
                        </p>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.75rem", color: "rgba(10,28,22,0.5)", marginTop: "0.2rem" }}>
                          Maps {costDraft?.members?.length || 0} active roles and additional miscellaneous buffers.
                        </p>
                      </div>
                      <div>
                        <Link
                          href="/cost-estimation"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.6rem 1.2rem",
                            background: "transparent",
                            border: "1px solid rgba(10,28,22,0.25)",
                            fontFamily: "var(--font-display)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            textDecoration: "none",
                            color: "#0A1C16",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                          }}
                        >
                          Manage Cost Model
                        </Link>
                      </div>
                    </div>
                  ) : hasTeam ? (
                    <div>
                      <Link
                        href="/cost-estimation"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem 1.5rem",
                          background: "#0A1C16",
                          color: "#EBEBEB",
                          fontFamily: "var(--font-display)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          textDecoration: "none",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        }}
                      >
                        Calculate Cost Projections <ArrowRight size={14} />
                      </Link>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "1.25rem 1.5rem",
                        background: "rgba(10,28,22,0.03)",
                        border: "1px solid rgba(10,28,22,0.06)",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      <Lock size={16} strokeWidth={1.5} color="rgba(10,28,22,0.4)" />
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "rgba(10,28,22,0.45)", margin: 0 }}>
                        Requires an approved team design. Complete the <strong>Team Design</strong> phase first to automatically map your team structure here.
                      </p>
                    </div>
                  )}
                </>
              )}

              {activeTab === "export" && (
                <>
                  <div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(10,28,22,0.45)",
                        marginBottom: "0.4rem",
                        display: "block",
                      }}
                    >
                      PHASE 04 — STRATEGIC WORKBOOK BUNDLE
                    </span>
                    <h3
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 400,
                        fontSize: "1.3rem",
                        color: "#0A1C16",
                        marginBottom: "0.75rem",
                      }}
                    >
                      Deliverables & Export
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.88rem",
                        color: "rgba(10,28,22,0.65)",
                        lineHeight: 1.6,
                        maxWidth: "800px",
                      }}
                    >
                      Ready for project launch. Export your planning workbook assets, including your synthesized requirements documentation, team allocation matrix, and estimated costs.
                    </p>
                  </div>

                  {(hasSrs || hasTeam) ? (
                    <div>
                      <Link
                        href="/download"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem 1.5rem",
                          background: "#0A1C16",
                          color: "#EBEBEB",
                          fontFamily: "var(--font-display)",
                          fontSize: "0.72rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          textDecoration: "none",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        }}
                      >
                        Go to Downloads & Exports <ArrowRight size={14} />
                      </Link>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "1.25rem 1.5rem",
                        background: "rgba(10,28,22,0.03)",
                        border: "1px solid rgba(10,28,22,0.06)",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      <Lock size={16} strokeWidth={1.5} color="rgba(10,28,22,0.4)" />
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "rgba(10,28,22,0.45)", margin: 0 }}>
                        Requires planning inputs. Complete the <strong>Intake & SRS</strong> or <strong>Team Design</strong> phases first to synthesize downloadable spreadsheets.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </ScrollReveal>

        {/* Recent Activity */}
        <ScrollReveal variant="slide-up" delay={120}>
          <div style={{ marginBottom: "3rem" }}>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(10,28,22,0.4)",
                marginBottom: "1rem",
              }}
            >
              Recent Project Activity
            </p>
            {loading ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#fff",
                  border: "1px solid rgba(10,28,22,0.08)",
                }}
              >
                <p style={{ fontFamily: "var(--font-sans)", color: "rgba(10,28,22,0.4)" }}>Loading activity…</p>
              </div>
            ) : history.length === 0 ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  background: "#fff",
                  border: "1px solid rgba(10,28,22,0.08)",
                  clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "rgba(10,28,22,0.4)",
                    fontSize: "0.85rem",
                  }}
                >
                  No activity recorded yet.
                </p>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "rgba(10,28,22,0.35)", marginTop: "0.5rem" }}>
                  Start a new project to see your activity log.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {history.slice(0, 10).map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "1.25rem 2rem",
                      background: "#fff",
                      border: "1px solid rgba(10,28,22,0.08)",
                      clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                      gap: "2rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          background: "rgba(142,196,160,0.12)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
                          flexShrink: 0,
                        }}
                      >
                        <FileText size={16} strokeWidth={1.5} color="#0A1C16" />
                      </div>
                      <div>
                        <p
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: "1.05rem",
                            fontWeight: 500,
                            color: "#0A1C16",
                          }}
                        >
                          {item.project_name || "Untitled Project"}
                        </p>
                        <p
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: "0.65rem",
                            color: "rgba(10,28,22,0.45)",
                            marginTop: "0.2rem",
                            letterSpacing: "0.15em",
                            textTransform: "uppercase",
                          }}
                        >
                          {item.action}
                        </p>
                        {item.details && (
                          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", color: "rgba(10,28,22,0.55)", marginTop: "0.2rem", lineHeight: 1.5 }}>
                            {formatHistoryDetails(item)}
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.78rem",
                        color: "rgba(10,28,22,0.4)",
                        flexShrink: 0,
                      }}
                    >
                      {new Date(item.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollReveal>

      </div>
    </div>
  );
}
