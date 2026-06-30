"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { getApprovedSRS } from "@/lib/platformApi";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

export default function HistoryPage() {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState(user);
  const { loadApprovedSrs } = useWorkflow();
  const [approvedBlueprints, setApprovedBlueprints] = useState([]);
  const [isLoadingBlueprints, setIsLoadingBlueprints] = useState(false);

  useEffect(() => {
    setProfile(user);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    refreshUser().then((nextUser) => {
      if (nextUser) {
        setProfile(nextUser);
      }
    });

    setIsLoadingBlueprints(true);
    getApprovedSRS()
      .then((data) => {
        if (Array.isArray(data)) {
          setApprovedBlueprints(data);
        }
      })
      .catch((err) => console.error("Failed to load approved blueprints", err))
      .finally(() => setIsLoadingBlueprints(false));
  }, [refreshUser, user]);

  if (!profile) {
    return null; // or a loading spinner, AuthContext handles redirection
  }

  const history = [...(profile.history || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="w-full min-h-screen bg-[var(--bg-primary)] pb-12" style={{ paddingTop: "clamp(4.25rem, 5.5vw, 5rem)", paddingLeft: "clamp(1.5rem, 5vw, 5rem)", paddingRight: "clamp(1.5rem, 5vw, 5rem)" }}>
      <div className="max-w-4xl mx-auto">
        <ScrollReveal variant="slide-up">
          <div className="section-tag mb-8" style={{ display: "inline-flex" }}>
            <span className="phase-number">User</span>
            <span>Account History</span>
          </div>
        </ScrollReveal>

        <ScrollReveal variant="slide-up" delay={100}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 300,
              fontSize: "clamp(2rem, 3.5vw, 3.5rem)",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              marginBottom: "1rem",
            }}
          >
            Activity{" "}
            <em
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontWeight: 400,
                color: "var(--color-parcelles-sage)",
              }}
            >
              Log.
            </em>
          </h1>
          <p className="text-sm uppercase tracking-widest text-black/50 mb-12" style={{ fontFamily: "var(--font-display)" }}>
            Tracking SRS activity for {profile.name} ({profile.email})
          </p>
        </ScrollReveal>

        {/* Approved Blueprints Section */}
        <ScrollReveal variant="fade" delay={150}>
          <div className="mb-12">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "var(--text-primary)",
                borderBottom: "1px solid rgba(10,28,22,0.1)",
                paddingBottom: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              Saved SRS Blueprints
            </h2>
            {isLoadingBlueprints ? (
              <p className="text-sm italic" style={{ fontFamily: "var(--font-sans)" }}>Loading blueprints...</p>
            ) : approvedBlueprints.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "1.5rem",
                }}
              >
                {approvedBlueprints.map((bp) => (
                  <div
                    key={bp.id}
                    className="p-6 border border-black/10 chamfer-bottom-right flex flex-col justify-between"
                    style={{
                      background: "rgba(142, 196, 160, 0.1)",
                      borderLeft: "4px solid #8EC4A0",
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 500,
                          fontSize: "1.05rem",
                          color: "#0A1C16",
                          marginBottom: "0.25rem",
                        }}
                      >
                        {bp.project_name}
                      </h3>
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          marginBottom: "1rem",
                        }}
                      >
                        Saved on {new Date(bp.created_at).toLocaleDateString()} at {new Date(bp.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.85rem",
                          color: "var(--text-primary)",
                          opacity: 0.85,
                          marginBottom: "1.5rem",
                          lineHeight: 1.5,
                        }}
                      >
                        {bp.content.sections?.length || 0} specification sections generated using {bp.content.selected_model?.provider || "AI Engine"}.
                      </p>
                    </div>
                    <button
                      onClick={() => loadApprovedSrs(bp)}
                      style={{
                        alignSelf: "flex-start",
                        padding: "0.5rem 1rem",
                        background: "#0A1C16",
                        color: "#EBEBEB",
                        border: "none",
                        fontFamily: "var(--font-display)",
                        fontSize: "0.7rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        fontWeight: 500,
                        cursor: "pointer",
                        borderRadius: "1px",
                        transition: "opacity 0.2s ease",
                        clipPath: "polygon(0 0, 100% 0, 100% 100%, 8px 100%, 0 calc(100% - 8px))",
                      }}
                      className="hover:opacity-90"
                    >
                      Restore Blueprint &rarr;
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center border border-dashed border-black/10">
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                  No approved blueprints saved yet. Finish a project intake to save one!
                </p>
              </div>
            )}
          </div>
        </ScrollReveal>

        <ScrollReveal variant="slide-up" delay={200}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              borderBottom: "1px solid rgba(10,28,22,0.1)",
              paddingBottom: "0.75rem",
              marginBottom: "1.5rem",
              marginTop: "2rem"
            }}
          >
            Activity Log
          </h2>
        </ScrollReveal>

        <ScrollReveal variant="fade" delay={250}>
          {history.length > 0 ? (
            <div className="flex flex-col gap-4">
              {history.map((item, index) => (
                <div 
                  key={index}
                  className="p-6 border border-black/10 chamfer-top-left chamfer-bottom-right"
                  style={{ background: "rgba(196, 215, 201, 0.05)" }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 
                      style={{ 
                        fontFamily: "var(--font-display)", 
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        fontSize: "0.85rem",
                        fontWeight: 600
                      }}
                    >
                      {item.action}
                    </h3>
                    <span 
                      style={{ 
                        fontFamily: "var(--font-sans)", 
                        fontSize: "0.75rem",
                        color: "var(--text-muted)"
                      }}
                    >
                      {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>
                  {(item.project_name || item.provider || item.sections_count) && (
                    <p style={{ fontFamily: "var(--font-display)", fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: item.details ? "0.75rem" : 0 }}>
                      {[item.project_name, item.provider, item.sections_count ? `${item.sections_count} sections` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {item.details && (
                    <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.9rem", color: "var(--text-primary)" }}>
                      {item.details}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center border border-black/10">
              <p style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                No history available yet.
              </p>
            </div>
          )}
        </ScrollReveal>
      </div>
    </div>
  );
}
