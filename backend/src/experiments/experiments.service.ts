import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ExperimentDefinition, PAUSE_EXPERIMENTS, findExperiment } from './experiments.config';
import {
  Assignment,
  DEFAULT_STATE,
  ExperimentData,
  ExperimentResults,
  ExperimentState,
  ExperimentStatus,
  analyze,
  assign,
  hashSubject,
} from './experiment-engine';

const STATE_KEY_PREFIX = 'experiment:';

export interface StatePatch {
  status?: ExperimentStatus;
  rolloutPercent?: number;
  winner?: string;
}

/**
 * ExperimentsService (#1326)
 *
 * Feature flags + A/B testing for pause feature variations:
 *  - assignment:  deterministic per subject, see experiment-engine.assign
 *  - tracking:    exposures and metric events in Postgres
 *  - results:     per-variant statistics with a ship/continue/rollback decision
 *  - state:       status / rollout % / winner in AdminConfig, so rollouts are
 *                 changed at runtime by an admin or scripts/experiment-rollout.js
 */
@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Definitions & state ─────────────────────────────────────────────────────

  async list(): Promise<Array<ExperimentDefinition & { state: ExperimentState }>> {
    return Promise.all(PAUSE_EXPERIMENTS.map(async (def) => ({ ...def, state: await this.getState(def.key) })));
  }

  async getState(key: string): Promise<ExperimentState> {
    const row = await this.prisma.adminConfig.findUnique({ where: { key: STATE_KEY_PREFIX + key } });
    if (!row) return { ...DEFAULT_STATE };
    try {
      return { ...DEFAULT_STATE, ...JSON.parse(row.value) };
    } catch {
      this.logger.warn(`Unparseable state for experiment ${key}; using default`);
      return { ...DEFAULT_STATE };
    }
  }

  async updateState(key: string, patch: StatePatch, admin: string): Promise<ExperimentState> {
    const def = this.require(key);
    const next: ExperimentState = { ...(await this.getState(key)), ...patch };

    if (next.rolloutPercent < 0 || next.rolloutPercent > 100) {
      throw new BadRequestException('rolloutPercent must be between 0 and 100');
    }
    if (next.winner !== undefined && !def.variants.some((v) => v.key === next.winner)) {
      throw new BadRequestException(`Unknown variant "${next.winner}" for ${key}`);
    }
    if (next.status === 'concluded' && !next.winner) {
      throw new BadRequestException('A winner is required to conclude an experiment');
    }
    if (next.status !== 'concluded') delete next.winner;

    next.updatedAt = new Date().toISOString();
    next.updatedBy = admin;
    const value = JSON.stringify(next);
    await this.prisma.adminConfig.upsert({
      where: { key: STATE_KEY_PREFIX + key },
      update: { value },
      create: { key: STATE_KEY_PREFIX + key, value },
    });
    this.logger.log({ event: 'experiment_state_changed', experiment: key, ...next });
    return next;
  }

  // ── Flags ───────────────────────────────────────────────────────────────────

  /** Variant for every experiment the subject is eligible for. */
  async getAssignments(subject: string, role?: string): Promise<Record<string, Assignment>> {
    const out: Record<string, Assignment> = {};
    for (const def of PAUSE_EXPERIMENTS) {
      if (!this.eligible(def, role)) continue;
      out[def.key] = assign(def, await this.getState(def.key), subject);
    }
    return out;
  }

  /**
   * Record that the subject actually saw their variant. Only enrolled
   * subjects are counted; the first exposure fixes the variant for analysis.
   */
  async recordExposure(key: string, subject: string, role?: string): Promise<Assignment> {
    const def = this.require(key);
    if (!this.eligible(def, role)) throw new BadRequestException(`${key} is not available for role ${role}`);

    const assignment = assign(def, await this.getState(key), subject);
    if (!assignment.enrolled) return assignment;

    const subjectHash = hashSubject(subject);
    await this.prisma.experimentExposure.upsert({
      where: { experimentKey_subjectHash: { experimentKey: key, subjectHash } },
      update: {},
      create: { experimentKey: key, variant: assignment.variant, subjectHash },
    });
    return assignment;
  }

  /** Record a metric for an exposed subject. Unexposed subjects are ignored. */
  async recordMetric(key: string, subject: string, metric: string, value?: number): Promise<{ recorded: boolean }> {
    const def = this.require(key);
    const metricDef = def.metrics.find((m) => m.key === metric);
    if (!metricDef) throw new BadRequestException(`Unknown metric "${metric}" for ${key}`);

    let v = 1;
    if (metricDef.type === 'continuous') {
      if (value === undefined || !Number.isFinite(value) || value < 0) {
        throw new BadRequestException(`${metric} requires a non-negative numeric value`);
      }
      v = value;
    }

    const subjectHash = hashSubject(subject);
    const exposure = await this.prisma.experimentExposure.findUnique({
      where: { experimentKey_subjectHash: { experimentKey: key, subjectHash } },
    });
    if (!exposure) return { recorded: false };

    await this.prisma.experimentMetricEvent.create({
      data: { experimentKey: key, variant: exposure.variant, subjectHash, metric, value: v },
    });
    return { recorded: true };
  }

  // ── Results ─────────────────────────────────────────────────────────────────

  async getResults(key: string): Promise<ExperimentResults> {
    const def = this.require(key);
    const [state, data] = await Promise.all([this.getState(key), this.collect(def)]);
    return analyze(def, state, data);
  }

  private async collect(def: ExperimentDefinition): Promise<ExperimentData> {
    const exposureRows = await this.prisma.experimentExposure.groupBy({
      by: ['variant'],
      where: { experimentKey: def.key },
      _count: { _all: true },
    });
    const data: ExperimentData = { exposures: {}, converted: {}, values: {} };
    for (const r of exposureRows) data.exposures[r.variant] = r._count._all;

    for (const m of def.metrics) {
      // One row per (variant, subject): the subject is the unit of analysis.
      const perSubject = await this.prisma.experimentMetricEvent.groupBy({
        by: ['variant', 'subjectHash'],
        where: { experimentKey: def.key, metric: m.key },
        _sum: { value: true },
      });
      const converted: Record<string, number> = {};
      const values: Record<string, number[]> = {};
      for (const r of perSubject) {
        converted[r.variant] = (converted[r.variant] ?? 0) + 1;
        (values[r.variant] ??= []).push(r._sum.value ?? 0);
      }
      data.converted[m.key] = converted;
      data.values[m.key] = values;
    }
    return data;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private require(key: string): ExperimentDefinition {
    const def = findExperiment(key);
    if (!def) throw new NotFoundException(`Unknown experiment "${key}"`);
    return def;
  }

  private eligible(def: ExperimentDefinition, role?: string): boolean {
    return def.audience === 'user' || role === 'admin';
  }
}
