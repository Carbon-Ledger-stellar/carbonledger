import { RetirementRecord } from '../lib/api';
import {
  filterByDateRange,
  aggregateBarChartData,
  aggregatePieChartData,
  aggregateKpiData,
  getAllMethodologies,
  getDefaultDateRange,
  getMethodologyColor,
} from '../lib/esg-aggregation';

function makeRetirement(overrides: Partial<RetirementRecord> = {}): RetirementRecord {
  return {
    id: 'ret-1',
    retirementId: 'ret-1',
    batchId: 'batch-1',
    projectId: 'proj-1',
    amount: 100,
    retiredBy: '0xABC',
    beneficiary: 'Test Corp',
    retirementReason: 'Carbon offset',
    vintageYear: 2023,
    serialNumbers: [],
    retiredAt: '2024-06-15T00:00:00Z',
    txHash: 'abc123def456',
    project: { name: 'Project A', methodology: 'VCS', country: 'Brazil' },
    batch: { batchId: 'batch-1', status: 'retired' },
    ...overrides,
  };
}

describe('filterByDateRange', () => {
  const retirements = [
    makeRetirement({ retiredAt: '2023-01-15T00:00:00Z' }),
    makeRetirement({ retiredAt: '2024-06-15T00:00:00Z' }),
    makeRetirement({ retiredAt: '2025-12-01T00:00:00Z' }),
  ];

  it('returns all when no dates specified', () => {
    expect(filterByDateRange(retirements)).toHaveLength(3);
  });

  it('filters by start date', () => {
    const result = filterByDateRange(retirements, '2024-01-01');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.retiredAt)).toEqual([
      '2024-06-15T00:00:00Z',
      '2025-12-01T00:00:00Z',
    ]);
  });

  it('filters by end date', () => {
    const result = filterByDateRange(retirements, undefined, '2024-06-01');
    expect(result).toHaveLength(1);
    expect(result[0].retiredAt).toBe('2023-01-15T00:00:00Z');
  });

  it('filters by both start and end date', () => {
    const result = filterByDateRange(retirements, '2024-01-01', '2024-12-31');
    expect(result).toHaveLength(1);
    expect(result[0].retiredAt).toBe('2024-06-15T00:00:00Z');
  });

  it('returns empty when range has no matches', () => {
    const result = filterByDateRange(retirements, '2026-01-01', '2026-12-31');
    expect(result).toHaveLength(0);
  });
});

describe('aggregateBarChartData', () => {
  it('groups retirements by year and methodology', () => {
    const retirements = [
      makeRetirement({ retiredAt: '2023-03-01T00:00:00Z', amount: 100, project: { name: 'A', methodology: 'VCS', country: 'Brazil' } }),
      makeRetirement({ retiredAt: '2023-09-01T00:00:00Z', amount: 200, project: { name: 'B', methodology: 'VCS', country: 'Brazil' } }),
      makeRetirement({ retiredAt: '2024-01-01T00:00:00Z', amount: 50, project: { name: 'C', methodology: 'Gold Standard', country: 'Kenya' } }),
    ];

    const result = aggregateBarChartData(retirements);

    expect(result).toEqual([
      { year: '2023', VCS: 300, 'Gold Standard': 0 },
      { year: '2024', VCS: 0, 'Gold Standard': 50 },
    ]);
  });

  it('returns empty array for no data', () => {
    expect(aggregateBarChartData([])).toEqual([]);
  });

  it('handles unknown methodology', () => {
    const retirements = [
      makeRetirement({ retiredAt: '2023-01-01T00:00:00Z', amount: 100, project: null }),
    ];

    const result = aggregateBarChartData(retirements);
    expect(result[0]).toHaveProperty('Unknown');
    expect(result[0]['Unknown']).toBe(100);
  });

  it('sorts years chronologically', () => {
    const retirements = [
      makeRetirement({ retiredAt: '2024-01-01T00:00:00Z', amount: 10 }),
      makeRetirement({ retiredAt: '2022-01-01T00:00:00Z', amount: 20 }),
      makeRetirement({ retiredAt: '2023-01-01T00:00:00Z', amount: 30 }),
    ];

    const result = aggregateBarChartData(retirements);
    expect(result.map((d) => d.year)).toEqual(['2022', '2023', '2024']);
  });
});

