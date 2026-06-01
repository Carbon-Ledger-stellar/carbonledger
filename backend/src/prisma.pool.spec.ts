/**
 * Connection pool load test — 500 concurrent queries
 *
 * Run: DATABASE_URL=<url> npx ts-node src/prisma.pool.spec.ts
 * Or via jest: jest --testPathPattern=prisma.pool
 */
import { PrismaService } from "./prisma.service";

const CONCURRENCY = 500;
const TIMEOUT_MS = 30_000;

async function runLoadTest() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/carbonledger";
  process.env.DB_POOL_MAX = process.env.DB_POOL_MAX ?? "10";

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const start = Date.now();
  let succeeded = 0;
  let failed = 0;

  const tasks = Array.from({ length: CONCURRENCY }, () =>
    prisma.$queryRaw`SELECT 1 AS n`
      .then(() => succeeded++)
      .catch(() => failed++),
  );

  await Promise.all(tasks);

  const elapsed = Date.now() - start;
  const metrics = prisma.getPoolMetrics();

  await prisma.onModuleDestroy();

  return { succeeded, failed, elapsed, metrics };
}

describe("Prisma connection pool — 500 concurrent queries", () => {
  jest.setTimeout(TIMEOUT_MS);

  it("handles 500 concurrent queries with ≤1% failure rate", async () => {
    const { succeeded, failed, elapsed, metrics } = await runLoadTest();

    console.log(
      `Results: ${succeeded} ok / ${failed} failed in ${elapsed}ms | pool_max=${metrics.pool_max}`,
    );

    const failRate = failed / CONCURRENCY;
    expect(failRate).toBeLessThanOrEqual(0.01); // ≤1% failures
    expect(succeeded).toBeGreaterThanOrEqual(CONCURRENCY * 0.99);
    expect(metrics.pool_max).toBe(parseInt(process.env.DB_POOL_MAX ?? "10"));
  });
});
