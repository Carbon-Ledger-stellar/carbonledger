import { Injectable, Logger } from '@nestjs/common';

/**
 * DualReadService
 *
 * Provides backward-compatible field reads during zero-downtime expand-contract
 * migrations.  When a column is being renamed or replaced, both the old and the
 * new column exist in the database simultaneously.  This service centralises the
 * "read new, fall back to old" logic so that every caller gets a consistent value
 * without embedding migration-specific null-checks throughout the codebase.
 *
 * Usage pattern:
 *
 *   // Phase 2 (dual-read): code deployed after the expand migration but before
 *   // the backfill completes.
 *   const reason = this.dualRead.readField(record, 'reason', 'retirementReason');
 *
 *   // Phase 3 (cutover): remove the fallback entirely.
 *   const reason = record.reason;
 *
 * The service also exposes helpers for writing to both columns simultaneously
 * (expand phase) and for tracking which rows still carry stale values (useful
 * for verifying that a backfill is complete before cutover).
 */
@Injectable()
export class DualReadService {
  private readonly logger = new Logger(DualReadService.name);

  /**
   * Read `newField` from `record`.  If it is null or undefined, fall back to
   * `oldField`.  Logs a debug trace so engineers can track how often the
   * fallback is still being exercised in production.
   *
   * @param record     Any Prisma model record (typed as a plain object).
   * @param newField   The canonical replacement field (added in the expand step).
   * @param oldField   The legacy field being phased out.
   * @returns          The value of the new field if populated, otherwise the old
   *                   field value.
   */
  readField<T extends Record<string, unknown>>(
    record: T,
    newField: keyof T & string,
    oldField: keyof T & string,
  ): T[keyof T] {
    const newValue = record[newField];
    if (newValue !== null && newValue !== undefined) {
      return newValue;
    }
    const oldValue = record[oldField];
    this.logger.debug(
      `DualRead fallback: record did not have ${newField}, using ${oldField}=${String(oldValue)}`,
    );
    return oldValue;
  }

  /**
   * Build a partial update payload that writes the same value to both the new
   * and the legacy field.  Use this in the expand phase so that new writes keep
   * both columns in sync until the old column can be safely dropped.
   *
   * @example
   * await this.prisma.retirementRecord.create({
   *   data: {
   *     ...this.dualRead.writeBothFields('reason', 'retirementReason', dto.reason),
   *     // …other fields
   *   },
   * });
   */
  writeBothFields<TNew extends string, TOld extends string, TValue>(
    newField: TNew,
    oldField: TOld,
    value: TValue,
  ): Record<TNew | TOld, TValue> {
    return {
      [newField]: value,
      [oldField]: value,
    } as Record<TNew | TOld, TValue>;
  }

  /**
   * Returns true if the record has a non-null value in the new field, meaning
   * it has been processed by the backfill (or was written by the dual-read code
   * path after the expand migration).
   *
   * Useful for assertions in unit tests and for reporting backfill completeness.
   */
  isBackfilled<T extends Record<string, unknown>>(
    record: T,
    newField: keyof T & string,
  ): boolean {
    const value = record[newField];
    return value !== null && value !== undefined;
  }

  /**
   * Count the fraction of records in `records` that have already been
   * backfilled (new field populated).  Returns a value between 0 and 1.
   *
   * Intended for monitoring dashboards during a live backfill.
   */
  backfillProgress<T extends Record<string, unknown>>(
    records: T[],
    newField: keyof T & string,
  ): number {
    if (records.length === 0) return 1;
    const backfilled = records.filter((r) => this.isBackfilled(r, newField)).length;
    return backfilled / records.length;
  }

  /**
   * Validate that all records in `records` have the new field populated.
   * Throws if any record is missing the value.  Call this at the start of the
   * cutover phase to gate the deployment on a complete backfill.
   *
   * @throws Error if any record has a null or undefined new field value.
   */
  assertBackfillComplete<T extends Record<string, unknown>>(
    records: T[],
    newField: keyof T & string,
    tableName: string,
  ): void {
    const missing = records.filter((r) => !this.isBackfilled(r, newField));
    if (missing.length > 0) {
      throw new Error(
        `Backfill incomplete for ${tableName}.${newField}: ` +
          `${missing.length} of ${records.length} rows still have NULL values. ` +
          `Complete the backfill before deploying cutover code.`,
      );
    }
  }
}
