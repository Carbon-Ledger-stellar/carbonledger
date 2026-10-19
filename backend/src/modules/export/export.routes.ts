import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { exportService } from './export.service';

const router = Router();

/**
 * GET /export/:accountId
 * Streams a CSV export for the given account directly to the response,
 * applying backpressure via stream.pipeline so memory stays flat even for
 * very large accounts (100k+ rows).
 */
router.get('/:accountId', async (req: Request, res: Response) => {
  const { accountId } = req.params;

  const filename = `export-${accountId}-${Date.now()}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );
  res.setHeader('Cache-Control', 'no-store');

  // Async generator yields one CSV line at a time; the underlying cursor is
  // only advanced as the response drains, keeping memory usage flat.
  const rows = exportService.streamRows(accountId);

  async function* toCsv(): AsyncGenerator<string> {
    yield 'id,createdAt,amount,currency,status\n';
    for await (const row of rows) {
      yield `${row.id},${row.createdAt},${row.amount},${row.currency},${row.status}\n`;
    }
  }

  try {
    await pipeline(Readable.from(toCsv()), res);
  } catch (err) {
    // If headers were already sent we cannot change the status; just abort.
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed' });
    } else {
      res.destroy(err as Error);
    }
  }
});

export default router;
