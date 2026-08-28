import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type ProjectStatus = 'Pending' | 'Verified' | 'Rejected' | 'Suspended' | 'Completed';

/**
 * Valid transitions — mirrors the Soroban carbon_registry contract.
 *
 * Pending   → Verified   (verifier approves)
 * Pending   → Rejected   (verifier rejects)
 * Verified  → Suspended  (admin suspends)
 * Verified  → Completed  (oracle marks complete)
 * Suspended → Verified   (admin reinstates)
 * Suspended → Rejected   (admin permanently rejects)
 *
 * Rejected and Completed are terminal.
 */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  Pending:   ['Verified', 'Rejected'],
  Verified:  ['Suspended', 'Completed'],
  Suspended: ['Verified', 'Rejected'],
  Rejected:  [],
  Completed: [],
};

@Injectable()
export class ProjectStateMachineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate and apply a status transition.
   * Throws 422 if the transition is invalid.
   * Logs the transition to AuditLog with actor and timestamp.
   */
  async transition(
    projectId: string,
    currentStatus: ProjectStatus,
    nextStatus: ProjectStatus,
    actor: string,
    reason?: string,
  ): Promise<void> {
    const allowed = TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(nextStatus)) {
      throw new UnprocessableEntityException({
        message: 'Invalid project status transition',
        currentStatus,
        attemptedStatus: nextStatus,
        allowedTransitions: allowed,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId:     actor,
        action:     'PROJECT_STATUS_TRANSITION',
        resourceId: projectId,
        result:     `${currentStatus} → ${nextStatus}`,
        metadata:   { from: currentStatus, to: nextStatus, reason: reason ?? null },
      },
    });
  }

  /** Returns the allowed next states for a given status. */
  allowedTransitions(status: ProjectStatus): ProjectStatus[] {
    return TRANSITIONS[status] ?? [];
  }
}
