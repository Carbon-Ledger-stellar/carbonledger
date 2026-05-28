import { NestFactory } from '@nestjs/core';
import { ConsoleLogger, ForbiddenException, LogLevel, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

/**
 * Minimal JSON logger — wraps NestJS ConsoleLogger so every line emitted to
 * stdout is a single JSON object.  Promtail's JSON pipeline stage picks up
 * `level`, `message`, and `service` labels automatically.
 */
class JsonLogger extends ConsoleLogger {
  private write(level: string, message: unknown, context?: string): void {
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: 'backend',
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
  const logLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;

  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(undefined, { logLevels: [logLevel] }),
  });

  const bodyLimit = process.env.BODY_SIZE_LIMIT ?? '10kb';
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

  app.setGlobalPrefix('api/v1');

  // Header-based versioning: Accept-Version: 1
  // All existing routes are VERSION_NEUTRAL (no @Version decorator needed).
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'Accept-Version',
  });

  // Fix mass assignment (API3): strip unknown fields globally
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

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

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/health", (_req: any, res: any) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Readiness — DB and Redis must be reachable
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

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
