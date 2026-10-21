/**
 * Statistics for A/B experiment analysis (#1326).
 *
 * Dependency-free implementations of the tests the results endpoint needs:
 *  - two-proportion z-test          conversion metrics
 *  - Welch's t-test                 continuous metrics (unequal variances)
 *  - chi-square goodness of fit     sample ratio mismatch (SRM)
 *  - required sample size           planning / "enough data yet?"
 *
 * Special functions follow Numerical Recipes (Lanczos log-gamma, continued
 * fraction incomplete beta, series/continued-fraction incomplete gamma).
 */

export interface ProportionSample {
  n: number;
  conversions: number;
}

export interface MeanSample {
  n: number;
  mean: number;
  /** Sample variance (n - 1 denominator). */
  variance: number;
}

export interface TestResult {
  /** Treatment minus control, in metric units (rate for conversions). */
  difference: number;
  /** difference / control, or null when control is 0. */
  relativeLift: number | null;
  statistic: number;
  pValue: number;
  /** 95% confidence interval for `difference`. */
  ci95: [number, number];
}

// ── Special functions ─────────────────────────────────────────────────────────

const LANCZOS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
];

export function logGamma(x: number): number {
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of LANCZOS) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function upperIncompleteGamma(a: number, x: number): number {
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

// ── Distributions ─────────────────────────────────────────────────────────────

export function normalCdf(z: number): number {
  // Φ(z) = 1 - Q(1/2, z²/2) / 2 for z ≥ 0
  const tail = 0.5 * upperIncompleteGamma(0.5, (z * z) / 2);
  return z >= 0 ? 1 - tail : tail;
}

/** Two-sided p-value of a Student-t statistic with `df` degrees of freedom. */
export function studentTTwoSidedP(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

export function chiSquareSurvival(chi2: number, df: number): number {
  return upperIncompleteGamma(df / 2, chi2 / 2);
}

/** Inverse of a monotonically increasing CDF on [lo, hi] by bisection. */
function invert(cdf: (x: number) => number, p: number, lo = -50, hi = 50): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function normalQuantile(p: number): number {
  return invert(normalCdf, p);
}

function studentTQuantile(p: number, df: number): number {
  const cdf = (t: number) => {
    const tail = studentTTwoSidedP(Math.abs(t), df) / 2;
    return t >= 0 ? 1 - tail : tail;
  };
  return invert(cdf, p);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/** Two-sided two-proportion z-test (pooled SE for the test, unpooled for the CI). */
export function twoProportionZTest(control: ProportionSample, treatment: ProportionSample): TestResult {
  const p1 = control.n ? control.conversions / control.n : 0;
  const p2 = treatment.n ? treatment.conversions / treatment.n : 0;
  const difference = p2 - p1;
  const relativeLift = p1 ? difference / p1 : null;

  if (!control.n || !treatment.n) {
    return { difference, relativeLift, statistic: 0, pValue: 1, ci95: [difference, difference] };
  }

  const pooled = (control.conversions + treatment.conversions) / (control.n + treatment.n);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / control.n + 1 / treatment.n));
  const z = sePooled ? difference / sePooled : 0;
  const pValue = sePooled ? 2 * (1 - normalCdf(Math.abs(z))) : 1;

  const se = Math.sqrt((p1 * (1 - p1)) / control.n + (p2 * (1 - p2)) / treatment.n);
  const margin = 1.959963984540054 * se;
  return { difference, relativeLift, statistic: z, pValue, ci95: [difference - margin, difference + margin] };
}

/** Two-sided Welch's t-test for a difference in means. */
export function welchTTest(control: MeanSample, treatment: MeanSample): TestResult & { df: number } {
  const difference = treatment.mean - control.mean;
  const relativeLift = control.mean ? difference / control.mean : null;

  if (control.n < 2 || treatment.n < 2) {
    return { difference, relativeLift, statistic: 0, pValue: 1, df: 0, ci95: [difference, difference] };
  }

  const v1 = control.variance / control.n;
  const v2 = treatment.variance / treatment.n;
  const se = Math.sqrt(v1 + v2);
  if (se === 0) {
    const pValue = difference === 0 ? 1 : 0;
    return { difference, relativeLift, statistic: 0, pValue, df: control.n + treatment.n - 2, ci95: [difference, difference] };
  }

  const df = (v1 + v2) ** 2 / (v1 ** 2 / (control.n - 1) + v2 ** 2 / (treatment.n - 1));
  const t = difference / se;
  const margin = studentTQuantile(0.975, df) * se;
  return {
    difference,
    relativeLift,
    statistic: t,
    pValue: studentTTwoSidedP(Math.abs(t), df),
    df,
    ci95: [difference - margin, difference + margin],
  };
}

/**
 * Sample ratio mismatch: chi-square goodness of fit of observed exposures
 * against the configured variant weights. A tiny p-value (< 0.001) means
 * assignment or exposure logging is broken and results must not be trusted.
 */
export function sampleRatioMismatch(observed: number[], weights: number[]): { chiSquare: number; pValue: number } {
  const total = observed.reduce((s, n) => s + n, 0);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (total === 0 || observed.length < 2) return { chiSquare: 0, pValue: 1 };

  let chiSquare = 0;
  observed.forEach((n, i) => {
    const expected = (total * weights[i]) / weightSum;
    if (expected > 0) chiSquare += (n - expected) ** 2 / expected;
  });
  return { chiSquare, pValue: chiSquareSurvival(chiSquare, observed.length - 1) };
}

/**
 * Subjects needed per variant to detect an absolute change of `mde` in a
 * conversion rate of `baseline` (two-sided).
 */
export function requiredSampleSize(baseline: number, mde: number, alpha = 0.05, power = 0.8): number {
  const p2 = Math.min(Math.max(baseline + mde, 0), 1);
  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);
  const variance = baseline * (1 - baseline) + p2 * (1 - p2);
  return Math.ceil(((zAlpha + zBeta) ** 2 * variance) / (mde * mde));
}

/** Mean and sample variance of a list of values. */
export function describe(values: number[]): MeanSample {
  const n = values.length;
  if (n === 0) return { n: 0, mean: 0, variance: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, variance };
}
