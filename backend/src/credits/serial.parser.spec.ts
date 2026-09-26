import * as fc from 'fast-check';
import {
  IsSerialNumberConstraint,
  ValidSerialRangeConstraint,
} from '../common/validators/serial-number.validator';

/**
 * Fuzz testing for the serial-number range parser used when minting credits
 * from uploaded registry PDFs/CSVs (issue #918).
 *
 * The parsing/validation logic for serial ranges lives in
 * ../common/validators/serial-number.validator.ts:
 *  - IsSerialNumberConstraint parses/validates a single serial string.
 *  - ValidSerialRangeConstraint cross-checks a (serialStart, serialEnd) pair
 *    and maps it to a start/end interval.
 *
 * These tests throw large volumes of randomized input at both validators —
 * boundary values, negative numbers, numeric overflow, non-printable/unicode
 * characters, and non-string values — to assert that:
 *  - The parser never throws an unhandled runtime exception.
 *  - Malformed range formatting is always rejected.
 *  - Well-formed intervals are mapped correctly to their start/end bounds.
 */

const NUM_RUNS = 10_000;

function rangeArgs(serialStart: unknown, serialEnd: unknown): any {
  return { object: { serialStart, serialEnd } };
}

describe('serial.parser fuzz testing — IsSerialNumberConstraint', () => {
  const validator = new IsSerialNumberConstraint();

  it('never throws on arbitrary strings, including non-printable/unicode characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 500 }), (input) => {
        expect(() => validator.validate(input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws on arbitrary non-string values', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => validator.validate(input)).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws on huge numeric-looking strings (overflow/DoS attempts)', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 0,
            maxLength: 2000,
          })
          .map((chars) => chars.join('')),
        (digits) => {
          expect(() => validator.validate(digits)).not.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects every negative integer string', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 30n }), (n) => {
        expect(validator.validate(`-${n.toString()}`)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects digit strings containing a stray control character', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999 }),
        fc.integer({ min: 0, max: 31 }),
        (digits, controlCode) => {
          const tampered = `${digits}${String.fromCharCode(controlCode)}`;
          expect(() => validator.validate(tampered)).not.toThrow();
          expect(validator.validate(tampered)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects decimal-formatted numeric strings', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 999 }),
        (whole, frac) => {
          expect(validator.validate(`${whole}.${frac}`)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts every non-negative integer string within the safe range', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 9_007_199_254_740_991n }), (n) => {
        expect(validator.validate(n.toString())).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects every integer string above the safe max bound (overflow)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 9_007_199_254_740_992n, max: 10n ** 40n }), (n) => {
        expect(validator.validate(n.toString())).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('serial.parser fuzz testing — ValidSerialRangeConstraint', () => {
  const validator = new ValidSerialRangeConstraint();

  it('never throws for arbitrary (start, end) string pairs, including malformed input', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 200 }),
        fc.string({ unit: 'binary', maxLength: 200 }),
        (start, end) => {
          expect(() => validator.validate(null, rangeArgs(start, end))).not.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws for arbitrary non-string bounds', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (start, end) => {
        expect(() => validator.validate(null, rangeArgs(start, end))).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('correctly maps well-formed interval bounds: accepts iff end >= start', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        (start, end) => {
          const result = validator.validate(null, rangeArgs(start.toString(), end.toString()));
          expect(result).toBe(end >= start);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('defers (returns true) when either bound is not a well-formed digit string', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc
          .string({ maxLength: 20 })
          .filter((s) => !/^[0-9]+$/.test(s)),
        (validEnd, malformedStart) => {
          expect(validator.validate(null, rangeArgs(malformedStart, validEnd.toString()))).toBe(
            true,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
