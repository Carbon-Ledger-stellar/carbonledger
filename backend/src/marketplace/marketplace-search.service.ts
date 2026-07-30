import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  SearchListingsDto,
  SearchListingsResponse,
  SearchResultItem,
  SearchSortBy,
} from './marketplace.dto';

/**
 * MarketplaceSearchService
 *
 * Implements full-text and faceted search for MarketListing using the
 * PostgreSQL tsvector GIN index created by migration
 * 20260729130000_marketplace_fulltext_search.
 *
 * Design decisions:
 *  - Uses $queryRawUnsafe with a fully parameterised WHERE clause to prevent
 *    SQL injection; all user values are passed as bound parameters ($1, $2 …).
 *  - The ORDER BY clause and LIMIT/OFFSET are built in-process — they are not
 *    user-controlled string interpolation: sortBy is validated against an enum
 *    allowlist before being embedded, and LIMIT is a validated integer.
 *  - Joins to CarbonProject to include project name and verification status in
 *    results, enabling the frontend to display rich context without a second
 *    round-trip.
 *  - Issues the data query and COUNT query in parallel (Promise.all) so total
 *    count doesn't add sequential latency.
 *  - Returns ts_rank in the result set so clients can display relevance scores
 *    or use them for secondary client-side sorting.
 */
