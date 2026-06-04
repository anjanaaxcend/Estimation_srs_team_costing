"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const routeMessages = {
  "/": "I turn briefs into build-ready plans, teams, and budgets.",
  "/services": "Pick a lane or run the full planning chain end to end.",
  "/input": "Drop the brief here and I will shape the first blueprint.",
  "/srs": "Review the extraction carefully. Once approved, I carry this exact scope into staffing.",
  "/download": "Download the blueprint here, then continue with the same approved SRS in team allocation.",
  "/team-design": "Adjust the staffing mix if needed. When you approve it, I seed costing with these exact roles.",
  "/cost-estimation": "Export only the deliverables that exist: SRS, team allocation, cost estimation, or any valid combination.",
};

export function AstraBot() {
  const pathname = usePathname();
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const message = useMemo(() => routeMessages[pathname] || routeMessages["/"], [pathname]);

  useEffect(() => {
    const handleMove = (event) => {
      const normalizedX = (event.clientX / window.innerWidth - 0.5) * 20;
      const normalizedY = (event.clientY / window.innerHeight - 0.5) * 20;
      setPointer({ x: normalizedX, y: normalizedY });
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div className="astra-bot pointer-events-none fixed bottom-6 right-4 z-30 hidden lg:block">
      <div className="astra-bot-bubble">
        <span className="astra-bot-label">Astra</span>
        <p>{message}</p>
      </div>
      <div
        className="astra-bot-stage"
        style={{
          transform: `translate3d(${pointer.x}px, ${pointer.y * -0.35}px, 0) rotateX(${pointer.y * -0.25}deg) rotateY(${pointer.x * 0.35}deg)`,
        }}
      >
        <div className="astra-bot-halo" />
        <div className="astra-bot-core">
          <div className="astra-bot-head">
            <div className="astra-bot-face">
              <span className="astra-bot-eye" />
              <span className="astra-bot-eye" />
            </div>
          </div>
          <div className="astra-bot-torso">
            <div className="astra-bot-heart" />
          </div>
          <div className="astra-bot-arm astra-bot-arm-left" />
          <div className="astra-bot-arm astra-bot-arm-right" />
          <div className="astra-bot-leg astra-bot-leg-left" />
          <div className="astra-bot-leg astra-bot-leg-right" />
        </div>
      </div>
    </div>
  );
}
