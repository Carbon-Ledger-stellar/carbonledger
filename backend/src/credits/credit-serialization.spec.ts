/**
 * Snapshot tests for CreditBatch / RetirementRecord serialization (#821).
 *
 * Both models leave the backend as JSON: Nest hands a Prisma row to
 * `JSON.stringify`, which invokes `toJSON` on `Prisma.Decimal` (→ string) and
 * on `Date` (→ ISO-8601 with a `Z` suffix). Nothing in the codebase maps these
 * rows explicitly, so the wire contract is entirely implicit — a column type
 * change in `schema.prisma` silently rewrites what every API consumer sees.
 *
 * These snapshots pin that contract. A failing snapshot here is not
 * necessarily a bug, but it always means the public API shape moved and the
 * frontend types in `frontend/lib/api.ts` plus the GraphQL types in
 * `src/graphql/types/` need to move with it.
 *
 * Models are deliberately not modified — fixtures mirror `schema.prisma`.
 */
import { Prisma } from '@prisma/client';

// ── Wire helpers ────────────────────────────────────────────────────────────

/** Exactly what a client receives: Nest's JSON pipeline applied to a row. */
function serialize<T>(row: T): any {
  return JSON.parse(JSON.stringify(row));
}

/** The inverse a consumer applies to recover the domain types. */
function deserializeBatch(json: any) {
  return {
    ...json,
    amount: new Prisma.Decimal(json.amount),
    issuedAt: new Date(json.issuedAt),
  };
}

/** The inverse a consumer applies to recover the domain types. */
function deserializeRetirement(json: any) {
  return {
    ...json,
    amount: new Prisma.Decimal(json.amount),
    retiredAt: new Date(json.retiredAt),
    validatedAt: json.validatedAt === null ? null : new Date(json.validatedAt),
    certificateFailedAt:
      json.certificateFailedAt === null ? null : new Date(json.certificateFailedAt),
    certificateGeneratedAt:
      json.certificateGeneratedAt === null ? null : new Date(json.certificateGeneratedAt),
  };
}

// ── Fixtures (mirror prisma/schema.prisma; all values fixed, never generated) ─

type CreditBatchRow = ReturnType<typeof creditBatchRow>;
type RetirementRow = ReturnType<typeof retirementRow>;

function creditBatchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'clx0batch000000000000001',
    batchId: 'batch-VCS-1529-2023-001',
    projectId: 'VCS-1529',
    vintageYear: 2023,
    amount: new Prisma.Decimal('12500.00'),
    serialStart: '1000000',
    serialEnd: '2250000',
    status: 'Active',
    metadataCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    issuedAt: new Date('2023-06-15T09:30:00.000Z'),
    ...overrides,
  };
}

function retirementRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'clx0retire00000000000001',
    retirementId: 'ret-batch-VCS-1529-2023-001-1686822600000',
    batchId: 'batch-VCS-1529-2023-001',
    projectId: 'VCS-1529',
    amount: new Prisma.Decimal('250.50'),
    retiredBy: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG',
    beneficiary: 'Acme Corporation',
    retirementReason: 'Scope 1 emissions offset for FY2023',
    vintageYear: 2023,
    serialStart: '1000000',
    serialEnd: '1025050',
    serialNumbers: ['1000000', '1000001', '1000002'],
    txHash: '3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889',
    certificateCid: null,
    certificateUrl: null,
    certificateContentCid: null,
    certificateContentHash: null,
    certificateStatus: 'pending_certificate',
    certificateRetries: 0,
    certificateFailedAt: null,
    certificateGeneratedAt: null,
    legacyStatus: null,
    isValid: true,
    validatedAt: null,
    retiredAt: new Date('2023-06-15T10:30:00.000Z'),
    ...overrides,
  };
}

// ── CreditBatch ─────────────────────────────────────────────────────────────

