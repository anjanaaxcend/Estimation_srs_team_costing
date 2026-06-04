"use client";

import Link from "next/link";
import { ArrowRight, FileSpreadsheet, Users, LayoutList } from "lucide-react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { HorizontalMarquee } from "@/components/ui/HorizontalMarquee";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { PageTransition } from "@/components/ui/PageTransition";
import { useAuth } from "@/context/AuthContext";

const MARQUEE_ITEMS = [
  "SRS Architecture",
  "Team Allocation",
  "Cost Estimation",
  "AI-Powered Planning",
  "Requirement Synthesis",
  "Sprint Timelines",
];

const PHASES = [
  {
    href: "/input",
    number: "01",
    title: "SRS Architecture",
    italic: "Intelligence",
    copy: "Upload your raw brief. The engine extracts requirements, maps UI experiences, and builds a comprehensive Software Requirements Specification.",
    icon: FileSpreadsheet,
    tag: "Intake → Synthesis",
  },
  {
    href: "/team-design",
    number: "02",
    title: "Team Allocation",
    italic: "Structure",
    copy: "Translate technical scope into concrete human effort. Allocate senior and junior roles across sprint timelines with precision.",
    icon: Users,
    tag: "Architecture → People",
  },
  {
    href: "/cost-estimation",
    number: "03",
    title: "Cost Estimation",
    italic: "Clarity",
    copy: "Finalize project budgets. Apply automated profit margins and export timelines and costs to professional deliverables.",
    icon: LayoutList,
    tag: "Projection → Export",
  },
];

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <>
      <PageTransition />

      <div className="w-full flex flex-col">

        {/* ─────────────── HERO ─────────────── */}
        <section className="relative w-full h-screen min-h-[640px] p-4 sm:p-8 lg:p-12 pb-0 flex flex-col justify-end overflow-hidden">

          {/* Dark hero panel with editorial clip */}
          <div className="w-full h-full relative overflow-hidden bg-parcelles-dark hero-clip flex flex-col items-center justify-center">

            {/* Subtle grid background texture */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(rgba(196,215,201,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(196,215,201,0.06) 1px, transparent 1px)",
                backgroundSize: "60px 60px",
                pointerEvents: "none",
              }}
            />

            {/* Animated radial glow */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse 70% 60% at 50% 60%, rgba(196,215,201,0.12) 0%, transparent 70%)",
                animation: "sage-pulse 10s ease infinite",
                pointerEvents: "none",
              }}
            />

            {/* Phase label — top left */}
            <div
              style={{
                position: "absolute",
                top: "2rem",
                left: "2rem",
                color: "rgba(235,235,235,0.4)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "0.85rem",
                letterSpacing: "0.1em",
              }}
            >
              est. 2024
            </div>

            {/* Top-right auth navigation */}
            <div
              style={{
                position: "absolute",
                top: "1.75rem",
                right: "2rem",
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                zIndex: 10,
              }}
            >
              {user ? (
                <>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.65rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "rgba(235,235,235,0.45)",
                    }}
                  >
                    {user.name || user.email}
                  </span>
                  <Link
                    href="/dashboard"
                    style={{
                      padding: "0.45rem 1.1rem",
                      border: "1px solid rgba(142,196,160,0.6)",
                      background: "rgba(142,196,160,0.12)",
                      color: "#8EC4A0",
                      fontFamily: "var(--font-display)",
                      fontSize: "0.62rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      textDecoration: "none",
                      transition: "background 0.2s ease, border-color 0.2s ease",
                    }}
                    className="hover-line"
                  >
                    Dashboard →
                  </Link>
                  <button
                    onClick={logout}
                    style={{
                      padding: "0.45rem 1.1rem",
                      border: "1px solid rgba(235,235,235,0.3)",
                      background: "transparent",
                      color: "rgba(235,235,235,0.7)",
                      fontFamily: "var(--font-display)",
                      fontSize: "0.62rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      transition: "all 0.2s ease",
                      cursor: "pointer",
                    }}
                    className="hover-line"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.62rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "rgba(235,235,235,0.5)",
                      textDecoration: "none",
                      transition: "color 0.2s ease",
                    }}
                    className="hover-line"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    style={{
                      padding: "0.45rem 1.1rem",
                      border: "1px solid rgba(142,196,160,0.5)",
                      background: "transparent",
                      color: "#8EC4A0",
                      fontFamily: "var(--font-display)",
                      fontSize: "0.62rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      textDecoration: "none",
                      transition: "background 0.2s ease",
                    }}
                    className="hover-line"
                  >
                    Register
                  </Link>
                </>
              )}
            </div>

            {/* Main hero text */}
            <div className="relative z-10 text-center flex flex-col items-center gap-8 px-4">
              {/* Eyebrow */}
              <ScrollReveal variant="fade" delay={200}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: "rgba(196,215,201,0.7)",
                    display: "block",
                  }}
                >
                  AI-Native Project Intelligence
                </span>
              </ScrollReveal>

              {/* Giant headline */}
              <ScrollReveal variant="slide-up" delay={320}>
                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 300,
                    fontSize: "clamp(2.5rem, 6vw, 6rem)",
                    lineHeight: 0.95,
                    letterSpacing: "-0.04em",
                    color: "#EBEBEB",
                  }}
                >
                  Scope
                  <br />
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontWeight: 400,
                      color: "#8EC4A0",
                    }}
                  >
                    Sense
                  </span>
                  <br />
                  AI.
                </h1>
              </ScrollReveal>

              {/* Sub-headline */}
              <ScrollReveal variant="slide-up" delay={500}>
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "clamp(1rem, 2vw, 1.2rem)",
                    color: "rgba(235,235,235,0.55)",
                    maxWidth: "480px",
                    lineHeight: 1.65,
                    fontWeight: 300,
                  }}
                >
                  Between raw ambition and structured execution —<br />
                  ScopeSense bridges the gap.
                </p>
              </ScrollReveal>

              {/* CTA — adapts to auth state */}
              <ScrollReveal variant="slide-up" delay={650}>
                <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap", justifyContent: "center" }}>
                  <Link
                    href={user ? "/input" : "/login"}
                    className="btn-arrow hover-line"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.9rem",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#EBEBEB",
                      paddingBottom: "4px",
                      borderBottom: "1px solid rgba(235,235,235,0.3)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.75rem",
                    }}
                  >
                    {user ? "Begin Project Intake" : "Get Started"}
                    <ArrowRight size={18} />
                  </Link>
                  {!user && (
                    <Link
                      href="/register"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.75rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(235,235,235,0.4)",
                        textDecoration: "none",
                      }}
                    >
                      Create Account
                    </Link>
                  )}
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>



        {/* ─────────────── PHILOSOPHY ─────────────── */}
        <section
          style={{
            background: "#8EC4A0",
            padding: "clamp(3rem, 6vw, 4.5rem) clamp(1.5rem, 6vw, 6rem)",
          }}
        >
          <div style={{ maxWidth: "1400px", margin: "0 auto" }}>

            {/* Section tag */}
            <ScrollReveal variant="slide-left" delay={0}>
              <div className="section-tag mb-6">
                <span className="phase-number">00</span>
                <span>Our Approach</span>
              </div>
            </ScrollReveal>

            {/* Large editorial quote */}
            <ScrollReveal variant="slide-up" delay={100}>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 300,
                  fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
                  lineHeight: 1.1,
                  letterSpacing: "-0.025em",
                  color: "#0A1C16",
                  maxWidth: "900px",
                  marginBottom: "2rem",
                }}
              >
                Between raw ambition{" "}
                <em
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                  }}
                >
                  and structured
                </em>{" "}
                execution, ScopeSense AI bridges the gap.
              </h2>
            </ScrollReveal>

            {/* Divider */}
            <div className="divider-horizontal-solid mb-6" style={{ opacity: 0.2 }} />

            {/* Stats row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "3rem",
              }}
            >
              {[
                { value: 3, suffix: "", label: "AI-Powered Phases" },
                { value: 100, suffix: "%", label: "Requirement Coverage" },
                { value: 10, suffix: "×", label: "Faster Than Manual" },
              ].map((stat, i) => (
                <ScrollReveal key={stat.label} variant="slide-up" delay={i * 100}>
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 300,
                        fontSize: "clamp(1.8rem, 3.5vw, 3rem)",
                        letterSpacing: "-0.04em",
                        lineHeight: 1,
                        color: "#0A1C16",
                      }}
                    >
                      <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                    </div>
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.8rem",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        color: "rgba(10,28,22,0.55)",
                        marginTop: "0.5rem",
                      }}
                    >
                      {stat.label}
                    </p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────────── WORKFLOW PHASES ─────────────── */}
        <section
          style={{
            background: "#EBEBEB",
            padding: "clamp(3rem, 6vw, 4.5rem) clamp(1.5rem, 6vw, 6rem)",
          }}
        >
          <div style={{ maxWidth: "1400px", margin: "0 auto" }}>

            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "3rem",
                marginBottom: "2.5rem",
                alignItems: "end",
              }}
            >
              <ScrollReveal variant="slide-up" delay={0}>
                <div className="section-tag mb-6">
                  <span className="phase-number">01–03</span>
                  <span>Platform Workflow</span>
                </div>
                <h2
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 300,
                    fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
                    lineHeight: 0.95,
                    letterSpacing: "-0.03em",
                    color: "#0A1C16",
                  }}
                >
                  Three phases.
                  <br />
                  <em
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontWeight: 400,
                    }}
                  >
                    One platform.
                  </em>
                </h2>
              </ScrollReveal>

              <ScrollReveal variant="slide-right" delay={150}>
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "1.05rem",
                    lineHeight: 1.7,
                    color: "rgba(10,28,22,0.7)",
                    fontWeight: 300,
                    paddingTop: "0.5rem",
                  }}
                >
                  Transform unstructured ideas into precise software requirements,
                  optimised team allocations, and accurate cost estimations — all
                  without leaving a single platform.
                </p>
              </ScrollReveal>
            </div>

            {/* Phase cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1px", border: "1px solid #0A1C16" }}>
              {PHASES.map((phase, i) => {
                const Icon = phase.icon;
                return (
                  <ScrollReveal key={phase.number} variant="slide-up" delay={i * 120} className="w-full">
                    <Link
                      href={phase.href}
                      className="card-invert hover-overline"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr auto",
                        alignItems: "center",
                        gap: "2rem",
                        padding: "1.5rem 2rem",
                        textDecoration: "none",
                        borderBottom: i < PHASES.length - 1 ? "1px solid #0A1C16" : "none",
                      }}
                    >
                      {/* Number */}
                      <div
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: "3.5rem",
                          color: "rgba(10,28,22,0.25)",
                          lineHeight: 1,
                          userSelect: "none",
                        }}
                      >
                        {phase.number}
                      </div>

                      {/* Content */}
                      <div>
                        <p
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: "0.65rem",
                            letterSpacing: "0.2em",
                            textTransform: "uppercase",
                            opacity: 0.5,
                            marginBottom: "0.5rem",
                          }}
                        >
                          {phase.tag}
                        </p>
                        <h3
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: 300,
                            fontSize: "clamp(1rem, 2vw, 1.75rem)",
                            letterSpacing: "-0.02em",
                            lineHeight: 1.1,
                            marginBottom: "0.75rem",
                          }}
                        >
                          {phase.title}{" "}
                          <em
                            style={{
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                              fontWeight: 400,
                              opacity: 0.6,
                            }}
                          >
                            — {phase.italic}
                          </em>
                        </h3>
                        <p
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "0.9rem",
                            lineHeight: 1.7,
                            opacity: 0.65,
                            fontWeight: 300,
                            maxWidth: "560px",
                          }}
                        >
                          {phase.copy}
                        </p>
                      </div>

                      {/* Arrow */}
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          border: "1px solid currentColor",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "transform 0.3s var(--ease-out-expo)",
                        }}
                        className="chamfer-bottom-right"
                      >
                        <ArrowRight size={20} strokeWidth={1.5} />
                      </div>
                    </Link>
                  </ScrollReveal>
                );
              })}
            </div>
          </div>
        </section>



        {/* ─────────────── CALL TO ACTION ─────────────── */}
        <section
          style={{
            background: "#0A1C16",
            padding: "clamp(3.5rem, 7vw, 5rem) clamp(1.5rem, 6vw, 6rem)",
          }}
        >
          <div
            style={{
              maxWidth: "1400px",
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4rem",
              alignItems: "center",
            }}
          >
            <ScrollReveal variant="slide-up" delay={0}>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 300,
                  fontSize: "clamp(1.5rem, 3vw, 2.75rem)",
                  lineHeight: 0.95,
                  letterSpacing: "-0.03em",
                  color: "#EBEBEB",
                }}
              >
                Ready to{" "}
                <em
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    color: "#8EC4A0",
                  }}
                >
                  plan?
                </em>
              </h2>
            </ScrollReveal>

            <ScrollReveal variant="slide-right" delay={200}>
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "1rem",
                    lineHeight: 1.7,
                    color: "rgba(235,235,235,0.55)",
                    fontWeight: 300,
                  }}
                >
                  Upload your raw project brief, let the AI extract and structure
                  every requirement, then move seamlessly through team and cost
                  planning — all in one workflow.
                </p>

                <Link
                  href="/input"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "2rem",
                    padding: "1.1rem 1.75rem",
                    background: "#8EC4A0",
                    color: "#0A1C16",
                    textDecoration: "none",
                    fontFamily: "var(--font-display)",
                    fontSize: "0.95rem",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontWeight: 500,
                    transition: "background 0.3s ease, gap 0.3s ease",
                  }}
                  className="chamfer-bottom-left btn-arrow"
                >
                  Start Project Intake
                  <ArrowRight size={22} strokeWidth={1.5} />
                </Link>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ─────────────── FOOTER ─────────────── */}
        <footer
          style={{
            borderTop: "1px solid rgba(10,28,22,0.15)",
            padding: "1.25rem clamp(1.5rem, 6vw, 6rem)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
            background: "#EBEBEB",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "0.85rem",
              color: "rgba(10,28,22,0.4)",
            }}
          >
            ScopeSense AI © 2024
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "0.65rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(10,28,22,0.3)",
            }}
          >
            Intelligent Planning System
          </span>
        </footer>

      </div>
    </>
  );
}
