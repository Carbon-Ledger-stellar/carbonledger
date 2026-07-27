// Mock stellar.ts to avoid @stellar/stellar-sdk import issues in tests
jest.mock('../lib/stellar', () => ({
  formatStroops: (stroops: bigint | number | string) => {
    const n = BigInt(stroops);
    const whole = n / 10_000_000n;
    const frac = (n % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  },
  parseStroops: (usdc: string) => {
    const [whole, frac = ''] = usdc.split('.');
    const fracPadded = frac.padEnd(7, '0').slice(0, 7);
    return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
  },
}));

import {
  calculateCreditCost,
  formatTonnes,
  generateRetirementId,
  generateBatchId,
  validateSerialRange,
  formatVintageYear,
  calculateCO2Equivalent,
  getCountryFlag,
  formatUSDC,
} from '../lib/carbon-utils';

describe('calculateCreditCost', () => {
  it('multiplies amount by price per credit', () => {
    expect(calculateCreditCost(10, 5_000_000n)).toBe(50_000_000n);
  });

  it('returns 0 for 0 amount', () => {
    expect(calculateCreditCost(0, 5_000_000n)).toBe(0n);
  });

  it('handles large amounts', () => {
    expect(calculateCreditCost(1_000_000, 1n)).toBe(1_000_000n);
  });
});

describe('validateSerialRange', () => {
  it('returns true for valid range (start < end)', () => {
    expect(validateSerialRange(1n, 100n)).toBe(true);
  });

  it('returns true when start equals end', () => {
    expect(validateSerialRange(5n, 5n)).toBe(true);
  });

  it('returns false when end < start', () => {
    expect(validateSerialRange(100n, 50n)).toBe(false);
  });

  it('returns false when start is 0', () => {
    expect(validateSerialRange(0n, 100n)).toBe(false);
  });

  it('returns false when both are 0', () => {
    expect(validateSerialRange(0n, 0n)).toBe(false);
  });
});

describe('formatTonnes', () => {
  it('formats small integer tonnes', () => {
    expect(formatTonnes(500)).toBe('500 tCO₂e');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTonnes(1500)).toBe('1.5K tCO₂e');
  });

  it('formats millions with M suffix', () => {
    expect(formatTonnes(2_500_000)).toBe('2.50M tCO₂e');
  });

  it('formats fractional tonnes', () => {
    expect(formatTonnes(0.5)).toBe('0.5 tCO₂e');
  });

  it('accepts string input', () => {
    expect(formatTonnes('1000')).toBe('1.0K tCO₂e');
  });

  it('accepts bigint input', () => {
    expect(formatTonnes(100n)).toBe('100 tCO₂e');
  });
});

describe('generateRetirementId', () => {
  it('generates deterministic id from batchId and timestamp', () => {
    expect(generateRetirementId('batch-001', 1683000000)).toBe('ret-batch-001-1683000000');
  });
});

describe('generateBatchId', () => {
  it('pads sequence number to 4 digits', () => {
    expect(generateBatchId('proj-1', 2023, 1)).toBe('batch-proj-1-2023-0001');
  });

  it('handles sequence >= 1000', () => {
    expect(generateBatchId('proj-1', 2023, 1234)).toBe('batch-proj-1-2023-1234');
  });
});

describe('formatVintageYear', () => {
  it('appends Vintage suffix', () => {
    expect(formatVintageYear(2023)).toBe('2023 Vintage');
  });
});

describe('calculateCO2Equivalent', () => {
  it('calculates car equivalents', () => {
    const result = calculateCO2Equivalent(4.6);
    expect(result.cars).toBe(1);
  });

  it('returns object with cars, flights, homes', () => {
    const result = calculateCO2Equivalent(100);
    expect(result).toHaveProperty('cars');
    expect(result).toHaveProperty('flights');
    expect(result).toHaveProperty('homes');
  });

  it('rounds to nearest integer', () => {
    const result = calculateCO2Equivalent(10);
    expect(Number.isInteger(result.cars)).toBe(true);
    expect(Number.isInteger(result.flights)).toBe(true);
    expect(Number.isInteger(result.homes)).toBe(true);
  });
});

describe('getCountryFlag', () => {
  it('returns flag for known country', () => {
    expect(getCountryFlag('Brazil')).toBe('🇧🇷');
    expect(getCountryFlag('United States')).toBe('🇺🇸');
  });

  it('returns fallback flag for unknown country', () => {
    expect(getCountryFlag('Atlantis')).toBe('🏳️');
  });
});

describe('formatUSDC', () => {
  it('formats stroops as USDC string', () => {
    expect(formatUSDC(10_000_000n)).toBe('$1 USDC');
  });

  it('formats fractional USDC', () => {
    expect(formatUSDC(5_000_000n)).toBe('$0.5 USDC');
  });
});
