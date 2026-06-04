"use client";

import { useEffect, useState } from "react";

/**
 * AuthTransition — a custom, distinct curtain wipe specifically for the login 
 * and registration pages. Plays a cinematic vertical split or bottom-up wipe.
 */
export function AuthTransition() {
  const [phase, setPhase] = useState("entering"); // entering → revealed → exited

  useEffect(() => {
    // Panel slides up to reveal
    const t1 = setTimeout(() => setPhase("revealed"), 50);
    const t2 = setTimeout(() => setPhase("exited"), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === "exited") return null;

  return (
    <>
      {/* Primary dark curtain sweeping UP */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 8999,
          background: "#0A1C16",
          transformOrigin: "top center",
          transform: phase === "entering"
            ? "scaleY(1)"
            : "scaleY(0)",
          transition: "transform 0.85s cubic-bezier(0.76, 0, 0.24, 1)",
          pointerEvents: phase !== "exited" ? "all" : "none",
        }}
      />
      {/* Accent sage sliver sweeping UP slightly delayed */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9000,
          background: "#8EC4A0",
          transformOrigin: "top center",
          transform: phase === "entering"
            ? "scaleY(1)"
            : "scaleY(0)",
          transition: "transform 0.75s cubic-bezier(0.76, 0, 0.24, 1) 0.1s",
          pointerEvents: "none",
        }}
      />
      {/* Typography overlay that fades out as curtain raises */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9001,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: phase === "entering" ? 1 : 0,
          transition: "opacity 0.4s ease 0.1s",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "0.85rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#EBEBEB",
            opacity: 0.8,
          }}
        >
          Secure Session
        </span>
      </div>
    </>
  );
}
