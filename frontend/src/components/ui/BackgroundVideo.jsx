"use client";

import { memo } from "react";

export const BackgroundVideo = memo(function BackgroundVideo() {
  return (
    <div className="fixed inset-0 -z-50 bg-[var(--bg)]">
      {/* Subtle Grain noise texture overlay */}
      <div className="grain-overlay" />
      {/* Light warm paper gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_100%_at_50%_0%,#FFFFFF,transparent_80%)] opacity-60" />
    </div>
  );
});
