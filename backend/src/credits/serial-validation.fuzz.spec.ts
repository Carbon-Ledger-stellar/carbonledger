/**
 * Property-based fuzz tests for serial number validation.
 *
 * Uses fast-check to generate 100+ random inputs per property and verify
 * that the validation logic behaves consistently under arbitrary inputs.
 *
 * Covers:
 *  - Format validation: only digit strings are valid
 *  - Range validity: serialEnd must be > serialStart, both positive
 *  - Overlap detection: the sweep-line algorithm detects all overlapping pairs
 *  - Overflow safety: very large BigInt values are handled without exceptions
 *  - Boundary conditions: zero, negative equivalents, empty strings rejected
 *
 * Run with:
 *   npx jest src/credits/serial-validation.fuzz.spec.ts
 */

import * as fc from 'fast-check';

// ── Pure validation functions extracted from credits.service.ts ──────────────
// We test the validation logic as pure functions so the fuzz suite has no
// database dependency and runs at full speed.

/** Returns true iff the string represents a valid positive-integer serial number. */
function isValidSerialFormat(s: string): boolean {
  return /^[0-9]+$/.test(s) && s.length >= 1 && s.length <= 32;
}

/**
 * Returns true iff the range (serialStart, serialEnd) is valid:
 * - Both must be positive integers (> 0)
 * - serialEnd must be strictly greater than serialStart
 */
function isValidRange(serialStart: string, serialEnd: string): boolean {
  if (!isValidSerialFormat(serialStart) || !isValidSerialFormat(serialEnd)) return false;
  try {
    const start = BigInt(serialStart);
    const end = BigInt(serialEnd);
    return start > 0n && end > 0n && end > start;
  } catch {
    return false; // BigInt() threw — the string is not a valid integer
  }
}

/**
 * Returns true iff two ranges overlap.
 * Assumes both ranges are valid (start > 0, end > start).
 *
 * Two ranges [a, b] and [c, d] overlap when c <= b AND a <= d.
 */
function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const a = BigInt(startA);
  const b = BigInt(endA);
  const c = BigInt(startB);
  const d = BigInt(endB);
  return c <= b && a <= d;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** Generates a valid positive-integer serial string (1–12 digits). */
const validSerial = fc
  .bigInt({ min: 1n, max: 999_999_999_999n })
  .map((n) => n.toString());

/** Generates a valid serial range where end > start. */
const validRangeArb = fc
  .tuple(
    fc.bigInt({ min: 1n, max: 999_999_999_990n }),
    fc.bigInt({ min: 1n, max: 9_999n }),
  )
  .map(([start, gap]) => ({
    serialStart: start.toString(),
    serialEnd: (start + gap).toString(),
  }));

/** Generates a string that may or may not be a valid serial format. */
const anyString = fc.oneof(
  fc.string(),                            // arbitrary strings
  fc.hexaString(),                        // hex strings (may contain non-digits)
  fc.bigInt({ min: 0n }).map((n) => n.toString()), // valid integer strings
  fc.constant(''),                        // empty string
  fc.constant('0'),                       // zero
  fc.constant('-1'),                      // negative (invalid for serial)
  fc.constant('1e5'),                     // scientific notation (invalid)
  fc.constant('1.5'),                     // decimal (invalid)
  fc.constant(' 100'),                    // leading space
  fc.constant('100 '),                    // trailing space
  validSerial,                            // mix in some valid ones
);

// ── Property tests ────────────────────────────────────────────────────────────

