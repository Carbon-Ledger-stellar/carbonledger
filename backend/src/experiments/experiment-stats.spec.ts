import {
  chiSquareSurvival,
  describe as describeSample,
  normalCdf,
  normalQuantile,
  requiredSampleSize,
  sampleRatioMismatch,
  studentTTwoSidedP,
  twoProportionZTest,
  welchTTest,
} from './experiment-stats';

// Expected values are standard statistical-table critical values.

describe('experiment-stats (#1326)', () => {
  describe('distributions', () => {
    it('normalCdf matches the standard normal table', () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 10);
      expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 7);
      expect(normalCdf(-1.644853626951472)).toBeCloseTo(0.05, 7);
    });

    it('normalQuantile inverts normalCdf', () => {
      expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
      expect(normalQuantile(0.8)).toBeCloseTo(0.841621, 5);
    });

    it('Student t two-sided p at the 5% critical values', () => {
      expect(studentTTwoSidedP(2.228139, 10)).toBeCloseTo(0.05, 5);
      expect(studentTTwoSidedP(2.042272, 30)).toBeCloseTo(0.05, 5);
      expect(studentTTwoSidedP(0, 10)).toBeCloseTo(1, 10);
    });

    it('chi-square survival at the 5% critical values', () => {
      expect(chiSquareSurvival(3.841459, 1)).toBeCloseTo(0.05, 5);
      expect(chiSquareSurvival(5.991465, 2)).toBeCloseTo(0.05, 5);
    });
  });

  describe('twoProportionZTest', () => {
    it('detects a 10% → 13% lift on 1000 subjects each', () => {
      const r = twoProportionZTest({ n: 1000, conversions: 100 }, { n: 1000, conversions: 130 });
      expect(r.difference).toBeCloseTo(0.03, 10);
      expect(r.relativeLift).toBeCloseTo(0.3, 10);
      expect(r.statistic).toBeCloseTo(2.1027, 3);
      expect(r.pValue).toBeCloseTo(0.0355, 3);
      expect(r.ci95[0]).toBeGreaterThan(0);
      expect(r.ci95[1]).toBeGreaterThan(r.difference);
    });

    it('returns p=1 when a variant has no subjects', () => {
      expect(twoProportionZTest({ n: 0, conversions: 0 }, { n: 10, conversions: 5 }).pValue).toBe(1);
    });

    it('returns p=1 when neither variant converts', () => {
      expect(twoProportionZTest({ n: 50, conversions: 0 }, { n: 50, conversions: 0 }).pValue).toBe(1);
    });
  });

  describe('welchTTest', () => {
    it('compares means with unequal variances', () => {
      const r = welchTTest({ n: 30, mean: 10, variance: 4 }, { n: 30, mean: 11.5, variance: 9 });
      expect(r.statistic).toBeCloseTo(2.2787, 3);
      expect(r.df).toBeCloseTo(50.52, 1);
      // Between the df=50 critical values for p=0.05 (2.009) and p=0.02 (2.403).
      expect(r.pValue).toBeGreaterThan(0.02);
      expect(r.pValue).toBeLessThan(0.05);
      expect(r.ci95[0]).toBeGreaterThan(0);
    });

    it('needs at least two observations per variant', () => {
      expect(welchTTest({ n: 1, mean: 1, variance: 0 }, { n: 5, mean: 3, variance: 1 }).pValue).toBe(1);
    });

    it('handles zero variance', () => {
      expect(welchTTest({ n: 5, mean: 2, variance: 0 }, { n: 5, mean: 2, variance: 0 }).pValue).toBe(1);
      expect(welchTTest({ n: 5, mean: 2, variance: 0 }, { n: 5, mean: 3, variance: 0 }).pValue).toBe(0);
    });
  });

  describe('sampleRatioMismatch', () => {
    it('accepts a normal 52/48 split', () => {
      const r = sampleRatioMismatch([520, 480], [50, 50]);
      expect(r.chiSquare).toBeCloseTo(1.6, 10);
      expect(r.pValue).toBeCloseTo(0.2059, 3);
    });

    it('flags a broken 60/40 split on a 50/50 experiment', () => {
      expect(sampleRatioMismatch([6000, 4000], [50, 50]).pValue).toBeLessThan(0.001);
    });

    it('honours unequal weights', () => {
      expect(sampleRatioMismatch([900, 100], [90, 10]).chiSquare).toBeCloseTo(0, 10);
    });
  });

  it('requiredSampleSize for 10% → 12% at α=0.05, power=0.8', () => {
    expect(requiredSampleSize(0.1, 0.02)).toBe(3839);
  });

  it('describe computes mean and sample variance', () => {
    expect(describeSample([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ n: 8, mean: 5, variance: 32 / 7 });
    expect(describeSample([])).toEqual({ n: 0, mean: 0, variance: 0 });
  });
});
