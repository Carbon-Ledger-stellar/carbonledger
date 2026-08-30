/** Rubric dimension max points — see METHODOLOGY_SCORING_RUBRIC.md */

export interface MethodologyScoreBreakdown {
  additionality: number;
  quantification: number;
  permanence: number;
  leakageCoBenefits: number;
  governance: number;
  total: number;
}

export const RUBRIC_DIMENSIONS: {
  key: keyof Omit<MethodologyScoreBreakdown, "total">;
  label: string;
  max: number;
}[] = [
  { key: "additionality", label: "Additionality", max: 30 },
  { key: "quantification", label: "Quantification & Monitoring", max: 25 },
  { key: "permanence", label: "Permanence & Risk Management", max: 20 },
  { key: "leakageCoBenefits", label: "Leakage & Co-Benefits", max: 15 },
  { key: "governance", label: "Governance & Transparency", max: 10 },
];

const MAX_TOTAL = RUBRIC_DIMENSIONS.reduce((sum, d) => sum + d.max, 0);

/**
 * When only the aggregate score is stored, allocate dimension scores proportionally
 * to each rubric weight so the breakdown sums to `totalScore`.
 */
export function breakdownMethodologyScore(totalScore: number): MethodologyScoreBreakdown {
  const clamped = Math.max(0, Math.min(MAX_TOTAL, Math.round(totalScore)));
  let remaining = clamped;
  const breakdown: MethodologyScoreBreakdown = {
    additionality: 0,
    quantification: 0,
    permanence: 0,
    leakageCoBenefits: 0,
    governance: 0,
    total: clamped,
  };

  RUBRIC_DIMENSIONS.forEach((dim, index) => {
    if (index === RUBRIC_DIMENSIONS.length - 1) {
      breakdown[dim.key] = remaining;
      return;
    }
    const share = Math.floor((clamped * dim.max) / MAX_TOTAL);
    breakdown[dim.key] = share;
    remaining -= share;
  });

  return breakdown;
}
