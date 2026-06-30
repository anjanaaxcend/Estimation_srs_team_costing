"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageTransition } from "@/components/ui/PageTransition";
import { LoadingCurtain } from "@/components/workflow/LoadingCurtain";
import { useAuth } from "@/context/AuthContext";

const NAV_LINKS = [
  { href: "/input",           label: "Intake",     number: "01" },
  { href: "/srs",             label: "SRS",         number: "02" },
  { href: "/team-design",     label: "Team",        number: "03" },
  { href: "/cost-estimation", label: "Costs",       number: "04" },
];

export function StudioShell({ children }) {
  const pathname = usePathname();

  const { user, logout } = useAuth();
  const router = useRouter();

  // Navigation tracking
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const historyStr = sessionStorage.getItem("scopesense_nav_history");
      let history = historyStr ? JSON.parse(historyStr) : [];
      
      // If history is empty, or the current pathname is different from the last element
      if (history.length === 0 || history[history.length - 1] !== pathname) {
        history.push(pathname);
        if (history.length > 20) {
          history.shift();
        }
        sessionStorage.setItem("scopesense_nav_history", JSON.stringify(history));
      }
    } catch (e) {
      console.error("Failed to update navigation history", e);
    }
  }, [pathname]);

  const handleBack = () => {
    try {
      const historyStr = sessionStorage.getItem("scopesense_nav_history");
      let history = historyStr ? JSON.parse(historyStr) : [];
      
      if (history.length > 1) {
        history.pop();
        const previousPage = history[history.length - 1];
        
        sessionStorage.setItem("scopesense_nav_history", JSON.stringify(history));
        
        if (previousPage) {
          router.push(previousPage);
          return;
        }
      }
    } catch (e) {
      console.error("Failed to pop navigation history", e);
    }
    
    // Fallbacks
    if (pathname === "/srs") {
      router.push("/input");
    } else if (pathname === "/team-design") {
      router.push("/srs");
    } else if (pathname === "/cost-estimation") {
      router.push("/team-design");
    } else if (pathname === "/download") {
      router.push("/cost-estimation");
    } else if (pathname === "/history") {
      router.push("/input");
    } else {
      router.push("/");
    }
  };

  // Don't show the top-right auth button on auth pages — they have their own navigation
  const isAuthPage = pathname === "/login" || pathname === "/register";
  // Don't show on the home page either — it has a clean full-screen hero
  const isHomePage = pathname === "/";

  return (
    <>
      <PageTransition />
      <LoadingCurtain />

      <div
        style={{
          position: "relative",
          display: "flex",
          minHeight: "100vh",
          width: "100%",
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* ── LEFT SIDEBAR ── */}
        <aside
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            height: "100vh",
            width: "clamp(72px, 6vw, 100px)",
            borderRight: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            overflow: "hidden",
            zIndex: 50,
            background: "var(--bg-primary)",
          }}
        >
          {/* Logo — crosshair/scope SVG symbol */}
          <Link
            href="/"
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              background: "#0A1C16",
              color: "#EBEBEB",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textDecoration: "none",
              gap: "1px",
              flexShrink: 0,
              transition: "opacity 0.2s ease",
              clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)",
            }}
            className="hover:opacity-80"
          >
            {/* Scope / crosshair symbol */}
            <svg
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ width: "clamp(22px, 2.4vw, 32px)", height: "clamp(22px, 2.4vw, 32px)" }}
            >
              {/* Document / Page Shape */}
              <path
                d="M 5 3 H 17 L 23 9 V 27 H 5 Z"
                stroke="#8EC4A0"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Document Fold */}
              <path
                d="M 17 3 V 9 H 23"
                stroke="#8EC4A0"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Requirements Lines */}
              <line x1="8" y1="13" x2="17" y2="13" stroke="#8EC4A0" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="8" y1="17" x2="13" y2="17" stroke="#8EC4A0" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="8" y1="21" x2="13" y2="21" stroke="#8EC4A0" strokeWidth="1.5" strokeLinecap="round" />

              {/* Magnifier / Scope (Filled with background color to mask underlying paths) */}
              <circle
                cx="21"
                cy="20"
                r="6.5"
                fill="#0A1C16"
                stroke="#8EC4A0"
                strokeWidth="1.5"
              />
              {/* Magnifier Handle */}
              <line
                x1="25.6"
                y1="24.6"
                x2="29.5"
                y2="28.5"
                stroke="#8EC4A0"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              {/* AI Spark inside the scope */}
              <path
                d="M 21 16.5 Q 21 20 24.5 20 Q 21 20 21 23.5 Q 21 20 17.5 20 Q 21 20 21 16.5 Z"
                fill="#8EC4A0"
              />
            </svg>
          </Link>

          {/* Static vertical text strip */}
          <div
            style={{
              flex: 1,
              position: "relative",
              width: "100%",
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              borderTop: "1px solid rgba(10,28,22,0.15)",
            }}
          >
            <span
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                color: "rgba(10,28,22,0.25)",
                fontSize: "0.55rem",
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                fontFamily: "var(--font-display)",
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
            >
              Estimator AI · SRS · Team · Cost
            </span>
          </div>

          {/* Bottom nav dots */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
              padding: "1.5rem 0",
              alignItems: "center",
            }}
          >
            {NAV_LINKS.map((link) => {
              const active = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={`${link.number} · ${link.label}`}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: active ? "#0A1C16" : "rgba(10,28,22,0.2)",
                    transition: "background 0.3s ease, transform 0.2s ease",
                    display: "block",
                  }}
                  className={active ? "scale-150" : "hover:scale-150"}
                />
              );
            })}
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main
          style={{
            width: "calc(100% - clamp(72px, 6vw, 100px))",
            marginLeft: "clamp(72px, 6vw, 100px)",
            minHeight: "100vh",
            height: isAuthPage ? "100vh" : "auto",
            overflow: isAuthPage ? "hidden" : "visible",
            position: "relative",
            paddingBottom: "5rem",
          }}
        >
          {/* Floating Back Button */}
          {!isHomePage && !isAuthPage && (
            <button
              onClick={handleBack}
              style={{
                position: "absolute",
                top: "1.5rem",
                left: "clamp(1.5rem, 5vw, 5rem)",
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 12px",
                border: "1px solid rgba(10, 28, 22, 0.3)",
                background: "var(--bg-primary)",
                color: "rgba(10, 28, 22, 0.7)",
                fontFamily: "var(--font-display)",
                fontSize: "0.62rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
                borderRadius: "1px",
                transition: "all 0.2s ease",
              }}
              className="hover-line"
            >
              <ArrowLeft size={12} /> Back
            </button>
          )}

          {/* ── FLOATING TOP NAV ── */}
          <div
            style={{
              position: "absolute",
              top: "1.5rem",
              right: "1.5rem",
              zIndex: 50,
              display: "flex",
              gap: "0.5rem",
            }}
          >
            {/* Auth button — hidden on auth/home pages which have their own nav */}
            {!isAuthPage && !isHomePage && (
              user ? (
                <>
                  {pathname !== "/history" && (
                    <Link
                      href="/history"
                      style={{
                        padding: "0.5rem 1rem",
                        border: "1px solid rgba(10,28,22,0.3)",
                        background: "transparent",
                        color: "rgba(10,28,22,0.7)",
                        fontFamily: "var(--font-display)",
                        fontSize: "0.62rem",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        borderRadius: "1px",
                        textDecoration: "none"
                      }}
                      className="hover-line"
                    >
                      History
                    </Link>
                  )}
                  <button
                    onClick={logout}
                    style={{
                      padding: "0.5rem 1rem",
                      border: "1px solid rgba(10,28,22,0.3)",
                      background: "transparent",
                      color: "rgba(10,28,22,0.7)",
                      fontFamily: "var(--font-display)",
                      fontSize: "0.62rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      borderRadius: "1px",
                      marginLeft: pathname !== "/history" ? "1rem" : "0",
                    }}
                    className="hover-line"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  style={{
                    padding: "0.5rem 1rem",
                    border: "1px solid rgba(10,28,22,0.3)",
                    background: "transparent",
                    color: "rgba(10,28,22,0.7)",
                    fontFamily: "var(--font-display)",
                    fontSize: "0.62rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    borderRadius: "1px",
                    marginLeft: "1rem",
                  }}
                  className="hover-line"
                >
                  Login
                </Link>
              )
            )}
          </div>

          {/* Page content */}
          <div style={{ width: "100%" }}>{children}</div>


        </main>
      </div>
    </>
  );
}
