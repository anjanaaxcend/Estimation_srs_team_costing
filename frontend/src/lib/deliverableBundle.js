import { exportBundle, exportCostExcel, exportTeamExcel, triggerAssetDownload } from "@/lib/platformApi";
import { loadApprovedTeam } from "@/lib/workflowArtifacts";
import { loadCostDraft } from "@/lib/costEstimationStorage";

export const getAvailableDeliverables = ({ srsData, teamData, costData } = {}) => {
  const resolvedTeam = teamData ?? loadApprovedTeam();
  const resolvedCost = costData ?? loadCostDraft();

  return {
    hasSrs: Boolean(srsData?.xlsxPath),
    hasTeam: Boolean(resolvedTeam?.members?.length),
    hasCost: Boolean(resolvedCost?.members?.length),
    teamData: resolvedTeam,
    costData: resolvedCost,
  };
};

export const getDeliverableBundleLabel = ({ hasSrs, hasTeam, hasCost } = {}) => {
  if (hasSrs && hasTeam && hasCost) return "Download SRS + Team + Cost Bundle";
  if (hasSrs && hasTeam) return "Download SRS + Team Allocation";
  if (hasSrs && hasCost) return "Download SRS + Cost";
  if (hasTeam && hasCost) return "Download Team + Cost";
  if (hasSrs) return "Download SRS";
  if (hasTeam) return "Download Team Allocation";
  if (hasCost) return "Download Cost Estimation";
  return "Download Deliverables";
};

export const downloadDeliverableBundle = async ({ srsData, teamData, costPayload } = {}) => {
  const { hasSrs, hasTeam, hasCost, teamData: resolvedTeam, costData: resolvedCost } = getAvailableDeliverables({ srsData, teamData });
  const activeCost = costPayload ?? resolvedCost;

  if (hasSrs && hasTeam && activeCost) {
    await exportBundle({ srs: srsData, team: resolvedTeam, cost: activeCost });
    return { hasSrs, hasTeam, hasCost: true };
  }

  if (hasSrs) {
    triggerAssetDownload(srsData.xlsxPath);
  }

  if (hasTeam && resolvedTeam) {
    await exportTeamExcel(resolvedTeam);
  }

  if (activeCost) {
    await exportCostExcel(activeCost);
  }

  return {
    hasSrs,
    hasTeam,
    hasCost: Boolean(activeCost),
  };
};
