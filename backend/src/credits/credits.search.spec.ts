/**
 * Unit tests for CreditsService#searchBySerial (issue #1019).
 *
 * Tests cover:
 *  - Exact match on batchId
 *  - Partial match (prefix "VCS" returns all VCS credits)
 *  - Match on projectId
 *  - Match on serialStart / serialEnd
 *  - Empty / missing serial throws BadRequestException
 *  - Soft-deleted records are excluded
 *  - Response shape includes isRetired + retirementCount
 */

import { BadRequestException } from '@nestjs/common';
import { CreditsService } from './credits.service';

// ── Prisma stub ────────────────────────────────────────────────────────────

const makeBatch = (overrides: Partial<any> = {}) => ({
  id:          'batch-db-id-1',
  batchId:     'VCS-001-BATCH-2024',
  projectId:   'VCS-001',
  vintageYear: 2024,
  amount:      100,
  serialStart: '100000',
  serialEnd:   '110000',
  status:      'Active',
  issuedAt:    new Date('2024-01-01'),
  deletedAt:   null,
  project: {
    name:        'Amazon Reforestation',
    methodology: 'VM0006',
    country:     'Brazil',
    status:      'Verified',
  },
  retirements: [],
  ...overrides,
});

function makePrisma(batches: any[]) {
  return {
    creditBatch: {
      findMany: jest.fn().mockResolvedValue(batches),
    },
  };
}

function makeService(batches: any[]) {
  const prisma = makePrisma(batches);
  // Minimal DI — only inject what searchBySerial needs
  const service = new (CreditsService as any)(
    prisma,
    { sendIfEnabled: jest.fn() }, // mailService
    { pin: jest.fn() },           // ipfsService
  );
  return { service, prisma };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CreditsService#searchBySerial (issue #1019)', () => {

  it('returns exact match on batchId', async () => {
    const batch = makeBatch({ batchId: 'VCS-001-BATCH-2024' });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('VCS-001-BATCH-2024');

    expect(result.total).toBe(1);
    expect(result.batches[0].batchId).toBe('VCS-001-BATCH-2024');
  });

  it('returns partial match — "VCS" returns all VCS credits', async () => {
    const batches = [
      makeBatch({ batchId: 'VCS-001-BATCH-2024', projectId: 'VCS-001' }),
      makeBatch({ id: 'b2', batchId: 'VCS-002-BATCH-2023', projectId: 'VCS-002' }),
    ];
    const { service, prisma } = makeService(batches);

    const result = await service.searchBySerial('VCS');

    expect(result.total).toBe(2);
    // Verify the OR filter was passed to Prisma
    const call = prisma.creditBatch.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchId: expect.objectContaining({ contains: 'VCS' }) }),
        expect.objectContaining({ projectId: expect.objectContaining({ contains: 'VCS' }) }),
      ]),
    );
  });

  it('matches on projectId containing the query', async () => {
    const batch = makeBatch({ projectId: 'VCS-AMAZON-42', batchId: 'UNRELATED-BATCH' });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('VCS-AMAZON');

    expect(result.total).toBe(1);
    expect(result.batches[0].projectId).toBe('VCS-AMAZON-42');
  });

  it('matches on serialStart', async () => {
    const batch = makeBatch({ serialStart: '100000', serialEnd: '200000' });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('100000');

    expect(result.total).toBe(1);
    expect(result.batches[0].serialStart).toBe('100000');
  });

  it('matches on serialEnd', async () => {
    const batch = makeBatch({ serialStart: '100000', serialEnd: '200000' });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('200000');

    expect(result.total).toBe(1);
  });

  it('returns isRetired=false when no retirements', async () => {
    const batch = makeBatch({ retirements: [] });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('VCS');

    expect(result.batches[0].isRetired).toBe(false);
    expect(result.batches[0].retirementCount).toBe(0);
  });

  it('returns isRetired=true when retirements exist', async () => {
    const batch = makeBatch({
      retirements: [
        { id: 'ret-1', retiredAt: new Date(), amount: 50 },
      ],
    });
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('VCS');

    expect(result.batches[0].isRetired).toBe(true);
    expect(result.batches[0].retirementCount).toBe(1);
  });

  it('returns project details in every batch', async () => {
    const batch = makeBatch();
    const { service } = makeService([batch]);

    const result = await service.searchBySerial('VCS');

    expect(result.batches[0].project).toEqual({
      name:        'Amazon Reforestation',
      methodology: 'VM0006',
      country:     'Brazil',
      status:      'Verified',
    });
  });

  it('filters soft-deleted records (deletedAt: null in query)', async () => {
    const { service, prisma } = makeService([]);

    await service.searchBySerial('VCS');

    const call = prisma.creditBatch.findMany.mock.calls[0][0];
    expect(call.where.deletedAt).toBe(null);
  });

  it('limits results to 100 records', async () => {
    const { service, prisma } = makeService([]);

    await service.searchBySerial('VCS');

    const call = prisma.creditBatch.findMany.mock.calls[0][0];
    expect(call.take).toBe(100);
  });

  it('orders by issuedAt desc (newest first)', async () => {
    const { service, prisma } = makeService([]);

    await service.searchBySerial('VCS');

    const call = prisma.creditBatch.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ issuedAt: 'desc' });
  });

  it('throws BadRequestException when serial is empty string', async () => {
    const { service } = makeService([]);
    await expect(service.searchBySerial('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when serial is whitespace only', async () => {
    const { service } = makeService([]);
    await expect(service.searchBySerial('   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns total=0 and empty batches when no matches', async () => {
    const { service } = makeService([]);

    const result = await service.searchBySerial('UNKNOWN-XYZ');

    expect(result.total).toBe(0);
    expect(result.batches).toHaveLength(0);
  });

  it('trims whitespace from the search query', async () => {
    const { service, prisma } = makeService([]);

    await service.searchBySerial('  VCS  ');

    const call = prisma.creditBatch.findMany.mock.calls[0][0];
    // All OR conditions should use the trimmed value 'VCS'
    for (const condition of call.where.OR) {
      const val = Object.values(condition)[0] as any;
      expect(val.contains).toBe('VCS');
    }
  });
});
