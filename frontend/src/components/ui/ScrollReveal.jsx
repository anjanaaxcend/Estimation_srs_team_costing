"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ScrollReveal — wraps any children in a scroll-triggered reveal.
 * @param {string} variant — "slide-up" | "slide-left" | "fade" | "clip-reveal" | "scale-in"
 * @param {number} delay — delay in ms before animation starts
 * @param {number} threshold — 0–1, how much of the element needs to be visible
 */
export function ScrollReveal({
  children,
  variant = "slide-up",
  delay = 0,
  threshold = 0.15,
  className = "",
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fallback = window.setTimeout(() => {
      setVisible(true);
    }, 350);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          window.clearTimeout(fallback);
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, [threshold]);

  const getStyle = () => {
    const base = {
      transitionDuration: "0.8s",
      transitionDelay: `${delay}ms`,
      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
    };

    if (!visible) {
      switch (variant) {
        case "slide-up":
          return { ...base, opacity: 0, transform: "translateY(40px)" };
        case "slide-left":
          return { ...base, opacity: 0, transform: "translateX(-30px)" };
        case "slide-right":
          return { ...base, opacity: 0, transform: "translateX(30px)" };
        case "fade":
          return { ...base, opacity: 0 };
        case "clip-reveal":
          return {
            ...base,
            clipPath: "inset(0 100% 0 0)",
            transitionDuration: "1s",
          };
        case "scale-in":
          return { ...base, opacity: 0, transform: "scale(0.92)" };
        default:
          return { ...base, opacity: 0 };
      }
    }

    return {
      ...base,
      opacity: 1,
      transform: "none",
      clipPath: variant === "clip-reveal" ? "inset(0 0% 0 0)" : undefined,
    };
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        transitionProperty: "opacity, transform, clip-path",
        willChange: "opacity, transform",
        ...getStyle(),
      }}
    >
      {children}
    </div>
  );
}

/**
 * SplitTextReveal — animates each word as a separate scroll-revealed element
 * Matches the word-by-word reveal on Collectif Parcelles hero text
 */
export function SplitTextReveal({ text, className = "", baseDelay = 0, tag: Tag = "span" }) {
  const words = text.split(" ");

  return (
    <Tag className={className} style={{ display: "inline" }}>
      {words.map((word, i) => (
        <ScrollReveal
          key={i}
          variant="slide-up"
          delay={baseDelay + i * 60}
          threshold={0.1}
          className="inline-block mr-[0.25em]"
        >
          {word}
        </ScrollReveal>
      ))}
    </Tag>
  );
}
