const STORAGE_KEY = "ai-project-planner-axcend-estimation-v1";

export const saveAxcendEstimationDraft = (draft) => {
  if (typeof window === "undefined" || !draft) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
};

export const loadAxcendEstimationDraft = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearAxcendEstimationDraft = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
};
