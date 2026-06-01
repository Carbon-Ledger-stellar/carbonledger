# Structured JSON Logging Implementation Summary

## Overview
Implemented structured JSON logging with correlation IDs across the backend to enable request tracing for debugging production issues and maintaining audit trails.

## Files Created

### Core Logging Infrastructure
1. **`src/logger/correlation-id.context.ts`** (NEW)
   - AsyncLocalStorage-based context manager for correlation IDs
   - Generates UUIDs and manages correlation context across async operations

2. **`src/logger/correlation-id.middleware.ts`** (NEW)
   - Express middleware that generates/extracts correlation IDs
   - Sets correlation ID in response headers
   - Stores context in AsyncLocalStorage

### Documentation
3. **`docs/STRUCTURED_LOGGING.md`** (NEW)
   - Comprehensive guide on structured logging implementation
   - Usage examples and debugging instructions

## Files Modified

### Core Application Setup
1. **`src/main.ts`**
   - Enhanced `JsonLogger` to include correlation ID from AsyncLocalStorage
   - Added import for `CorrelationIdContext`

2. **`src/app.module.ts`**
   - Added `LoggerModule` import
   - Registered `CorrelationIdMiddleware` in `configure()` method
   - Added `LoggingInterceptor` as global interceptor
   - Implemented `NestModule` interface

### Logger Module
3. **`src/logger/logger.service.ts`**
   - Enhanced to automatically include correlation ID from AsyncLocalStorage
   - Added `getContextWithCorrelationId()` method
   - Updated all logging methods to use correlation context

4. **`src/logger/logging.interceptor.ts`**
   - Updated to use correlation ID from request object
   - Enhanced to log structured fields: method, path, statusCode, duration
   - Updated correlation context with response details

5. **`src/logger/logger.module.ts`**
   - Added `CorrelationIdContext` to providers and exports

### Service Layer
6. **`src/uploads/ipfs-upload.service.ts`**
   - Replaced `console.error` with `LoggerService.error()`
   - Added structured logging context

7. **`src/mail/mail.processor.ts`**
   - Replaced `console.log` and `console.error` with `LoggerService`
   - Added structured logging for email sending

8. **`src/mail/pdf.service.ts`**
   - Replaced `console.log` with `LoggerService.log()`
   - Added structured logging context

### Indexer & Utilities
9. **`src/indexer.ts`**
   - Replaced `console.log` and `console.error` with `StructuredLogger`
   - Added structured logging for indexing operations

10. **`src/export-openapi.ts`**
    - Replaced `console.log` with `StructuredLogger`
    - Added structured logging for OpenAPI export

### Filters & Interceptors
11. **`src/common/throttler-exception.filter.ts`**
    - Replaced `console.log` with `LoggerService.debug()`
    - Added dependency injection for logger

12. **`src/audit/audit.interceptor.ts`**
    - Replaced `console.error` with `LoggerService.error()`
    - Added structured logging for audit failures

### Database Seeds
13. **`prisma/seed.ts`**
    - Replaced `console.log` and `console.error` with `StructuredLogger`
    - Added structured logging for seed operations

14. **`prisma/seed-staging.ts`**
    - Replaced `console.log` and `console.error` with `StructuredLogger`
    - Added structured logging for staging seed operations

## Acceptance Criteria Met

✅ **Every request generates a unique correlation ID (UUID)**
- Generated in `CorrelationIdMiddleware` or extracted from `X-Correlation-ID` header

✅ **Correlation ID is included in all log entries for that request**
- Automatically added by `LoggerService` via `AsyncLocalStorage`
- Propagated through async operations

✅ **Logs are structured JSON with required fields**
- `timestamp`: ISO 8601 format
- `level`: Log level (debug, info, warn, error)
- `correlationId`: UUID for request tracing
- `method`: HTTP method
- `path`: Request path
- `statusCode`: HTTP status code
- `duration`: Request duration in milliseconds

✅ **Correlation ID is returned in X-Correlation-ID response header**
- Set by `CorrelationIdMiddleware` on all responses

✅ **Log level is configurable via LOG_LEVEL environment variable**
- Configured in `main.ts`
- Respects standard log levels: debug, info, warn, error
- Defaults to 'info'

## Key Features

### Request Tracing
- Correlation IDs automatically propagate through entire request lifecycle
- Clients can provide custom correlation IDs via `X-Correlation-ID` header
- All logs for a request share the same correlation ID

### Structured Logging
- All logs are emitted as single-line JSON objects
- Includes timestamp, level, service name, and correlation ID
- Optional fields for user_id, contract_id, error details, and custom context

### Async Context Propagation
- Uses Node.js `AsyncLocalStorage` for context management
- Correlation ID maintained across async operations
- No manual context passing required

### CloudWatch Integration
- Optional CloudWatch integration (if `AWS_CLOUDWATCH_GROUP` set)
- Logs automatically sent to CloudWatch with retention policy
- JSON format compatible with CloudWatch Insights

### Backward Compatibility
- Existing code continues to work
- All `console.log` calls replaced with structured logging
- No breaking changes to API or service interfaces

## Testing

To verify the implementation:

1. **Start the application**:
   ```bash
   npm run start:dev
   ```

2. **Make a request**:
   ```bash
   curl -v http://localhost:3001/api/v1/health
   ```

3. **Check response headers**:
   - Look for `X-Correlation-ID` header in response

4. **Check logs**:
   - All logs should include `correlationId` field
   - Logs should be valid JSON

5. **Test with custom correlation ID**:
   ```bash
   curl -H "X-Correlation-ID: custom-id-123" \
        http://localhost:3001/api/v1/health
   ```

## Environment Configuration

Set these environment variables to control logging:

```bash
# Log level (debug, info, warn, error)
LOG_LEVEL=info

# CloudWatch integration (optional)
AWS_CLOUDWATCH_GROUP=carbonledger-backend
AWS_REGION=us-east-1
```

## Migration Notes

- No database migrations required
- No breaking changes to existing APIs
- All services automatically use structured logging
- Existing log consumers should parse JSON format

## Future Enhancements

- Add OpenTelemetry integration for distributed tracing
- Add request/response body logging with PII redaction
- Add performance metrics collection
- Add custom log formatters for different environments
- Add log sampling for high-volume endpoints