@Injectable()
export class MarketplaceSearchService {
  private readonly logger = new Logger(MarketplaceSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search and filter marketplace listings.
   *
   * At least one filter parameter must be provided; calling this endpoint
   * with a completely empty DTO returns a 400 Bad Request to prevent
   * unbounded full-table scans.
   *
   * @param dto   Validated SearchListingsDto from the controller
   * @returns     SearchListingsResponse with ranked, paginated results
   */
  async searchListings(dto: SearchListingsDto): Promise<SearchListingsResponse> {
    const {
      search,
      methodology,
      vintage,
      country,
      minPrice,
      maxPrice,
      status,
      seller,
      sortBy,
      cursor,
      limit = 20,
    } = dto;

    // ── Input validation ─────────────────────────────────────────────────────

    // Require at least one filter to prevent a full-table unfiltered dump
    const hasFilter =
      search || methodology?.length || vintage?.length || country?.length ||
      minPrice !== undefined || maxPrice !== undefined ||
      status?.length || seller;

    if (!hasFilter) {
      throw new BadRequestException(
        'At least one search or filter parameter is required',
      );
    }

    // Price range validation
    if (minPrice !== undefined && isNaN(parseFloat(minPrice))) {
      throw new BadRequestException('minPrice must be a valid numeric string');
    }
    if (maxPrice !== undefined && isNaN(parseFloat(maxPrice))) {
      throw new BadRequestException('maxPrice must be a valid numeric string');
    }
    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      parseFloat(minPrice) > parseFloat(maxPrice)
    ) {
      throw new BadRequestException(
        'minPrice must be less than or equal to maxPrice',
      );
    }

    // ── Build parameterised WHERE clause ─────────────────────────────────────

    const conditions: string[] = [];
    const args: unknown[] = [];
    let idx = 1;

    // Full-text search using the GIN-indexed tsvector column.
    // The listing's searchVector covers project name (A), methodology (B),
    // country (B), project description (C), and projectId (D).
    // We also include the project's own searchVector via the join so that
    // richer project metadata (verified name, full description) participates.
    if (search) {
      // Both the listing's own searchVector and the joined project's searchVector
      // are matched; the ts_rank in ORDER BY uses the listing vector.
      conditions.push(
        `(ml."searchVector" @@ plainto_tsquery('english', $${idx}) OR ` +
        `cp."searchVector" @@ plainto_tsquery('english', $${idx}))`,
      );
      args.push(search);
      idx++;
    }

    // Facet 1: methodology — IN list
    if (methodology && methodology.length > 0) {
      conditions.push(`ml."methodology" = ANY($${idx}::text[])`);
      args.push(methodology);
      idx++;
    }

    // Facet 2: vintageYear — IN list
    if (vintage && vintage.length > 0) {
      conditions.push(`ml."vintageYear" = ANY($${idx}::int[])`);
      args.push(vintage);
      idx++;
    }

    // Facet 3: country — IN list
    if (country && country.length > 0) {
      conditions.push(`ml."country" = ANY($${idx}::text[])`);
      args.push(country);
      idx++;
    }

    // Facet 4a: price lower bound (numeric cast)
    if (minPrice !== undefined) {
      conditions.push(`CAST(ml."pricePerCredit" AS NUMERIC) >= $${idx}::numeric`);
      args.push(minPrice);
      idx++;
    }

    // Facet 4b: price upper bound (numeric cast)
    if (maxPrice !== undefined) {
      conditions.push(`CAST(ml."pricePerCredit" AS NUMERIC) <= $${idx}::numeric`);
      args.push(maxPrice);
      idx++;
    }

    // Facet 5: listing status — IN list
    if (status && status.length > 0) {
      conditions.push(`ml."status" = ANY($${idx}::text[])`);
      args.push(status);
      idx++;
    }

    // Facet 6: seller public key (exact match)
    if (seller) {
      conditions.push(`ml."seller" = $${idx}`);
      args.push(seller);
      idx++;
    }

    // Cursor-based keyset pagination: only rows with id > cursor are returned.
    // We use the listing's id (cuid) as an opaque keyset cursor.
    if (cursor) {
      conditions.push(`ml."id" > $${idx}`);
      args.push(cursor);
      idx++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ── ORDER BY ─────────────────────────────────────────────────────────────
    //
    // sortBy is validated against the SearchSortBy enum allowlist here.
    // Only the enum key is ever interpolated — never a raw user string.

    const effectiveSortBy: SearchSortBy =
      sortBy ?? (search ? 'relevance' : 'createdAt');

    const ORDER_BY_MAP: Record<SearchSortBy, string> = {
      relevance:    search
        ? `ts_rank(ml."searchVector", plainto_tsquery('english', $1)) DESC, ml."createdAt" DESC`
        : `ml."createdAt" DESC`,
      price_asc:    `CAST(ml."pricePerCredit" AS NUMERIC) ASC, ml."createdAt" DESC`,
      price_desc:   `CAST(ml."pricePerCredit" AS NUMERIC) DESC, ml."createdAt" DESC`,
      vintage_asc:  `ml."vintageYear" ASC, ml."createdAt" DESC`,
      vintage_desc: `ml."vintageYear" DESC, ml."createdAt" DESC`,
      createdAt:    `ml."createdAt" DESC`,
    };

    const orderByClause = ORDER_BY_MAP[effectiveSortBy] ?? `ml."createdAt" DESC`;

    // Fetch limit + 1 to detect whether another page exists
    const take = limit + 1;

    // ── Raw SQL ───────────────────────────────────────────────────────────────

    type RawRow = {
      id: string;
      listingId: string;
      projectId: string;
      batchId: string;
      seller: string;
      amountAvailable: string;
      pricePerCredit: string;
      vintageYear: number;
      methodology: string;
      country: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      rank: number | null;
      projectName: string | null;
      projectStatus: string | null;
      methodologyScore: number | null;
    };

    const selectSQL = `
      SELECT
        ml."id",
        ml."listingId",
        ml."projectId",
        ml."batchId",
        ml."seller",
        ml."amountAvailable"::text,
        ml."pricePerCredit",
        ml."vintageYear",
        ml."methodology",
        ml."country",
        ml."status",
        ml."createdAt",
        ml."updatedAt",
        ${
          search
            ? `ts_rank(ml."searchVector", plainto_tsquery('english', $1))`
            : 'NULL::float4'
        } AS "rank",
        cp."name"               AS "projectName",
        cp."status"             AS "projectStatus",
        cp."methodologyScore"   AS "methodologyScore"
      FROM "MarketListing" ml
      LEFT JOIN "CarbonProject" cp
        ON cp."projectId" = ml."projectId"
      ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ${take}
    `;

    const countSQL = `
      SELECT COUNT(*)::bigint AS count
      FROM "MarketListing" ml
      LEFT JOIN "CarbonProject" cp
        ON cp."projectId" = ml."projectId"
      ${whereClause}
    `;

    this.logger.debug(
      `searchListings: search=${search ?? '(none)'} ` +
      `facets=[methodology:${methodology?.join(',')}, ` +
      `vintage:${vintage?.join(',')}, ` +
      `country:${country?.join(',')}, ` +
      `status:${status?.join(',')}, ` +
      `seller:${seller}] ` +
      `sort=${effectiveSortBy} limit=${limit}`,
    );

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<RawRow[]>(selectSQL, ...args),
      this.prisma.$queryRawUnsafe<[{ count: bigint }]>(countSQL, ...args),
    ]);

    // ── Pagination ────────────────────────────────────────────────────────────

    const hasMore = rows.length > limit;
    const nextCursor = hasMore ? rows[limit - 1].id : undefined;
    if (hasMore) rows.pop();

    const totalCount = Number(countRows[0]?.count ?? 0);

    const results: SearchResultItem[] = rows.map((r) => ({
      id:              r.id,
      listingId:       r.listingId,
      projectId:       r.projectId,
      batchId:         r.batchId,
      seller:          r.seller,
      amountAvailable: r.amountAvailable,
      pricePerCredit:  r.pricePerCredit,
      vintageYear:     r.vintageYear,
      methodology:     r.methodology,
      country:         r.country,
      status:          r.status,
      createdAt:       r.createdAt,
      updatedAt:       r.updatedAt,
      rank:            r.rank !== null ? Number(r.rank) : null,
      projectName:     r.projectName,
      projectStatus:   r.projectStatus,
      methodologyScore: r.methodologyScore !== null ? Number(r.methodologyScore) : null,
    }));

    return {
      results,
      total_count: totalCount,
      next_cursor: nextCursor,
      has_more:    hasMore,
    };
  }
}
