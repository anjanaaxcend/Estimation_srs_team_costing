"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { AuthTransition } from "@/components/ui/AuthTransition";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // State for forgot password flow
  const [formMode, setFormMode] = useState("login"); // login | forgot_email | forgot_otp
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const { login, forgotPassword, resetPassword } = useAuth();

  // Countdown timer for resend OTP
  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (!result.success) {
      setError(result.error);
    }
  };

  const handleForgotEmailSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);
    const result = await forgotPassword(email);
    setLoading(false);
    if (result.success) {
      setSuccessMessage("Check your inbox — a 6-digit code has been sent.");
      setFormMode("forgot_otp");
      startResendCooldown();
    } else {
      setError(result.error);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setSuccessMessage("");
    setLoading(true);
    const result = await forgotPassword(email);
    setLoading(false);
    if (result.success) {
      setSuccessMessage("A new verification code has been sent to your email.");
      startResendCooldown();
    } else {
      setError(result.error);
    }
  };

  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (newPassword !== confirmNewPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const result = await resetPassword(email, otp, newPassword);
    setLoading(false);
    if (result.success) {
      setSuccessMessage("Password successfully reset. You can now sign in.");
      setFormMode("login");
      setPassword("");
      setOtp("");
      setNewPassword("");
      setConfirmNewPassword("");
    } else {
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
                  {formMode === "login" ? "Authentication" : "Recovery"}
                </span>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "clamp(2.5rem, 5vw, 5rem)", lineHeight: 0.95, letterSpacing: "-0.03em", color: "#EBEBEB" }}>
                  Scope<br className="hidden lg:block" />
                  <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, color: "#8EC4A0" }}>Sense</em><br className="hidden lg:block" />
                  AI.
                </h1>
              </ScrollReveal>
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDE (FORM) ── */}
        <div className="w-full lg:w-[55%] flex-1 min-h-0 overflow-y-auto flex flex-col p-6 lg:p-12 relative">

          <div style={{ maxWidth: "440px", width: "100%", margin: "auto" }}>
            
            {/* ── LOGIN FORM MODE ── */}
            {formMode === "login" && (
              <>
                <ScrollReveal variant="slide-up">
                  <div className="section-tag mb-4" style={{ display: "inline-flex" }}>
                    <span className="phase-number">Login</span>
                    <span>Session Access</span>
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
                    Welcome{" "}
                    <em
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontWeight: 400,
                        color: "var(--color-parcelles-sage)",
                      }}
                    >
                      back.
                    </em>
                  </h2>
                </ScrollReveal>

                <ScrollReveal variant="fade" delay={200}>
                  {error && (
                    <div style={{ color: "red", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem" }}>
                      {error}
                    </div>
                  )}
                  {successMessage && (
                    <div style={{ color: "var(--color-parcelles-sage)", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem", fontWeight: 500 }}>
                      {successMessage}
                    </div>
                  )}
                  <form className="flex flex-col gap-3" onSubmit={handleLoginSubmit}>
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
                      <div className="flex justify-between items-center">
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
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setSuccessMessage("");
                            setFormMode("forgot_email");
                          }}
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: "0.68rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "var(--color-parcelles-olive)",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                          }}
                          className="hover-line"
                        >
                          Forgot?
                        </button>
                      </div>
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

                    <button
                      type="submit"
                      disabled={loading}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "2rem",
                        padding: "0.9rem 1.25rem",
                        background: "var(--text-primary)",
                        color: "var(--bg-primary)",
                        border: "none",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-display)",
                        fontSize: "0.8rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginTop: "0.5rem",
                        transition: "opacity 0.2s ease",
                        opacity: loading ? 0.7 : 1,
                      }}
                      className="chamfer-bottom-right btn-arrow"
                    >
                      {loading ? "Signing In…" : "Sign In"}
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
                      Don't have an account?{" "}
                      <Link
                        href="/register"
                        className="hover-line"
                        style={{ color: "var(--text-primary)", fontWeight: 500 }}
                      >
                        Create one now.
                      </Link>
                    </p>
                  </div>
                </ScrollReveal>
              </>
            )}

            {/* ── FORGOT PASSWORD: STEP 1 (EMAIL REQUEST) ── */}
            {formMode === "forgot_email" && (
              <>
                <ScrollReveal variant="slide-up">
                  <div className="section-tag mb-4" style={{ display: "inline-flex" }}>
                    <span className="phase-number">Reset</span>
                    <span>Password Code</span>
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
                    Request{" "}
                    <em
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontWeight: 400,
                        color: "var(--color-parcelles-sage)",
                      }}
                    >
                      reset.
                    </em>
                  </h2>
                </ScrollReveal>

                <ScrollReveal variant="fade" delay={200}>
                  {error && (
                    <div style={{ color: "red", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem" }}>
                      {error}
                    </div>
                  )}
                  <form className="flex flex-col gap-3" onSubmit={handleForgotEmailSubmit}>
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

                    <button
                      type="submit"
                      disabled={loading}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "2rem",
                        padding: "0.9rem 1.25rem",
                        background: "var(--text-primary)",
                        color: "var(--bg-primary)",
                        border: "none",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-display)",
                        fontSize: "0.8rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginTop: "0.5rem",
                        transition: "opacity 0.2s ease",
                        opacity: loading ? 0.7 : 1,
                      }}
                      className="chamfer-bottom-right btn-arrow"
                    >
                      {loading ? "Sending…" : "Send Reset Code"}
                      <ArrowRight size={18} strokeWidth={1.5} />
                    </button>
                  </form>
                </ScrollReveal>

                <ScrollReveal variant="fade" delay={300}>
                  <div className="mt-6 pt-4 border-t border-black/10 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        setError("");
                        setFormMode("login");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        textAlign: "left",
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.85rem",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      className="hover-line align-self-start"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </ScrollReveal>
              </>
            )}

            {/* ── FORGOT PASSWORD: STEP 2 (OTP VERIFICATION & RESET) ── */}
            {formMode === "forgot_otp" && (
              <>
                <ScrollReveal variant="slide-up">
                  <div className="section-tag mb-4" style={{ display: "inline-flex" }}>
                    <span className="phase-number">Verify</span>
                    <span>One-Time Code</span>
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
                    Enter{" "}
                    <em
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontWeight: 400,
                        color: "var(--color-parcelles-sage)",
                      }}
                    >
                      code.
                    </em>
                  </h2>
                </ScrollReveal>

                <ScrollReveal variant="fade" delay={200}>
                  {error && (
                    <div style={{ color: "red", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem" }}>
                      {error}
                    </div>
                  )}
                  {successMessage && (
                    <div style={{ color: "var(--color-parcelles-sage)", marginBottom: "1rem", fontFamily: "var(--font-sans)", fontSize: "0.9rem", fontWeight: 500 }}>
                      {successMessage}
                    </div>
                  )}
                  <form className="flex flex-col gap-3" onSubmit={handleResetPasswordSubmit}>
                    
                    <div className="flex flex-col gap-1">
                      <label
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "0.7rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          color: "var(--text-muted)",
                          opacity: 0.7
                        }}
                      >
                        Email Address
                      </label>
                      <input
                        type="email"
                        disabled
                        style={{
                          width: "100%",
                          padding: "0.75rem 1rem",
                          background: "rgba(0,0,0,0.03)",
                          border: "1px solid var(--border-muted)",
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.95rem",
                          outline: "none",
                          cursor: "not-allowed"
                        }}
                        value={email}
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
                        Verification Code (OTP)
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
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
                        onChange={(e) => setOtp(e.target.value)}
                        value={otp}
                        placeholder="123456"
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
                        New Password
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
                        onChange={(e) => setNewPassword(e.target.value)}
                        value={newPassword}
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
                        Confirm New Password
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
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        value={confirmNewPassword}
                        placeholder="••••••••"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "2rem",
                        padding: "0.9rem 1.25rem",
                        background: "var(--text-primary)",
                        color: "var(--bg-primary)",
                        border: "none",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-display)",
                        fontSize: "0.8rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginTop: "0.5rem",
                        transition: "opacity 0.2s ease",
                        opacity: loading ? 0.7 : 1,
                      }}
                      className="chamfer-bottom-right btn-arrow"
                    >
                      {loading ? "Updating…" : "Update Password"}
                      <ArrowRight size={18} strokeWidth={1.5} />
                    </button>
                  </form>
                </ScrollReveal>

                <ScrollReveal variant="fade" delay={300}>
                  <div className="mt-6 pt-4 border-t border-black/10 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <button
                        onClick={handleResendOtp}
                        disabled={resendCooldown > 0 || loading}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.85rem",
                          color: resendCooldown > 0 ? "var(--text-muted)" : "var(--color-parcelles-sage)",
                          fontWeight: 500,
                          cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                          transition: "color 0.2s ease",
                        }}
                      >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
                      </button>

                      <button
                        onClick={() => {
                          setError("");
                          setFormMode("forgot_email");
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          textAlign: "right",
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                          fontWeight: 400,
                          cursor: "pointer",
                        }}
                        className="hover-line"
                      >
                        Change Email
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setError("");
                        setFormMode("login");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        textAlign: "left",
                        fontFamily: "var(--font-sans)",
                        fontSize: "0.85rem",
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                      className="hover-line"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </ScrollReveal>
              </>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
