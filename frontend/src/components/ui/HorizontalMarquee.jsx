"use client";

import { useEffect, useRef } from "react";

/**
 * HorizontalMarquee — a horizontal scrolling ticker.
 * Matches the infinite scrolling text banners used on Collectif Parcelles.
 * @param {string[]} items — array of strings to display
 * @param {number} speed — px/s speed of the marquee
 * @param {string} separator — separator between items
 * @param {boolean} reverse — scroll direction
 */
export function HorizontalMarquee({
  items = [],
  speed = 60,
  separator = "·",
  reverse = false,
  className = "",
  itemClassName = "",
}) {
  const trackRef = useRef(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const totalWidth = track.scrollWidth / 2;
    let start = null;
    let raf;

    const step = (timestamp) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const px = (elapsed / 1000) * speed;
      const offset = reverse ? -(totalWidth - (px % totalWidth)) : -(px % totalWidth);
      track.style.transform = `translateX(${offset}px)`;
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [speed, reverse]);

  const combined = [...items, ...items]; // duplicate for seamless loop

  return (
    <div
      className={`overflow-hidden whitespace-nowrap select-none ${className}`}
      aria-hidden="true"
    >
      <div ref={trackRef} className="inline-flex gap-0 will-change-transform">
        {combined.map((item, i) => (
          <span key={i} className={`inline-flex items-center gap-8 ${itemClassName}`}>
            <span>{item}</span>
            <span className="opacity-40 text-lg">{separator}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
