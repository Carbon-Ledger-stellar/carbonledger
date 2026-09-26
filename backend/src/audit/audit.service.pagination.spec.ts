import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  auditLog: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
};

describe('AuditService pagination', () => {
  let service: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(AuditService);
  });

  it('returns opaque cursors for audit log pages', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      { id: 'a1', timestamp: new Date('2024-01-01T00:00:00.000Z') },
      { id: 'a2', timestamp: new Date('2024-01-02T00:00:00.000Z') },
      { id: 'a3', timestamp: new Date('2024-01-03T00:00:00.000Z') },
    ]);
    mockPrisma.auditLog.count.mockResolvedValue(3);

    const result = await service.findAll({ limit: 2 });
    expect(result.next_cursor).toBeDefined();
    expect(result.total_count).toBe(3);
  });
});
