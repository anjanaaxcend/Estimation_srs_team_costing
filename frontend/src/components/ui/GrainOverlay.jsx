"use client";

export function GrainOverlay() {
  return (
    <>
      {/* SVG grain filter definition */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
        <defs>
          <filter id="grain-filter" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves="3"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* Grain overlay div */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9000,
          pointerEvents: "none",
          width: "100%",
          height: "100%",
          filter: "url(#grain-filter)",
          opacity: 0.042,
          mixBlendMode: "multiply",
          animation: "grain-shift 0.18s steps(1) infinite",
        }}
      />

      <style>{`
        @keyframes grain-shift {
          0%   { transform: translate(0, 0); }
          10%  { transform: translate(-2%, -3%); }
          20%  { transform: translate(3%, 1%); }
          30%  { transform: translate(-1%, 4%); }
          40%  { transform: translate(4%, -2%); }
          50%  { transform: translate(-3%, 2%); }
          60%  { transform: translate(2%, 3%); }
          70%  { transform: translate(-4%, -1%); }
          80%  { transform: translate(1%, -4%); }
          90%  { transform: translate(3%, 2%); }
          100% { transform: translate(-2%, 1%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .grain-overlay { animation: none !important; }
        }
      `}</style>
    </>
  );
}
