import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly reconciliationMismatchGauge = new Gauge({
    name: 'reconciliation_mismatch_count',
    help: 'Number of mismatches detected between DB and chain during the last reconciliation run',
    labelNames: ['entity'] as const,
    registers: [this.registry],
  });

  readonly reconciliationMismatchCounter = new Counter({
    name: 'reconciliation_mismatch_total',
    help: 'Total number of mismatches detected between DB and chain',
    labelNames: ['entity'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordReconciliationMismatches(entity: string, count: number): void {
    this.reconciliationMismatchGauge.set({ entity }, count);
    if (count > 0) {
      this.reconciliationMismatchCounter.inc({ entity }, count);
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
