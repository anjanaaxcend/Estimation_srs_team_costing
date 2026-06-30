"use client";

import { useEffect, useState } from "react";
import { ArrowRight, FileText, Loader2, Gauge, RefreshCw, AlertCircle, CheckCircle, Type, Users, Plus, Trash2, Save, X } from "lucide-react";


import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { useWorkflow } from "@/context/WorkflowContext";
import { getRateLimitStatus } from "@/lib/platformApi";

// ─── Shared Company Roster Storage ───────────────────────────────────────────
const SHARED_PROFILES_KEY = "scopesense-company-profiles-v1";
const ACTIVE_PROFILE_ID_KEY = "scopesense-active-profile-id-v1";

const DEFAULT_PROFILES = [
  {
    id: "profile-default-inr",
    name: "Default INR Profile",
    currency: "INR",
    members: [
      { name: "Resource A", role: "S3 Developer", experience_years: 12, hourly_rate_override: null },
      { name: "Resource B", role: "S2 Developer", experience_years: 8,  hourly_rate_override: null },
      { name: "Resource C", role: "S1 Developer", experience_years: 2,  hourly_rate_override: null },
    ]
  },
  {
    id: "profile-default-usd",
    name: "Default USD Profile",
    currency: "USD",
    members: [
      { name: "Resource A (US)", role: "S3 Developer", experience_years: 12, hourly_rate_override: null },
      { name: "Resource B (US)", role: "S2 Developer", experience_years: 8,  hourly_rate_override: null },
      { name: "Resource C (US)", role: "S1 Developer", experience_years: 2,  hourly_rate_override: null },
    ]
  }
];

const CURRENCY_SYMBOLS = { USD: "$", INR: "\u20b9", EUR: "\u20ac", GBP: "\u00a3", JPY: "\u00a5" };
const getCurrencySymbol = (c) => CURRENCY_SYMBOLS[c] || "$";

const COMPANY_ROLES = [
  "S1 Developer",
  "S2 Developer",
  "S3 Developer",
  "Junior Developer",
  "Mid-Level Developer",
  "Senior Developer",
  "Lead Developer",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Mobile Developer",
  "iOS Developer",
  "Android Developer",
  "UI/UX Designer",
  "Product Designer",
  "QA Engineer",
  "Test Engineer",
  "Automation Engineer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Site Reliability Engineer",
  "Data Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "Business Analyst",
  "Product Manager",
  "Project Manager",
  "Scrum Master",
  "Tech Lead",
  "Engineering Manager",
  "Solutions Architect",
  "Database Administrator",
  "Security Engineer",
  "Technical Writer",
];

const loadSharedProfiles = () => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(SHARED_PROFILES_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [];
};

const saveSharedProfiles = (profiles) => {
  try {
    window.localStorage.setItem(SHARED_PROFILES_KEY, JSON.stringify(profiles));
  } catch (e) {}
};

const loadActiveProfileId = (profiles) => {
  try {
    const activeId = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PROFILE_ID_KEY) : null;
    if (activeId !== null) {
      if (activeId === "") return "";
      if (profiles.some(p => p.id === activeId)) return activeId;
    }
  } catch (e) {}
  return profiles[0]?.id || "";
};

const saveActiveProfileId = (id) => {
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
  } catch (e) {}
};

const calcRate = (exp) => {
  const y = Number(exp) || 0;
  if (y >= 10) return 50;
  if (y >= 5)  return 45;
  return 40;
};

