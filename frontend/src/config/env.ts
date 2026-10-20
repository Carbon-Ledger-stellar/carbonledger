/**
 * Centralized environment configuration.
 *
 * Values are read from Vite's `import.meta.env` at build time. Keep this
 * module free of side effects so it can be imported anywhere (components,
 * hooks, services) without pulling in runtime dependencies.
 */

const env = import.meta.env;

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Base URL for the Horizon API used by the frontend.
 */
export const HORIZON_URL = readString(env.VITE_HORIZON_URL, 'https://horizon.stellar.org');

/**
 * Base URL for the Soroban RPC endpoint used by the frontend.
 */
export const SOROBAN_RPC_URL = readString(
  env.VITE_SOROBAN_RPC_URL,
  'https://soroban-testnet.stellar.org',
);

/**
 * Lightweight health endpoint used by NetworkStatusIndicator to detect
 * Horizon/Soroban RPC outages. Defaults to the Horizon root endpoint, which
 * responds with a small JSON payload and is safe to poll.
 */
export const NETWORK_HEALTH_URL = readString(
  env.VITE_NETWORK_HEALTH_URL,
  `${HORIZON_URL.replace(/\/$/, '')}/`,
);

/**
 * Default interval (in milliseconds) between network health checks.
 * Can be overridden per-component via the `checkInterval` prop.
 */
export const NETWORK_HEALTH_CHECK_INTERVAL_MS = readNumber(
  env.VITE_NETWORK_HEALTH_CHECK_INTERVAL_MS,
  30_000,
);

/**
 * Timeout (in milliseconds) for a single network health check request.
 */
export const NETWORK_HEALTH_CHECK_TIMEOUT_MS = readNumber(
  env.VITE_NETWORK_HEALTH_CHECK_TIMEOUT_MS,
  5_000,
);
