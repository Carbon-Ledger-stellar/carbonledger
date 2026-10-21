import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PauseState } from '../entities/pause-state.entity';
import { PauseStateVersion } from '../entities/pause-state-version.entity';

export type PauseAction = 'pause' | 'unpause';

export interface PauseStateSnapshot {
  paused: boolean;
  reason?: string | null;
  adminUserId?: string | null;
  timestamp: Date;
}

@Injectable()
export class PauseService {
  private readonly logger = new Logger(PauseService.name);

  constructor(
    @InjectRepository(PauseState)
    private readonly pauseStateRepository: Repository<PauseState>,
    @InjectRepository(PauseStateVersion)
    private readonly pauseStateVersionRepository: Repository<PauseStateVersion>,
  ) {}

  /**
   * Returns the current pause state.
   */
  async getCurrentState(): Promise<PauseState | null> {
    return this.pauseStateRepository.findOne({ where: {} });
  }

  /**
   * Applies a pause/unpause action and appends an immutable version record.
   */
  async setPaused(
    paused: boolean,
    adminUserId: string,
    reason?: string,
  ): Promise<PauseState> {
    const action: PauseAction = paused ? 'pause' : 'unpause';
    const now = new Date();

    let state = await this.pauseStateRepository.findOne({ where: {} });
    if (!state) {
      state = this.pauseStateRepository.create({ paused: false });
    }

    state.paused = paused;
    state.reason = reason ?? null;
    state.updatedBy = adminUserId;
    state.updatedAt = now;

    const saved = await this.pauseStateRepository.save(state);

    await this.appendVersion({
      paused,
      reason: reason ?? null,
      adminUserId,
      action,
      timestamp: now,
    });

    this.logger.log(
      `Pause state changed to ${paused ? 'paused' : 'unpaused'} by admin ${adminUserId}`,
    );

    return saved;
  }

  /**
   * Appends an immutable version record. History rows are never updated or deleted.
   */
  private async appendVersion(entry: {
    paused: boolean;
    reason: string | null;
    adminUserId: string;
    action: PauseAction;
    timestamp: Date;
  }): Promise<PauseStateVersion> {
    const version = this.pauseStateVersionRepository.create({
      paused: entry.paused,
      reason: entry.reason,
      adminUserId: entry.adminUserId,
      action: entry.action,
      createdAt: entry.timestamp,
    });
    return this.pauseStateVersionRepository.save(version);
  }

  /**
   * Returns the full, ordered history of pause state changes.
   */
  async getHistory(): Promise<PauseStateVersion[]> {
    return this.pauseStateVersionRepository.find({
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Reconstructs the pause state as of the given point in time by replaying
   * the immutable version history up to and including that timestamp.
   */
  async getStateAt(timestamp: Date): Promise<PauseStateSnapshot> {
    const versions = await this.pauseStateVersionRepository.find({
      where: { createdAt: LessThanOrEqual(timestamp) },
      order: { createdAt: 'ASC' },
    });

    if (versions.length === 0) {
      return {
        paused: false,
        reason: null,
        adminUserId: null,
        timestamp,
      };
    }

    const latest = versions[versions.length - 1];
    return {
      paused: latest.paused,
      reason: latest.reason,
      adminUserId: latest.adminUserId,
      timestamp: latest.createdAt,
    };
  }
}
