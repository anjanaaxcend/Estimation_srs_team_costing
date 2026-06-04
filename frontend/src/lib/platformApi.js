const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1";
const ASSET_BASE = process.env.NEXT_PUBLIC_ASSET_BASE ?? "";

export const getSessionId = () => {
  if (typeof window === "undefined") return null;
  let sessionId = sessionStorage.getItem("scopesense_session_id");
  if (!sessionId) {
    sessionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem("scopesense_session_id", sessionId);
  }
  return sessionId;
};

const apiFetch = async (path, options = {}) => {
  let response;
  try {
    const token = localStorage.getItem("scopesense_token");
    const headers = { ...options.headers };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const sessionId = getSessionId();
    if (sessionId) {
      headers["X-Session-ID"] = sessionId;
    }
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error(
      "Backend API is not reachable. Make sure the backend is running on http://localhost:8001 and try again.",
    );
  }

  if (!response.ok) {
    let message = `Request failed for ${path}`;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (typeof payload.detail === "string") {
        message = payload.detail;
      } else if (Array.isArray(payload.detail)) {
        message = payload.detail.map((item) => item.msg).join(", ");
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return response.json();
};

const toAssetUrl = (path) => {
  if (!path) {
    return null;
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  if (ASSET_BASE) {
    return `${ASSET_BASE}${path}`;
  }
  return path;
};

export const normalizeSrs = (payload = {}) => {
  const structuredRequirements = payload.structured_requirements ?? payload.structuredRequirements ?? null;

  return {
    title: payload.title,
    sections: payload.sections ?? [],
    docxPath: toAssetUrl(payload.docx_path ?? payload.docxPath),
    xlsxPath: toAssetUrl(payload.xlsx_path ?? payload.xlsxPath),
    pdfPath: toAssetUrl(payload.pdf_path ?? payload.pdfPath),
    docx_path: payload.docx_path ?? payload.docxPath ?? null,
    xlsx_path: payload.xlsx_path ?? payload.xlsxPath ?? null,
    pdf_path: payload.pdf_path ?? payload.pdfPath ?? null,
    cleanedText: payload.cleaned_text ?? payload.cleanedText ?? "",
    structuredRequirements,
    selectedModel: payload.selected_model ?? payload.selectedModel ?? null,
    pipelineTrace: payload.pipeline_trace ?? payload.pipelineTrace ?? [],
  };
};

export const triggerAssetDownload = (path, filename) => {
  const assetUrl = toAssetUrl(path);
  if (!assetUrl) return;
  const anchor = document.createElement("a");
  anchor.href = assetUrl;
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

export const generateSrsFromText = async ({ projectTitle, rawText, selectedEngine }) =>
  apiFetch("/srs/generate-from-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: projectTitle?.trim() || undefined,
      raw_text: rawText,
      selected_model: selectedEngine ? (typeof selectedEngine === "object" ? selectedEngine : { provider: selectedEngine }) : undefined,
    }),
  });

export const generateSrsFromFile = async ({ projectTitle, file, selectedEngine }) => {
  const formData = new FormData();
  formData.append("file", file);
  if (projectTitle?.trim()) {
    formData.append("project_name", projectTitle.trim());
  }
  if (selectedEngine) {
    if (typeof selectedEngine === "object") {
      if (selectedEngine.provider) formData.append("selected_provider", selectedEngine.provider);
      if (selectedEngine.model) formData.append("selected_model", selectedEngine.model);
      if (selectedEngine.base_url) formData.append("selected_base_url", selectedEngine.base_url);
      if (selectedEngine.api_key) formData.append("selected_api_key", selectedEngine.api_key);
    } else {
      formData.append("selected_provider", selectedEngine);
    }
  }

  return apiFetch("/srs/generate-from-file", {
    method: "POST",
    body: formData,
  });
};

export const runSrsPipeline = async ({ projectTitle, source, rawText, file, selectedEngine }) => {
  if (source === "file" && file) {
    const srs = await generateSrsFromFile({ projectTitle, file, selectedEngine });
    const normalized = normalizeSrs(srs);
    return { srs: normalized, cleanedText: normalized.cleanedText };
  }

  const srs = await generateSrsFromText({ projectTitle, rawText, selectedEngine });
  const normalized = normalizeSrs(srs);
  return { srs: normalized, cleanedText: normalized.cleanedText };
};

export const regenerateSrs = async ({ rawText, projectTitle, userFeedback, feedbackHistory, attempt, previousOutput, selectedEngine, priorRequirements }) => {
  const srs = await apiFetch("/srs/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_text: rawText,
      project_name: projectTitle?.trim() || undefined,
      user_feedback: userFeedback || "",
      feedback_history: feedbackHistory || [],
      attempt: attempt || 1,
      previous_output: previousOutput || [],
      selected_model: selectedEngine ? (typeof selectedEngine === "object" ? selectedEngine : { provider: selectedEngine }) : undefined,
      prior_requirements: priorRequirements || undefined,
    }),
  });
  const normalized = normalizeSrs(srs);
  return { srs: normalized, cleanedText: normalized.cleanedText };
};

export const saveFeedback = async ({ rawInput, extracted, userFeedback }) => {
  return apiFetch("/srs/save-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_input: rawInput,
      extracted: extracted,
      user_feedback: userFeedback || "",
      session_id: getSessionId() || undefined,
    }),
  });
};

export const getTempDraft = async () => {
  return apiFetch("/srs/temp-draft");
};

