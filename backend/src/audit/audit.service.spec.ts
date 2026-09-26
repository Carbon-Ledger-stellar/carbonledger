/**
 * Unit tests for AuditService hash-chain tamper detection (#674).
 *
 * Verifies that verifyChain() correctly:
 *   - passes an empty log
 *   - passes a correctly-chained log
 *   - detects a missing/changed previousHash link
 *   - detects a modified entryHash (field tampering)
 *   - detects a deleted middle entry (chain gap)
 *   - skips legacy rows with null entryHash
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma.service';
import { createHash } from 'crypto';

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function makeHash(fields: {
  id: string; userId: string; action: string; resourceId: string;
  ipAddress: string; result: string; metadata: unknown;
  timestamp: Date; previousHash: string | null;
}): string {
  const payload = [
    fields.id, fields.userId, fields.action, fields.resourceId,
    fields.ipAddress, fields.result,
    JSON.stringify(fields.metadata ?? {}),
    fields.timestamp.toISOString(),
    fields.previousHash ?? '',
  ].join('|');
  return sha256(payload);
}

interface AuditRow {
  id: string; userId: string | null; action: string; resourceId: string | null;
  ipAddress: string | null; result: string | null; metadata: unknown;
  timestamp: Date; previousHash: string | null; entryHash: string | null;
}

function buildChain(count: number): AuditRow[] {
  const rows: AuditRow[] = [];
  let prevHash: string | null = null;
  for (let i = 0; i < count; i++) {
    const id = `entry-${i}`;
    const ts = new Date(Date.now() + i * 1000);
    const fields = {
      id, userId: 'user1', action: 'TEST', resourceId: null,
      ipAddress: null, result: 'Success', metadata: {},
      timestamp: ts, previousHash: prevHash,
    };
    const entryHash = makeHash(fields);
    rows.push({ ...fields, entryHash });
    prevHash = entryHash;
  }
  return rows;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AuditService — verifyChain (#674)', () => {
  let service: AuditService;
  let prisma: { auditLog: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock }; $transaction: jest.Mock };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma.auditLog)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('passes an empty log', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    const result = await service.verifyChain();
    expect(result).toEqual({ valid: true, checked: 0 });
  });

  it('passes a correctly-chained log of 5 entries', async () => {
    const chain = buildChain(5);
    prisma.auditLog.findMany.mockResolvedValue(chain);
    const result = await service.verifyChain();
    expect(result).toEqual({ valid: true, checked: 5 });
  });

  it('skips legacy rows (entryHash === null) without failing', async () => {
    const chain = buildChain(3);
    // Inject a legacy row at position 1 with null entryHash
    const legacy: AuditRow = {
      id: 'legacy', userId: null, action: 'LEGACY', resourceId: null,
      ipAddress: null, result: null, metadata: {},
      timestamp: new Date(chain[0].timestamp.getTime() + 500),
      previousHash: null, entryHash: null,
    };
    const mixed = [chain[0], legacy, ...chain.slice(1)];
    prisma.auditLog.findMany.mockResolvedValue(mixed);
    const result = await service.verifyChain();
    // Only chain entries are checked (3); legacy entry is skipped
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(4); // total rows (service counts all)
  });

  it('detects a tampered entryHash (field modification)', async () => {
    const chain = buildChain(3);
    // Mutate a field in entry 1 but leave entryHash unchanged
    chain[1] = { ...chain[1], action: 'TAMPERED_ACTION' };
    prisma.auditLog.findMany.mockResolvedValue(chain);
    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('entry-1');
  });

  it('detects a broken previousHash link (entry deletion / insertion)', async () => {
    const chain = buildChain(4);
    // Remove the middle entry to break the chain
    const withGap = [chain[0], chain[2], chain[3]];
    prisma.auditLog.findMany.mockResolvedValue(withGap);
    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('entry-2');
  });

  it('detects a corrupted previousHash on first entry (should be null)', async () => {
    const chain = buildChain(2);
    chain[0] = { ...chain[0], previousHash: 'corrupted' };
    prisma.auditLog.findMany.mockResolvedValue(chain);
    const result = await service.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe('entry-0');
  });
});