describe('CreditBatch serialization', () => {
  it('serializes a typical batch to the documented wire shape', () => {
    expect(serialize(creditBatchRow())).toMatchSnapshot();
  });

  it('exposes exactly the documented set of fields', () => {
    expect(Object.keys(serialize(creditBatchRow())).sort()).toMatchSnapshot();
  });

  it('emits Decimal amounts as strings and drops insignificant trailing zeros', () => {
    const wire = serialize(creditBatchRow());

    // `frontend/lib/api.ts` declares `amount: number`, but the wire value is a
    // string — consumers must coerce. Pinned so the mismatch stays visible.
    expect(typeof wire.amount).toBe('string');
    expect(wire.amount).toMatchInlineSnapshot(`"12500"`);
    expect(serialize(creditBatchRow({ amount: new Prisma.Decimal('0.50') })).amount)
      .toMatchInlineSnapshot(`"0.5"`);
  });

  it('emits issuedAt as a UTC ISO-8601 timestamp with millisecond precision', () => {
    expect(serialize(creditBatchRow()).issuedAt).toMatchInlineSnapshot(
      `"2023-06-15T09:30:00.000Z"`,
    );
  });

  it('round-trips through JSON without losing amount precision or timestamp', () => {
    const original: CreditBatchRow = creditBatchRow({
      amount: new Prisma.Decimal('12500.07'),
    });
    const restored = deserializeBatch(serialize(original));

    expect(restored.amount.equals(original.amount)).toBe(true);
    expect(restored.issuedAt.getTime()).toBe(original.issuedAt.getTime());
    expect(serialize(restored)).toEqual(serialize(original));
  });

  it('serializes a fully-retired batch', () => {
    expect(
      serialize(creditBatchRow({ status: 'FullyRetired', amount: new Prisma.Decimal('0.00') })),
    ).toMatchSnapshot();
  });
});

// ── RetirementRecord ────────────────────────────────────────────────────────

