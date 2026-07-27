/**
 * Invariant tests for the carbon credit lifecycle.
 *
 * Three invariants are verified after every state-changing operation:
 *
 *   I1 – Conservation:        sum(batch.amount) >= sum(retirements)
 *   I2 – Serial uniqueness:   no serial number appears in two active batches
 *   I3 – Monotonic retirements: per-project retired count never decreases
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { IpfsService } from '../common/ipfs.service';
import { MintCreditsDto, RetireCreditsDto } from './credits.dto';

// ── In-memory state mirrors ───────────────────────────────────────────────────

interface Batch {
  batchId: string;
  projectId: string;
  amount: number;
  serialStart: string;
  serialEnd: string;
  status: string;
  vintageYear: number;
  metadataCid: string;
}

interface Retirement {
  retirementId: string;
  batchId: string;
  projectId: string;
  amount: number;
  serialNumbers: string[];
}

interface Project {
  projectId: string;
  ownerAddress: string;
  totalCreditsIssued: number;
  totalCreditsRetired: number;
}

// ── Invariant helpers ─────────────────────────────────────────────────────────

/**
 * I1: sum of all batch amounts >= sum of all retirement amounts.
 * Also checks per-batch: batch.amount >= sum of retirements for that batch.
 */
function assertConservation(batches: Batch[], retirements: Retirement[]): void {
  const totalIssued = batches.reduce((s, b) => s + b.amount, 0);
  const totalRetired = retirements.reduce((s, r) => s + r.amount, 0);

  expect(totalIssued).toBeGreaterThanOrEqual(totalRetired);

  for (const batch of batches) {
    const batchRetired = retirements
      .filter(r => r.batchId === batch.batchId)
      .reduce((s, r) => s + r.amount, 0);
    expect(batch.amount).toBeGreaterThanOrEqual(batchRetired);
  }
}

/**
 * I2: No serial number appears in two different active batches.
 * Checks all pairs of active batches for range overlap.
 */
function assertNoSerialOverlap(batches: Batch[]): void {
  const active = batches.filter(b => b.status !== 'FullyRetired');

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const aStart = BigInt(a.serialStart);
      const aEnd   = BigInt(a.serialEnd);
      const bStart = BigInt(b.serialStart);
      const bEnd   = BigInt(b.serialEnd);

      const overlaps = aStart <= bEnd && bStart <= aEnd;
      expect(overlaps).toBe(false);
    }
  }
}

/**
 * I3: The total retired credits for a project must be >= the previously
 * observed value (monotonically non-decreasing).
 */
function assertMonotonicRetirements(
  projectId: string,
  projects: Map<string, Project>,
  prevRetired: number,
): number {
  const project = projects.get(projectId);
  if (!project) return prevRetired;
  expect(project.totalCreditsRetired).toBeGreaterThanOrEqual(prevRetired);
  return project.totalCreditsRetired;
}

// ── Mock factory ──────────────────────────────────────────────────────────────

