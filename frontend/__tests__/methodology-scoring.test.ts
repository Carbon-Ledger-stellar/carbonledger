import { breakdownMethodologyScore, RUBRIC_DIMENSIONS } from "../lib/methodology-scoring";

describe("breakdownMethodologyScore", () => {
  it("sums dimension scores to the total", () => {
    const b = breakdownMethodologyScore(82);
    const sum =
      b.additionality +
      b.quantification +
      b.permanence +
      b.leakageCoBenefits +
      b.governance;
    expect(sum).toBe(82);
    expect(b.total).toBe(82);
  });

  it("uses rubric max weights", () => {
    expect(RUBRIC_DIMENSIONS.reduce((s, d) => s + d.max, 0)).toBe(100);
  });
});
