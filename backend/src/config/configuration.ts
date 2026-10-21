import { registerAs } from '@nestjs/config';

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
}

/**
 * Required environment variables grouped by the module that consumes them.
 * Keep this list in sync with mail, redis and stellar modules so that a
 * misconfigured deployment fails fast at startup instead of crashing later.
 */
export const REQUIRED_ENV_VARS: readonly string[] = [
  // Core
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'JWT_SECRET',

  // Mail
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',

  // Redis
  'REDIS_HOST',
  'REDIS_PORT',

  // Stellar
  'STELLAR_NETWORK',
  'STELLAR_HORIZON_URL',
  'STELLAR_SECRET_KEY',
  'STELLAR_PUBLIC_KEY',
];

function isMissing(value: string | undefined): boolean {
  return value === undefined || value === null || value.trim() === '';
}

/**
 * Validates that every required environment variable is present.
 * Returns the full list of missing variables so callers can report them all
 * at once rather than failing on the first one.
 */
export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnvValidationResult {
  const missing = REQUIRED_ENV_VARS.filter((key) => isMissing(env[key]));
  return { valid: missing.length === 0, missing };
}

/**
 * Fails fast at startup with a clear, aggregated error listing every missing
 * required environment variable.
 */
export function assertEnvValid(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { valid, missing } = validateEnv(env);
  if (!valid) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  mail: {
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASSWORD,
    from: process.env.MAIL_FROM,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  stellar: {
    network: process.env.STELLAR_NETWORK,
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    secretKey: process.env.STELLAR_SECRET_KEY,
    publicKey: process.env.STELLAR_PUBLIC_KEY,
  },
}));
