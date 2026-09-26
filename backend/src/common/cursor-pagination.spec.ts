import { buildCursorWhere, decodeCursor, encodeCursor, normalizePaginationLimit } from './cursor-pagination';

describe('cursor pagination helpers', () => {
  it('encodes and decodes opaque cursors', () => {
    const cursor = encodeCursor('row-1', new Date('2024-01-01T00:00:00.000Z'));
    expect(decodeCursor(cursor)).toEqual({ id: 'row-1', createdAt: '2024-01-01T00:00:00.000Z' });
  });

  it('caps page size at the configured maximum', () => {
    expect(normalizePaginationLimit(500, 100)).toBe(100);
    expect(normalizePaginationLimit(20, 100)).toBe(20);
  });

  it('builds a stable cursor filter for keyset pagination', () => {
    const cursor = decodeCursor(encodeCursor('row-2', new Date('2024-01-02T00:00:00.000Z')))!;
    expect(buildCursorWhere(cursor)).toEqual({
      OR: [
        { createdAt: { lt: new Date('2024-01-02T00:00:00.000Z') } },
        {
          createdAt: { equals: new Date('2024-01-02T00:00:00.000Z') },
          id: { lt: 'row-2' },
        },
      ],
    });
  });
});
