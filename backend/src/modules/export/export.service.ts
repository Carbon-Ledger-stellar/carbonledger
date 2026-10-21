import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface ExportRowSource {
  /**
   * Returns a page of rows. Implementations should fetch lazily (e.g. keyset
   * pagination) so the full dataset is never held in memory at once.
   */
  fetchPage(offset: number, limit: number): Promise<Record<string, unknown>[]>;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  private static readonly PAGE_SIZE = 1000;

  /**
   * Streams CSV rows to the HTTP response with backpressure.
   *
   * Rows are pulled page-by-page from the source and pushed into the response
   * stream. When the socket buffer is full, `write` returns false and we wait
   * for `drain` before fetching the next page, keeping memory flat regardless
   * of the total row count (e.g. 100k rows).
   */
  async streamCsv(
    res: Response,
    source: ExportRowSource,
    filename: string,
    columns?: string[],
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.sanitizeFilename(filename)}"`,
    );

    let header: string[] | null = columns ?? null;
    let offset = 0;
    let wroteAny = false;

    try {
      while (true) {
        const rows = await source.fetchPage(offset, ExportService.PAGE_SIZE);
        if (!rows.length) {
          break;
        }

        if (!header) {
          header = Object.keys(rows[0]);
        }

        if (!wroteAny) {
          await this.write(res, this.toCsvLine(header));
          wroteAny = true;
        }

        for (const row of rows) {
          const line = this.toCsvLine(header.map((col) => row[col]));
          await this.write(res, line);
        }

        offset += rows.length;
        if (rows.length < ExportService.PAGE_SIZE) {
          break;
        }
      }

      // Emit header even for empty exports so consumers get a valid CSV.
      if (!wroteAny && header) {
        await this.write(res, this.toCsvLine(header));
      }

      res.end();
    } catch (err) {
      this.logger.error(`CSV export failed: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    }
  }

  /**
   * Streams CSV from an async iterable of rows (alternative entry point).
   */
  async streamCsvFromIterable(
    res: Response,
    rows: AsyncIterable<Record<string, unknown>>,
    filename: string,
    columns?: string[],
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.sanitizeFilename(filename)}"`,
    );

    let header: string[] | null = columns ?? null;
    let wroteHeader = false;

    try {
      for await (const row of rows) {
        if (!header) {
          header = Object.keys(row);
        }
        if (!wroteHeader) {
          await this.write(res, this.toCsvLine(header));
          wroteHeader = true;
        }
        await this.write(res, this.toCsvLine(header.map((col) => row[col])));
      }

      if (!wroteHeader && header) {
        await this.write(res, this.toCsvLine(header));
      }

      res.end();
    } catch (err) {
      this.logger.error(`CSV export failed: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    }
  }

  /**
   * Writes a chunk and resolves once the stream can accept more data,
   * applying backpressure when the underlying socket buffer is full.
   */
  private write(res: Response, chunk: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        res.off('drain', onDrain);
        reject(err);
      };
      const onDrain = () => {
        res.off('error', onError);
        resolve();
      };

      res.once('error', onError);

      if (res.write(chunk)) {
        res.off('error', onError);
        resolve();
      } else {
        res.once('drain', onDrain);
      }
    });
  }

  private toCsvLine(values: unknown[]): string {
    return values.map((v) => this.escapeCsv(v)).join(',') + '\n';
  }

  private escapeCsv(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[\r\n"]/g, '');
  }
}
