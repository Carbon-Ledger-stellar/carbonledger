import { ForbiddenException } from '@nestjs/common';

const ORIGIN_PATTERN = /^https?:\/\/[^\s/]+(?::\d+)?$/i;

export interface CorsConfig {
  allowedOrigins: readonly string[];
  origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => void;
  credentials: true;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  preflightContinue: false;
  optionsSuccessStatus: 204;
  maxAge: number;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getCorsOrigins(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = parseOrigins(env.CORS_ORIGINS);
  const production = isProduction(env);

  if (configured.length === 0) {
    if (production) {
      throw new Error('Invalid CORS configuration: CORS_ORIGINS must contain at least one explicit origin in production');
    }
    return [env.FRONTEND_URL?.trim() || 'http://localhost:3000'];
  }

  if (configured.includes('*')) {
    if (production) {
      throw new Error('Invalid CORS configuration: wildcard origins are not allowed in production');
    }
    throw new Error('Invalid CORS configuration: wildcard origins are not supported; configure explicit origins');
  }

  const invalid = configured.filter((origin) => !ORIGIN_PATTERN.test(origin));
  if (invalid.length > 0) {
    throw new Error(`Invalid CORS configuration: invalid origin(s): ${invalid.join(', ')}`);
  }

  return configured;
}

export function createCorsConfig(env: NodeJS.ProcessEnv = process.env): CorsConfig {
  const allowedOrigins = getCorsOrigins(env);
  return {
    allowedOrigins,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenException(`CORS: origin '${origin}' is not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Idempotency-Key',
      'X-Correlation-ID',
    ],
    exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Remaining'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };
}