describe('RetirementRecord serialization', () => {
  it('serializes a typical retirement to the documented wire shape', () => {
    expect(serialize(retirementRow())).toMatchSnapshot();
  });

  it('exposes exactly the documented set of fields', () => {
    expect(Object.keys(serialize(retirementRow())).sort()).toMatchSnapshot();
  });

  it('preserves serialNumbers as an ordered array of strings', () => {
    const wire = serialize(
      retirementRow({ serialNumbers: ['1000002', '1000000', '1000001'] }),
    );

    expect(wire.serialNumbers).toEqual(['1000002', '1000000', '1000001']);
    expect(wire.serialNumbers.every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  it('serializes an empty serialNumbers array as [] rather than dropping it', () => {
    expect(serialize(retirementRow({ serialNumbers: [] })).serialNumbers).toEqual([]);
  });

  it('keeps unset certificate fields as explicit nulls', () => {
    const wire = serialize(retirementRow());

    // `undefined` would be dropped by JSON.stringify; Prisma yields `null`, so
    // consumers can rely on the keys always being present.
    for (const key of [
      'certificateCid',
      'certificateUrl',
      'certificateContentCid',
      'certificateContentHash',
      'certificateFailedAt',
      'certificateGeneratedAt',
      'legacyStatus',
      'validatedAt',
    ]) {
      expect(wire).toHaveProperty(key, null);
    }
  });

  it('serializes a retirement with a generated certificate', () => {
    expect(
      serialize(
        retirementRow({
          certificateCid: 'bafybeih5zgcgqor3dw6hpqnvj2z2r5t5oaqmhqnlvmi4vgrmvbxk5xg7pa',
          certificateUrl:
            'https://gateway.pinata.cloud/ipfs/bafybeih5zgcgqor3dw6hpqnvj2z2r5t5oaqmhqnlvmi4vgrmvbxk5xg7pa',
          certificateContentCid:
            'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354',
          certificateContentHash:
            '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          certificateStatus: 'generated',
          certificateGeneratedAt: new Date('2023-06-15T10:35:12.482Z'),
          validatedAt: new Date('2023-06-15T10:36:00.000Z'),
        }),
      ),
    ).toMatchSnapshot();
  });

  it('round-trips through JSON without losing amount precision or timestamps', () => {
    const original: RetirementRow = retirementRow({
      certificateGeneratedAt: new Date('2023-06-15T10:35:12.482Z'),
    });
    const restored = deserializeRetirement(serialize(original));

    expect(restored.amount.equals(original.amount)).toBe(true);
    expect(restored.retiredAt.getTime()).toBe(original.retiredAt.getTime());
    expect(restored.certificateGeneratedAt!.getTime()).toBe(
      (original.certificateGeneratedAt as Date).getTime(),
    );
    expect(serialize(restored)).toEqual(serialize(original));
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('CreditBatch serialization — edge cases', () => {
  it('carries max-int and uint64 serial numbers losslessly as strings', () => {
    // Serials are `String` columns precisely because they outgrow float64.
    // 2^53 and 2^64-1 are the two boundaries that break numeric handling.
    const maxSafe = String(Number.MAX_SAFE_INTEGER); // 9007199254740991
    const beyondSafe = '9007199254740993'; // 2^53 + 2 — unrepresentable as a float64
    const uint64Max = '18446744073709551615'; // 2^64 - 1

    const wire = serialize(
      creditBatchRow({ serialStart: maxSafe, serialEnd: uint64Max }),
    );

    expect(wire).toMatchSnapshot();
    expect(wire.serialStart).toBe(maxSafe);
    expect(wire.serialEnd).toBe(uint64Max);

    // Guard rail: this is what a consumer loses by coercing to a number.
    expect(String(Number(beyondSafe))).not.toBe(beyondSafe);
    expect(BigInt(wire.serialEnd) - BigInt(wire.serialStart)).toBe(
      BigInt(uint64Max) - BigInt(maxSafe),
    );
  });

  it('serializes Decimal(18,2) amounts at both column bounds', () => {
    expect(
      serialize({
        columnMax: new Prisma.Decimal('9999999999999999.99'),
        minIssuable: new Prisma.Decimal('0.01'),
        zero: new Prisma.Decimal('0'),
        trailingZeros: new Prisma.Decimal('1500.00'),
        fractional: new Prisma.Decimal('0.5'),
      }),
    ).toMatchSnapshot();
  });

  it('escapes special characters in metadata CIDs and identifiers', () => {
    expect(
      serialize(
        creditBatchRow({
          metadataCid: 'bafy/…/quote-"double"-and-\'single\'',
          status: 'Active\\Pending',
        }),
      ),
    ).toMatchSnapshot();
  });

  it('normalizes timestamps to UTC regardless of the source offset', () => {
    const fromOffset = new Date('2023-06-15T11:30:00.000+02:00');
    const fromUtc = new Date('2023-06-15T09:30:00.000Z');

    expect(serialize(creditBatchRow({ issuedAt: fromOffset }))).toEqual(
      serialize(creditBatchRow({ issuedAt: fromUtc })),
    );
  });

  it('serializes boundary timestamps', () => {
    expect(
      serialize({
        unixEpoch: new Date(0),
        subSecondPrecision: new Date('2023-06-15T09:30:00.007Z'),
        leapDay: new Date('2024-02-29T23:59:59.999Z'),
        farFuture: new Date('2999-12-31T23:59:59.999Z'),
        preEpoch: new Date('1969-07-20T20:17:40.000Z'),
      }),
    ).toMatchSnapshot();
  });
});

describe('RetirementRecord serialization — edge cases', () => {
  it('escapes special characters in beneficiary and reason text', () => {
    const wire = serialize(
      retirementRow({
        beneficiary: 'Ünïcødé Ltd. 🌱 «Grüne Wärme» — 株式会社 / شركة',
        retirementReason:
          'Reason with "double quotes", \'single\', a backslash \\, a tab\there,\na newline, and <script>alert(1)</script>',
      }),
    );

    expect(wire).toMatchSnapshot();
    // Round-tripping is what matters: escaping must be reversible, and the
    // markup must survive verbatim rather than being HTML-encoded in transit.
    expect(wire.beneficiary).toBe('Ünïcødé Ltd. 🌱 «Grüne Wärme» — 株式会社 / شركة');
    expect(wire.retirementReason).toContain('<script>alert(1)</script>');
  });

  it('preserves astral-plane characters through a full round trip', () => {
    const beneficiary = '𝐂arbon 🌍🌱 Ltd';
    const wire = serialize(retirementRow({ beneficiary }));

    expect(wire.beneficiary).toBe(beneficiary);
    expect([...wire.beneficiary].length).toBe([...beneficiary].length);
  });

  it('carries max-int serial numbers and a large serialNumbers array', () => {
    const serialStart = String(Number.MAX_SAFE_INTEGER);
    const serialNumbers = ['9007199254740991', '9007199254740992', '9007199254740993'];

    const wire = serialize(retirementRow({ serialStart, serialNumbers }));

    expect(wire.serialStart).toBe(serialStart);
    expect(wire.serialNumbers).toEqual(serialNumbers);
    // Distinct strings that all collapse to the same float64 — proof the
    // array must never be round-tripped through numbers.
    expect(new Set(serialNumbers).size).toBe(3);
    expect(new Set(serialNumbers.map(Number)).size).toBe(2);
  });

  it('serializes a legacy/invalidated retirement', () => {
    expect(
      serialize(
        retirementRow({
          legacyStatus: 'migrated_v1',
          isValid: false,
          validatedAt: new Date('2023-07-01T00:00:00.000Z'),
          certificateStatus: 'failed',
          certificateRetries: 3,
          certificateFailedAt: new Date('2023-06-15T10:40:00.000Z'),
        }),
      ),
    ).toMatchSnapshot();
  });
});