export const saveTeamDraft = async (teamDraft) => {
  return apiFetch("/srs/temp-draft/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: teamDraft }),
  });
};

export const saveCostDraftApi = async (costDraft) => {
  return apiFetch("/srs/temp-draft/cost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: costDraft }),
  });
};

export const getOllamaModels = async () => {
  return apiFetch("/health/ollama-models");
};

export const getRateLimitStatus = async (engine = "openai") => {
  return apiFetch(`/health/rate-limit?engine=${encodeURIComponent(engine)}`);
};

export const deleteTempDraft = async () => {
  return apiFetch("/srs/temp-draft", { method: "DELETE" });
};

export const getApprovedSRS = async () => {
  return apiFetch("/srs/approved");
};

export const analyzeTeam = async (file, selectedEngine, companyRoster, planningPreferences) => {
  const formData = new FormData();
  formData.append("file", file);
  if (selectedEngine) {
    if (typeof selectedEngine === "object") {
      if (selectedEngine.provider) formData.append("selected_provider", selectedEngine.provider);
      if (selectedEngine.model) formData.append("selected_model", selectedEngine.model);
      if (selectedEngine.base_url) formData.append("selected_base_url", selectedEngine.base_url);
      if (selectedEngine.api_key) formData.append("selected_api_key", selectedEngine.api_key);
    } else {
      formData.append("selected_provider", selectedEngine);
    }
  }
  if (companyRoster) {
    formData.append("company_roster", JSON.stringify(companyRoster));
  }
  if (planningPreferences) {
    formData.append("planning_preferences", JSON.stringify(planningPreferences));
  }

  return apiFetch("/team/analyze-srs", {
    method: "POST",
    body: formData,
  });
};

export const analyzeTeamFromText = async ({ text, title, selectedEngine, companyRoster, planningPreferences }) => {
  return apiFetch("/team/analyze-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_text: text,
      project_name: title?.trim() || "",
      selected_model: selectedEngine ? (typeof selectedEngine === "object" ? selectedEngine : { provider: selectedEngine }) : undefined,
      company_roster: companyRoster || undefined,
      planning_preferences: planningPreferences || undefined,
    }),
  });
};

export const extractTeamFromFile = async (file) => {
  const formData = new FormData();
  formData.append("file", file);

  return apiFetch("/team/extract-document-team", {
    method: "POST",
    body: formData,
  });
};

export const extractTeamFromText = async ({ text, title }) => {
  return apiFetch("/team/extract-text-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_text: text,
      project_name: title?.trim() || "",
    }),
  });
};

export const analyzeCostDocument = async (file) => {
  const formData = new FormData();
  formData.append("file", file);

  return apiFetch("/cost/analyze-document", {
    method: "POST",
    body: formData,
  });
};

export const exportTeamExcel = async (teamData) => {
  const token = localStorage.getItem("scopesense_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/export/team`, {
    method: "POST",
    headers,
    body: JSON.stringify(teamData),
  });

  if (!response.ok) throw new Error("Export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${teamData.project_name.replace(/\s+/g, "_")}_Team_Design.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const exportTeamWord = async (teamData) => {
  const token = localStorage.getItem("scopesense_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/export/team/docx`, {
    method: "POST",
    headers,
    body: JSON.stringify(teamData),
  });

  if (!response.ok) throw new Error("Word export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${teamData.project_name.replace(/\s+/g, "_")}_Team_Design.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const exportTeamPdf = async (teamData) => {
  const token = localStorage.getItem("scopesense_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/export/team/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify(teamData),
  });

  if (!response.ok) throw new Error("PDF export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${teamData.project_name.replace(/\s+/g, "_")}_Team_Design.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const exportCostExcel = async (costData) => {
  const token = localStorage.getItem("scopesense_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/cost/export-excel`, {
    method: "POST",
    headers,
    body: JSON.stringify(costData),
  });

  if (!response.ok) throw new Error("Cost export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(costData.project_name || "Project").replace(/\s+/g, "_")}_Cost_Estimation.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export const exportBundle = async ({ srs, team, cost }) => {
  const token = localStorage.getItem("scopesense_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/export/bundle`, {
    method: "POST",
    headers,
    body: JSON.stringify({ srs, team, cost }),
  });

  if (!response.ok) throw new Error("Bundle export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  const filename = `${(srs.structuredRequirements?.project_name || "Project").replace(/\s+/g, "_")}_ScopeSense_Master.xlsx`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// --- Token Credit System & Admin Endpoints ---

export const getUserPlan = async () => {
  return apiFetch("/user/plan");
};

export const getUserApiKeys = async () => {
  return apiFetch("/user/api-keys");
};

export const saveUserApiKey = async (provider, apiKey) => {
  return apiFetch("/user/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
};

export const deleteUserApiKey = async (provider) => {
  return apiFetch(`/user/api-keys/${provider}`, {
    method: "DELETE",
  });
};

export const getTokenUsageHistory = async () => {
  return apiFetch("/user/token-usage");
};

export const getAdminStats = async () => {
  return apiFetch("/admin/stats");
};

export const getAdminUsers = async () => {
  return apiFetch("/admin/users");
};

export const updateAdminUserPlan = async (userId, { tier, custom_budget }) => {
  return apiFetch(`/admin/users/${userId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier, custom_budget }),
  });
};

export const getAdminTokenUsage = async () => {
  return apiFetch("/admin/token-usage");
};