// ─── Edit Roster Modal ────────────────────────────────────────────────────────
function EditRosterModal({ onClose }) {
  const [profiles, setProfiles] = useState(() => loadSharedProfiles());
  const [activeProfileId, setActiveProfileId] = useState(() => loadActiveProfileId(profiles));

  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState(COMPANY_ROLES[0]);
  const [newExp, setNewExp]   = useState(5);
  const [newRate, setNewRate] = useState("");
  const [saved, setSaved] = useState(false);

  // Profile creation sub-form state
  const [showAddProfileForm, setShowAddProfileForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileCurrency, setNewProfileCurrency] = useState("INR");

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const roster = activeProfile?.members || [];
  const currency = activeProfile?.currency || "INR";

  const updateMember = (index, field, value) => {
    setProfiles((prev) => {
      const next = prev.map((p) => {
        if (p.id === activeProfileId) {
          const nextMembers = [...p.members];
          const m = { ...nextMembers[index] };
          if (field === "name") m.name = value;
          else if (field === "role") m.role = value;
          else if (field === "experience_years") m.experience_years = Math.max(0, Number(value) || 0);
          else if (field === "hourly_rate_override") m.hourly_rate_override = value === "" ? null : Math.max(0, Number(value) || 0);
          nextMembers[index] = m;
          return { ...p, members: nextMembers };
        }
        return p;
      });
      return next;
    });
    setSaved(false);
  };

  const addMember = () => {
    if (!newName.trim()) return;
    setProfiles((prev) => {
      const next = prev.map((p) => {
        if (p.id === activeProfileId) {
          return {
            ...p,
            members: [
              ...p.members,
              {
                name: newName.trim(),
                role: newRole || COMPANY_ROLES[0],
                experience_years: Number(newExp) || 0,
                hourly_rate_override: newRate !== "" ? Number(newRate) : null,
              }
            ]
          };
        }
        return p;
      });
      return next;
    });
    setNewName(""); setNewRole(COMPANY_ROLES[0]); setNewExp(5); setNewRate("");
    setSaved(false);
  };

  const removeMember = (index) => {
    setProfiles((prev) => {
      const next = prev.map((p) => {
        if (p.id === activeProfileId) {
          return {
            ...p,
            members: p.members.filter((_, i) => i !== index)
          };
        }
        return p;
      });
      return next;
    });
    setSaved(false);
  };

  const addProfile = () => {
    if (!newProfileName.trim()) return;
    const newId = "profile-" + Date.now();
    const newProf = {
      id: newId,
      name: newProfileName.trim(),
      currency: newProfileCurrency,
      members: []
    };
    const nextProfiles = [...profiles, newProf];
    setProfiles(nextProfiles);
    setActiveProfileId(newId);
    setNewProfileName("");
    setShowAddProfileForm(false);
    setSaved(false);
  };

  const deleteProfile = () => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== activeProfileId);
    setProfiles(remaining);
    setActiveProfileId(remaining[0].id);
    setSaved(false);
  };

  const handleSave = () => {
    saveSharedProfiles(profiles);
    saveActiveProfileId(activeProfileId);
    setSaved(true);
    setTimeout(() => onClose(), 800);
  };

  const sym = getCurrencySymbol(currency);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,28,22,0.88)", backdropFilter: "blur(8px)", padding: "1rem" }}>
      <div style={{ width: "100%", maxWidth: "880px", background: "#EBEBEB", border: "1px solid #0A1C16", clipPath: "polygon(0 0, 100% 0, 100% 100%, 28px 100%, 0 calc(100% - 28px))", display: "flex", flexDirection: "column", maxHeight: "90vh" }}>

        {/* Header */}
        <div style={{ padding: "1.75rem 2rem", borderBottom: "1px solid #0A1C16", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexShrink: 0 }}>
          <div>
            <p style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(10,28,22,0.5)", marginBottom: "0.5rem" }}>Company Resource Roster</p>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 300, fontSize: "1.8rem", letterSpacing: "-0.02em", color: "#0A1C16", lineHeight: 1.1 }}>
              Edit <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, opacity: 0.6 }}>your team roster</em>
            </h2>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "rgba(10,28,22,0.6)", marginTop: "0.5rem", lineHeight: 1.6, fontWeight: 300 }}>
              Saved roster will be used automatically when generating team allocation.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            {/* Profile selector and Management */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid rgba(10,28,22,0.3)", padding: "0.35rem 0.75rem", fontSize: "0.75rem", fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <span style={{ opacity: 0.5 }}>Company / Project:</span>
                <select 
                  value={activeProfileId} 
                  onChange={(e) => {
                    setActiveProfileId(e.target.value);
                    setSaved(false);
                  }} 
                  style={{ background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-display)", fontWeight: 700, cursor: "pointer", color: "#0A1C16" }}
                >
                  {profiles.length === 0 ? (
                    <option value="">No Profiles Created</option>
                  ) : (
                    <>
                      <option value="">-- Select Profile --</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              {/* Add profile button */}
              <button 
                onClick={() => setShowAddProfileForm(!showAddProfileForm)} 
                style={{ padding: "0.45rem 0.75rem", border: "1px solid rgba(10,28,22,0.3)", background: "transparent", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", fontSize: "0.7rem", fontFamily: "var(--font-display)", textTransform: "uppercase", fontWeight: 700, color: "#0A1C16" }}
                title="Create a new Company or Project Profile"
              >
                <Plus size={12} /> New Profile
              </button>

              {/* Delete profile button */}
              {profiles.length > 1 && (
                <button 
                  onClick={deleteProfile} 
                  style={{ padding: "0.45rem", border: "1px solid rgba(220,38,38,0.3)", background: "transparent", display: "flex", alignItems: "center", cursor: "pointer", color: "#991b1b" }}
                  title="Delete current profile"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <button onClick={onClose} style={{ padding: "0.5rem", border: "1px solid rgba(10,28,22,0.3)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Add Profile Popover/Form */}
        {showAddProfileForm && (
          <div style={{ padding: "1rem 2rem", background: "rgba(196,215,201,0.25)", borderBottom: "1px solid rgba(10,28,22,0.15)", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.8rem", fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.08em", color: "#0A1C16", fontWeight: 700 }}>New Profile:</span>
            <input 
              type="text" 
              placeholder="e.g. Axcend or Project X" 
              value={newProfileName} 
              onChange={(e) => setNewProfileName(e.target.value)} 
              style={{ flex: 1, minWidth: "150px", border: "1px solid rgba(10,28,22,0.25)", padding: "0.4rem 0.6rem", fontSize: "0.8rem", outline: "none", background: "#fff", color: "#0A1C16" }}
            />
            <select 
              value={newProfileCurrency} 
              onChange={(e) => setNewProfileCurrency(e.target.value)} 
              style={{ border: "1px solid rgba(10,28,22,0.25)", padding: "0.4rem 0.6rem", fontSize: "0.8rem", background: "#fff", outline: "none", color: "#0A1C16" }}
            >
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="JPY">JPY (¥)</option>
            </select>
            <button 
              onClick={addProfile} 
              disabled={!newProfileName.trim()} 
              style={{ padding: "0.45rem 1rem", background: newProfileName.trim() ? "#0A1C16" : "rgba(10,28,22,0.2)", color: newProfileName.trim() ? "#EBEBEB" : "rgba(10,28,22,0.4)", border: "none", cursor: newProfileName.trim() ? "pointer" : "not-allowed", fontSize: "0.75rem", fontFamily: "var(--font-display)", textTransform: "uppercase", fontWeight: 600 }}
            >
              Create
            </button>
            <button 
              onClick={() => setShowAddProfileForm(false)} 
              style={{ padding: "0.45rem 1rem", border: "1px solid rgba(10,28,22,0.2)", background: "transparent", cursor: "pointer", fontSize: "0.75rem", fontFamily: "var(--font-display)", textTransform: "uppercase", color: "#0A1C16" }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Table */}
        {showAddProfileForm ? (
          <div style={{ flex: 1, padding: "3rem 2rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", textAlign: "center", background: "rgba(196,215,201,0.02)" }}>
            <div style={{ width: "64px", height: "64px", border: "1px dashed rgba(10,28,22,0.25)", display: "flex", alignItems: "center", justifyContent: "center", clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)", color: "rgba(10,28,22,0.4)" }}>
              <Plus size={24} />
            </div>
            <div>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 700, marginBottom: "0.35rem" }}>
                Creating New Profile
              </p>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "rgba(10,28,22,0.55)", maxWidth: "380px", lineHeight: 1.5 }}>
                Enter a profile name and select a currency above, then click <strong>Create</strong> to initialize the profile and start adding developers.
              </p>
            </div>
          </div>
        ) : !activeProfile ? (
          <div style={{ flex: 1, padding: "3rem 2rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", textAlign: "center", background: "rgba(196,215,201,0.02)" }}>
            <div style={{ width: "64px", height: "64px", border: "1px dashed rgba(10,28,22,0.25)", display: "flex", alignItems: "center", justifyContent: "center", clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)", color: "rgba(10,28,22,0.4)" }}>
              <Users size={24} />
            </div>
            <div>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 700, marginBottom: "0.35rem" }}>
                No Profile Selected
              </p>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.82rem", color: "rgba(10,28,22,0.55)", maxWidth: "380px", lineHeight: 1.5 }}>
                Please select a Company/Project profile from the dropdown above, or click <strong>New Profile</strong> to create one.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 2rem" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr auto", gap: "0.75rem", alignItems: "center", padding: "0.5rem 0.75rem", background: "rgba(196,215,201,0.25)", borderBottom: "1px solid rgba(10,28,22,0.15)", marginBottom: "0.25rem" }}>
              {["Name", "Role", "Exp (Yrs)", "Hourly Pay", ""].map((h, i) => (
                <div key={i} style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(10,28,22,0.5)" }}>{h}</div>
              ))}
            </div>

            {/* Existing members */}
            <div style={{ border: "1px solid rgba(10,28,22,0.12)", borderTop: "none" }}>
              {roster.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "rgba(10,28,22,0.45)" }}>
                  No roster members yet in this profile. Add one below.
                </div>
              )}
              {roster.map((member, index) => (
                <div
                  key={index}
                  style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr auto", gap: "0.75rem", alignItems: "center", padding: "0.6rem 0.75rem", borderBottom: "1px solid rgba(10,28,22,0.07)", background: index % 2 === 0 ? "transparent" : "rgba(196,215,201,0.04)" }}
                >
                  <input
                    type="text"
                    value={member.name}
                    onChange={(e) => updateMember(index, "name", e.target.value)}
                    style={{ width: "100%", border: "1px solid rgba(10,28,22,0.2)", padding: "0.4rem 0.6rem", background: "transparent", outline: "none", fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "#0A1C16", fontWeight: 500 }}
                    placeholder="Member name"
                  />
                  <select
                    value={member.role}
                    onChange={(e) => updateMember(index, "role", e.target.value)}
                    style={{ width: "100%", border: "1px solid rgba(10,28,22,0.2)", padding: "0.4rem 0.6rem", background: "transparent", outline: "none", fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "rgba(10,28,22,0.8)", cursor: "pointer" }}
                  >
                    {!COMPANY_ROLES.includes(member.role) && (
                      <option value={member.role}>{member.role}</option>
                    )}
                    {COMPANY_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step="0.5"
                      value={member.experience_years}
                      onChange={(e) => updateMember(index, "experience_years", e.target.value)}
                      style={{ width: "52px", border: "1px solid rgba(10,28,22,0.2)", padding: "0.4rem 0.35rem", background: "transparent", outline: "none", fontFamily: "monospace", fontSize: "0.85rem", textAlign: "center", color: "#0A1C16" }}
                    />
                    <span style={{ fontSize: "0.7rem", color: "rgba(10,28,22,0.45)" }}>yrs</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(10,28,22,0.55)" }}>{sym}</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={member.hourly_rate_override != null ? member.hourly_rate_override : calcRate(member.experience_years)}
                      onChange={(e) => updateMember(index, "hourly_rate_override", e.target.value)}
                      style={{ width: "62px", border: "1px solid rgba(10,28,22,0.2)", padding: "0.4rem 0.35rem", background: "transparent", outline: "none", fontFamily: "monospace", fontSize: "0.85rem", textAlign: "center", color: "#0A1C16", fontWeight: 600 }}
                      title="Hourly pay — edit to override computed rate"
                    />
                    <span style={{ fontSize: "0.7rem", color: "rgba(10,28,22,0.45)" }}>/hr</span>
                  </div>
                  <button
                    onClick={() => removeMember(index)}
                    style={{ padding: "0.4rem", border: "1px solid rgba(220,38,38,0.25)", background: "transparent", color: "#991b1b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease" }}
                    title="Remove member"
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(220,38,38,0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new member row */}
            <div style={{ marginTop: "1.25rem", border: "1px dashed rgba(10,28,22,0.25)", padding: "1rem", background: "rgba(196,215,201,0.06)" }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(10,28,22,0.45)", marginBottom: "0.75rem" }}>Add New Member to Profile</p>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1.5fr auto", gap: "0.75rem", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                  style={{ width: "100%", border: "1px solid rgba(10,28,22,0.25)", padding: "0.5rem 0.6rem", background: "#fff", outline: "none", fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "#0A1C16" }}
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  style={{ width: "100%", border: "1px solid rgba(10,28,22,0.25)", padding: "0.5rem 0.6rem", background: "#fff", outline: "none", fontFamily: "var(--font-sans)", fontSize: "0.85rem", color: "#0A1C16", cursor: "pointer" }}
                >
                  {COMPANY_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={newExp}
                    onChange={(e) => setNewExp(e.target.value)}
                    style={{ width: "52px", border: "1px solid rgba(10,28,22,0.25)", padding: "0.5rem 0.35rem", background: "#fff", outline: "none", fontFamily: "monospace", fontSize: "0.85rem", textAlign: "center", color: "#0A1C16" }}
                  />
                  <span style={{ fontSize: "0.7rem", color: "rgba(10,28,22,0.45)" }}>yrs</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(10,28,22,0.55)" }}>{sym}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder={String(calcRate(newExp))}
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                    style={{ width: "62px", border: "1px solid rgba(10,28,22,0.25)", padding: "0.5rem 0.35rem", background: "#fff", outline: "none", fontFamily: "monospace", fontSize: "0.85rem", textAlign: "center", color: "#0A1C16" }}
                  />
                  <span style={{ fontSize: "0.7rem", color: "rgba(10,28,22,0.45)" }}>/hr</span>
                </div>
                <button
                  onClick={addMember}
                  disabled={!newName.trim()}
                  style={{ padding: "0.5rem 1rem", border: "1px solid #0A1C16", background: newName.trim() ? "#0A1C16" : "transparent", color: newName.trim() ? "#EBEBEB" : "rgba(10,28,22,0.35)", cursor: newName.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: "0.35rem", fontFamily: "var(--font-display)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", transition: "all 0.2s ease", whiteSpace: "nowrap" }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "1rem 2rem", borderTop: "1px solid rgba(10,28,22,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "rgba(196,215,201,0.08)" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.78rem", color: "rgba(10,28,22,0.5)", fontWeight: 300 }}>
            {roster.length} member{roster.length !== 1 ? "s" : ""} in profile · Saved to device storage
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={onClose}
              style={{ padding: "0.6rem 1.25rem", border: "1px solid rgba(10,28,22,0.3)", background: "transparent", fontFamily: "var(--font-display)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", color: "rgba(10,28,22,0.7)", transition: "all 0.2s ease" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{ padding: "0.6rem 1.5rem", border: "1px solid #0A1C16", background: saved ? "#16a34a" : "#0A1C16", color: "#EBEBEB", fontFamily: "var(--font-display)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", transition: "all 0.3s ease", clipPath: "polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))" }}
            >
              <Save size={15} />
              {saved ? "Saved ✓" : "Save Roster"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_MODELS = {
  openai_custom: [
    { id: "gpt-4o", label: "GPT-4o (Recommended)" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini (Fast & Cost-Efficient)" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
    { id: "o1-preview", label: "o1 Preview (Reasoning)" },
    { id: "o1-mini", label: "o1 Mini (Reasoning)" },
    { id: "other", label: "Custom Model..." }
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (Recommended)" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus" },
    { id: "other", label: "Custom Model..." }
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek V3 (Chat)" },
    { id: "deepseek-coder", label: "DeepSeek Coder" },
    { id: "other", label: "Custom Model..." }
  ],
  groq_custom: [
    { id: "llama3-70b-8192", label: "LLaMA 3 70B (Groq)" },
    { id: "llama3-8b-8192", label: "LLaMA 3 8B (Groq)" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B (Groq)" },
    { id: "gemma-7b-it", label: "Gemma 7B (Groq)" },
    { id: "other", label: "Custom Model..." }
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large" },
    { id: "open-mixtral-8x22b", label: "Mixtral 8x22B" },
    { id: "mistral-small-latest", label: "Mistral Small" },
    { id: "other", label: "Custom Model..." }
  ],
  openrouter: [
    { id: "meta-llama/llama-3-70b-instruct", label: "LLaMA 3 70B (OpenRouter)" },
    { id: "mistralai/mixtral-8x22b-instruct", label: "Mixtral 8x22B (OpenRouter)" },
    { id: "other", label: "Custom Model..." }
  ],
  cohere: [
    { id: "command-r-plus", label: "Command R+" },
    { id: "command-r", label: "Command R" },
    { id: "other", label: "Custom Model..." }
  ]
};

const formatCount = (value) => {
  if (value === null || value === undefined) return null;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString();
};

const getRateLimitEngineId = (selectedEngine) => {
  if (selectedEngine === "gemini") return selectedEngine;
  if (selectedEngine && typeof selectedEngine === "object") {
    if (selectedEngine.provider === "gemini") {
      return selectedEngine.provider;
    }
  }
  return "openai";
};

// Parse Groq/OpenAI reset strings like "1m30s", "30s", "2h" into human-readable form
const parseResetTime = (resetStr) => {
  if (!resetStr) return null;
  // Already human-readable or ISO
  const match = resetStr.match(/(\d+h)?(\d+m)?(\d+(?:\.\d+)?s)?/);
  if (!match || !match[0]) return resetStr;
  const parts = [];
  if (match[1]) parts.push(match[1]);
  if (match[2]) parts.push(match[2]);
  if (match[3]) parts.push(match[3].replace(/\.\d+/, ""));
  return parts.length ? parts.join(" ") : resetStr;
};

export default function InputPage() {
  const { rawInput, submitInput, errorMessage, isProcessing, selectedEngine, setSelectedEngine, clearInputFields } = useWorkflow();
  const [activeTab, setActiveTab] = useState("file");
  const [textValue, setTextValue] = useState(rawInput);
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showRosterModal, setShowRosterModal] = useState(false);

  const [customProvider, setCustomProvider] = useState("openai_custom");
  const [customModelDropdown, setCustomModelDropdown] = useState("gpt-4o");
  const [customModelName, setCustomModelName] = useState("gpt-4o");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [isFetchingRateLimit, setIsFetchingRateLimit] = useState(false);
  const [rateLimitError, setRateLimitError] = useState("");

  const rateLimitEngine = getRateLimitEngineId(selectedEngine);

  // Derive structured rate-limit info for the rich widget
  const rateLimitInfo = (() => {
    if (isFetchingRateLimit) return { state: "loading" };
    if (rateLimitError) return { state: "error", message: rateLimitError };
    if (!rateLimitStatus) return { state: "idle" };
    if (rateLimitStatus.status === "local") return { state: "local" };
    if (rateLimitStatus.status === "no_key") return { state: "no_key", consoleUrl: rateLimitStatus.console_url };
    if (rateLimitStatus.status !== "ok") return { state: "error", message: rateLimitStatus.note || "Unavailable", consoleUrl: rateLimitStatus.console_url };

    const reqRemaining = rateLimitStatus.remaining_requests;
    const reqLimit = rateLimitStatus.limit_requests;
    const tpmRemaining = rateLimitStatus.remaining_tokens;
    const tpmLimit = rateLimitStatus.limit_tokens;
    const tpdRemaining = rateLimitStatus.remaining_tokens_day;
    const tpdLimit = rateLimitStatus.limit_tokens_day;

    const reqPct = reqLimit > 0 ? Math.round((reqRemaining / reqLimit) * 100) : null;
    const tpmPct = tpmLimit > 0 ? Math.round((tpmRemaining / tpmLimit) * 100) : null;
    const tpdPct = tpdLimit > 0 ? Math.round((tpdRemaining / tpdLimit) * 100) : null;

    return {
      state: "ok",
      model: rateLimitStatus.model,
      consoleUrl: rateLimitStatus.console_url,
      note: rateLimitStatus.note,
      quotaViolations: rateLimitStatus.quota_violations || [],
      req: reqPct !== null ? { pct: reqPct, remaining: reqRemaining, limit: reqLimit, reset: parseResetTime(rateLimitStatus.reset_requests) } : null,
      tpm: tpmPct !== null ? { pct: tpmPct, remaining: tpmRemaining, limit: tpmLimit, reset: parseResetTime(rateLimitStatus.reset_tokens) } : null,
      tpd: tpdPct !== null ? { pct: tpdPct, remaining: tpdRemaining, limit: tpdLimit } : null,
      noData: reqPct === null && tpmPct === null && tpdPct === null,
    };
  })();

  const selectedModelLabel = (() => {
    if (selectedEngine === "openai") return "Groq / LLaMA 4";
    if (selectedEngine === "gemini") return "Gemini Flash-Lite";
    
    const provider = typeof selectedEngine === "object" ? selectedEngine.provider : customProvider;
    const model = typeof selectedEngine === "object" ? selectedEngine.model : (customModelDropdown === "other" ? customModelName : customModelDropdown);
    const cleanProvider = provider?.replace("_custom", "").toUpperCase() || "CUSTOM";
    return `${cleanProvider} (${model || "Default"})`;
  })();

  useEffect(() => {
    clearInputFields();
  }, []);

  useEffect(() => {
    setTextValue(rawInput);
  }, [rawInput]);

  useEffect(() => {
    let cancelled = false;
    setIsFetchingRateLimit(true);
    setRateLimitError("");

    getRateLimitStatus(rateLimitEngine)
      .then((status) => {
        if (!cancelled) {
          setRateLimitStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRateLimitStatus(null);
          setRateLimitError(error.message || "Could not fetch rate limit status.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsFetchingRateLimit(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rateLimitEngine]);

  useEffect(() => {
    const defaultModels = {
      openai_custom: "gpt-4o",
      anthropic: "claude-3-5-sonnet-latest",
      deepseek: "deepseek-chat",
      groq_custom: "llama3-70b-8192",
      mistral: "mistral-large-latest",
      openrouter: "meta-llama/llama-3-70b-instruct",
      cohere: "command-r-plus"
    };
    const defaultModel = defaultModels[customProvider] || "other";
    setCustomModelDropdown(defaultModel);
    setCustomModelName(defaultModel);

    const defaultUrls = {
      openai_custom: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com",
      deepseek: "https://api.deepseek.com",
      groq_custom: "https://api.groq.com/openai/v1",
      mistral: "https://api.mistral.ai/v1",
      openrouter: "https://openrouter.ai/api/v1",
      cohere: "https://api.cohere.com/v1"
    };
    if (defaultUrls[customProvider]) {
      setCustomBaseUrl(defaultUrls[customProvider]);
    }
  }, [customProvider]);



  useEffect(() => {
    if (selectedEngine && typeof selectedEngine === "object") {
      const provider = selectedEngine.provider || "openai";
      
      let uiProvider = provider;
      if (provider === "openai") {
        const url = (selectedEngine.base_url || "").toLowerCase();
        if (url.includes("deepseek.com")) {
          uiProvider = "deepseek";
        } else if (url.includes("groq.com")) {
          uiProvider = "groq_custom";
        } else if (url.includes("mistral.ai")) {
          uiProvider = "mistral";
        } else if (url.includes("openrouter.ai")) {
          uiProvider = "openrouter";
        } else if (url.includes("cohere.com")) {
          uiProvider = "cohere";
        } else {
          uiProvider = "openai_custom";
        }
      }
      
      setCustomProvider(uiProvider);
      
      const model = selectedEngine.model || "";
      if (model) {
        const knownModels = PROVIDER_MODELS[uiProvider] || [];
        const isKnown = knownModels.some(m => m.id === model && m.id !== "other");
        if (isKnown) {
          setCustomModelDropdown(model);
        } else {
          setCustomModelDropdown("other");
          setCustomModelName(model);
        }
      }
      
      if (selectedEngine.api_key) setCustomApiKey(selectedEngine.api_key);
      if (selectedEngine.base_url) setCustomBaseUrl(selectedEngine.base_url);
    }
  }, [selectedEngine]);

  const handleTabChange = (key) => {
    setActiveTab(key);
    if (key === "file") {
      setTextValue("");
    } else if (key === "text") {
      setFile(null);
    }
  };

  const handleSubmit = () => {
    let engineConfig = selectedEngine;
    if (selectedEngine === "custom") {
      const backendProvider = customProvider === "anthropic" ? "anthropic" : "openai";
      engineConfig = {
        provider: backendProvider,
        model: customModelDropdown === "other" ? customModelName : customModelDropdown,
        base_url: customBaseUrl || undefined,
        api_key: customApiKey || undefined,
      };
    }
    submitInput({
      nextSource: activeTab,
      textValue: activeTab === "text" ? textValue : "",
      file: activeTab === "file" ? file : null,
      selectedEngine: engineConfig,
    });
  };

  const isSubmitDisabled =
    (activeTab === "file" && !file) ||
    (activeTab === "text" && !textValue.trim()) ||
    isProcessing;

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setTextValue(""); // strict isolation
      setActiveTab("file");
    }
  };

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <section
        style={{
          width: "100%",
          paddingTop: "clamp(4.25rem, 5.5vw, 5rem)",
          paddingBottom: "1.25rem",
          paddingLeft: "clamp(1.5rem, 5vw, 5rem)",
          paddingRight: "clamp(1.5rem, 5vw, 5rem)",
          borderBottom: "1px solid rgba(10,28,22,0.12)",
        }}
      >
        <div style={{ maxWidth: "1300px", margin: "0 auto" }}>
          <ScrollReveal variant="slide-left" delay={0}>
            <p className="text-eyebrow" style={{ color: "rgba(10,28,22,0.45)", marginBottom: "0.5rem" }}>
              Phase <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>01</em> - Intake
            </p>
          </ScrollReveal>

          <ScrollReveal variant="slide-up" delay={80}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 300,
                fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: "#0A1C16",
                marginBottom: "0.5rem",
              }}
            >
              Project{" "}
              <em
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontWeight: 400,
                  color: "rgba(10,28,22,0.55)",
                }}
              >
                Intake.
              </em>
            </h1>
          </ScrollReveal>

          <ScrollReveal variant="slide-up" delay={160}>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 300,
                fontSize: "clamp(0.85rem, 1.5vw, 0.95rem)",
                color: "rgba(10,28,22,0.6)",
                maxWidth: "560px",
                lineHeight: 1.5,
              }}
            >
              Feed the engine your raw brief. We extract requirements, map UI, and build the
              architecture in seconds.
            </p>
          </ScrollReveal>
        </div>
      </section>

      {showRosterModal && <EditRosterModal onClose={() => setShowRosterModal(false)} />}

      <div
        style={{
          borderBottom: "1px solid rgba(10,28,22,0.12)",
          padding: "0.5rem clamp(1.5rem, 5vw, 5rem)",
          background: "#8EC4A0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1.5rem",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 500 }}>
            AI Engine:
          </span>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {[
              { id: "openai", label: "Groq / LLaMA 4" },
              { id: "custom", label: "⚙️ Custom Agentic AI" }
            ].map((engine) => {
              const isCustomActive = typeof selectedEngine === "object" || selectedEngine === "custom";
              
              let isActive = false;
              if (engine.id === "custom") {
                isActive = isCustomActive;
              } else {
                isActive = selectedEngine === engine.id;
              }
              return (
                <button
                  key={engine.id}
                  onClick={() => setSelectedEngine(engine.id)}
                  style={{
                    background: isActive ? "#0A1C16" : "transparent",
                    color: isActive ? "#EBEBEB" : "#0A1C16",
                    border: "1px solid #0A1C16",
                    padding: "0.4rem 1rem",
                    fontFamily: "var(--font-sans)",
                    fontSize: "0.8rem",
                    borderRadius: "2px",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                >
                  {engine.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Edit Company Roster Button ── */}
        <button
          onClick={() => setShowRosterModal(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "rgba(10,28,22,0.08)",
            border: "1px solid rgba(10,28,22,0.35)",
            padding: "0.4rem 1rem",
            fontFamily: "var(--font-display)",
            fontSize: "0.78rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#0A1C16",
            cursor: "pointer",
            transition: "all 0.2s ease",
            whiteSpace: "nowrap",
            borderRadius: "2px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#0A1C16"; e.currentTarget.style.color = "#EBEBEB"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(10,28,22,0.08)"; e.currentTarget.style.color = "#0A1C16"; }}
          title="Add or edit your company resource roster"
        >
          <Users size={14} />
          Edit Company Roster
        </button>

        {/* ── API Rate-Limit Widget ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: rateLimitInfo.state === "error" ? "rgba(220,38,38,0.08)" : "rgba(10,28,22,0.07)",
          border: `1px solid ${rateLimitInfo.state === "error" ? "rgba(220,38,38,0.3)" : "rgba(10,28,22,0.2)"}`,
          padding: "0.35rem 0.75rem",
          borderRadius: "3px",
          userSelect: "none",
          minWidth: "160px",
          maxWidth: "420px",
        }}>
          {/* Icon */}
          {rateLimitInfo.state === "loading" ? (
            <Loader2 size={13} strokeWidth={1.5} className="animate-spin" style={{ color: "#0A1C16", flexShrink: 0 }} />
          ) : rateLimitInfo.state === "error" ? (
            <AlertCircle size={13} strokeWidth={1.5} style={{ color: "#DC2626", flexShrink: 0 }} />
          ) : rateLimitInfo.state === "local" ? (
            <CheckCircle size={13} strokeWidth={1.5} style={{ color: "#16a34a", flexShrink: 0 }} />
          ) : (
            <Gauge size={13} strokeWidth={1.5} style={{ color: "#0A1C16", flexShrink: 0 }} />
          )}

          {/* Content */}
          {rateLimitInfo.state === "loading" && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.72rem", color: "rgba(10,28,22,0.6)", letterSpacing: "0.03em" }}>
              Checking API limits…
            </span>
          )}

          {rateLimitInfo.state === "local" && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.72rem", fontWeight: 600, color: "#16a34a", letterSpacing: "0.03em" }}>
              Local — no API rate limits
            </span>
          )}

          {rateLimitInfo.state === "no_key" && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.72rem", color: "rgba(10,28,22,0.55)", letterSpacing: "0.03em" }}>
              No API key configured
              {rateLimitInfo.consoleUrl && (
                <a href={rateLimitInfo.consoleUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "0.4rem", color: "#0A1C16", textDecoration: "underline" }}>
                  Dashboard
                </a>
              )}
            </span>
          )}

          {rateLimitInfo.state === "error" && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.72rem", color: "#DC2626", letterSpacing: "0.03em" }}>
              Rate limit check failed
              {rateLimitInfo.consoleUrl && (
                <a href={rateLimitInfo.consoleUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "0.4rem", color: "#991b1b", textDecoration: "underline" }}>
                  Dashboard
                </a>
              )}
            </span>
          )}

          {rateLimitInfo.state === "ok" && rateLimitInfo.noData && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.72rem", color: "rgba(10,28,22,0.5)", letterSpacing: "0.03em" }}>
              Live limits are on provider dashboard
              {rateLimitInfo.consoleUrl && (
                <a href={rateLimitInfo.consoleUrl} target="_blank" rel="noreferrer" style={{ marginLeft: "0.4rem", color: "#0A1C16", textDecoration: "underline" }}>
                  Open
                </a>
              )}
            </span>
          )}

          {rateLimitInfo.state === "ok" && !rateLimitInfo.noData && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.22rem", flex: 1 }}>
              {/* Requests bar */}
              {rateLimitInfo.req && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", color: "rgba(10,28,22,0.55)", width: "22px", flexShrink: 0 }}>REQ</span>
                  <div style={{ flex: 1, height: "5px", background: "rgba(10,28,22,0.12)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${rateLimitInfo.req.pct}%`,
                      background: rateLimitInfo.req.pct < 15 ? "#DC2626" : rateLimitInfo.req.pct < 40 ? "#D97706" : "#16a34a",
                      borderRadius: "99px",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", fontWeight: 700, color: rateLimitInfo.req.pct < 15 ? "#DC2626" : rateLimitInfo.req.pct < 40 ? "#D97706" : "#0A1C16", minWidth: "28px", textAlign: "right" }}>
                    {rateLimitInfo.req.pct}%
                  </span>
                  {rateLimitInfo.req.reset && (
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.6rem", color: "rgba(10,28,22,0.4)", whiteSpace: "nowrap" }}>
                      ↺ {rateLimitInfo.req.reset}
                    </span>
                  )}
                </div>
              )}
              {/* TPM bar */}
              {rateLimitInfo.tpm && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", color: "rgba(10,28,22,0.55)", width: "22px", flexShrink: 0 }}>TPM</span>
                  <div style={{ flex: 1, height: "5px", background: "rgba(10,28,22,0.12)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${rateLimitInfo.tpm.pct}%`,
                      background: rateLimitInfo.tpm.pct < 15 ? "#DC2626" : rateLimitInfo.tpm.pct < 40 ? "#D97706" : "#16a34a",
                      borderRadius: "99px",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", fontWeight: 700, color: rateLimitInfo.tpm.pct < 15 ? "#DC2626" : rateLimitInfo.tpm.pct < 40 ? "#D97706" : "#0A1C16", minWidth: "28px", textAlign: "right" }}>
                    {rateLimitInfo.tpm.pct}%
                  </span>
                  {rateLimitInfo.tpm.reset && (
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.6rem", color: "rgba(10,28,22,0.4)", whiteSpace: "nowrap" }}>
                      ↺ {rateLimitInfo.tpm.reset}
                    </span>
                  )}
                </div>
              )}
              {/* TPD bar */}
              {rateLimitInfo.tpd && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", color: "rgba(10,28,22,0.55)", width: "22px", flexShrink: 0 }}>TPD</span>
                  <div style={{ flex: 1, height: "5px", background: "rgba(10,28,22,0.12)", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${rateLimitInfo.tpd.pct}%`,
                      background: rateLimitInfo.tpd.pct < 15 ? "#DC2626" : rateLimitInfo.tpd.pct < 40 ? "#D97706" : "#16a34a",
                      borderRadius: "99px",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.65rem", fontWeight: 700, color: rateLimitInfo.tpd.pct < 15 ? "#DC2626" : rateLimitInfo.tpd.pct < 40 ? "#D97706" : "#0A1C16", minWidth: "28px", textAlign: "right" }}>
                    {rateLimitInfo.tpd.pct}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(selectedEngine === "custom" || typeof selectedEngine === "object") && (
        <div
          style={{
            background: "rgba(142, 196, 160, 0.15)",
            borderBottom: "1px solid rgba(10,28,22,0.12)",
            padding: "1rem clamp(1.5rem, 5vw, 5rem)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1.25rem",
            alignItems: "end",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 600 }}>
              AI Provider
            </label>
            <select
              value={customProvider}
              onChange={(e) => setCustomProvider(e.target.value)}
              style={{
                background: "#F5F3EE",
                border: "1px solid #0A1C16",
                padding: "0.4rem 0.75rem",
                fontFamily: "var(--font-sans)",
                fontSize: "0.8rem",
                color: "#0A1C16",
                borderRadius: "2px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="openai_custom">OpenAI (Custom Key)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="deepseek">DeepSeek</option>
              <option value="groq_custom">Groq (Custom Key)</option>
              <option value="mistral">Mistral AI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="cohere">Cohere</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 600 }}>
              Model Selection
            </label>
            <select
              value={customModelDropdown}
              onChange={(e) => {
                setCustomModelDropdown(e.target.value);
                if (e.target.value !== "other") {
                  setCustomModelName(e.target.value);
                }
              }}
              style={{
                background: "#F5F3EE",
                border: "1px solid #0A1C16",
                padding: "0.4rem 0.75rem",
                fontFamily: "var(--font-sans)",
                fontSize: "0.8rem",
                color: "#0A1C16",
                borderRadius: "2px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {(PROVIDER_MODELS[customProvider] || []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {customModelDropdown === "other" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <label style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 600 }}>
                Custom Model Name
              </label>
              <input
                type="text"
                value={customModelName}
                onChange={(e) => setCustomModelName(e.target.value)}
                placeholder="e.g. gpt-4o, llama-3..."
                style={{
                  background: "#F5F3EE",
                  border: "1px solid #0A1C16",
                  padding: "0.4rem 0.75rem",
                  fontFamily: "var(--font-sans)",
                  fontSize: "0.8rem",
                  color: "#0A1C16",
                  borderRadius: "2px",
                  outline: "none",
                }}
              />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 600 }}>
              API Key (Runtime Only)
            </label>
            <input
              type="password"
              value={customApiKey}
              onChange={(e) => setCustomApiKey(e.target.value)}
              placeholder="Enter your API key"
              style={{
                background: "#F5F3EE",
                border: "1px solid #0A1C16",
                padding: "0.4rem 0.75rem",
                fontFamily: "var(--font-sans)",
                fontSize: "0.8rem",
                color: "#0A1C16",
                borderRadius: "2px",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label style={{ fontFamily: "var(--font-display)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#0A1C16", fontWeight: 600 }}>
              Custom Base URL (Optional)
            </label>
            <input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="e.g. https://api.openai.com/v1"
              style={{
                background: "#F5F3EE",
                border: "1px solid #0A1C16",
                padding: "0.4rem 0.75rem",
                fontFamily: "var(--font-sans)",
                fontSize: "0.8rem",
                color: "#0A1C16",
                borderRadius: "2px",
                outline: "none",
              }}
            />
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            background: "rgba(220,38,38,0.08)",
            borderBottom: "1px solid rgba(220,38,38,0.25)",
            padding: "1rem 2rem",
            fontFamily: "var(--font-sans)",
            color: "#991b1b",
            fontSize: "0.9rem",
          }}
        >
          {errorMessage}
        </div>
      )}

      <section
        style={{
          width: "100%",
          flex: 1,
          background: "#8EC4A0",
          paddingTop: "1.5rem",
          paddingBottom: "1.5rem",
          paddingLeft: "clamp(1.5rem, 5vw, 5rem)",
          paddingRight: "clamp(1.5rem, 5vw, 5rem)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ maxWidth: "960px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem", flex: 1, overflow: "hidden" }}>
          <ScrollReveal variant="slide-up" delay={0} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  gap: "2rem",
                  borderBottom: "1px solid #0A1C16",
                  paddingBottom: "0.75rem",
                }}
              >
                {[
                  { key: "file", label: "Upload File", icon: FileText },
                  { key: "text", label: "Paste Text", icon: Type },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => handleTabChange(key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      fontFamily: "var(--font-display)",
                      fontWeight: 300,
                      fontSize: "clamp(0.95rem, 1.5vw, 1.15rem)",
                      letterSpacing: "-0.01em",
                      color: "#0A1C16",
                      opacity: activeTab === key ? 1 : 0.35,
                      background: "none",
                      border: "none",
                      padding: 0,
                      transition: "opacity 0.3s ease",
                      position: "relative",
                    }}
                  >
                    {label}
                    {activeTab === key && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: "-0.75rem",
                          left: 0,
                          width: "100%",
                          height: "2px",
                          background: "#0A1C16",
                        }}
                      />
                    )}
                  </button>
                ))}
              </div>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  flex: 1,
                  minHeight: "220px",
                  border: `1px solid ${dragOver ? "#0A1C16" : "rgba(10,28,22,0.5)"}`,
                  background: dragOver ? "rgba(10,28,22,0.04)" : "#F5F3EE",
                  transition: "border-color 0.3s ease, background 0.3s ease",
                  clipPath: "polygon(0 0, 100% 0, 100% 100%, 28px 100%, 0 calc(100% - 28px))",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {activeTab === "file" ? (
                  <label
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "1.5rem",
                      gap: "1rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md,.json"
                      className="hidden"
                      onChange={(event) => {
                        const selectedFile = event.target.files?.[0] ?? null;
                        setFile(selectedFile);
                        if (selectedFile) {
                          setTextValue(""); // strict isolation
                        }
                      }}
                      style={{ display: "none" }}
                    />

                    <div
                      style={{
                        width: "64px",
                        height: "64px",
                        border: "1px solid #0A1C16",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "background 0.4s ease, color 0.4s ease",
                        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)",
                        background: file ? "#0A1C16" : "transparent",
                        color: file ? "#EBEBEB" : "#0A1C16",
                      }}
                    >
                      <FileText size={28} strokeWidth={1} />
                    </div>

                    <div style={{ textAlign: "center" }}>
                      <h3
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 300,
                          fontSize: "0.95rem",
                          color: "#0A1C16",
                          marginBottom: "0.25rem",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {file?.name ?? "Drop or click to select"}
                      </h3>
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "0.7rem",
                          letterSpacing: "0.15em",
                          textTransform: "uppercase",
                          color: "rgba(10,28,22,0.4)",
                        }}
                      >
                        PDF · DOCX · TXT · MD · JSON
                      </p>
                    </div>

                    {dragOver && (
                      <p
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          color: "rgba(10,28,22,0.6)",
                          fontSize: "0.9rem",
                        }}
                      >
                        Release to upload
                      </p>
                    )}
                  </label>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      padding: "1rem 1.5rem",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginBottom: "0.5rem",
                        opacity: 0.4,
                      }}
                    >
                      <Type size={16} strokeWidth={1.5} />
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "0.65rem",
                          letterSpacing: "0.18em",
                          textTransform: "uppercase",
                        }}
                      >
                        Raw Brief Editor
                      </span>
                    </div>
                    <textarea
                      value={textValue}
                      onChange={(event) => {
                        setTextValue(event.target.value);
                        setFile(null); // strict isolation
                      }}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontFamily: "var(--font-sans)",
                        fontWeight: 300,
                        fontSize: "1rem",
                        lineHeight: 1.5,
                        color: "#0A1C16",
                        resize: "none",
                        minHeight: "150px",
                      }}
                      placeholder="Start typing your project requirements, features, and constraints here..."
                    />
                  </div>
                )}
              </div>
            </div>
          </ScrollReveal>



          <ScrollReveal variant="slide-up" delay={120}>
            <button
              onClick={handleSubmit}
              disabled={isSubmitDisabled}
              style={{
                width: "100%",
                padding: "1rem 1.5rem",
                background: isSubmitDisabled ? "rgba(10,28,22,0.25)" : "#0A1C16",
                color: "#EBEBEB",
                border: "none",
                fontFamily: "var(--font-display)",
                fontWeight: 500,
                fontSize: "0.9rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                transition: "background 0.3s ease, opacity 0.3s ease",
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 20px 100%, 0 calc(100% - 20px))",
              }}
            >
              <span>{isProcessing ? "Synthesising..." : "Generate SRS"}</span>
              {isProcessing ? (
                <Loader2 size={18} strokeWidth={1.5} className="animate-spin" />
              ) : (
                <ArrowRight size={18} strokeWidth={1.5} />
              )}
            </button>
          </ScrollReveal>


          <ScrollReveal variant="slide-up" delay={180}>
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "0.75rem",
                color: "rgba(10,28,22,0.4)",
                lineHeight: 1.4,
                textAlign: "center",
              }}
            >
              The AI engine is configured in the backend and selected automatically, so users only need to provide the project brief.
            </p>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}
