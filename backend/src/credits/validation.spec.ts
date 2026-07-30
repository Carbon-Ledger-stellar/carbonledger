import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsStellarAddressConstraint } from '../common/validators/stellar-address.validator';
import {
  IsSerialNumberConstraint,
  ValidSerialRangeConstraint,
} from '../common/validators/serial-number.validator';
import {
  IsVintageYearConstraint,
  IsCreditAmountConstraint,
  IsIpfsCidConstraint,
  IsMethodologyScoreConstraint,
} from '../common/validators/business-rules.validator';
import { MintCreditsDto, RetireCreditsDto } from './credits.dto';

// ── Helper ─────────────────────────────────────────────────────────────────────

async function getErrors(DtoClass: any, plain: Record<string, unknown>) {
  const instance = plainToInstance(DtoClass, plain) as object;
  return validate(instance);
}

// ─────────────────────────────────────────────────────────────────────────────
// IsStellarAddress validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsStellarAddressConstraint', () => {
  const validator = new IsStellarAddressConstraint();

  describe('valid addresses', () => {
    it('accepts a well-formed 56-char G... key', () => {
      expect(
        validator.validate('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
      ).toBe(true);
    });

    it('accepts another valid Stellar address', () => {
      expect(
        validator.validate('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ).toBe(true);
    });
  });

  describe('invalid addresses', () => {
    it('rejects empty string', () => {
      expect(validator.validate('')).toBe(false);
    });

    it('rejects non-string', () => {
      expect(validator.validate(12345)).toBe(false);
      expect(validator.validate(null)).toBe(false);
    });

    it('rejects too-short key', () => {
      expect(validator.validate('GABC')).toBe(false);
    });

    it('rejects key not starting with G', () => {
      expect(
        validator.validate('SAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3LRGLDBKB'),
      ).toBe(false);
    });

    it('rejects key with invalid base32 characters', () => {
      expect(
        validator.validate('G0HJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3LRGLDBKB'),
      ).toBe(false);
    });

    it('rejects key that is 57 chars (one too many)', () => {
      expect(
        validator.validate('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ).toBe(false);
    });

    it('rejects Ethereum address format', () => {
      expect(validator.validate('0x742d35Cc6634C0532925a3b8D4C4c2aA2C3')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IsSerialNumber validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsSerialNumberConstraint', () => {
  const validator = new IsSerialNumberConstraint();

  describe('valid serial numbers', () => {
    it('accepts "0"', () => expect(validator.validate('0')).toBe(true));
    it('accepts "1"', () => expect(validator.validate('1')).toBe(true));
    it('accepts "9007199254740991" (MAX_SAFE)', () => {
      expect(validator.validate('9007199254740991')).toBe(true);
    });
    it('accepts "1000000"', () => expect(validator.validate('1000000')).toBe(true));
  });

  describe('invalid serial numbers', () => {
    it('rejects empty string', () => expect(validator.validate('')).toBe(false));
    it('rejects negative string "-1"', () => expect(validator.validate('-1')).toBe(false));
    it('rejects decimal string "1.5"', () => expect(validator.validate('1.5')).toBe(false));
    it('rejects string with letters "abc"', () => expect(validator.validate('abc')).toBe(false));
    it('rejects non-string number 42', () => expect(validator.validate(42)).toBe(false));
    it('rejects overflow "99999999999999999"', () => {
      expect(validator.validate('99999999999999999')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ValidSerialRange cross-field validator
// ─────────────────────────────────────────────────────────────────────────────
describe('ValidSerialRangeConstraint', () => {
  const validator = new ValidSerialRangeConstraint();

  function makeArgs(serialStart: string, serialEnd: string): any {
    return { object: { serialStart, serialEnd } };
  }

  it('accepts equal start and end', () => {
    expect(validator.validate(null, makeArgs('100', '100'))).toBe(true);
  });

  it('accepts end > start', () => {
    expect(validator.validate(null, makeArgs('100', '200'))).toBe(true);
  });

  it('rejects end < start', () => {
    expect(validator.validate(null, makeArgs('200', '100'))).toBe(false);
  });

  it('returns true (defers) when serialStart is not a number string', () => {
    expect(validator.validate(null, makeArgs('abc', '100'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IsVintageYear validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsVintageYearConstraint', () => {
  const validator = new IsVintageYearConstraint();
  const currentYear = new Date().getFullYear();

  describe('valid vintage years', () => {
    it('accepts 1990 (minimum)', () => expect(validator.validate(1990)).toBe(true));
    it('accepts current year', () => expect(validator.validate(currentYear)).toBe(true));
    it('accepts current year + 1', () => expect(validator.validate(currentYear + 1)).toBe(true));
    it('accepts 2023', () => expect(validator.validate(2023)).toBe(true));
  });

  describe('invalid vintage years', () => {
    it('rejects 1989 (before min)', () => expect(validator.validate(1989)).toBe(false));
    it('rejects current year + 2 (too far future)', () => {
      expect(validator.validate(currentYear + 2)).toBe(false);
    });
    it('rejects 0', () => expect(validator.validate(0)).toBe(false));
    it('rejects fractional year 2020.5', () => expect(validator.validate(2020.5)).toBe(false));
    it('rejects string "2023"', () => expect(validator.validate('2023')).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IsCreditAmount validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsCreditAmountConstraint', () => {
  const validator = new IsCreditAmountConstraint();

  describe('valid amounts', () => {
    it('accepts 0.01 (minimum)', () => expect(validator.validate(0.01)).toBe(true));
    it('accepts 1', () => expect(validator.validate(1)).toBe(true));
    it('accepts 1000000', () => expect(validator.validate(1000000)).toBe(true));
    it('accepts 1000000000 (maximum)', () => expect(validator.validate(1_000_000_000)).toBe(true));
    it('accepts 12.99', () => expect(validator.validate(12.99)).toBe(true));
  });

  describe('invalid amounts', () => {
    it('rejects 0', () => expect(validator.validate(0)).toBe(false));
    it('rejects -1', () => expect(validator.validate(-1)).toBe(false));
    it('rejects 0.001 (3 decimal places)', () => expect(validator.validate(0.001)).toBe(false));
    it('rejects 1000000001 (exceeds max)', () => expect(validator.validate(1_000_000_001)).toBe(false));
    it('rejects NaN', () => expect(validator.validate(NaN)).toBe(false));
    it('rejects string "1.5"', () => expect(validator.validate('1.5')).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IsIpfsCid validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsIpfsCidConstraint', () => {
  const validator = new IsIpfsCidConstraint();

  describe('valid CIDs', () => {
    it('accepts a valid CIDv0', () => {
      expect(
        validator.validate('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'),
      ).toBe(true);
    });
    it('accepts a valid CIDv1 (bafy...)', () => {
      expect(
        validator.validate('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
      ).toBe(true);
    });
  });

  describe('invalid CIDs', () => {
    it('rejects empty string', () => expect(validator.validate('')).toBe(false));
    it('rejects plain URL', () => {
      expect(validator.validate('https://ipfs.io/ipfs/QmYwAP')).toBe(false);
    });
    it('rejects arbitrary string', () => expect(validator.validate('not-a-cid')).toBe(false));
    it('rejects CIDv0 that is too short', () => {
      expect(validator.validate('QmYwAPJzv5')).toBe(false);
    });
    it('rejects non-string', () => expect(validator.validate(42)).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IsMethodologyScore validator
// ─────────────────────────────────────────────────────────────────────────────
describe('IsMethodologyScoreConstraint', () => {
  const validator = new IsMethodologyScoreConstraint();

  describe('valid scores', () => {
    it('accepts 0', () => expect(validator.validate(0)).toBe(true));
    it('accepts 70', () => expect(validator.validate(70)).toBe(true));
    it('accepts 100', () => expect(validator.validate(100)).toBe(true));
  });

  describe('invalid scores', () => {
    it('rejects -1', () => expect(validator.validate(-1)).toBe(false));
    it('rejects 101', () => expect(validator.validate(101)).toBe(false));
    it('rejects 70.5 (not integer)', () => expect(validator.validate(70.5)).toBe(false));
    it('rejects string "70"', () => expect(validator.validate('70')).toBe(false));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MintCreditsDto integration
// ─────────────────────────────────────────────────────────────────────────────
describe('MintCreditsDto validation', () => {
  const validBase = {
    batchId: 'BATCH-001',
    projectId: 'PROJ-001',
    vintageYear: 2023,
    amount: 100.5,
    serialStart: '1000',
    serialEnd: '1099',
    metadataCid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
  };

  it('passes with all valid fields', async () => {
    const errors = await getErrors(MintCreditsDto, validBase);
    expect(errors).toHaveLength(0);
  });

  it('fails when batchId is missing', async () => {
    const { batchId, ...rest } = validBase;
    const errors = await getErrors(MintCreditsDto, rest);
    expect(errors.some((e) => e.property === 'batchId')).toBe(true);
  });

  it('fails with invalid vintage year (1989)', async () => {
    const errors = await getErrors(MintCreditsDto, { ...validBase, vintageYear: 1989 });
    expect(errors.some((e) => e.property === 'vintageYear')).toBe(true);
  });

  it('fails with invalid amount (0)', async () => {
    const errors = await getErrors(MintCreditsDto, { ...validBase, amount: 0 });
    expect(errors.some((e) => e.property === 'amount')).toBe(true);
  });

  it('fails when serialEnd < serialStart', async () => {
    const errors = await getErrors(MintCreditsDto, {
      ...validBase,
      serialStart: '200',
      serialEnd: '100',
    });
    expect(errors.some((e) => e.property === 'serialEnd')).toBe(true);
  });

  it('fails with invalid IPFS CID', async () => {
    const errors = await getErrors(MintCreditsDto, { ...validBase, metadataCid: 'not-a-cid' });
    expect(errors.some((e) => e.property === 'metadataCid')).toBe(true);
  });

  it('fails with non-numeric serialStart', async () => {
    const errors = await getErrors(MintCreditsDto, { ...validBase, serialStart: 'abc' });
    expect(errors.some((e) => e.property === 'serialStart')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RetireCreditsDto integration
// ─────────────────────────────────────────────────────────────────────────────
describe('RetireCreditsDto validation (credits module)', () => {
  const validBase = {
    batchId: 'BATCH-001',
    amount: 50.0,
    beneficiary: 'Acme Corp',
    retirementReason: 'Annual ESG offset commitment',
    holderPublicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  };

  it('passes with all valid fields', async () => {
    const errors = await getErrors(RetireCreditsDto, validBase);
    expect(errors).toHaveLength(0);
  });

  it('fails with invalid Stellar address', async () => {
    const errors = await getErrors(RetireCreditsDto, {
      ...validBase,
      holderPublicKey: 'not-a-stellar-key',
    });
    expect(errors.some((e) => e.property === 'holderPublicKey')).toBe(true);
  });

  it('fails when amount is 0', async () => {
    const errors = await getErrors(RetireCreditsDto, { ...validBase, amount: 0 });
    expect(errors.some((e) => e.property === 'amount')).toBe(true);
  });

  it('fails with missing beneficiary', async () => {
    const { beneficiary, ...rest } = validBase;
    const errors = await getErrors(RetireCreditsDto, rest);
    expect(errors.some((e) => e.property === 'beneficiary')).toBe(true);
  });
});
