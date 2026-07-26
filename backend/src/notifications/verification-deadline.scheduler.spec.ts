import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { VerificationDeadlineScheduler } from './verification-deadline.scheduler';
import { PrismaService } from '../prisma.service';
import { VERIFIER_EVENTS } from './notification.events';

const VERIFIER = 'GVERIFIER000000000000000000000000000000000000000000000001';
const HOUR_MS = 60 * 60 * 1000;

describe('VerificationDeadlineScheduler', () => {
  let scheduler: VerificationDeadlineScheduler;
  let findMany: jest.Mock;
  let emit: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    emit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationDeadlineScheduler,
        { provide: PrismaService, useValue: { carbonProject: { findMany } } },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    }).compile();

    scheduler = module.get(VerificationDeadlineScheduler);
  });

  it('queries only Pending projects that have an assigned verifier', async () => {
    await scheduler.warnOnApproachingDeadline();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'Pending',
          verifierAddress: { not: '' },
        }),
      }),
    );
  });

  it('emits a deadline warning addressed to the assigned verifier', async () => {
    // 48h elapsed against the default 72h SLA — inside the warning window.
    const createdAt = new Date(Date.now() - 48 * HOUR_MS);
    findMany.mockResolvedValue([
      {
        projectId: 'proj-001',
        name: 'Amazon Reforestation',
        verifierAddress: VERIFIER,
        createdAt,
      },
    ]);

    await scheduler.warnOnApproachingDeadline();

    expect(emit).toHaveBeenCalledWith(
      VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H,
      expect.objectContaining({
        verifierAddress: VERIFIER,
        projectId: 'proj-001',
        name: 'Amazon Reforestation',
        pendingSince: createdAt.toISOString(),
        hoursRemaining: 24,
      }),
    );
  });

  it('emits once per project in the window', async () => {
    findMany.mockResolvedValue([
      {
        projectId: 'proj-001',
        name: 'A',
        verifierAddress: VERIFIER,
        createdAt: new Date(Date.now() - 48 * HOUR_MS),
      },
      {
        projectId: 'proj-002',
        name: 'B',
        verifierAddress: VERIFIER,
        createdAt: new Date(Date.now() - 48 * HOUR_MS),
      },
    ]);

    await scheduler.warnOnApproachingDeadline();

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('emits nothing when no project is inside the window', async () => {
    await scheduler.warnOnApproachingDeadline();

    expect(emit).not.toHaveBeenCalled();
  });

  it('swallows query failures so one bad sweep does not kill the cron', async () => {
    findMany.mockRejectedValue(new Error('db down'));

    await expect(scheduler.warnOnApproachingDeadline()).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});
