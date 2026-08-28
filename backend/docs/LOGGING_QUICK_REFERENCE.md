# Structured Logging - Quick Reference Guide

## Quick Start

### Using LoggerService in Your Service

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class MyService {
  constructor(private readonly logger: LoggerService) {}

  async doSomething(userId: string) {
    // Info log
    this.logger.log('Starting operation', { userId });

    try {
      // ... do work
      this.logger.log('Operation completed', { userId, result: 'success' });
    } catch (error) {
      // Error log
      this.logger.error('Operation failed', error.stack, {
        userId,
        error: error.message,
      });
    }
  }
}
```

## Log Levels

```typescript
// Debug - Most verbose, for development
this.logger.debug('Debug message', { detail: 'value' });

// Info - General information (default)
this.logger.log('Info message', { detail: 'value' });

// Warn - Warning messages
this.logger.warn('Warning message', { detail: 'value' });

// Error - Error messages with stack trace
this.logger.error('Error message', error.stack, { detail: 'value' });

// Verbose - Very detailed (NestJS specific)
this.logger.verbose('Verbose message', { detail: 'value' });
```

## Environment Variables

```bash
# Set log level (debug, info, warn, error)
export LOG_LEVEL=debug

# Optional: CloudWatch integration
export AWS_CLOUDWATCH_GROUP=carbonledger-backend
export AWS_REGION=us-east-1
```

## Tracing Requests

### Get Correlation ID from Request

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller('api/v1')
export class MyController {
  @Get('example')
  example(@Req() req: Request) {
    const correlationId = (req as any).correlationId;
    // Use correlationId for logging or passing to services
  }
}
```

### Get Correlation ID from Context

```typescript
import { CorrelationIdContext } from '../logger/correlation-id.context';

// Anywhere in your code
const correlationId = CorrelationIdContext.getCorrelationId();
```

## Client-Side Usage

### Provide Custom Correlation ID

```bash
# Send request with custom correlation ID
curl -H "X-Correlation-ID: my-trace-id-123" \
     http://localhost:3001/api/v1/projects

# Response will include the same correlation ID
# X-Correlation-ID: my-trace-id-123
```

### Extract Correlation ID from Response

```javascript
// JavaScript/Node.js
const response = await fetch('http://localhost:3001/api/v1/projects');
const correlationId = response.headers.get('X-Correlation-ID');
console.log('Correlation ID:', correlationId);
```

## Log Output Examples

### Request Log
```json
{
  "timestamp": "2025-05-29T10:30:45.123Z",
  "level": "info",
  "service": "carbonledger-backend",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "GET /api/v1/projects",
  "method": "GET",
  "path": "/api/v1/projects",
  "ip": "127.0.0.1"
}
```

### Response Log
```json
{
  "timestamp": "2025-05-29T10:30:45.168Z",
  "level": "info",
  "service": "carbonledger-backend",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "GET /api/v1/projects completed",
  "statusCode": 200,
  "duration": 45,
  "method": "GET",
  "path": "/api/v1/projects"
}
```

### Error Log
```json
{
  "timestamp": "2025-05-29T10:30:46.200Z",
  "level": "error",
  "service": "carbonledger-backend",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Database query failed",
  "error": "Connection timeout",
  "trace": "Error: Connection timeout\n    at Database.query (...)"
}
```

## Debugging with Correlation IDs

### Find All Logs for a Request

```bash
# Using grep
grep "550e8400-e29b-41d4-a716-446655440000" app.log

# Using CloudWatch Insights
fields @timestamp, @message, level
| filter correlationId = "550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc
```

### Trace Request Flow

1. Find initial request log with correlation ID
2. Search for all logs with that correlation ID
3. Follow the request through services
4. Identify where errors occur
5. Check error logs for stack traces

## Common Patterns

### Logging with User Context

```typescript
this.logger.log('User action', {
  userId: user.id,
  action: 'project_created',
  projectId: project.id,
});
```

### Logging with Error Details

```typescript
try {
  // ... operation
} catch (error) {
  this.logger.error('Operation failed', error.stack, {
    operation: 'create_project',
    error: error.message,
    code: error.code,
  });
}
```

### Logging Performance Metrics

```typescript
const start = Date.now();
// ... operation
const duration = Date.now() - start;
this.logger.log('Operation completed', {
  operation: 'database_query',
  duration,
  threshold: duration > 1000 ? 'slow' : 'normal',
});
```

## Best Practices

✅ **DO:**
- Include relevant context in logs
- Use appropriate log levels
- Include user/request IDs for tracing
- Log errors with stack traces
- Use structured fields instead of string concatenation

❌ **DON'T:**
- Log sensitive data (passwords, tokens, PII)
- Use console.log directly (use LoggerService)
- Log entire objects without filtering
- Mix structured and unstructured logging
- Ignore correlation IDs

## Troubleshooting

### Correlation ID Not Appearing in Logs

1. Check that middleware is registered in AppModule
2. Verify LOG_LEVEL is not set to 'error' (hides info logs)
3. Check that LoggerService is injected correctly
4. Verify AsyncLocalStorage is working (Node.js 12.17+)

### Logs Not Appearing

1. Check LOG_LEVEL environment variable
2. Verify application is running
3. Check stdout/stderr redirection
4. Verify CloudWatch credentials (if using AWS)

### Performance Issues

1. Check if CloudWatch integration is causing delays
2. Verify log volume is reasonable
3. Check for excessive logging in loops
4. Monitor AsyncLocalStorage overhead

## Resources

- Full Documentation: `docs/STRUCTURED_LOGGING.md`
- Implementation Details: `IMPLEMENTATION_SUMMARY.md`
- Verification Checklist: `VERIFICATION_CHECKLIST.md`
