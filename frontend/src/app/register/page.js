"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { AuthTransition } from "@/components/ui/AuthTransition";
import { useAuth } from "@/context/AuthContext";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const { register } = useAuth();

  const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
  };

  const validatePassword = (pwd) => {
    const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
    return pwdRegex.test(pwd);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!validatePassword(password)) {
      setError("Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const result = await register(name, email, password);
    if (!result.success) {
      setError(result.error);
    }
  };

  return (
    <>
      <AuthTransition />
      <div className="h-screen w-full flex flex-col lg:flex-row bg-[#EBEBEB] overflow-hidden">
        
        {/* ── LEFT SIDE (BRANDS/ANIMATION) ── */}
        <div className="relative w-full lg:w-[45%] h-[35vh] lg:h-full p-4 sm:p-8 flex flex-col justify-end overflow-hidden flex-shrink-0">
          <div className="w-full h-full relative overflow-hidden bg-[#0A1C16] chamfer-bottom-right chamfer-top-right flex flex-col items-center justify-center lg:items-start lg:justify-end p-8 lg:p-16">
            {/* Absolute Back Button inside the dark card */}
            <Link
              href="/"
              style={{
                position: "absolute",
                top: "2.5rem",
                left: "2.5rem",
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1.25rem",
                border: "1px solid rgba(235, 235, 235, 0.35)",
                background: "rgba(235, 235, 235, 0.08)",
                color: "#EBEBEB",
                fontFamily: "var(--font-display)",
                fontSize: "0.62rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                textDecoration: "none",
                cursor: "pointer",
                borderRadius: "1px",
                transition: "all 0.2s ease",
              }}
              className="hover-line"
            >
              <ArrowLeft size={12} /> Back
            </Link>
            {/* Subtle grid background texture */}
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(196,215,201,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(196,215,201,0.06) 1px, transparent 1px)", backgroundSize: "60px 60px", pointerEvents: "none" }} />
            {/* Animated radial glow */}
            <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 50% 60%, rgba(196,215,201,0.12) 0%, transparent 70%)", animation: "sage-pulse 10s ease infinite", pointerEvents: "none" }} />

            <div className="relative z-10 w-full text-center lg:text-left">
              <ScrollReveal variant="slide-up" delay={200}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: "rgba(196,215,201,0.7)",
                    display: "block",
                    marginBottom: "1rem"
                  }}
                >
                  Onboarding
                </span>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(2.5rem, 5vw, 5rem)", lineHeight: 0.95, letterSpacing: "-0.03em", color: "#EBEBEB" }}>
                  Start<br className="hidden lg:block" />
                  <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, color: "#8EC4A0" }}>planning</em><br className="hidden lg:block" />
                  today.
                </h1>
              </ScrollReveal>
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDE (FORM) ── */}
        <div className="w-full lg:w-[55%] flex-1 min-h-0 overflow-y-auto flex flex-col p-6 lg:p-12 relative">

          <div style={{ maxWidth: "440px", width: "100%", margin: "auto" }}>
            <ScrollReveal variant="slide-up">
              <div className="section-tag mb-4" style={{ display: "inline-flex" }}>
                <span className="phase-number">Register</span>
                <span>New Account</span>
              </div>
            </ScrollReveal>

            <ScrollReveal variant="slide-up" delay={100}>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 300,
                  fontSize: "clamp(1.75rem, 3vw, 2.75rem)",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                  color: "var(--text-primary)",
                  marginBottom: "1.25rem",
                }}
              >
                Join the{" "}
                <em
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontWeight: 400,
                    color: "var(--color-parcelles-sage)",
                  }}
                >
                  collective.
                </em>
              </h2>
            </ScrollReveal>

            <ScrollReveal variant="fade" delay={200}>
              {error && (
                <div style={{ color: "red", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem" }}>
                  {error}
                </div>
              )}
              <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                <div className="flex flex-col gap-1">
                  <label
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "transparent",
                      border: "1px solid var(--border-muted)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.95rem",
                      outline: "none",
                      transition: "border-color 0.3s ease",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--text-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-muted)")}
                    onChange={(e) => setName(e.target.value)}
                    value={name}
                    placeholder="Jane Doe"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "transparent",
                      border: "1px solid var(--border-muted)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.95rem",
                      outline: "none",
                      transition: "border-color 0.3s ease",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--text-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-muted)")}
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    placeholder="name@company.com"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "transparent",
                      border: "1px solid var(--border-muted)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.95rem",
                      outline: "none",
                      transition: "border-color 0.3s ease",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--text-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-muted)")}
                    onChange={(e) => setPassword(e.target.value)}
                    value={password}
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
                      background: "transparent",
                      border: "1px solid var(--border-muted)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)",
                      fontSize: "0.95rem",
                      outline: "none",
                      transition: "border-color 0.3s ease",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--text-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-muted)")}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    value={confirmPassword}
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "2rem",
                    padding: "0.9rem 1.25rem",
                    background: "var(--text-primary)",
                    color: "var(--bg-primary)",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    fontSize: "0.8rem",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    marginTop: "0.5rem",
                    transition: "opacity 0.2s ease",
                  }}
                  className="chamfer-bottom-left btn-arrow hover:opacity-90"
                >
                  Create Account
                  <ArrowRight size={18} strokeWidth={1.5} />
                </button>
              </form>
            </ScrollReveal>

            <ScrollReveal variant="fade" delay={300}>
              <div className="mt-6 pt-4 border-t border-black/10 flex flex-col gap-2">
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Already have an account?{" "}
                  <Link
                    href="/login"
                    className="hover-line"
                    style={{ color: "var(--text-primary)", fontWeight: 500 }}
                  >
                    Sign in instead.
                  </Link>
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </>
  );
}
