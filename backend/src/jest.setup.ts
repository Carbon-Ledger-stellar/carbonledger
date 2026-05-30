// Set required environment variables before any module is loaded
process.env.DATABASE_URL = "postgresql://carbonledger:testpass@localhost:5433/carbonledger_test";
process.env.JWT_SECRET = "dev-secret-change-in-production";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.NODE_ENV = "test";