function buildMocks() {
  const batches  = new Map<string, Batch>();
  const retirements: Retirement[] = [];
  const projects = new Map<string, Project>();

  // Seed a default project
  projects.set('proj-001', {
    projectId: 'proj-001',
    ownerAddress: 'GOWNER',
    totalCreditsIssued: 0,
    totalCreditsRetired: 0,
  });

  const mockPrisma = {
    creditBatch: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(batches.get(where.batchId) ?? null),
      ),
      findFirst: jest.fn(({ where }: any) => {
        // Simulate serial overlap check
        const { serialStart: reqStart, serialEnd: reqEnd } = where.OR?.[0] ?? {};
        if (!reqStart || !reqEnd) return Promise.resolve(null);
        for (const b of batches.values()) {
          if (BigInt(b.serialStart) <= BigInt(reqEnd.lte ?? reqEnd) &&
              BigInt(b.serialEnd)   >= BigInt(reqStart.gte ?? reqStart)) {
            return Promise.resolve(b);
          }
        }
        return Promise.resolve(null);
      }),
      create: jest.fn(({ data }: any) => {
        const batch: Batch = {
          batchId:     data.batchId,
          projectId:   data.projectId,
          amount:      Number(data.amount),
          serialStart: data.serialStart,
          serialEnd:   data.serialEnd,
          status:      data.status ?? 'Active',
          vintageYear: data.vintageYear,
          metadataCid: data.metadataCid,
        };
        batches.set(batch.batchId, batch);
        return Promise.resolve(batch);
      }),
      update: jest.fn(({ where, data }: any) => {
        const b = batches.get(where.batchId);
        if (b && data.status) b.status = data.status;
        return Promise.resolve(b);
      }),
    },
    retirementRecord: {
      create: jest.fn(({ data }: any) => {
        const r: Retirement = {
          retirementId: data.retirementId,
          batchId:      data.batchId,
          projectId:    data.projectId,
          amount:       Number(data.amount),
          serialNumbers: data.serialNumbers ?? [],
        };
        retirements.push(r);
        return Promise.resolve({ ...r, isValid: true });
      }),
    },
    carbonProject: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(projects.get(where.projectId) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const p = projects.get(where.projectId);
        if (p && data.totalCreditsRetired?.increment) {
          p.totalCreditsRetired += Number(data.totalCreditsRetired.increment);
        }
        return Promise.resolve(p);
      }),
    },
  };

  const mockMail = { sendIfEnabled: jest.fn().mockResolvedValue(undefined) };
  const mockIpfs = {};

  return { mockPrisma, mockMail, mockIpfs, batches, retirements, projects };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Credit Lifecycle Invariants', () => {
  let service: CreditsService;
  let state: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    state = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: PrismaService, useValue: state.mockPrisma },
        { provide: MailService,   useValue: state.mockMail },
        { provide: IpfsService,   useValue: state.mockIpfs },
      ],
    }).compile();

    service = module.get<CreditsService>(CreditsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── I1: Conservation ───────────────────────────────────────────────────────

  it('I1: conservation holds after minting a single batch', async () => {
    const dto: MintCreditsDto = {
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 1000, serialStart: '1', serialEnd: '100000', metadataCid: 'QmCID',
    };
    await service.mintCredits(dto);

    assertConservation([...state.batches.values()], state.retirements);
    assertNoSerialOverlap([...state.batches.values()]);
  });

  it('I1: conservation holds after minting two non-overlapping batches', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 500, serialStart: '1', serialEnd: '50000', metadataCid: 'QmCID',
    });
    assertConservation([...state.batches.values()], state.retirements);
    assertNoSerialOverlap([...state.batches.values()]);

    await service.mintCredits({
      batchId: 'b2', projectId: 'proj-001', vintageYear: 2023,
      amount: 500, serialStart: '50001', serialEnd: '100000', metadataCid: 'QmCID',
    });
    assertConservation([...state.batches.values()], state.retirements);
    assertNoSerialOverlap([...state.batches.values()]);
  });

  it('I1: conservation holds after a full retirement', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 100, serialStart: '1', serialEnd: '10000', metadataCid: 'QmCID',
    });

    await service.retireCredits({
      batchId: 'b1', amount: 100, beneficiary: 'Acme',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });

    assertConservation([...state.batches.values()], state.retirements);
  });

  it('I1: conservation holds after sequential partial retirements', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 300, serialStart: '1', serialEnd: '30000', metadataCid: 'QmCID',
    });

    for (const chunk of [100, 100, 100]) {
      await service.retireCredits({
        batchId: 'b1', amount: chunk, beneficiary: 'Acme',
        retirementReason: 'offset', holderPublicKey: 'GHOLDER',
      });
      assertConservation([...state.batches.values()], state.retirements);
    }
  });

  it('I1: over-retirement is rejected and conservation is preserved', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 100, serialStart: '1', serialEnd: '10000', metadataCid: 'QmCID',
    });

    await expect(
      service.retireCredits({
        batchId: 'b1', amount: 101, beneficiary: 'Acme',
        retirementReason: 'offset', holderPublicKey: 'GHOLDER',
      }),
    ).rejects.toThrow(BadRequestException);

    assertConservation([...state.batches.values()], state.retirements);
  });

  // ── I2: Serial uniqueness ──────────────────────────────────────────────────

  it('I2: no serial overlap across two non-adjacent batches', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 200, serialStart: '1', serialEnd: '20000', metadataCid: 'QmCID',
    });
    await service.mintCredits({
      batchId: 'b2', projectId: 'proj-001', vintageYear: 2023,
      amount: 300, serialStart: '20001', serialEnd: '50000', metadataCid: 'QmCID',
    });
    await service.mintCredits({
      batchId: 'b3', projectId: 'proj-001', vintageYear: 2023,
      amount: 500, serialStart: '50001', serialEnd: '100000', metadataCid: 'QmCID',
    });

    assertNoSerialOverlap([...state.batches.values()]);
  });

  it('I2: overlapping serial range is rejected and registry stays clean', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 100, serialStart: '1', serialEnd: '10000', metadataCid: 'QmCID',
    });

    // Simulate the overlap check returning a conflict
    state.mockPrisma.creditBatch.findFirst.mockResolvedValueOnce(
      state.batches.get('b1'),
    );

    await expect(
      service.mintCredits({
        batchId: 'b2', projectId: 'proj-001', vintageYear: 2023,
        amount: 50, serialStart: '5000', serialEnd: '15000', metadataCid: 'QmCID',
      }),
    ).rejects.toThrow(BadRequestException);

    // Only b1 should exist; no overlap
    assertNoSerialOverlap([...state.batches.values()]);
    assertConservation([...state.batches.values()], state.retirements);
  });

  it('I2: serial numbers in retirement records do not overlap across batches', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 100, serialStart: '1', serialEnd: '10000', metadataCid: 'QmCID',
    });
    await service.mintCredits({
      batchId: 'b2', projectId: 'proj-001', vintageYear: 2023,
      amount: 100, serialStart: '10001', serialEnd: '20000', metadataCid: 'QmCID',
    });

    await service.retireCredits({
      batchId: 'b1', amount: 50, beneficiary: 'A',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });
    await service.retireCredits({
      batchId: 'b2', amount: 50, beneficiary: 'B',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });

    // Collect all retired serial numbers and assert uniqueness
    const allSerials = state.retirements.flatMap(r => r.serialNumbers);
    const uniqueSerials = new Set(allSerials);
    expect(uniqueSerials.size).toBe(allSerials.length);
  });

  // ── I3: Monotonic retirements ──────────────────────────────────────────────

  it('I3: retirement count is monotonically non-decreasing across partial retirements', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 1000, serialStart: '1', serialEnd: '100000', metadataCid: 'QmCID',
    });

    let prev = assertMonotonicRetirements('proj-001', state.projects, 0);

    for (const chunk of [100, 200, 50, 150, 500]) {
      await service.retireCredits({
        batchId: 'b1', amount: chunk, beneficiary: 'Acme',
        retirementReason: 'offset', holderPublicKey: 'GHOLDER',
      });
      prev = assertMonotonicRetirements('proj-001', state.projects, prev);
      assertConservation([...state.batches.values()], state.retirements);
    }
  });

  it('I3: retirement count never decreases across multiple batches', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 200, serialStart: '1', serialEnd: '20000', metadataCid: 'QmCID',
    });
    await service.mintCredits({
      batchId: 'b2', projectId: 'proj-001', vintageYear: 2023,
      amount: 300, serialStart: '20001', serialEnd: '50000', metadataCid: 'QmCID',
    });

    let prev = 0;

    await service.retireCredits({
      batchId: 'b1', amount: 100, beneficiary: 'A',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });
    prev = assertMonotonicRetirements('proj-001', state.projects, prev);

    await service.retireCredits({
      batchId: 'b2', amount: 150, beneficiary: 'B',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });
    prev = assertMonotonicRetirements('proj-001', state.projects, prev);

    await service.retireCredits({
      batchId: 'b1', amount: 100, beneficiary: 'C',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });
    assertMonotonicRetirements('proj-001', state.projects, prev);
  });

  it('I3: fully retiring a batch does not decrease the project retirement count', async () => {
    await service.mintCredits({
      batchId: 'b1', projectId: 'proj-001', vintageYear: 2023,
      amount: 500, serialStart: '1', serialEnd: '50000', metadataCid: 'QmCID',
    });

    let prev = assertMonotonicRetirements('proj-001', state.projects, 0);

    await service.retireCredits({
      batchId: 'b1', amount: 500, beneficiary: 'Acme',
      retirementReason: 'offset', holderPublicKey: 'GHOLDER',
    });

    prev = assertMonotonicRetirements('proj-001', state.projects, prev);
    assertConservation([...state.batches.values()], state.retirements);

    // Batch is now FullyRetired — further retirement must be rejected
    await expect(
      service.retireCredits({
        batchId: 'b1', amount: 1, beneficiary: 'X',
        retirementReason: 'offset', holderPublicKey: 'GHOLDER',
      }),
    ).rejects.toThrow(BadRequestException);

    // Count must not have changed after the failed attempt
    assertMonotonicRetirements('proj-001', state.projects, prev);
  });
});
