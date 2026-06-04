const TEAM_STORAGE_KEY = "nexaforge-approved-team-v1";

export const saveApprovedTeam = (teamData) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(teamData));
};

export const loadApprovedTeam = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEAM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearApprovedTeam = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TEAM_STORAGE_KEY);
};
