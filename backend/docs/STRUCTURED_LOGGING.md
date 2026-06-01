# Structured JSON Logging with Correlation IDs

## Overview

The backend now implements structured JSON logging with correlation IDs to enable request tracing throughout the system. Every request generates a unique correlation ID (UUID) that is included in all log entries for that request, making it possible to trace a request through the entire system for debugging production issues and maintaining an audit trail.

## Architecture

### Components

1. **CorrelationIdContext** (`src/logger/correlation-id.context.ts`)
   - Uses Node.js `AsyncLocalStorage` to maintain correlation context across async operations
   - Generates UUIDs for correlation IDs
   - Provides methods to get/set correlation context

2. **CorrelationIdMiddleware** (`src/logger/correlation-id.middleware.ts`)
   - Express middleware that runs on every request
   - Extracts correlation ID from `X-Correlation-ID` header or generates a new one
   - Stores correlation ID in request object and AsyncLocalStorage
   - Sets correlation ID in response header

3. **Enhanced LoggerService** (`src/logger/logger.service.ts`)
   - Winston-based logger with CloudWatch integration
   - Automatically includes correlation ID from AsyncLocalStorage in all logs
   - Supports structured logging with context fields

4. **Enhanced LoggingInterceptor** (`src/logger/logging.interceptor.ts`)
   - Global NestJS interceptor that logs all HTTP requests/responses
   - Captures request method, path, status code, and duration
   - Logs errors with stack traces
   - Updates correlation context with response details

5. **Enhanced JsonLogger** (`src/main.ts`)
   - Custom NestJS logger that emits single-line JSON to stdout
   - Includes correlation ID from AsyncLocalStorage
   - Respects LOG_LEVEL environment variable

## Log Format

All logs are emitted as structured JSON with the following fields:

```json
{
  "timestamp": "2025-05-29T10:30:45.123Z",
  "level": "info",
  "service": "carbonledger-backend",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "GET /api/v1/projects completed",
  "statusCode": 200,
  "duration": 45,
  "method": "GET",
  "path": "/api/v1/projects",
  "user_id": "user-123",
  "contract_id": "contract-456"
}
```

### Required Fields

- `timestamp`: ISO 8601 timestamp
- `level`: Log level (debug, info, warn, error)
- `correlationId`: UUID for request tracing
- `method`: HTTP method (for request logs)
- `path`: Request path (for request logs)
- `statusCode`: HTTP status code (for response logs)
- `duration`: Request duration in milliseconds (for response logs)

### Optional Fields

- `user_id`: User ID from JWT payload
- `contract_id`: Contract ID from X-Contract-ID header
- `error`: Error message and stack trace
- `context`: Additional context data

## Usage

### Configuration

Set the `LOG_LEVEL` environment variable to control logging verbosity:

```bash
LOG_LEVEL=debug    # Most verbose
LOG_LEVEL=info     # Default
LOG_LEVEL=warn     # Warnings and errors only
LOG_LEVEL=error    # Errors only
```

### Request Tracing

The correlation ID is automatically propagated through:

1. **Request Header**: Extract from `X-Correlation-ID` header if present
2. **Response Header**: Set in `X-Correlation-ID` response header
3. **All Logs**: Included in every log entry for that request
4. **Async Operations**: Maintained across async operations via AsyncLocalStorage

### Example: Tracing a Request

1. Client sends request with optional `X-Correlation-ID` header:
```bash
curl -H "X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000" \
     http://localhost:3001/api/v1/projects
```

2. Middleware generates or uses provided correlation ID
3. All logs for this request include the correlation ID
4. Response includes `X-Correlation-ID` header with the same ID

### Logging in Services

Use the injected `LoggerService` to log with automatic correlation ID:

```typescript
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  async doSomething() {
    // Correlation ID is automatically included
    this.logger.log('Processing request', {
      userId: user.id,
      projectId: project.id,
    });

    try {
      // ... do work
      this.logger.log('Processing completed', {
        result: 'success',
      });
    } catch (error) {
      this.logger.error('Processing failed', error.stack, {
        error: error.message,
      });
    }
  }
}
```

## Integration Points

### Global Middleware
- Registered in `AppModule.configure()` to run on all routes

### Global Interceptor
- `LoggingInterceptor` registered as `APP_INTERCEPTOR` in `AppModule`
- Logs all HTTP requests and responses

### Seed Scripts
- `prisma/seed.ts` and `prisma/seed-staging.ts` use `StructuredLogger`
- Indexer (`src/indexer.ts`) uses `StructuredLogger`
- OpenAPI export (`src/export-openapi.ts`) uses `StructuredLogger`

### Service Logging
- All services that previously used `console.log` now use `LoggerService`
- Includes: mail processor, PDF service, IPFS upload service, audit interceptor

## Acceptance Criteria Met

✅ **Every request generates a unique correlation ID (UUID)**
- Generated in `CorrelationIdMiddleware` or extracted from header

✅ **Correlation ID is included in all log entries for that request**
- Automatically added by `LoggerService` via `AsyncLocalStorage`

✅ **Logs are structured JSON with required fields**
- `timestamp`: ISO 8601 format
- `level`: Log level
- `correlationId`: UUID
- `method`: HTTP method
- `path`: Request path
- `statusCode`: HTTP status code
- `duration`: Request duration in milliseconds

✅ **Correlation ID is returned in X-Correlation-ID response header**
- Set by `CorrelationIdMiddleware` on all responses

✅ **Log level is configurable via LOG_LEVEL environment variable**
- Configured in `main.ts` and passed to NestJS logger
- Respects standard log levels: debug, info, warn, error

## Debugging Production Issues

To trace a request through the system:

1. Find the correlation ID in the response header or initial log entry
2. Search logs for that correlation ID
3. All logs with that ID are part of the same request flow
4. Follow the request through services, database operations, and external calls

Example log search:
```bash
# Using grep
grep "550e8400-e29b-41d4-a716-446655440000" /var/log/app.log

# Using CloudWatch Insights
fields @timestamp, @message, correlationId, level
| filter correlationId = "550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc
```

## Performance Considerations

- **AsyncLocalStorage**: Minimal overhead, used for context propagation
- **JSON Serialization**: Logs are serialized to JSON once at output
- **No Blocking**: Logging is non-blocking and doesn't impact request latency
- **CloudWatch Integration**: Optional, disabled if `AWS_CLOUDWATCH_GROUP` not set

## Future Enhancements

- Add distributed tracing support (OpenTelemetry)
- Add request/response body logging (with PII redaction)
- Add performance metrics collection
- Add custom log formatters for different environments
