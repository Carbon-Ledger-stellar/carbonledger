import { createHash } from 'crypto';

export interface CursorPayload {
  id: string;
  createdAt: string;
}

export function encodeCursor(id: string, createdAt: Date): string {
  const payload = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  return Buffer.from(payload).toString('base64url');
}

export function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as CursorPayload;
    if (!parsed.id || !parsed.createdAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function normalizePaginationLimit(limit?: number, max = 100): number {
  const numeric = Number(limit ?? 20);
  if (!Number.isFinite(numeric) || numeric < 1) return 1;
  return Math.min(numeric, max);
}

export function buildCursorWhere(cursor: CursorPayload | null) {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      {
        createdAt: { equals: createdAt },
        id: { lt: cursor.id },
      },
    ],
  };
}

export function createOpaqueCursor(id: string, createdAt: Date, salt = 'carbonledger'): string {
  const payload = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  const digest = createHash('sha256').update(`${salt}:${payload}`).digest('hex');
  return Buffer.from(JSON.stringify({ v: 1, payload, digest })).toString('base64url');
}
