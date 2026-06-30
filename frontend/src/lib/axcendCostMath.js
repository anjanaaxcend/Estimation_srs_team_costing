/**
 * axcendCostMath.js
 *
 * Pure calculation functions that mirror the AXCEND "Overall Software Design
 * Efforts" Excel sheet.  Nothing is hard-coded — all percentages come from
 * the inputs supplied by the caller.
 *
 * Excel column flow:
 *   Hours → Days (÷8) → Rate per Day → Total Dev Cost
 *
 * Cost roll-up (bottom section):
 *   Development subtotal
 *   + PM (% of dev subtotal)
 *   = Total Cost
 *   + Finance Cost (1.5 % default)
 *   + Forex risk  (1 %   default)
 *   + Risk        (25 %  default)
 *   = SubTotal
 *   − Nego deduction
 *   = Final Quote
 *
 * Rate / hr = Final Quote ÷ Total Hours
 */

export const HOURS_PER_DAY = 8;
export const DAYS_PER_MONTH = 20; // working days

// ─── Experience → S-level mapping ────────────────────────────────────────────

export function expYearsToSLevel(years) {
  const y = parseFloat(years) || 0;
  if (y >= 10) return "S3"; // Sr  >=10 yrs
  if (y >= 5) return "S2";  // Mid 5-9 yrs
  return "S1";              // Jr  <5 yrs
}

export function sLevelLabel(slevel) {
  switch (slevel) {
    case "S3": return "S3 Developer";
    case "S2": return "S2 Developer";
    case "S1": return "S1 Developer";
    default:   return slevel;
  }
}

// ─── Main calculation ─────────────────────────────────────────────────────────

/**
 * @param {Object} p
 * @param {Array}  p.rows              Each row: { role, count, experience_years, hours_per_member, rate_per_day, is_pm }
 * @param {number} p.pm_pct            Project Management % of dev subtotal      (default 10)
 * @param {number} p.finance_cost_pct  Finance Cost %                            (default 1.5)
 * @param {number} p.forex_risk_pct    Forex risk %                              (default 1)
 * @param {number} p.risk_pct          Risk contingency %                        (default 25)
 * @param {number} p.nego_deduction    Negotiation deduction as % of subtotal    (default 0)
 */
export function calculateAxcendCost({
  rows = [],
  pm_pct = 15,
  finance_cost_pct = 1.5,
  forex_risk_pct = 1,
  risk_pct = 25,
  nego_deduction_pct = 0,
}) {
  // ── Dev rows (non-PM) ─────────────────────────────────────────────────────
  const devRows = rows.filter((r) => !r.is_pm);
  const pmRows  = rows.filter((r) =>  r.is_pm);

  const enrichedDevRows = devRows.map((r) => {
    const totalHours   = Math.round((parseFloat(r.count) || 1) * (parseFloat(r.hours_per_member) || 0));
    const manDays      = Math.round(totalHours / HOURS_PER_DAY);
    const ratePerDay   = Math.round(parseFloat(r.rate_per_day) || 0);
    const totalDevCost = Math.round(manDays * ratePerDay);
    return {
      ...r,
      total_hours: totalHours,
      man_days: manDays,
      rate_per_day: ratePerDay,
      total_dev_cost: totalDevCost,
      s_level: expYearsToSLevel(r.experience_years),
    };
  });

  const totalDevHours = enrichedDevRows.reduce((s, r) => s + r.total_hours, 0);
  const totalDevDays  = Math.round(totalDevHours / HOURS_PER_DAY);
  const devSubtotal   = enrichedDevRows.reduce((s, r) => s + r.total_dev_cost, 0);

  // ── PM row (15% of engineering time, excluding pre-engineering) ───────────
  const preEngRows = enrichedDevRows.filter((r) => r.role.toLowerCase().includes("pre-engineering") || r.role.toLowerCase().includes("pre engineering"));
  const engRows = enrichedDevRows.filter((r) => !r.role.toLowerCase().includes("pre-engineering") && !r.role.toLowerCase().includes("pre engineering"));
  const totalEngHours = engRows.reduce((s, r) => s + r.total_hours, 0);
  const totalEngDays = Math.round(totalEngHours / HOURS_PER_DAY);
  const engSubtotal = engRows.reduce((s, r) => s + r.total_dev_cost, 0);

  const pmHours     = Math.round((pm_pct / 100) * totalDevHours);
  const pmDays      = Math.round(pmHours / HOURS_PER_DAY);
  // PM rate = weighted avg of engineering rows, or use explicit pm rate if supplied
  const avgDevRate  = totalEngDays > 0 ? engSubtotal / totalEngDays : 0;
  const pmRow       = pmRows[0] || null;
  const pmRatePerDay = pmRow?.rate_per_day ? Math.round(parseFloat(pmRow.rate_per_day)) : Math.round(avgDevRate * 1.2);
  const pmCost       = Math.round(pmDays * pmRatePerDay);

  const totalAllHours = totalDevHours + pmHours;
  const totalAllDays  = Math.round(totalAllHours / HOURS_PER_DAY);
  const totalCost     = Math.round(devSubtotal + pmCost);

  // ── Summary metrics ───────────────────────────────────────────────────────
  const manDaysTotal   = totalAllDays;
  const manMonths      = Math.round(manDaysTotal / DAYS_PER_MONTH);
  const manWeeks       = Math.round(manDaysTotal / 5);
  const inDays         = Math.round(totalDevDays);

  // ── Finance section ───────────────────────────────────────────────────────
  const financeCost  = Math.round((finance_cost_pct / 100) * totalCost);
  const forexCost    = Math.round((forex_risk_pct   / 100) * totalCost);
  const riskAmount   = Math.round((risk_pct         / 100) * totalCost);
  const subTotal     = Math.round(totalCost + financeCost + forexCost + riskAmount);
  const negoAmount   = Math.round((nego_deduction_pct / 100) * subTotal);
  const finalQuote   = Math.round(subTotal - negoAmount);
  const ratePerHr    = totalAllHours > 0 ? Math.round(finalQuote / totalAllHours) : 0;

  return {
    // Dev rows with computed columns
    enrichedDevRows,
    totalDevHours,
    totalDevDays,
    devSubtotal,

    // PM
    pmHours,
    pmDays,
    pmRatePerDay,
    pmCost,
    pmPct: pm_pct,

    // Totals
    totalAllHours,
    totalAllDays,
    totalCost,

    // Summary
    inDays,
    manDaysTotal,
    manMonths,
    manWeeks,

    // Finance section
    financeCost,
    financeCostPct: finance_cost_pct,
    forexCost,
    forexRiskPct: forex_risk_pct,
    riskAmount,
    riskPct: risk_pct,
    subTotal,
    negoAmount,
    negoPct: nego_deduction_pct,
    finalQuote,
    ratePerHr,
  };
}
