import {
  DECISION_LABELS,
  formatDifference,
  formatInterval,
  formatMetricValue,
  formatPValue,
} from '../experiments';

describe('experiments formatting (#1326)', () => {
  it('formats p-values', () => {
    expect(formatPValue(0.0004)).toBe('< 0.001');
    expect(formatPValue(0.0362)).toBe('0.036');
  });

  it('formats metric values by type', () => {
    expect(formatMetricValue('conversion', 0.1234)).toBe('12.3%');
    expect(formatMetricValue('continuous', 21.456)).toBe('21.46');
  });

  it('formats differences with relative lift', () => {
    expect(
      formatDifference('conversion', { difference: 0.03, relativeLift: 0.3, statistic: 2.1, pValue: 0.03, ci95: [0.002, 0.058] }),
    ).toBe('+3.0 pp (+30.0%)');
    expect(
      formatDifference('continuous', { difference: -1.5, relativeLift: null, statistic: -2, pValue: 0.04, ci95: [-2.9, -0.1] }),
    ).toBe('-1.50');
  });

  it('formats confidence intervals', () => {
    expect(formatInterval('conversion', [0.002, 0.058])).toBe('[0.2, 5.8] pp');
    expect(formatInterval('continuous', [-2.9, -0.1])).toBe('[-2.90, -0.10]');
  });

  it('has a label for every decision', () => {
    expect(Object.keys(DECISION_LABELS).sort()).toEqual(['continue', 'insufficient_data', 'rollback', 'ship']);
  });
});
