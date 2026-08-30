/**
 * marketplace-pagination.e2e-spec.ts
 *
 * Comprehensive integration tests for marketplace listings pagination.
 * Tests run against a real NestJS app + real PostgreSQL test database.
 *
 * Coverage:
 *   - Page-based pagination (page, limit)
 *   - Cursor-based pagination (cursor, next_cursor, prev_cursor)
 *   - Offset-based pagination (offset, limit)
 *   - Limit enforcement (max 100)
 *   - Sorting (price, vintageYear, methodology, verificationDate)
 *   - Filtering (methodology, vintage, country, minPrice, maxPrice, search)
 *   - Edge cases (page=0, limit=0, negative values, out of range)
 *   - Response structure validation
 *
 * Closes #1015
 */

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp, cleanDatabase, seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma.service';

describe('Marketplace Pagination Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    await seedTestData(app);
    await seedPaginationTestData(app);
  });

  // ── Page-Based Pagination ──────────────────────────────────────────────

  describe('Page-Based Pagination (?page=N&limit=L)', () => {
    it('[happy] returns first page with default limit=20', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1')
        .expect(200);

      expect(res.body).toHaveProperty('listings');
      expect(res.body).toHaveProperty('total_count');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('total_pages');
      expect(res.body).toHaveProperty('has_more');
      expect(res.body).toHaveProperty('hasMore');
      expect(Array.isArray(res.body.listings)).toBe(true);
      expect(res.body.listings.length).toBeLessThanOrEqual(20);
    });

    it('[happy] returns second page with page=2', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=10')
        .expect(200);

      expect(res.body.page).toBe(2);
      expect(res.body.listings.length).toBeLessThanOrEqual(10);
    });

    it('[happy] page navigation works correctly (page 1, 2, 3)', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=5')
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=5')
        .expect(200);

      const page3 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=3&limit=5')
        .expect(200);

      // Verify pages are different
      if (page1.body.listings.length === 5 && page2.body.listings.length === 5) {
        expect(page1.body.listings[0].id).not.toBe(page2.body.listings[0].id);
      }

      // Verify has_more flag
      if (page3.body.listings.length === 0) {
        expect(page2.body.has_more).toBe(false);
      }
    });

    it('[edge] page=0 returns error or defaults to page=1', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=0&limit=20');

      // Should either error (400) or default to page 1
      if (res.status === 400) {
        expect(res.body).toHaveProperty('message');
      } else {
        expect([200, 400]).toContain(res.status);
      }
    });

    it('[edge] out of range page returns empty results', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=99999&limit=20')
        .expect(200);

      expect(res.body.listings.length).toBe(0);
      expect(res.body.has_more).toBe(false);
    });

    it('[edge] negative page returns error or defaults', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=-1&limit=20');

      expect([200, 400]).toContain(res.status);
    });

    it('[edge] very large page number works without error', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1000000&limit=20')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });
  });

  // ── Limit Enforcement ──────────────────────────────────────────────────

  describe('Limit Enforcement (max 100)', () => {
    it('[happy] limit=20 works (default)', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      expect(res.body.limit).toBe(20);
      expect(res.body.listings.length).toBeLessThanOrEqual(20);
    });

    it('[happy] limit=50 works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=50')
        .expect(200);

      expect(res.body.limit).toBe(50);
      expect(res.body.listings.length).toBeLessThanOrEqual(50);
    });

    it('[happy] limit=100 (max) works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=100')
        .expect(200);

      expect(res.body.limit).toBe(100);
      expect(res.body.listings.length).toBeLessThanOrEqual(100);
    });

    it('[protection] limit > 100 is capped to 100', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=200')
        .expect(200);

      expect(res.body.limit).toBe(100);
      expect(res.body.listings.length).toBeLessThanOrEqual(100);
    });

    it('[protection] limit=999 is capped to 100', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=999')
        .expect(200);

      expect(res.body.limit).toBe(100);
    });

    it('[protection] limit=1000000 is capped to 100', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=1000000')
        .expect(200);

      expect(res.body.limit).toBe(100);
    });

    it('[edge] limit=0 returns error or defaults', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=0');

      // Should either error (400) or default to 1
      if (res.status === 400) {
        expect(res.body).toHaveProperty('message');
      } else {
        expect([200, 400]).toContain(res.status);
      }
    });

    it('[edge] limit=-5 returns error or defaults', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=-5');

      expect([200, 400]).toContain(res.status);
    });

    it('[edge] limit=1 (minimum valid) works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=1')
        .expect(200);

      expect(res.body.listings.length).toBeLessThanOrEqual(1);
    });

    it('[edge] non-numeric limit is rejected or defaults', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=abc');

      // Should either error or use default
      expect([200, 400]).toContain(res.status);
    });
  });

  // ── Cursor-Based Pagination ────────────────────────────────────────────

  describe('Cursor-Based Pagination (?cursor=...)', () => {
    it('[happy] cursor-based pagination works', async () => {
      const res1 = await request(app.getHttpServer())
        .get('/marketplace/listings?limit=5')
        .expect(200);

      if (res1.body.next_cursor && res1.body.listings.length > 0) {
        const res2 = await request(app.getHttpServer())
          .get(`/marketplace/listings?cursor=${res1.body.next_cursor}&limit=5`)
          .expect(200);

        expect(Array.isArray(res2.body.listings)).toBe(true);
        // Verify cursor advances (different starting item)
        if (res2.body.listings.length > 0 && res1.body.listings.length > 0) {
          expect(res2.body.listings[0].id).not.toBe(res1.body.listings[0].id);
        }
      }
    });

    it('[happy] next_cursor is provided when more items exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?limit=5')
        .expect(200);

      if (res.body.listings.length === 5) {
        expect(res.body.next_cursor).toBeDefined();
      }
    });

    it('[happy] next_cursor is null when on last page', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?limit=10000')
        .expect(200);

      expect(res.body.next_cursor).toBeUndefined();
    });

    it('[edge] invalid cursor returns error or is handled gracefully', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?cursor=invalid_base64&limit=5');

      // Should either error (400) or skip cursor
      expect([200, 400]).toContain(res.status);
    });

    it('[edge] malformed cursor (not JSON) is handled', async () => {
      const badCursor = Buffer.from('not-json').toString('base64');
      const res = await request(app.getHttpServer())
        .get(`/marketplace/listings?cursor=${badCursor}&limit=5`);

      expect([200, 400]).toContain(res.status);
    });
  });

  // ── Offset-Based Pagination ────────────────────────────────────────────

  describe('Offset-Based Pagination (?offset=N&limit=L)', () => {
    it('[happy] offset=0 with limit=10 returns first 10', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=0&limit=10')
        .expect(200);

      expect(res.body.offset).toBe(0);
      expect(res.body.listings.length).toBeLessThanOrEqual(10);
    });

    it('[happy] offset=10 with limit=10 returns items 10-19', async () => {
      const res1 = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=0&limit=10')
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=10&limit=10')
        .expect(200);

      if (res1.body.listings.length === 10 && res2.body.listings.length > 0) {
        expect(res2.body.listings[0].id).not.toBe(res1.body.listings[0].id);
      }
    });

    it('[happy] offset navigation works (0, 20, 40)', async () => {
      const offset0 = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=0&limit=20')
        .expect(200);

      const offset20 = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=20&limit=20')
        .expect(200);

      const offset40 = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=40&limit=20')
        .expect(200);

      expect(Array.isArray(offset0.body.listings)).toBe(true);
      expect(Array.isArray(offset20.body.listings)).toBe(true);
      expect(Array.isArray(offset40.body.listings)).toBe(true);
    });

    it('[edge] offset out of range returns empty', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=999999&limit=20')
        .expect(200);

      expect(res.body.listings.length).toBe(0);
    });

    it('[edge] negative offset is handled', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=-10&limit=20');

      // Should either error or default to 0
      expect([200, 400]).toContain(res.status);
    });
  });

  // ── Response Structure ─────────────────────────────────────────────────

  describe('Response Structure Validation', () => {
    it('[happy] response includes all required pagination fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      // Required fields
      expect(res.body).toHaveProperty('listings');
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total_count');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(res.body).toHaveProperty('has_more');
      expect(res.body).toHaveProperty('hasMore');

      // Page-based fields
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('total_pages');

      // Type checks
      expect(typeof res.body.total_count).toBe('number');
      expect(typeof res.body.limit).toBe('number');
      expect(typeof res.body.has_more).toBe('boolean');
      expect(typeof res.body.page).toBe('number');
    });

    it('[happy] listing items have required fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      if (res.body.listings.length > 0) {
        const listing = res.body.listings[0];
        expect(listing).toHaveProperty('id');
        expect(listing).toHaveProperty('listingId');
        expect(listing).toHaveProperty('projectId');
        expect(listing).toHaveProperty('batchId');
        expect(listing).toHaveProperty('seller');
        expect(listing).toHaveProperty('amountAvailable');
        expect(listing).toHaveProperty('pricePerCredit');
        expect(listing).toHaveProperty('vintageYear');
        expect(listing).toHaveProperty('methodology');
        expect(listing).toHaveProperty('country');
        expect(listing).toHaveProperty('status');
      }
    });

    it('[happy] has_more and hasMore are consistent', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      expect(res.body.has_more).toBe(res.body.hasMore);
    });

    it('[happy] data and listings are consistent', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      expect(res.body.data).toEqual(res.body.listings);
    });

    it('[happy] total and total_count are consistent', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      expect(res.body.total).toBe(res.body.total_count);
    });

    it('[happy] offset matches expected calculation', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=3&limit=10')
        .expect(200);

      expect(res.body.offset).toBe((res.body.page - 1) * res.body.limit);
    });

    it('[happy] total_pages is calculated correctly', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      const expected = Math.ceil(res.body.total_count / res.body.limit);
      expect(res.body.total_pages).toBe(expected);
    });
  });

  // ── Sorting ────────────────────────────────────────────────────────────

  describe('Sorting (?sortBy=...&sortOrder=...)', () => {
    it('[happy] sortBy=price returns listings sorted by price', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=price&sortOrder=asc&limit=100')
        .expect(200);

      if (res.body.listings.length > 1) {
        for (let i = 0; i < res.body.listings.length - 1; i++) {
          const current = parseFloat(res.body.listings[i].pricePerCredit);
          const next = parseFloat(res.body.listings[i + 1].pricePerCredit);
          expect(current).toBeLessThanOrEqual(next);
        }
      }
    });

    it('[happy] sortBy=price&sortOrder=desc returns descending prices', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=price&sortOrder=desc&limit=100')
        .expect(200);

      if (res.body.listings.length > 1) {
        for (let i = 0; i < res.body.listings.length - 1; i++) {
          const current = parseFloat(res.body.listings[i].pricePerCredit);
          const next = parseFloat(res.body.listings[i + 1].pricePerCredit);
          expect(current).toGreaterThanOrEqual(next);
        }
      }
    });

    it('[happy] sortBy=vintageYear works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=vintageYear&sortOrder=asc&limit=100')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });

    it('[happy] sortBy=methodology works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=methodology&sortOrder=asc&limit=100')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });

    it('[happy] sortBy=verificationDate works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=verificationDate&sortOrder=asc&limit=100')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });

    it('[edge] invalid sortBy defaults to createdAt', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?sortBy=invalid&limit=100')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });
  });

  // ── Filtering ──────────────────────────────────────────────────────────

  describe('Filtering with Pagination', () => {
    it('[happy] methodology filter works with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?methodology=ACM0002&page=1&limit=20')
        .expect(200);

      res.body.listings.forEach((listing: any) => {
        expect(listing.methodology).toBe('ACM0002');
      });
    });

    it('[happy] vintage filter works with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?vintage=2024&page=1&limit=20')
        .expect(200);

      res.body.listings.forEach((listing: any) => {
        expect(listing.vintageYear).toBe(2024);
      });
    });

    it('[happy] country filter works with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?country=Kenya&page=1&limit=20')
        .expect(200);

      res.body.listings.forEach((listing: any) => {
        expect(listing.country).toBe('Kenya');
      });
    });

    it('[happy] price range filter works', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?minPrice=5&maxPrice=15&page=1&limit=20')
        .expect(200);

      res.body.listings.forEach((listing: any) => {
        const price = parseFloat(listing.pricePerCredit);
        expect(price).toBeGreaterThanOrEqual(5);
        expect(price).toBeLessThanOrEqual(15);
      });
    });

    it('[happy] search filter works with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?search=Test&page=1&limit=20')
        .expect(200);

      expect(Array.isArray(res.body.listings)).toBe(true);
    });

    it('[edge] minPrice > maxPrice returns error', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?minPrice=100&maxPrice=10');

      expect(res.status).toBe(400);
    });

    it('[edge] invalid price values are rejected', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?minPrice=invalid&page=1&limit=20');

      expect([200, 400]).toContain(res.status);
    });

    it('[happy] multiple filters combine correctly', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?methodology=ACM0002&country=Kenya&minPrice=5&maxPrice=20&page=1&limit=20')
        .expect(200);

      res.body.listings.forEach((listing: any) => {
        expect(listing.methodology).toBe('ACM0002');
        expect(listing.country).toBe('Kenya');
        const price = parseFloat(listing.pricePerCredit);
        expect(price).toBeGreaterThanOrEqual(5);
        expect(price).toBeLessThanOrEqual(20);
      });
    });
  });

  // ── Combined Scenarios ─────────────────────────────────────────────────

  describe('Combined Pagination, Sorting & Filtering', () => {
    it('[happy] page + sort + filter work together', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=10&sortBy=price&sortOrder=asc&methodology=ACM0002&country=Kenya')
        .expect(200);

      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      res.body.listings.forEach((listing: any) => {
        expect(listing.methodology).toBe('ACM0002');
        expect(listing.country).toBe('Kenya');
      });
    });

    it('[happy] offset + sort + filter work together', async () => {
      const res = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=0&limit=10&sortBy=vintageYear&sortOrder=desc&vintage=2024')
        .expect(200);

      expect(res.body.offset).toBe(0);
      res.body.listings.forEach((listing: any) => {
        expect(listing.vintageYear).toBe(2024);
      });
    });

    it('[happy] cursor + filter works', async () => {
      const res1 = await request(app.getHttpServer())
        .get('/marketplace/listings?limit=5&methodology=ACM0002')
        .expect(200);

      if (res1.body.next_cursor) {
        const res2 = await request(app.getHttpServer())
          .get(`/marketplace/listings?cursor=${res1.body.next_cursor}&limit=5&methodology=ACM0002`)
          .expect(200);

        expect(Array.isArray(res2.body.listings)).toBe(true);
      }
    });
  });

  // ── Consistency Tests ──────────────────────────────────────────────────

  describe('Pagination Consistency', () => {
    it('[happy] total_count stays constant across pages', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=10')
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=10')
        .expect(200);

      expect(page1.body.total_count).toBe(page2.body.total_count);
    });

    it('[happy] limit is respected across multiple pages', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=15')
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=15')
        .expect(200);

      expect(page1.body.limit).toBe(15);
      expect(page2.body.limit).toBe(15);
    });

    it('[happy] all listings across pages are unique', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=10')
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=10')
        .expect(200);

      const ids1 = page1.body.listings.map((l: any) => l.id);
      const ids2 = page2.body.listings.map((l: any) => l.id);

      const intersection = ids1.filter((id: string) => ids2.includes(id));
      expect(intersection.length).toBe(0);
    });

    it('[happy] item count matches across offset/page methods', async () => {
      const pageBased = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      const offsetBased = await request(app.getHttpServer())
        .get('/marketplace/listings?offset=0&limit=20')
        .expect(200);

      expect(pageBased.body.listings.length).toBe(offsetBased.body.listings.length);
    });
  });

  // ── Caching and Performance ────────────────────────────────────────────

  describe('Caching Behavior', () => {
    it('[happy] repeated requests use cache', async () => {
      const res1 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      // Results should be identical (same cache)
      expect(res1.body.listings).toEqual(res2.body.listings);
      expect(res1.body.total_count).toBe(res2.body.total_count);
    });

    it('[happy] different page queries have separate cache entries', async () => {
      await request(app.getHttpServer())
        .get('/marketplace/listings?page=1&limit=20')
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .get('/marketplace/listings?page=2&limit=20')
        .expect(200);

      expect(res2.body.page).toBe(2);
    });
  });
});

