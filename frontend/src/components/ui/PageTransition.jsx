"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PageTransition — a curtain wipe that plays on mount, matching 
 * Collectif Parcelles' elegant page transition that wipes in from the side.
 */
export function PageTransition() {
  const [phase, setPhase] = useState("entering"); // entering → revealed → exited

  useEffect(() => {
    // Panel slides in to cover, then slides out to reveal
    const t1 = setTimeout(() => setPhase("revealed"), 50);
    const t2 = setTimeout(() => setPhase("exited"), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === "exited") return null;

  return (
    <>
      {/* Right panel */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 8999,
          background: "#0A1C16",
          transformOrigin: "left center",
          transform: phase === "entering"
            ? "scaleX(1)"
            : "scaleX(0)",
          transition: "transform 0.85s cubic-bezier(0.76, 0, 0.24, 1)",
          pointerEvents: phase !== "exited" ? "all" : "none",
        }}
      />
      {/* Accent sliver */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9000,
          background: "#8EC4A0",
          transformOrigin: "left center",
          transform: phase === "entering"
            ? "scaleX(1)"
            : "scaleX(0)",
          transition: "transform 0.7s cubic-bezier(0.76, 0, 0.24, 1) 0.08s",
          pointerEvents: "none",
          clipPath: "inset(0 0 0 calc(100% - 4px))",
        }}
      />
    </>
  );
}
