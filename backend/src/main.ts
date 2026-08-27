import './telemetry/register';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger, ForbiddenException, LogLevel, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { CorrelationIdContext } from './logger/correlation-id.context';
import { validateEnv } from './env.validation';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import { StellarNetworkService } from './common/stellar-network.service';
import { contractCallsRegistry, poolMetricsRegistry } from './common/metrics.registry';
import { ValidationExceptionFilter } from './common/validation-exception.filter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { LoggerService } from './logger/logger.service';

/**
 * Enhanced JSON logger with correlation ID support.
 * Wraps NestJS ConsoleLogger so every line emitted to stdout is a single JSON object.
 * Includes correlation ID from AsyncLocalStorage for request tracing.
 */
class JsonLogger extends ConsoleLogger {
  private write(level: string, message: unknown, context?: string): void {
    const correlationId = CorrelationIdContext.getCorrelationId();
    const traceId = CorrelationIdContext.getTraceId();
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'backend',
        correlationId: correlationId || undefined,
        traceId: traceId || undefined,
        context: context ?? this.context,
        message,
      }) + '\n',
    );
  }

  log(message: unknown, context?: string)   { this.write('info',  message, context); }
  error(message: unknown, context?: string) { this.write('error', message, context); }
  warn(message: unknown, context?: string)  { this.write('warn',  message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('verbose', message, context); }
}

async function bootstrap() {
  validateEnv();

  const logLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;

  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(undefined, { logLevels: [logLevel] }),
  });

  const bodyLimit = process.env.BODY_SIZE_LIMIT ?? '10kb';
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

  // Required so the HTTP-only refresh-token cookie set by AuthController
  // can be read back from req.cookies on /auth/refresh and /auth/logout.
  app.use(cookieParser());

  // URI-based versioning: /api/v1/... and /api/v2/...
  // - v1 controllers use @Controller('resource') with VERSION_NEUTRAL (global prefix api/v1)
  // - v2 controllers use @Controller({ path: 'resource', version: '2' })
  // The global prefix is set to 'api' and versioning adds /v{n}/ automatically.
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',   // Controllers without @Version() default to v1
    prefix: 'v',
  });

  // Fix mass assignment (API3): strip unknown fields globally.
  // exceptionFactory passes structured errors so ValidationExceptionFilter
  // can map them to the CarbonLedger error catalog format.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const { BadRequestException } = require('@nestjs/common');
        return new BadRequestException({
          message: errors
            .map((e) => Object.values(e.constraints ?? {}).join(', '))
            .filter(Boolean),
          errors,
        });
      },
    }),
  );

  // Maps class-validator errors to CarbonLedger validation error catalog format (400 + error codes).
  app.useGlobalFilters(new ValidationExceptionFilter());

  // Catch-all fallback (#966): standardizes every response NOT already handled by a
  // more specific filter above (ThrottlerExceptionFilter, StellarUnavailableExceptionFilter,
  // ValidationExceptionFilter) into the CarbonLedger error envelope, and collapses
  // unexpected 5xx errors to a generic message so internals never leak to callers.
  // Must be registered LAST — global filters are tried in registration order and this
  // one's bare @Catch() matches every exception, so anything registered after it would
  // never run.
  app.useGlobalFilters(new AllExceptionsFilter(app.get(LoggerService)));

  // Fix API6: limit request body to 1 MB to prevent resource exhaustion
  app.use(require('express').json({ limit: '1mb' }));
  app.use(require('express').urlencoded({ limit: '1mb', extended: true }));

  // Ensure all responses use keep-alive to prevent ECONNRESET under load
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('Connection', 'keep-alive');
    next();
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [process.env.FRONTEND_URL || 'http://localhost:3000'];

  app.enableCors({
     origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new ForbiddenException('Origin not allowed by CORS'), false);
        }
      },
     credentials: true,
     methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
     preflightContinue: false,
     optionsSuccessStatus: 204,
   });

  const stellarNetwork = app.get(StellarNetworkService);
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/health", (_req: any, res: any) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Readiness — DB, Redis and Stellar connectivity must be reachable
  httpAdapter.get('/health/ready', async (_req: any, res: any) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // DB check
    try {
      const prisma = app.get(PrismaService);
      await prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch (err: any) {
      checks.db = `error: ${err.message}`;
      healthy = false;
    }

    // Redis check
    try {
      const Redis = require('ioredis');
      const redis = new Redis({
        host:        process.env.REDIS_HOST     || 'localhost',
        port:        parseInt(process.env.REDIS_PORT || '6379'),
        password:    process.env.REDIS_PASSWORD || undefined,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      await redis.connect();
      await redis.ping();
      redis.disconnect();
      checks.redis = 'ok';
    } catch (err: any) {
      checks.redis = `error: ${err.message}`;
      healthy = false;
    }

    // Stellar Horizon / Soroban RPC check
    try {
      const stellarCheck = await stellarNetwork.checkConnectivity();
      if (!stellarCheck.healthy) {
        healthy = false;
        checks.stellar = `horizon: ${stellarCheck.horizon.details ?? 'ok'}, rpc: ${stellarCheck.rpc.details ?? 'ok'}`;
      } else {
        checks.stellar = 'ok';
      }
    } catch (err: any) {
      checks.stellar = `error: ${err.message}`;
      healthy = false;
    }

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Prometheus-compatible metrics endpoint.
  // Scraped by Grafana Agent / Prometheus at /metrics.
  // No authentication — metrics contain no sensitive data, only counters.
  httpAdapter.get('/metrics', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(
      contractCallsRegistry.toPrometheusText() +
      poolMetricsRegistry.toPrometheusText(),
    );
  });

  await app.listen(process.env.PORT ?? 3001);
}

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'unhandledRejection',
    reason: reason instanceof Error ? reason.stack || reason.message : reason,
  }));
});

bootstrap();