describe('aggregatePieChartData', () => {
  it('groups by methodology and sorts descending', () => {
    const retirements = [
      makeRetirement({ amount: 100, project: { name: 'A', methodology: 'VCS', country: 'Brazil' } }),
      makeRetirement({ amount: 200, project: { name: 'B', methodology: 'VCS', country: 'Brazil' } }),
      makeRetirement({ amount: 50, project: { name: 'C', methodology: 'Gold Standard', country: 'Kenya' } }),
    ];

    const result = aggregatePieChartData(retirements);

    expect(result).toEqual([
      { name: 'VCS', value: 300 },
      { name: 'Gold Standard', value: 50 },
    ]);
  });

  it('returns empty array for no data', () => {
    expect(aggregatePieChartData([])).toEqual([]);
  });

  it('handles single methodology', () => {
    const retirements = [
      makeRetirement({ amount: 100, project: { name: 'A', methodology: 'ACR', country: 'India' } }),
    ];

    const result = aggregatePieChartData(retirements);
    expect(result).toEqual([{ name: 'ACR', value: 100 }]);
  });
});

describe('aggregateKpiData', () => {
  it('calculates lifetime total across all retirements', () => {
    const all = [
      makeRetirement({ amount: 100 }),
      makeRetirement({ amount: 200 }),
    ];
    const filtered = [all[0]];

    const kpi = aggregateKpiData(all, filtered);
    expect(kpi.totalTonnesLifetime).toBe(300);
  });

  it('calculates this year total', () => {
    const currentYear = new Date().getFullYear();
    const all = [
      makeRetirement({ amount: 100, retiredAt: `${currentYear}-06-15T00:00:00Z` }),
      makeRetirement({ amount: 200, retiredAt: '2023-01-01T00:00:00Z' }),
    ];

    const kpi = aggregateKpiData(all, all);
    expect(kpi.totalTonnesThisYear).toBe(100);
  });

  it('counts pending certificates from filtered set', () => {
    const all = [
      makeRetirement({ batch: { batchId: 'b1', status: 'retired' } }),
      makeRetirement({ batch: { batchId: 'b2', status: 'active' } }),
      makeRetirement({ batch: null }),
    ];

    const kpi = aggregateKpiData(all, all);
    expect(kpi.pendingCertificates).toBe(2);
  });

  it('returns zeros for empty data', () => {
    const kpi = aggregateKpiData([], []);
    expect(kpi).toEqual({
      totalTonnesLifetime: 0,
      totalTonnesThisYear: 0,
      pendingCertificates: 0,
    });
  });
});

describe('getAllMethodologies', () => {
  it('returns unique sorted methodologies', () => {
    const retirements = [
      makeRetirement({ project: { name: 'A', methodology: 'VCS', country: 'Brazil' } }),
      makeRetirement({ project: { name: 'B', methodology: 'Gold Standard', country: 'Kenya' } }),
      makeRetirement({ project: { name: 'C', methodology: 'VCS', country: 'Brazil' } }),
    ];

    expect(getAllMethodologies(retirements)).toEqual(['Gold Standard', 'VCS']);
  });

  it('returns empty array for no data', () => {
    expect(getAllMethodologies([])).toEqual([]);
  });
});

describe('getDefaultDateRange', () => {
  it('returns a 2-year range ending today', () => {
    const range = getDefaultDateRange();
    const now = new Date();
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(now.getFullYear() - 2);

    expect(range.end).toBe(now.toISOString().split('T')[0]);
    expect(range.start).toBe(twoYearsAgo.toISOString().split('T')[0]);
  });

  it('start is before end', () => {
    const range = getDefaultDateRange();
    expect(new Date(range.start).getTime()).toBeLessThan(new Date(range.end).getTime());
  });
});

describe('getMethodologyColor', () => {
  it('returns known color for VCS', () => {
    expect(getMethodologyColor('VCS')).toBe('#16a34a');
  });

  it('returns known color for Gold Standard', () => {
    expect(getMethodologyColor('Gold Standard')).toBe('#ca8a04');
  });

  it('returns gray fallback for unknown methodology', () => {
    expect(getMethodologyColor('Unknown')).toBe('#6b7280');
  });
});
