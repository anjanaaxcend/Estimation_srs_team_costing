const COST_STORAGE_KEY = "ai-project-planner-cost-estimation-v1";
const createId = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_MISCELLANEOUS_AMOUNT = "0";

const createDefaultMiscellaneous = () => ({
  id: createId(),
  label: "Miscellaneous",
  amount: DEFAULT_MISCELLANEOUS_AMOUNT,
});

export const loadCostDraft = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveCostDraft = (draft) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COST_STORAGE_KEY, JSON.stringify(draft));
};

export const clearCostDraft = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COST_STORAGE_KEY);
};

export const createCostDraftFromTeamData = (teamData, defaultHours = 160) => ({
  project_name: teamData?.project_name || "",
  currency: teamData?.currency || "INR",
  isFromApprovedTeam: true,
  source_summary: teamData?.logic_summary || "",
  members: (teamData?.members || [])
    .filter((member) => Number(member.count) > 0)
    .map((member) => ({
      id: createId(),
      role: member.role || "",
      count: String(member.count ?? 0),
      hourly_rate: String(member.hourly_rate ?? ""),
      // Store the original INR base rate so it can be restored exactly on back-conversion
      base_inr_rate: teamData?.currency === "INR" && member.hourly_rate ? String(member.hourly_rate) : undefined,
      weekly_hours: String(member.weekly_hours ?? teamData?.weekly_hours_per_member ?? 40),
      hours_per_member: String(
        member.hours_per_member
          ?? (
            teamData?.total_project_hours && teamData?.total_size
              ? teamData.total_project_hours / teamData.total_size
              : defaultHours
          )
      ),
      notes: member.description || "",
    })),
  project_management_cost: "",
  project_management_percent: "15",
  risk_contingency_percent: "10",
  miscellaneous_costs: [],
});

export { DEFAULT_MISCELLANEOUS_AMOUNT, createDefaultMiscellaneous };
