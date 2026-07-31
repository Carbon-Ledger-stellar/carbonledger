// Required for class-validator / class-transformer decorators
import 'reflect-metadata';

// Set required environment variables before any module is loaded
process.env.DATABASE_URL = "postgresql://carbonledger:testpass@localhost:5433/carbonledger_test";
process.env.JWT_SECRET = "dev-secret-change-in-production";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.NODE_ENV = "test";

jest.mock("uuid", () => ({
  v4: () => "00000000-0000-4000-8000-000000000001",
}));

jest.mock("ioredis", () => {
  const instance = {
    ping: jest.fn().mockResolvedValue("PONG"),
    disconnect: jest.fn(),
    quit: jest.fn().mockResolvedValue("OK"),
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue([]),
    multi: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
    zadd: jest.fn().mockReturnThis(),
    zremrangebyscore: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    lpush: jest.fn().mockReturnThis(),
    ltrim: jest.fn().mockReturnThis(),
    status: "ready",
    connect: jest.fn().mockResolvedValue(undefined),
  };
  const Redis = jest.fn(() => instance);
  return { __esModule: true, default: Redis, Redis };
});

jest.mock("@nest-lab/throttler-storage-redis", () => ({
  ThrottlerStorageRedisService: jest.fn().mockImplementation(() => ({
    increment: jest.fn().mockResolvedValue({ totalHits: 1, timeToExpire: 60, isBlocked: false }),
    getBlockExpiration: jest.fn().mockResolvedValue(0),
  })),
}));

jest.mock("@nestjs/bullmq", () => {
  const actual = jest.requireActual("@nestjs/bullmq");
  class WorkerHost {}

  const BullModule = {
    forRoot: () => ({
      module: class BullRootModule {},
      global: true,
    }),
    registerQueue: (config: { name: string }) => {
      const token = `BullQueue_${config.name}`;
      const queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };
      return {
        module: class BullFeatureModule {},
        providers: [{ provide: token, useValue: queue }],
        exports: [token],
      };
    },
  };

  return {
    ...actual,
    BullModule,
    Processor: () => () => undefined,
    WorkerHost,
    getQueueToken: (name: string) => `BullQueue_${name}`,
  };
});

jest.mock("@nestjs/schedule", () => ({
  ScheduleModule: {
    forRoot: () => ({ module: class ScheduleRootModule {} }),
  },
  Interval: () => () => undefined,
  Cron: () => () => undefined,
  Timeout: () => () => undefined,
}));

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Server: jest.fn().mockImplementation(() => ({
      root: jest.fn().mockResolvedValue({}),
    })),
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }),
      })),
    },
  };
});