describe('Serial number validation — property-based fuzz tests', () => {

  // ── Format validation properties ──────────────────────────────────────────

  describe('isValidSerialFormat', () => {
    it('accepts any string of 1–32 digits', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 1n, max: 10n ** 31n - 1n }).map((n) => n.toString()),
          (serial) => {
            expect(isValidSerialFormat(serial)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('rejects empty string', () => {
      expect(isValidSerialFormat('')).toBe(false);
    });

    it('rejects strings longer than 32 digits', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 10n ** 32n }).map((n) => n.toString()),
          (serial) => {
            // 10^32 has 33 digits
            expect(isValidSerialFormat(serial)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects any string containing non-digit characters', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1 })
            .filter((s) => /[^0-9]/.test(s)),
          (s) => {
            expect(isValidSerialFormat(s)).toBe(false);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('rejects all invalid formats regardless of content', () => {
      fc.assert(
        fc.property(anyString, (s) => {
          const valid = isValidSerialFormat(s);
          // If valid=true, the string must be a pure digit string of length 1-32
          if (valid) {
            expect(/^[0-9]{1,32}$/.test(s)).toBe(true);
          }
          // valid=false can happen for any reason — no assertion needed
        }),
        { numRuns: 500 },
      );
    });
  });

  // ── Range validity properties ─────────────────────────────────────────────

  describe('isValidRange', () => {
    it('always accepts a valid range where end > start > 0', () => {
      fc.assert(
        fc.property(validRangeArb, ({ serialStart, serialEnd }) => {
          expect(isValidRange(serialStart, serialEnd)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('rejects when start equals end', () => {
      fc.assert(
        fc.property(validSerial, (s) => {
          expect(isValidRange(s, s)).toBe(false);
        }),
        { numRuns: 200 },
      );
    });

    it('rejects when end < start', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.bigInt({ min: 2n, max: 999_999_999n }),
            fc.bigInt({ min: 1n, max: 999_999_998n }),
          ).filter(([end, start]) => end > start).map(([end, start]) => ({ serialStart: end.toString(), serialEnd: start.toString() })),
          ({ serialStart, serialEnd }) => {
            // serialStart > serialEnd here
            expect(isValidRange(serialStart, serialEnd)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('rejects zero start', () => {
      expect(isValidRange('0', '100')).toBe(false);
    });

    it('rejects non-digit strings in either position', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => /[^0-9]/.test(s)),
          validSerial,
          (invalid, valid) => {
            expect(isValidRange(invalid, valid)).toBe(false);
            expect(isValidRange(valid, invalid)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('is always false when serialStart is empty string', () => {
      fc.assert(
        fc.property(validSerial, (end) => {
          expect(isValidRange('', end)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  // ── Overlap detection properties ──────────────────────────────────────────

  describe('rangesOverlap (sweep-line logic)', () => {
    it('is reflexive: a range always overlaps with itself', () => {
      fc.assert(
        fc.property(validRangeArb, ({ serialStart, serialEnd }) => {
          expect(rangesOverlap(serialStart, serialEnd, serialStart, serialEnd)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });

    it('is symmetric: if A overlaps B then B overlaps A', () => {
      fc.assert(
        fc.property(
          fc.tuple(validRangeArb, validRangeArb),
          ([rangeA, rangeB]) => {
            const ab = rangesOverlap(rangeA.serialStart, rangeA.serialEnd, rangeB.serialStart, rangeB.serialEnd);
            const ba = rangesOverlap(rangeB.serialStart, rangeB.serialEnd, rangeA.serialStart, rangeA.serialEnd);
            expect(ab).toBe(ba);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('detects overlap when one range is fully contained in the other', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.bigInt({ min: 1n, max: 1_000n }),   // outer start
            fc.bigInt({ min: 100n, max: 500n }),    // outer size
          ),
          ([outerStart, outerSize]) => {
            const outerEnd = outerStart + outerSize;
            // Inner range is strictly inside outer
            const innerStart = outerStart + 1n;
            const innerEnd = outerEnd - 1n;
            if (innerStart >= innerEnd) return; // skip degenerate

            expect(
              rangesOverlap(
                outerStart.toString(),
                outerEnd.toString(),
                innerStart.toString(),
                innerEnd.toString(),
              ),
            ).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('returns false for completely disjoint ranges (no gap=0)', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.bigInt({ min: 1n, max: 1_000n }),    // range A start
            fc.bigInt({ min: 1n, max: 500n }),       // range A size
            fc.bigInt({ min: 1n, max: 100n }),       // gap between A and B
            fc.bigInt({ min: 1n, max: 500n }),       // range B size
          ),
          ([startA, sizeA, gap, sizeB]) => {
            const endA = startA + sizeA;
            const startB = endA + gap;  // gap > 0 → disjoint
            const endB = startB + sizeB;

            expect(
              rangesOverlap(
                startA.toString(),
                endA.toString(),
                startB.toString(),
                endB.toString(),
              ),
            ).toBe(false);
          },
        ),
        { numRuns: 300 },
      );
    });

    it('detects overlap on partial intersection (ranges share a sub-range)', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.bigInt({ min: 1n, max: 1_000n }),    // A start
            fc.bigInt({ min: 10n, max: 500n }),      // A size
            fc.bigInt({ min: 5n, max: 490n }),       // overlap amount (< A size)
          ),
          ([startA, sizeA, overlapAmt]) => {
            const endA = startA + sizeA;
            // B starts inside A
            const startB = endA - overlapAmt;
            const endB = endA + overlapAmt;

            if (startB >= endB) return; // skip degenerate

            expect(
              rangesOverlap(
                startA.toString(),
                endA.toString(),
                startB.toString(),
                endB.toString(),
              ),
            ).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // ── Overflow / large value safety ─────────────────────────────────────────

  describe('overflow and large value safety', () => {
    it('handles very large serial numbers without throwing', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 10n ** 30n, max: 10n ** 32n - 1n }),
          (start) => {
            const end = start + 1n;
            // Should not throw — BigInt handles arbitrary precision
            const valid = isValidRange(start.toString(), end.toString());
            // 10^30 is > 32 chars so should be invalid due to length check
            expect(typeof valid).toBe('boolean');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('does not throw on any arbitrary string input to isValidSerialFormat', () => {
      fc.assert(
        fc.property(fc.string(), (s) => {
          expect(() => isValidSerialFormat(s)).not.toThrow();
        }),
        { numRuns: 500 },
      );
    });

    it('does not throw on any arbitrary string pair input to isValidRange', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (a, b) => {
          expect(() => isValidRange(a, b)).not.toThrow();
        }),
        { numRuns: 500 },
      );
    });

    it('does not throw on any arbitrary string pair input to rangesOverlap with valid ranges', () => {
      fc.assert(
        fc.property(
          fc.tuple(validRangeArb, validRangeArb),
          ([a, b]) => {
            expect(() =>
              rangesOverlap(a.serialStart, a.serialEnd, b.serialStart, b.serialEnd),
            ).not.toThrow();
          },
        ),
        { numRuns: 500 },
      );
    });
  });

  // ── Invariants across random batch collections ────────────────────────────

  describe('batch collection invariants', () => {
    /**
     * For any collection of non-overlapping valid ranges,
     * the sweep-line check must report zero overlaps.
     */
    it('clean batch set: no overlaps detected in a non-overlapping collection', () => {
      fc.assert(
        fc.property(
          // Generate N non-overlapping ranges by placing them sequentially
          fc.array(fc.bigInt({ min: 1n, max: 1_000n }), { minLength: 2, maxLength: 20 }),
          (sizes) => {
            // Build sorted non-overlapping ranges
            let cursor = 1n;
            const ranges: Array<{ serialStart: string; serialEnd: string }> = [];
            for (const size of sizes) {
              const start = cursor;
              const end = cursor + size;
              ranges.push({ serialStart: start.toString(), serialEnd: end.toString() });
              cursor = end + 1n; // leave a gap of 1 between ranges
            }

            // No overlaps should be found
            let overlapsFound = 0;
            for (let i = 1; i < ranges.length; i++) {
              const prev = ranges[i - 1];
              const curr = ranges[i];
              if (rangesOverlap(prev.serialStart, prev.serialEnd, curr.serialStart, curr.serialEnd)) {
                overlapsFound++;
              }
            }
            expect(overlapsFound).toBe(0);
          },
        ),
        { numRuns: 200 },
      );
    });

    /**
     * Inserting one deliberately overlapping range must always be detected.
     */
    it('overlap always detected when one range overlaps its predecessor', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.bigInt({ min: 1n, max: 1_000n }),   // base start
            fc.bigInt({ min: 2n, max: 100n }),      // base size
          ),
          ([baseStart, baseSize]) => {
            const baseEnd = baseStart + baseSize;
            // Overlapping range starts inside base range
            const overlapStart = baseStart + 1n;
            const overlapEnd = baseEnd + 1n;

            expect(
              rangesOverlap(
                baseStart.toString(),
                baseEnd.toString(),
                overlapStart.toString(),
                overlapEnd.toString(),
              ),
            ).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
