import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { ProjectStateMachineService, ProjectStatus } from './project-state-machine.service';
import { PrismaService } from '../prisma.service';

const prismaMock = {
  auditLog: { create: jest.fn().mockResolvedValue({}) },
};

describe('ProjectStateMachineService', () => {
  let service: ProjectStateMachineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectStateMachineService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(ProjectStateMachineService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Valid transitions ────────────────────────────────────────────────────

  const validCases: [ProjectStatus, ProjectStatus][] = [
    ['Pending',   'Verified'],
    ['Pending',   'Rejected'],
    ['Verified',  'Suspended'],
    ['Verified',  'Completed'],
    ['Suspended', 'Verified'],
    ['Suspended', 'Rejected'],
  ];

  test.each(validCases)(
    'allows %s → %s',
    async (from, to) => {
      await expect(
        service.transition('proj-001', from, to, 'GACTOR'),
      ).resolves.toBeUndefined();
    },
  );

  // ── Invalid transitions ──────────────────────────────────────────────────

  const invalidCases: [ProjectStatus, ProjectStatus][] = [
    ['Pending',   'Suspended'],
    ['Pending',   'Completed'],
    ['Verified',  'Pending'],
    ['Verified',  'Rejected'],
    ['Rejected',  'Pending'],
    ['Rejected',  'Verified'],
    ['Completed', 'Verified'],
    ['Completed', 'Suspended'],
    ['Suspended', 'Pending'],
    ['Suspended', 'Completed'],
  ];

  test.each(invalidCases)(
    'rejects %s → %s with 422',
    async (from, to) => {
      await expect(
        service.transition('proj-001', from, to, 'GACTOR'),
      ).rejects.toThrow(UnprocessableEntityException);
    },
  );

  it('422 response body includes currentStatus and attemptedStatus', async () => {
    try {
      await service.transition('proj-001', 'Rejected', 'Verified', 'GACTOR');
      fail('should have thrown');
    } catch (err: any) {
      expect(err.getStatus()).toBe(422);
      const body = err.getResponse();
      expect(body.currentStatus).toBe('Rejected');
      expect(body.attemptedStatus).toBe('Verified');
      expect(body.allowedTransitions).toEqual([]);
    }
  });

  it('logs the transition to AuditLog with actor and timestamp', async () => {
    await service.transition('proj-001', 'Pending', 'Verified', 'GVERIFIER', 'looks good');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId:     'GVERIFIER',
        action:     'PROJECT_STATUS_TRANSITION',
        resourceId: 'proj-001',
        result:     'Pending → Verified',
        metadata:   { from: 'Pending', to: 'Verified', reason: 'looks good' },
      }),
    });
  });

  it('does not log when transition is invalid', async () => {
    await expect(
      service.transition('proj-001', 'Completed', 'Pending', 'GACTOR'),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('allowedTransitions returns correct next states', () => {
    expect(service.allowedTransitions('Pending')).toEqual(['Verified', 'Rejected']);
    expect(service.allowedTransitions('Rejected')).toEqual([]);
    expect(service.allowedTransitions('Completed')).toEqual([]);
  });
});
