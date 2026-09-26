import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";

function createInMemoryRedisService() {
  const memory = new Map<string, string>();
  return {
    isConnected: true,
    get: jest.fn(async (key: string) => {
      const raw = memory.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    set: jest.fn(async (key: string, value: unknown) => {
      memory.set(key, JSON.stringify(value));
      return true;
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => memory.delete(k));
      return true;
    }),
    delByPattern: jest.fn(async () => true),
    getClient: jest.fn(() => null),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };
}

import { inferRoleFromPublicKey } from "./security-test-auth";

type Row = Record<string, unknown>;

function makeStore() {
  const rows: Row[] = [];
  return {
    rows,
    upsert: jest.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = Object.keys(where)[0];
      const val = where[key as string];
      const idx = rows.findIndex((r) => r[key as string] === val);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...update };
        return rows[idx];
      }
      const row = { ...create };
      rows.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: { where: Row }) => {
      const key = Object.keys(where)[0];
      const val = where[key as string];
      return rows.find((r) => r[key as string] === val) ?? null;
    }),
    findMany: jest.fn(async ({ where }: { where?: Row } = {}) => {
      if (!where) return [...rows];
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (v && typeof v === "object" && "contains" in (v as object)) {
            return String(r[k] ?? "").includes(String((v as { contains: string }).contains));
          }
          return r[k] === v;
        }),
      );
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      rows.push(data);
      return data;
    }),
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const key = Object.keys(where)[0];
      const val = where[key as string];
      const idx = rows.findIndex((r) => r[key as string] === val);
      if (idx < 0) throw new Error("not found");
      rows[idx] = { ...rows[idx], ...data };
      return rows[idx];
    }),
    deleteMany: jest.fn(async ({ where }: { where: Row }) => {
      const before = rows.length;
      const key = Object.keys(where)[0];
      const val = where[key as string];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][key as string] === val) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    }),
    count: jest.fn(async () => rows.length),
  };
}

export function createSecurityPrismaMock() {
  const noop = jest.fn().mockResolvedValue(undefined);
  const carbonProject = makeStore();
  const creditBatch = makeStore();
  const marketListing = makeStore();
  const retirementRecord = makeStore();
  const userStore = makeStore();

  return {
    $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    $connect: noop,
    $disconnect: noop,
    onModuleInit: noop,
    onModuleDestroy: noop,
    getPoolMetrics: jest.fn().mockReturnValue({ pool_max: 10 }),
    user: {
      ...userStore,
      findUnique: jest.fn(async ({ where }: { where: { publicKey: string } }) => {
        const row = await userStore.findUnique({ where });
        if (row) return row;
        return {
          publicKey: where.publicKey,
          role: inferRoleFromPublicKey(where.publicKey),
        };
      }),
      upsert: jest.fn(async ({ where, create, update }: { where: { publicKey: string }; create: Row; update: Row }) => {
        return userStore.upsert({ where, create, update });
      }),
    },
    carbonProject,
    creditBatch,
    marketListing,
    retirementRecord,
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    adminConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    monitoringData: { findFirst: jest.fn().mockResolvedValue(null) },
    syncMetadata: { update: jest.fn().mockResolvedValue({}) },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    emailLog: {
      create: jest.fn(async ({ data }: { data: Row }) => ({ id: "email-1", ...data })),
    },
  };
}

export async function createSecurityTestApp(
  pipeOptions: ConstructorParameters<typeof ValidationPipe>[0] = { whitelist: true },
): Promise<INestApplication> {
  const prismaMock = createSecurityPrismaMock();
  const redisMock = createInMemoryRedisService();

  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .overrideProvider(RedisService)
    .useValue(redisMock)
    .compile();

  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe(pipeOptions));
  await app.init();
  return app;
}
