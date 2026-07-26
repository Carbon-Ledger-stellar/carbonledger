// Set required environment variables before any module is loaded
// Defaults to the docker-compose.test.yml database, but honours an explicit
// DATABASE_URL so CI or a local Postgres can be targeted instead.
process.env.DATABASE_URL ??= "postgresql://carbonledger:testpass@localhost:5433/carbonledger_test";
process.env.JWT_SECRET = "dev-secret-change-in-production";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.NODE_ENV = "test";
