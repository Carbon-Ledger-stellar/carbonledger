import { Pool, PoolClient } from 'pg';

export interface PauseStatus {
  contractId: string;
  isPaused: boolean;
  pausedAt: Date | null;
  pausedBy: string | null;
  reason: string | null;
}

export interface PauseEvent {
  id: string;
  contractId: string;
  action: 'pause' | 'unpause';
  actor: string;
  reason: string | null;
  createdAt: Date;
}

export class ContractRepository {
  constructor(private readonly db: Pool) {}

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Returns the current pause state for a contract.
   * Uses the partial index on contract_pause_events(contract_id, created_at DESC)
   * to fetch the most recent pause/unpause event efficiently.
   */
  async getPauseStatus(contractId: string): Promise<PauseStatus | null> {
    const result = await this.db.query<{
      contract_id: string;
      action: 'pause' | 'unpause';
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT contract_id, action, actor, reason, created_at
         FROM contract_pause_events
        WHERE contract_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [contractId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const isPaused = row.action === 'pause';
    return {
      contractId: row.contract_id,
      isPaused,
      pausedAt: isPaused ? row.created_at : null,
      pausedBy: isPaused ? row.actor : null,
      reason: isPaused ? row.reason : null,
    };
  }

  /**
   * Returns the pause/unpause history for a contract, newest first.
   * Bounded by `limit` to keep the query efficient against the
   * (contract_id, created_at DESC) index.
   */
  async getPauseHistory(contractId: string, limit = 50): Promise<PauseEvent[]> {
    const result = await this.db.query<{
      id: string;
      contract_id: string;
      action: 'pause' | 'unpause';
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT id, contract_id, action, actor, reason, created_at
         FROM contract_pause_events
        WHERE contract_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [contractId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      contractId: row.contract_id,
      action: row.action,
      actor: row.actor,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Returns the most recent pause/unpause event for a contract, or null
   * when the contract has never been paused.
   */
  async getLastPauseEvent(contractId: string): Promise<PauseEvent | null> {
    const result = await this.db.query<{
      id: string;
      contract_id: string;
      action: 'pause' | 'unpause';
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT id, contract_id, action, actor, reason, created_at
         FROM contract_pause_events
        WHERE contract_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [contractId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      contractId: row.contract_id,
      action: row.action,
      actor: row.actor,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }
}
