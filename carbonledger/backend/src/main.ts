import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { StructuredLogger } from './common/logging/structured-logger.service';
import { CorrelationIdMiddleware } from './common/logging/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Structured JSON logging with correlation ID threading.
  app.useLogger(app.get(StructuredLogger));

  // Auto-generate a correlation ID per request and expose it on the request context.
  app.use(CorrelationIdMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
