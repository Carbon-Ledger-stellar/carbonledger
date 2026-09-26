import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Response } from 'express';

// Number of rows fetched per database page to bound memory usage
const STREAM_PAGE_SIZE = 200;

@Injectable()
export class ExportService {
  constructor(private prisma: PrismaService) {}

  // ── Existing in-memory helpers (kept for small result sets / tests) ────────

  async getProjects(filters: any) {
    return this.prisma.carbonProject.findMany({
      where: this.buildProjectWhere(filters),
    });
  }

  async getRetirements(filters: any) {
    return this.prisma.retirementRecord.findMany({
      where: this.buildRetirementWhere(filters),
      include: {
        project: { select: { name: true, methodology: true, country: true } },
      },
    });
  }

  // ── Streaming NDJSON export (#666) ────────────────────────────────────────

  /**
   * Stream retirement records as NDJSON (one JSON object per line) directly
   * into the HTTP response.  Fetches rows in pages of STREAM_PAGE_SIZE to
   * avoid loading the full result set into memory.
   *
   * Callers must set response headers before invoking this method.
   */
  async streamRetirementsNdjson(filters: any, res: Response): Promise<void> {
    let cursor: string | undefined;

    while (true) {
      const page = await this.prisma.retirementRecord.findMany({
        where: this.buildRetirementWhere(filters),
        include: {
          project: { select: { name: true, methodology: true, country: true } },
        },
        orderBy: { retiredAt: 'asc' },
        take: STREAM_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;

      for (const row of page) {
        res.write(JSON.stringify(row) + '\n');
      }

      if (page.length < STREAM_PAGE_SIZE) break;
      cursor = page[page.length - 1].id;
    }

    res.end();
  }

  /**
   * Stream retirement records as CSV directly into the HTTP response.
   * Headers are written from the first page; subsequent pages append rows only.
   */
  async streamRetirementsCsv(filters: any, res: Response): Promise<void> {
    let cursor: string | undefined;
    let headersWritten = false;
    let csvHeaders: string[] = [];

    while (true) {
      const page = await this.prisma.retirementRecord.findMany({
        where: this.buildRetirementWhere(filters),
        include: {
          project: { select: { name: true, methodology: true, country: true } },
        },
        orderBy: { retiredAt: 'asc' },
        take: STREAM_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;

      const flatPage = page.map(flattenRecord);

      if (!headersWritten) {
        csvHeaders = Object.keys(flatPage[0]);
        res.write(csvHeaders.join(',') + '\n');
        headersWritten = true;
      }

      for (const row of flatPage) {
        res.write(toCsvRow(row, csvHeaders) + '\n');
      }

      if (page.length < STREAM_PAGE_SIZE) break;
      cursor = page[page.length - 1].id;
    }

    res.end();
  }

  // ── CSV serializer (kept for projects export and backwards compat) ─────────

  toCsv(data: any[]): string {
    if (!data || data.length === 0) return '';
    const flattenedData = data.map(flattenRecord);
    const headers = Object.keys(flattenedData[0]);
    const rows = flattenedData.map((obj) => toCsvRow(obj, headers));
    return [headers.join(','), ...rows].join('\n');
  }

  // ── Where clause builders ──────────────────────────────────────────────────

  private buildProjectWhere(filters: any) {
    return {
      ...(filters.startDate && { createdAt: { gte: new Date(filters.startDate) } }),
      ...(filters.endDate && { createdAt: { lte: new Date(filters.endDate) } }),
      ...(filters.methodology && { methodology: filters.methodology }),
      ...(filters.country && { country: filters.country }),
    };
  }

  private buildRetirementWhere(filters: any) {
    return {
      ...(filters.startDate && { retiredAt: { gte: new Date(filters.startDate) } }),
      ...(filters.endDate && { retiredAt: { lte: new Date(filters.endDate) } }),
      ...(filters.projectId && { projectId: filters.projectId }),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function flattenRecord(item: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      for (const [nk, nv] of Object.entries(value)) {
        out[`${key}_${nk}`] = nv;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toCsvRow(obj: Record<string, unknown>, headers: string[]): string {
  return headers
    .map((h) => {
      const val = obj[h];
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      if (Array.isArray(val)) return `"${val.join('; ').replace(/"/g, '""')}"`;
      if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
      return String(val);
    })
    .join(',');
}
