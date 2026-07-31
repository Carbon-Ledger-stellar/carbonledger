import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { contractCallsRegistry } from '../common/metrics.registry';

export type ReconciliationDivergenceType =
  | 'db_active_on_chain_retired'
  | 'db_retired_on_chain_active'
  | 'db_amount_mismatch'
  | 'db_missing_on_chain';

export interface ReconciliationResolution {
  action: 'auto_resolved' | 'escalated';
  reason: string;
}

export interface ReconciliationResult {
  checked: number;
  divergencesFound: number;
  autoResolved: number;
  escalated: number;
  metrics: Record<string, number>;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async runReconciliation(): Promise<ReconciliationResult> {
    const batches = await this.prisma.creditBatch.findMany({
      select: {
        batchId: true,
        status: true,
        amount: true,
        projectId: true,
        vintageYear: true,
      },
    });

    let checked = 0;
    let divergencesFound = 0;
    let autoResolved = 0;
    let escalated = 0;

    for (const batch of batches) {
      checked += 1;
      const divergence = await this.detectDivergence(batch);

      if (!divergence) continue;

      divergencesFound += 1;
      const resolution = await this.resolveDivergence(batch, divergence);
      if (resolution.action === 'auto_resolved') {
        autoResolved += 1;
      } else {
        escalated += 1;
      }
    }

    const result = {
      checked,
      divergencesFound,
      autoResolved,
      escalated,
      metrics: {
        records_checked: checked,
        divergences_found: divergencesFound,
        auto_resolved: autoResolved,
        escalated,
      },
    };

    this.logger.log('Reconciliation completed', result);
    return result;
  }

  private async detectDivergence(batch: { batchId: string; status: string; amount: number; projectId: string; vintageYear: number }) {
    const retirementRecords = await this.prisma.retirementRecord.findMany({
      where: { batchId: batch.batchId },
      select: { amount: true },
    });

    const retiredAmount = retirementRecords.reduce((acc, item) => acc + Number(item.amount), 0);
    const onChainRetired = retiredAmount > 0 && batch.status === 'Active';
    const dbRetired = batch.status === 'FullyRetired' || batch.status === 'PartiallyRetired';

    if (onChainRetired && dbRetired) {
      return 'db_active_on_chain_retired' as const;
    }

    if (!onChainRetired && batch.status === 'FullyRetired') {
      return 'db_retired_on_chain_active' as const;
    }

    if (retiredAmount > batch.amount) {
      return 'db_amount_mismatch' as const;
    }

    return null;
  }

  private async resolveDivergence(batch: { batchId: string; status: string }, divergence: ReconciliationDivergenceType): Promise<ReconciliationResolution> {
    switch (divergence) {
      case 'db_active_on_chain_retired': {
        await this.prisma.creditBatch.update({
          where: { batchId: batch.batchId },
          data: { status: 'PartiallyRetired' },
        });
        contractCallsRegistry.increment('primary', 'success');
        return { action: 'auto_resolved', reason: 'DB marked active while on-chain retirement evidence exists' };
      }
      case 'db_retired_on_chain_active': {
        await this.prisma.creditBatch.update({
          where: { batchId: batch.batchId },
          data: { status: 'Active' },
        });
        contractCallsRegistry.increment('primary', 'success');
        return { action: 'auto_resolved', reason: 'DB marked retired while on-chain state is active' };
      }
      case 'db_amount_mismatch': {
        await this.prisma.creditBatch.update({
          where: { batchId: batch.batchId },
          data: { status: 'Active' },
        });
        contractCallsRegistry.increment('primary', 'error');
        return { action: 'escalated', reason: 'Retirement amount mismatch requires manual review' };
      }
      default: {
        contractCallsRegistry.increment('primary', 'error');
        return { action: 'escalated', reason: 'Unresolvable divergence' };
      }
    }
  }
}
