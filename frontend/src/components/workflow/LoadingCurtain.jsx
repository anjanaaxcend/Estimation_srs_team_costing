"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useWorkflow } from "@/context/WorkflowContext";

const SRS_MESSAGES = [
  "Analyzing your project brief...",
  "Extracting functional requirements...",
  "Mapping user experience flows...",
  "Structuring system modules...",
];

const TEAM_MESSAGES = [
  "Reading approved SRS modules and feature specifications...",
  "Analyzing complexity levels for each component...",
  "Generating optimal staffing requirements from roster...",
  "Recalculating project engineering hours and timelines...",
];

const COST_MESSAGES = [
  "Extracting staffing hours and resources...",
  "Calculating regional pay scales...",
  "Analyzing licensing and support costs...",
  "Finalizing master budget matrix...",
];

export function LoadingCurtain() {
  const { isProcessing } = useWorkflow();
  const pathname = usePathname();
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isProcessing) {
      setVisible(true);
      setLoadingPhase(0);
    }
  }, [isProcessing]);

  const isTeamDesign = pathname?.startsWith("/team-design");
  const isCost = pathname?.startsWith("/cost-estimation");

  const headerText = isTeamDesign
    ? "Synthesizing Staffing Model"
    : isCost
      ? "Calculating Cost Model"
      : "Synthesizing Requirements";

  const subText = isTeamDesign
    ? "Staffing - Roles - Effort"
    : isCost
      ? "Budget - Rates - Licensing"
      : "SRS - Architecture - Modules";

  const loadingMessages = useMemo(() => {
    if (isTeamDesign) return TEAM_MESSAGES;
    if (isCost) return COST_MESSAGES;
    return SRS_MESSAGES;
  }, [isTeamDesign, isCost]);

  useEffect(() => {
    if (!isProcessing) return undefined;
    const id = setInterval(() => {
      setLoadingPhase((phase) => (phase + 1) % loadingMessages.length);
    }, 2500);
    return () => clearInterval(id);
  }, [isProcessing, loadingMessages]);

  if (!isProcessing && !visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        background: "#F5F3EE",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: isProcessing ? 1 : 0,
        transition: "opacity 0.55s ease",
        pointerEvents: isProcessing ? "all" : "none",
        padding: "2rem",
      }}
      onTransitionEnd={() => {
        if (!isProcessing) setVisible(false);
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(10,28,22,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(10,28,22,0.035) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: "600px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "2rem",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100px",
            height: "100px",
            border: "1px solid #0A1C16",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)",
            background: "rgba(196,215,201,0.2)",
          }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              width: "70px",
              height: "70px",
              border: "1px dashed rgba(10,28,22,0.3)",
            }}
          />
          <Loader2 size={36} className="animate-spin text-parcelles-dark" strokeWidth={1} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p
            className="text-eyebrow"
            style={{
              color: "rgba(10,28,22,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              fontSize: "0.75rem",
              margin: 0,
            }}
          >
            Estimator AI Active - {subText}
          </p>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 300,
              fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
              color: "#0A1C16",
              letterSpacing: "-0.01em",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            {headerText}
          </h2>

          <AnimatePresence mode="wait">
            <motion.p
              key={loadingPhase}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 0.75, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "1.1rem",
                color: "#0A1C16",
                marginTop: "0.5rem",
                minHeight: "2rem",
                lineHeight: 1.5,
              }}
            >
              "{loadingMessages[loadingPhase]}"
            </motion.p>
          </AnimatePresence>
        </div>

        <div
          style={{
            width: "180px",
            height: "1px",
            background: "rgba(10,28,22,0.15)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <motion.div
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, transparent, #0A1C16, transparent)",
              width: "60%",
            }}
          />
        </div>
      </div>
    </div>
  );
}
