import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../prisma.service';
import {
  VERIFIER_EVENTS,
  ProjectVerificationDeadlineEvent,
} from './notification.events';

/** Hours a verifier has to review a project before it breaches SLA. */
const SLA_HOURS = Number(process.env.VERIFICATION_SLA_HOURS ?? 72);
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class VerificationDeadlineScheduler {
  private readonly logger = new Logger(VerificationDeadlineScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Warns the assigned verifier when a pending project has 24h of SLA left.
   *
   * Runs hourly and selects only projects whose elapsed time falls inside the
   * single one-hour window where the remaining time crosses 24h. That window is
   * what makes the job idempotent — each project matches exactly one run, so no
   * "already notified" bookkeeping is needed and a missed run simply skips the
   * warning rather than replaying it forever.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async warnOnApproachingDeadline(): Promise<void> {
    const now = Date.now();

    // elapsed ∈ [SLA-24h, SLA-23h)  ⇒  createdAt ∈ (now-(SLA-23h), now-(SLA-24h)]
    const windowEnd = new Date(now - (SLA_HOURS - 24) * HOUR_MS);
    const windowStart = new Date(now - (SLA_HOURS - 23) * HOUR_MS);

    if (SLA_HOURS <= 24) {
      this.logger.warn(
        `VERIFICATION_SLA_HOURS=${SLA_HOURS} is <= 24; no 24h warning window exists`,
      );
      return;
    }

    let projects: Array<{
      projectId: string;
      name: string;
      verifierAddress: string;
      createdAt: Date;
    }>;

    try {
      projects = await this.prisma.carbonProject.findMany({
        where: {
          status: 'Pending',
          verifierAddress: { not: '' },
          createdAt: { gt: windowStart, lte: windowEnd },
        },
        select: {
          projectId: true,
          name: true,
          verifierAddress: true,
          createdAt: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Deadline sweep query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    for (const project of projects) {
      const hoursElapsed = (now - project.createdAt.getTime()) / HOUR_MS;
      const payload: ProjectVerificationDeadlineEvent = {
        verifierAddress: project.verifierAddress,
        projectId: project.projectId,
        name: project.name,
        pendingSince: project.createdAt.toISOString(),
        hoursRemaining: Math.max(0, Math.round(SLA_HOURS - hoursElapsed)),
        emittedAt: new Date().toISOString(),
      };

      this.events.emit(
        VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H,
        payload,
      );
    }

    if (projects.length) {
      this.logger.log(
        `Emitted ${projects.length} verification-deadline warning(s)`,
      );
    }
  }
}
