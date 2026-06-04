"use client";

import { ScrollReveal } from "@/components/ui/ScrollReveal";

export function PageIntro({ eyebrow, title, titleItalic, copy, aside }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: aside ? "1fr minmax(280px, 380px)" : "1fr",
        gap: "3rem",
        alignItems: "end",
        borderBottom: "1px solid #0A1C16",
        paddingBottom: "1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Eyebrow */}
        <ScrollReveal variant="slide-left" delay={0}>
          <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.5)" }}>
            {eyebrow}
          </p>
        </ScrollReveal>

        {/* Title */}
        <ScrollReveal variant="slide-up" delay={80}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 300,
              fontSize: "clamp(1.6rem, 3vw, 2.8rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "#0A1C16",
            }}
          >
            {title}
            {titleItalic && (
              <>
                {" "}
                <em
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    opacity: 0.65,
                  }}
                >
                  {titleItalic}
                </em>
              </>
            )}
          </h1>
        </ScrollReveal>

        {/* Copy */}
        {copy && (
          <ScrollReveal variant="slide-up" delay={160}>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.9rem",
                maxWidth: "640px",
                color: "rgba(10,28,22,0.7)",
                lineHeight: 1.7,
                fontWeight: 300,
              }}
            >
              {copy}
            </p>
          </ScrollReveal>
        )}
      </div>

      {/* Aside block */}
      {aside && (
        <ScrollReveal variant="slide-right" delay={220}>
          <div
            style={{
              background: "#0A1C16",
              color: "#EBEBEB",
              padding: "2rem",
              clipPath:
                "polygon(0 0, 100% 0, 100% 100%, 24px 100%, 0 calc(100% - 24px))",
            }}
          >
            {aside}
          </div>
        </ScrollReveal>
      )}
    </section>
  );
}