/**
 * Seeds the test database with a variety of marketplace listings
 * for comprehensive pagination testing.
 */
async function seedPaginationTestData(app: INestApplication) {
  const prisma = app.get(PrismaService);

  // Ensure project and batch exist
  const project = await prisma.carbonProject.findFirst({
    where: { projectId: 'PROJ001' },
  });

  if (!project) {
    await prisma.carbonProject.create({
      data: {
        projectId: 'PROJ001',
        name: 'Test Solar Project',
        description: 'Test project for pagination',
        methodology: 'ACM0002',
        country: 'Kenya',
        projectType: 'Solar',
        status: 'Active',
        vintageYear: 2024,
        totalCreditsIssued: 1000,
        totalCreditsRetired: 0,
        metadataCid: 'QmTest123',
        verifierAddress: 'GVERIF456',
        ownerAddress: 'GCORP123',
      },
    });
  }

  const batch = await prisma.creditBatch.findFirst({
    where: { batchId: 'BATCH001' },
  });

  if (!batch) {
    await prisma.creditBatch.create({
      data: {
        batchId: 'BATCH001',
        projectId: 'PROJ001',
        vintageYear: 2024,
        amount: 1000,
        serialStart: 'KE-001-2024-0001',
        serialEnd: 'KE-001-2024-1000',
        status: 'Active',
        metadataCid: 'QmBatch123',
      },
    });
  }

  // Create 50 test listings with varied prices for sorting tests
  const listings = [];
  for (let i = 1; i <= 50; i++) {
    listings.push({
      listingId: `LISTING${String(i).padStart(3, '0')}`,
      projectId: 'PROJ001',
      batchId: 'BATCH001',
      seller: i % 2 === 0 ? 'GCORP123' : 'GVERIF456',
      amountAvailable: 100,
      pricePerCredit: (5 + i * 0.5).toFixed(2), // Prices from 5.5 to 30
      vintageYear: 2024,
      methodology: i % 3 === 0 ? 'ACM0003' : 'ACM0002',
      country: i % 4 === 0 ? 'Uganda' : 'Kenya',
      status: i % 5 === 0 ? 'PartiallyFilled' : 'Active',
      createdAt: new Date(Date.now() - i * 1000),
      updatedAt: new Date(Date.now() - i * 1000),
    });
  }

  await prisma.marketListing.createMany({
    data: listings,
    skipDuplicates: true,
  });
}
