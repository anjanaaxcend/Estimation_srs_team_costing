"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Download, FileSpreadsheet, FolderOutput, ScrollText, Users, Lock } from "lucide-react";

import { PageIntro } from "@/components/workflow/PageIntro";
import { useWorkflow } from "@/context/WorkflowContext";
import { getAvailableDeliverables } from "@/lib/deliverableBundle";
import { exportTeamExcel, triggerAssetDownload } from "@/lib/platformApi";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { HorizontalMarquee } from "@/components/ui/HorizontalMarquee";

export function DeliverablesExperience() {
  const router = useRouter();
  const { srsData } = useWorkflow();
  const deliverables = getAvailableDeliverables({ srsData });
  const hasAnyDeliverable = deliverables.hasSrs || deliverables.hasTeam;



  const LOCKED_ITEMS = [
    { icon: ScrollText, title: "SRS Workbook",          copy: "Unlocked after AI-powered requirement synthesis and approval." },
    { icon: Users,      title: "Team Architecture",     copy: "Unlocked once the staffing recommendation is finalised." },
    { icon: FileSpreadsheet, title: "Strategic Projections", copy: "The final export containing all project financial models." },
  ];

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", paddingBottom: "1.5rem" }}>

      {/* ── HEADER ── */}
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
            {/* Eyebrow */}
            <ScrollReveal variant="slide-left" delay={0}>
              <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.5)" }}>
                Phase 04 — Deliverables
              </p>
            </ScrollReveal>

            {/* Title */}
            <ScrollReveal variant="slide-up" delay={80}>
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
                {hasAnyDeliverable ? "Download strategic" : "Awaiting deliverable"}{" "}
                <em
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    opacity: 0.65,
                  }}
                >
                  {hasAnyDeliverable ? "assets." : "generation."}
                </em>
              </h1>
            </ScrollReveal>

            {/* Copy */}
            <ScrollReveal variant="slide-up" delay={160}>
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
                {hasAnyDeliverable
                  ? "Your project planning artifacts are ready for deployment. Stage-specific exports are available below."
                  : "Complete the SRS, team architecture, or cost projections to activate downloads."}
              </p>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── MAIN GRID ── */}
      <section
        style={{
          paddingTop: "1rem",
          paddingBottom: "1rem",
          paddingLeft: "clamp(1.5rem, 5vw, 5rem)",
          paddingRight: "clamp(1.5rem, 5vw, 5rem)",
        }}
      >
        <div
          style={{
            maxWidth: "1400px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1.15fr 0.85fr",
            gap: "2rem",
            alignItems: "start",
          }}
        >
          {/* ── LEFT: Downloads ── */}
          <ScrollReveal variant="slide-up" delay={0}>
            <article
              style={{
                border: "1px solid #0A1C16",
                background: "#F5F3EE",
                padding: "1.5rem",
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 28px 100%, 0 calc(100% - 28px))",
              }}
            >
              {/* Section header */}
              <div style={{ borderBottom: "1px solid rgba(10,28,22,0.15)", paddingBottom: "0.75rem", marginBottom: "1rem" }}>
                <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.45)", marginBottom: "0.5rem" }}>Exportable Assets</p>
                <h2
                  style={{
                    fontFamily: "var(--font-display)", fontWeight: 300,
                    fontSize: "clamp(1.8rem, 3vw, 2.5rem)", letterSpacing: "-0.02em", color: "#0A1C16",
                  }}
                >
                  {hasAnyDeliverable ? "Ready for download." : "Assets locked."}
                </h2>
              </div>

              {hasAnyDeliverable ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {deliverables.hasSrs && (
                    <ScrollReveal variant="slide-up" delay={0}>
                      <article
                        className="card-invert"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "1.25rem",
                          padding: "1.25rem 1.5rem",
                          border: "1px solid #0A1C16",
                          transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                          <div
                            style={{
                              width: "56px", height: "56px", flexShrink: 0,
                              border: "1px solid currentColor", display: "flex",
                              alignItems: "center", justifyContent: "center",
                              transition: "border-color 0.4s ease",
                              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)",
                            }}
                          >
                            <ScrollText size={26} strokeWidth={1} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", letterSpacing: "-0.01em" }}>
                              SRS Document Package
                            </p>
                            <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.85rem", opacity: 0.65, marginTop: "0.25rem", lineHeight: 1.5, fontWeight: 300 }}>
                              Complete requirements specifications available in Microsoft Word, Adobe PDF, and Microsoft Excel workbook formats.
                            </p>
                          </div>
                        </div>

                        {/* Format buttons row */}
                        <div style={{ 
                          display: "grid", 
                          gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", 
                          gap: "0.75rem", 
                          marginTop: "0.5rem",
                          width: "100%" 
                        }}>
                          <button
                            onClick={() => triggerAssetDownload(srsData.docxPath || srsData.docx_path)}
                            style={{
                              padding: "0.75rem 1rem",
                              border: "1px solid currentColor",
                              background: "transparent",
                              fontFamily: "var(--font-display)", fontSize: "0.72rem",
                              letterSpacing: "0.1em", textTransform: "uppercase",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                              transition: "all 0.3s ease",
                              cursor: "pointer",
                              clipPath: "polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
                            }}
                          >
                            <Download size={14} strokeWidth={1.5} />
                            Word (DOCX)
                          </button>

                          <button
                            onClick={() => triggerAssetDownload(srsData.pdfPath || srsData.pdf_path)}
                            style={{
                              padding: "0.75rem 1rem",
                              border: "1px solid currentColor",
                              background: "transparent",
                              fontFamily: "var(--font-display)", fontSize: "0.72rem",
                              letterSpacing: "0.1em", textTransform: "uppercase",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                              transition: "all 0.3s ease",
                              cursor: "pointer",
                              clipPath: "polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
                            }}
                          >
                            <Download size={14} strokeWidth={1.5} />
                            Adobe PDF
                          </button>

                          <button
                            onClick={() => triggerAssetDownload(srsData.xlsxPath || srsData.xlsx_path)}
                            style={{
                              padding: "0.75rem 1rem",
                              border: "1px solid currentColor",
                              background: "transparent",
                              fontFamily: "var(--font-display)", fontSize: "0.72rem",
                              letterSpacing: "0.1em", textTransform: "uppercase",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                              transition: "all 0.3s ease",
                              cursor: "pointer",
                              clipPath: "polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
                            }}
                          >
                            <Download size={14} strokeWidth={1.5} />
                            Excel (XLSX)
                          </button>
                        </div>
                      </article>
                    </ScrollReveal>
                  )}

                  {deliverables.hasTeam && (
                    <ScrollReveal variant="slide-up" delay={150}>
                      <article
                        className="card-invert"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "1.5rem",
                          padding: "1.25rem 1.5rem",
                          border: "1px solid #0A1C16",
                          transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      >
                        <div
                          style={{
                            width: "56px", height: "56px", flexShrink: 0,
                            border: "1px solid currentColor", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            transition: "border-color 0.4s ease",
                            clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)",
                          }}
                        >
                          <Users size={26} strokeWidth={1} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.3rem", letterSpacing: "-0.01em" }}>
                            Team Architecture (Excel)
                          </p>
                          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.85rem", opacity: 0.65, marginTop: "0.25rem", lineHeight: 1.5, fontWeight: 300 }}>
                            Staffing, resource allocation, and project timeline.
                          </p>
                        </div>
                        <button
                          onClick={() => exportTeamExcel(deliverables.teamData)}
                          style={{
                            flexShrink: 0,
                            padding: "0.75rem 1.5rem",
                            border: "1px solid currentColor",
                            background: "transparent",
                            fontFamily: "var(--font-display)", fontSize: "0.75rem",
                            letterSpacing: "0.15em", textTransform: "uppercase",
                            display: "flex", alignItems: "center", gap: "0.5rem",
                            transition: "all 0.3s ease",
                            cursor: "pointer",
                            clipPath: "polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))",
                          }}
                        >
                          <Download size={16} strokeWidth={1.5} />
                          Export Excel
                        </button>
                      </article>
                    </ScrollReveal>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    minHeight: "320px", display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "100px", height: "100px", border: "1px solid rgba(10,28,22,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2rem",
                      clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)",
                    }}
                  >
                    <Lock size={36} strokeWidth={1} style={{ opacity: 0.3 }} />
                  </div>
                  <p className="text-eyebrow" style={{ opacity: 0.4, marginBottom: "0.75rem" }}>Awaiting Generation</p>
                  <h3
                    style={{
                      fontFamily: "var(--font-display)", fontWeight: 300,
                      fontSize: "1.8rem", color: "#0A1C16", letterSpacing: "-0.02em",
                    }}
                  >
                    Assets are currently{" "}
                    <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400 }}>locked.</em>
                  </h3>
                  <p style={{ fontFamily: "var(--font-sans)", color: "rgba(10,28,22,0.55)", marginTop: "1rem", lineHeight: 1.75, fontWeight: 300, maxWidth: "360px", fontSize: "0.9rem" }}>
                    Proceed through intake, team design, and costing stages to synthesise and unlock your project artifacts.
                  </p>
                </div>
              )}
            </article>
          </ScrollReveal>

          {/* ── RIGHT: Context & Nav ── */}
          <ScrollReveal variant="slide-right" delay={150}>
            <article
              style={{
                border: "1px solid rgba(10,28,22,0.3)",
                background: "rgba(196,215,201,0.15)",
                padding: "1.5rem",
                clipPath: "polygon(0 0, calc(100% - 28px) 0, 100% 28px, 100% 100%, 0 100%)",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", borderBottom: "1px solid rgba(10,28,22,0.15)", paddingBottom: "0.75rem", marginBottom: "1rem" }}>
                <div
                  style={{
                    width: "40px", height: "40px", border: "1px solid rgba(10,28,22,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
                  }}
                >
                  <FolderOutput size={18} strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-eyebrow" style={{ opacity: 0.4, marginBottom: "0.2rem" }}>Workflow Access</p>
                  <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.2rem", letterSpacing: "-0.01em" }}>
                    Downloads from completed stages
                  </h2>
                </div>
              </div>

              {/* Stage list */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {LOCKED_ITEMS.map((item, i) => {
                  const Icon = item.icon;
                  const isUnlocked =
                    (item.title === "SRS Workbook" && deliverables.hasSrs) ||
                    (item.title === "Team Architecture" && deliverables.hasTeam);
                  return (
                    <div
                      key={item.title}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: "1rem",
                        padding: "0.75rem 0",
                        borderBottom: i < LOCKED_ITEMS.length - 1 ? "1px solid rgba(10,28,22,0.1)" : "none",
                      }}
                    >
                      <div
                        style={{
                          width: "36px", height: "36px", flexShrink: 0,
                          border: `1px solid ${isUnlocked ? "#0A1C16" : "rgba(10,28,22,0.2)"}`,
                          background: isUnlocked ? "#0A1C16" : "transparent",
                          color: isUnlocked ? "#EBEBEB" : "rgba(10,28,22,0.4)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.3s ease",
                          clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                        }}
                      >
                        <Icon size={16} strokeWidth={1.5} />
                      </div>
                      <div>
                        <p
                          style={{
                            fontFamily: "var(--font-display)", fontWeight: 400,
                            fontSize: "1rem", color: isUnlocked ? "#0A1C16" : "rgba(10,28,22,0.5)",
                          }}
                        >
                          {item.title}
                          {isUnlocked && (
                            <span
                              style={{
                                marginLeft: "0.6rem", fontFamily: "var(--font-display)",
                                fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase",
                                color: "#0A1C16", opacity: 0.5,
                              }}
                            >
                              · Ready
                            </span>
                          )}
                        </p>
                        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.8rem", color: "rgba(10,28,22,0.45)", marginTop: "0.25rem", lineHeight: 1.6, fontWeight: 300 }}>
                          {item.copy}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Nav buttons */}
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  onClick={() => router.push("/input")}
                  style={{
                    width: "100%", padding: "1rem",
                    border: "1px solid rgba(10,28,22,0.3)", background: "transparent",
                    fontFamily: "var(--font-display)", fontSize: "0.75rem",
                    letterSpacing: "0.15em", textTransform: "uppercase", color: "#0A1C16",
                    transition: "all 0.25s ease",
                    clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
                  }}
                  className="card-invert"
                >
                  Start from Intake
                </button>
                <button
                  onClick={() => router.push("/team-design")}
                  style={{
                    width: "100%", padding: "1rem",
                    background: "#0A1C16", border: "none",
                    fontFamily: "var(--font-display)", fontSize: "0.75rem",
                    letterSpacing: "0.15em", textTransform: "uppercase", color: "#EBEBEB",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
                    clipPath: "polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))",
                    transition: "opacity 0.25s ease",
                  }}
                >
                  Open Team Allocation
                  <ArrowRight size={16} strokeWidth={1.5} />
                </button>
              </div>
            </article>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
