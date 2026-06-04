import { exportBundle, exportCostExcel, exportTeamExcel, triggerAssetDownload } from "@/lib/platformApi";
import { loadApprovedTeam } from "@/lib/workflowArtifacts";

export const getAvailableDeliverables = ({ srsData, teamData } = {}) => {
  const resolvedTeam = teamData ?? loadApprovedTeam();

  return {
    hasSrs: Boolean(srsData?.xlsxPath),
    hasTeam: Boolean(resolvedTeam?.members?.length),
    teamData: resolvedTeam,
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
  const { hasSrs, hasTeam, teamData: resolvedTeam } = getAvailableDeliverables({ srsData, teamData });

  if (hasSrs && hasTeam && costPayload) {
    await exportBundle({ srs: srsData, team: resolvedTeam, cost: costPayload });
    return { hasSrs, hasTeam, hasCost: true };
  }

  if (hasSrs) {
    triggerAssetDownload(srsData.xlsxPath);
  }

  if (hasTeam && resolvedTeam) {
    await exportTeamExcel(resolvedTeam);
  }

  if (costPayload) {
    await exportCostExcel(costPayload);
  }

  return {
    hasSrs,
    hasTeam,
    hasCost: Boolean(costPayload),
  };
};
