import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

const ROLE_MULTIPLIERS = {
  "Full Stack": 1.0,
  "Backend": 1.2,
  "Frontend": 1.1,
  "UI/UX": 1.5,
};

export function DeveloperTimeEstimator({ modules, features }) {
  const [selectedRole, setSelectedRole] = useState("Full Stack");
  const [isExpanded, setIsExpanded] = useState(false);

  // Basic effort per unit (hours)
  const BASE_HOURS_PER_MODULE = 2; // hours per module
  const BASE_HOURS_PER_FEATURE = 1; // hours per feature

  // Compute raw effort
  const rawEffort = useMemo(() => {
    const moduleEffort = modules.length * BASE_HOURS_PER_MODULE;
    const featureEffort = features.length * BASE_HOURS_PER_FEATURE;
    return moduleEffort + featureEffort;
  }, [modules, features]);

  const totalEffort = useMemo(() => {
    const multiplier = ROLE_MULTIPLIERS[selectedRole] ?? 1.0;
    return Math.round(rawEffort * multiplier * 10) / 10; // round to 1 decimal
  }, [rawEffort, selectedRole]);

  const handleRoleChange = (e) => {
    setSelectedRole(e.target.value);
  };

  return (
    <div className="border border-parcelles-dark p-4 bg-parcelles-sage/20 chamfer-bottom-right">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsExpanded((c) => !c)}>
        <h3 className="font-display text-lg">Developer Time Estimator</h3>
        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </div>
      {isExpanded && (
        <div className="mt-4 space-y-4">
          <label className="block font-display">Select Your Role</label>
          <select
            className="w-full p-2 border border-parcelles-dark bg-transparent"
            style={{ cursor: "pointer" }}
            value={selectedRole}
            onChange={handleRoleChange}
          >
            {Object.keys(ROLE_MULTIPLIERS).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          {/* If Full Stack, hide UI/UX specific advice */}
          {selectedRole !== "Full Stack" && (
            <p className="text-sm text-parcelles-dark/70">
              Note: As you are not a Full‑Stack developer, consider allocating dedicated UI/UX resources if the project includes heavy front‑end work.
            </p>
          )}

          <div className="p-2 bg-parcelles-dark/5 rounded">
            <p className="font-display">
              Estimated Effort: <span className="font-bold">{totalEffort} hrs</span>
            </p>
            <p className="text-sm text-parcelles-dark/60">
              Calculation: (Modules × {BASE_HOURS_PER_MODULE}h + Features × {BASE_HOURS_PER_FEATURE}h) × Role Multiplier ({ROLE_MULTIPLIERS[selectedRole]})
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
