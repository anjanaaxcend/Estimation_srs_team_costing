const TESTING_ROLE_KEYWORDS = [
  "qa",
  "quality assurance",
  "tester",
  "testing",
  "test engineer",
  "test analyst",
  "sdet",
];

const DEPLOYMENT_ROLE_KEYWORDS = [
  "devops",
  "platform engineer",
  "release engineer",
  "site reliability",
  "sre",
  "cloud engineer",
  "deployment",
];

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isTestingRole = (roleName = "") => {
  const normalized = String(roleName).toLowerCase();
  return TESTING_ROLE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

export const isDeploymentRole = (roleName = "") => {
  const normalized = String(roleName).toLowerCase();
  return DEPLOYMENT_ROLE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

export const isDevRole = (roleName = "") => {
  const normalized = String(roleName).toLowerCase();
  return (
    (normalized.includes("developer") || normalized.includes("engineer") || normalized.includes("architect")) &&
    !normalized.includes("lead") &&
    !isTestingRole(roleName) &&
    !isDeploymentRole(roleName)
  );
};

export const isManagementRole = (roleName = "") => {
  const normalized = String(roleName).toLowerCase();
  const keywords = [
    "project manager",
    "program manager",
    "scrum master",
    "business analyst",
    "product manager",
    "pm",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
};

export const calculateCostTotals = ({
  members = [],
  miscellaneousCosts = [],
  projectManagementCost = "",
  projectManagementPercent = "",
  riskContingencyPercent = "",
} = {}) => {
  let developmentTotal = 0;
  let testingTotal = 0;
  let deploymentTotal = 0;
  let managementSalaryTotal = 0;

  // First pass: find total dev hours of the team to split lead developer hours correctly
  const devMembers = members.filter((m) => isDevRole(m.role));
  const totalDevHours = devMembers.reduce((sum, m) => sum + parseNumber(m.count) * parseNumber(m.hours_per_member), 0);

  const memberBreakdown = members.map((member) => {
    const count = parseNumber(member.count);
    const hourlyRate = parseNumber(member.hourly_rate);
    const hoursPerMember = parseNumber(member.hours_per_member);
    const costPerEmployee = hourlyRate * hoursPerMember;
    const total = count * costPerEmployee;

    if (isManagementRole(member.role)) {
      managementSalaryTotal += total;
    } else {
      const roleLower = String(member.role).toLowerCase();
      if (roleLower.includes("lead")) {
        // Lead Developer: split hours into testing (30%), deployment (10%), and other (remainder)
        const testingHours = totalDevHours * 0.30;
        const deploymentHours = totalDevHours * 0.10;
        const otherHours = Math.max(0, hoursPerMember - testingHours - deploymentHours);
        
        const testingShare = hoursPerMember > 0 ? testingHours / hoursPerMember : 0.375;
        const deploymentShare = hoursPerMember > 0 ? deploymentHours / hoursPerMember : 0.125;
        const otherShare = hoursPerMember > 0 ? otherHours / hoursPerMember : 0.50;
        
        testingTotal += total * testingShare;
        deploymentTotal += total * deploymentShare;
        developmentTotal += total * otherShare;
      } else if (isTestingRole(member.role)) {
        testingTotal += total;
      } else if (isDeploymentRole(member.role)) {
        deploymentTotal += total;
      } else {
        developmentTotal += total;
      }
    }

    return {
      ...member,
      count,
      hourlyRate,
      hoursPerMember,
      costPerEmployee,
      roleTotal: total,
      salaryTotal: total,
      total,
    };
  });

  const salaryTotal = developmentTotal + testingTotal + deploymentTotal;
  const projectManagementOverride = parseNumber(projectManagementCost);
  const projectManagementRate = parseNumber(projectManagementPercent) > 0 ? parseNumber(projectManagementPercent) : 15;
  const projectManagement = projectManagementOverride > 0 
    ? projectManagementOverride 
    : (managementSalaryTotal > 0 
      ? managementSalaryTotal 
      : (salaryTotal > 0 ? salaryTotal * (projectManagementRate / 100) : 0));
  
  // Exclude Risk and Negotiation from miscellaneousCosts to avoid double counting
  const cleanMiscCosts = miscellaneousCosts.filter(
    (item) => !item.label.toLowerCase().includes("risk") && !item.label.toLowerCase().includes("negotiation")
  );
  const miscTotal = cleanMiscCosts.reduce((sum, item) => sum + parseNumber(item.amount), 0);
  
  const riskRate = parseNumber(riskContingencyPercent) > 0 ? parseNumber(riskContingencyPercent) : 10;
  const riskContingency = salaryTotal > 0 ? (salaryTotal + projectManagement + miscTotal) * (riskRate / 100) : 0;
  
  const negotiationRate = 5;
  const negotiationBuffer = salaryTotal > 0 ? (salaryTotal + projectManagement + miscTotal) * (negotiationRate / 100) : 0;
  
  const projectTotalEstimation = salaryTotal + projectManagement + miscTotal + riskContingency + negotiationBuffer;
  const grandTotal = projectTotalEstimation;

  return {
    memberBreakdown,
    developmentTotal,
    testingTotal,
    deploymentTotal,
    salaryTotal,
    projectManagement,
    projectManagementRate,
    riskContingency,
    riskRate,
    negotiationBuffer,
    negotiationRate,
    miscTotal,
    projectTotalEstimation,
    grandTotal,
  };
};
