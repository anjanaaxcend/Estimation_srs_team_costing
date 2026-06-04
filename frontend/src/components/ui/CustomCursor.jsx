"use client";

import { useEffect, useRef, useState } from "react";

export function CustomCursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const pos = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const rafRef = useRef(null);

  useEffect(() => {
    const dot = dotRef.current;
    const ringEl = ringRef.current;
    if (!dot || !ringEl) return;

    const onMove = (e) => {
      pos.current = { x: e.clientX, y: e.clientY };
      dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    };

    const animate = () => {
      const ease = 0.12;
      ring.current.x += (pos.current.x - ring.current.x) * ease;
      ring.current.y += (pos.current.y - ring.current.y) * ease;
      ringEl.style.transform = `translate(${ring.current.x}px, ${ring.current.y}px) translate(-50%, -50%)`;
      rafRef.current = requestAnimationFrame(animate);
    };

    const onEnter = (e) => {
      const el = e.target;
      if (el.matches("a, button, [data-cursor-hover], input, textarea, label, select")) {
        setIsHovering(true);
      }
    };

    const onLeave = (e) => {
      const el = e.target;
      if (el.matches("a, button, [data-cursor-hover], input, textarea, label, select")) {
        setIsHovering(false);
      }
    };

    const onDown = () => setIsClicking(true);
    const onUp = () => setIsClicking(false);

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseover", onEnter);
    document.addEventListener("mouseout", onLeave);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onEnter);
      document.removeEventListener("mouseout", onLeave);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      {/* Dot — snaps instantly */}
      <div
        ref={dotRef}
        className="cursor-dot"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 9999,
          width: isClicking ? "6px" : "8px",
          height: isClicking ? "6px" : "8px",
          borderRadius: "50%",
          background: "var(--color-parcelles-dark, #0A1C16)",
          transition: "width 0.15s ease, height 0.15s ease",
          willChange: "transform",
        }}
      />
      {/* Ring — follows with lag */}
      <div
        ref={ringRef}
        className="cursor-ring"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 9998,
          width: isHovering ? "56px" : (isClicking ? "28px" : "36px"),
          height: isHovering ? "56px" : (isClicking ? "28px" : "36px"),
          borderRadius: "50%",
          border: "1.5px solid var(--color-parcelles-dark, #0A1C16)",
          background: isHovering ? "rgba(10,28,22,0.08)" : "transparent",
          transition: "width 0.35s cubic-bezier(0.16,1,0.3,1), height 0.35s cubic-bezier(0.16,1,0.3,1), background 0.3s ease",
          willChange: "transform",
          mixBlendMode: "multiply",
        }}
      />
    </>
  );
}
