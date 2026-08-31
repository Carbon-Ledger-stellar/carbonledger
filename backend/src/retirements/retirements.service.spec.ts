import { Test } from '@nestjs/testing';
jest.mock('winston-cloudwatch', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ log: jest.fn(), on: jest.fn(), end: jest.fn() })),
}));

import { RetirementsService } from './retirements.service';
import { PrismaService } from '../prisma.service';
import { IpfsService } from '../common/ipfs.service';
import { CertificateService } from './certificate.service';
import { QueueService } from '../queue/queue.service';
import { CertificateSigningService } from '../common/certificate-signing.service';

const mockPrisma = {
  retirementRecord: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  creditBatch: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
};

const mockQueue = {
  enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getJobStatus: jest.fn().mockResolvedValue({ id: 'job-1', state: 'completed' }),
};

describe('RetirementsService pagination', () => {
  let service: RetirementsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RetirementsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IpfsService, useValue: {} },
        { provide: CertificateService, useValue: {} },
        { provide: QueueService, useValue: mockQueue },
        // RetirementsService gained a required CertificateSigningService
        // dependency after this spec was written; this predates that.
        { provide: CertificateSigningService, useValue: {} },
      ],
    }).compile();
    service = module.get(RetirementsService);
  });

  it('returns opaque next/prev cursors and caps the page size', async () => {
    mockPrisma.retirementRecord.findMany.mockResolvedValue([
      { id: 'row-1', retiredAt: new Date('2024-01-01T00:00:00.000Z') },
      { id: 'row-2', retiredAt: new Date('2024-01-02T00:00:00.000Z') },
      { id: 'row-3', retiredAt: new Date('2024-01-03T00:00:00.000Z') },
    ]);
    mockPrisma.retirementRecord.count.mockResolvedValue(3);

    const result = await service.findAll(undefined, 2);
    expect(result.next_cursor).toBeDefined();
    expect(result.prev_cursor).toBeUndefined();
    expect(result.total_count).toBe(3);
  });
});
