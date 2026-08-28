/**
 * Startup environment variable validation.
 * Call validateEnv() before NestFactory.create() to fail fast with a clear error
 * if any required variable is absent.
 */

const REQUIRED: string[] = [
  'DATABASE_URL',
  'STELLAR_RPC_URL',
  'REDIS_HOST',
  'JWT_SECRET',
];

/**
 * Optional variables with their default values (for documentation purposes).
 * These are not validated but serve as a reference for .env.example.
 *
 * STELLAR_NETWORK          = 'testnet'
 * STELLAR_HORIZON_URL      = 'https://horizon-testnet.stellar.org'
 * NETWORK_PASSPHRASE       = 'Test SDF Network ; September 2015'
 * PORT                     = '3001'
 * FRONTEND_URL             = 'http://localhost:3000'
 * ALLOWED_ORIGINS          = 'http://localhost:3000'
 * LOG_LEVEL                = 'info'
 * BODY_SIZE_LIMIT          = '10kb'
 * REDIS_PORT               = '6379'
 * DB_POOL_MAX              = '10'
 * DB_POOL_TIMEOUT_MS       = '10000'
 * DB_CONNECT_TIMEOUT_S     = '10'
 * JWT_EXPIRY               = '7d'
 */

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    process.stderr.write(
      `[env] Missing required environment variable(s): ${missing.join(', ')}\n` +
      `[env] Copy .env.example to .env and fill in the missing values.\n`,
    );
    process.exit(1);
  }
}
