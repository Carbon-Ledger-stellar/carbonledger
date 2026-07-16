# Observability — Structured Logging and Alerting

Comprehensive observability stack for CarbonLedger with structured logging, alerting, and monitoring dashboards.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Services                     │
│  Backend │ Oracle Services │ Frontend                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Structured JSON Logging                        │
│  - trace_id, timestamp, service, level, context            │
│  - Secrets automatically redacted                          │
└────────────────┬────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐   ┌──────────────┐
│   Promtail   │   │  CloudWatch  │
│  (Docker)    │   │  (AWS)       │
└──────┬───────┘   └──────┬───────┘
       │                  │
       └────────┬─────────┘
                ▼
        ┌──────────────┐
        │    Loki      │
        │ (Log Store)  │
        └──────┬───────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    ┌────────┐   ┌─────────┐
    │ Grafana│   │ Alerts  │
    │(Viz)   │   │(Webhook)│
    └────────┘   └─────────┘
```

## Structured Logging

### Log Format

All logs are JSON with consistent structure:

```json
{
  "level": "info",
  "timestamp": "2026-04-28T10:00:00.000Z",
  "service": "carbonledger-backend",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Project registered successfully",
  "context": {
    "project_id": "proj_123",
    "developer": "G...",
    "methodology": "VCS"
  }
}
```

### Log Levels

| Level | Usage | Example |
|-------|-------|---------|
| `debug` | Development details | Variable values, function entry/exit |
| `info` | Normal operations | Project registered, credit minted |
| `warn` | Potential issues | Deprecated API, slow query |
| `error` | Failures | Database error, contract call failed |

### Using Structured Logger

```typescript
import { StructuredLogger } from './logger/structured-logger';

const logger = new StructuredLogger('carbonledger-backend');

// Log with context
logger.info('Project registered', {
  project_id: 'proj_123',
  developer: 'G...',
  methodology: 'VCS'
});

// Log error with stack trace
try {
  await registerProject(data);
} catch (error) {
  logger.error('Failed to register project', error as Error, {
    project_id: 'proj_123'
  });
}
```

### Secret Redaction

Sensitive fields are automatically redacted:

```typescript
logger.info('User login', {
  username: 'alice@example.com',
  password: 'secret123',      // → [REDACTED]
  api_key: 'sk_live_...',     // → [REDACTED]
  private_key: 'S...'         // → [REDACTED]
});
```

## Alerting

### Alert Types

#### 1. Oracle Data Staleness (Warning)

**Trigger**: No oracle data update for 30 days (early warning before 365-day limit)

```json
{
  "severity": "warning",
  "title": "Oracle Data Staleness Warning",
  "message": "Oracle data has not been updated for 35 days. Early warning before 365-day limit.",
  "context": {
    "daysSinceUpdate": 35,
    "lastUpdateTime": "2026-03-24T10:00:00Z",
    "threshold": 30
  }
}
```

#### 2. Soroban Submission Failure Rate (Critical)

**Trigger**: Failure rate > 5% in 1 hour

```json
{
  "severity": "critical",
  "title": "Soroban Submission Failure Rate Exceeded",
  "message": "Soroban submission failure rate is 7.50% in the last 60 minutes, exceeding 5% threshold.",
  "context": {
    "failureCount": 3,
    "totalCount": 40,
    "failureRate": "7.50%",
    "timeWindowMinutes": 60,
    "threshold": "5%"
  }
}
```

#### 3. Authentication Anomaly (Warning)

**Trigger**: Unusual auth patterns detected

```json
{
  "severity": "warning",
  "title": "Authentication Anomaly Detected: Multiple Failed Logins",
  "message": "Unusual authentication activity detected. Review details for potential security issue.",
  "context": {
    "anomalyType": "Multiple Failed Logins",
    "userId": "user_123",
    "failedAttempts": 5,
    "timeWindow": "5 minutes",
    "ipAddress": "192.168.1.1"
  }
}
```

### Configuring Alerts

Set webhook URL in `.env`:

```bash
ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

Supported webhook formats:
- Slack
- Discord
- Microsoft Teams
- Custom HTTP endpoints

### Using Alerting Service

```typescript
import { AlertingService } from './logger/alerting.service';

constructor(private alerting: AlertingService) {}

// Check oracle staleness
await this.alerting.checkOracleDataStaleness(lastUpdateTime);

// Check Soroban failure rate
await this.alerting.checkSorobanSubmissionFailureRate(
  failureCount,
  totalCount,
  60 // time window in minutes
);

// Send custom alert
await this.alerting.sendAlert({
  severity: 'critical',
  title: 'Custom Alert',
  message: 'Something important happened',
  context: { details: 'here' }
});
```

## Monitoring Dashboard

### Metrics Endpoint

```bash
GET /api/v1/observability/metrics
```

Response:

```json
{
  "activeListings": 1250,
  "dailyRetirements": 45,
  "oracleStatus": {
    "lastUpdate": "2026-04-28T09:30:00Z",
    "isHealthy": true,
    "daysSinceUpdate": 0
  },
  "sorobanMetrics": {
    "successRate": 0.98,
    "failureCount": 2,
    "totalCount": 100
  }
}
```

### Grafana Dashboards

Access Grafana at `http://localhost:3200` (admin/admin)

#### Pre-built Dashboards

1. **System Health**
   - Service uptime
   - Database connections
   - Memory usage
   - CPU usage

2. **Application Metrics**
   - Active listings count
   - Daily retirements
   - Oracle status
   - Soroban success rate

3. **Error Tracking**
   - Error rate by service
   - Error types
   - Stack traces
   - Affected users

4. **Performance**
   - Request latency
   - Database query time
   - Contract call duration
   - API response times

### Creating Custom Dashboards

1. Visit Grafana: `http://localhost:3200`
2. Click "+" → "Dashboard"
3. Add panels with Loki queries:

```logql
{service="carbonledger-backend", level="error"}
{service="carbonledger-backend"} | json | trace_id="550e8400-e29b-41d4-a716-446655440000"
{service="carbonledger-backend"} | json | status="failed" | stats count() by level
```

## Tracking Metrics

### Track Soroban Submissions

```typescript
import { MonitoringService } from './logger/monitoring.service';

constructor(private monitoring: MonitoringService) {}

try {
  await submitToSoroban(data);
  await this.monitoring.trackSorobanSubmission(contractId, 'success');
} catch (error) {
  await this.monitoring.trackSorobanSubmission(
    contractId,
    'failed',
    error.message
  );
}
```

### Track Oracle Updates

```typescript
try {
  await updateOracleData(data);
  await this.monitoring.trackOracleUpdate('verification', true);
} catch (error) {
  await this.monitoring.trackOracleUpdate(
    'verification',
    false,
    error.message
  );
}
```

## Log Aggregation

### Loki Query Examples

```logql
# All errors in last hour
{service="carbonledger-backend", level="error"} | since=1h

# Errors by service
{level="error"} | json | stats count() by service

# Trace specific request
{trace_id="550e8400-e29b-41d4-a716-446655440000"}

# Performance analysis
{service="carbonledger-backend"} | json | stats avg(duration_ms) by endpoint

# Failed Soroban submissions
{service="carbonledger-backend"} | json | status="failed"
```

### Viewing Logs

**In Grafana:**
1. Click "Explore"
2. Select "Loki" datasource
3. Enter LogQL query
4. View results with trace_id links

**In Docker:**
```bash
docker-compose logs --follow backend
docker-compose logs --follow oracle_verification
```

## Performance Considerations

### Log Volume

- **Backend**: ~100-500 logs/minute in production
- **Oracle Services**: ~50-200 logs/minute
- **Retention**: 30 days in Loki (configurable)

### Storage

- **Loki**: ~5-10GB per month
- **Grafana**: ~1GB
- **PostgreSQL**: Monitoring tables grow ~1MB/day

### Optimization

```bash
# Reduce log level in production
LOG_LEVEL=warn

# Increase Loki retention
# Edit logging/loki/loki.yml: retention_period: 30d

# Archive old logs to S3
# Configure Loki S3 backend
```

## Troubleshooting

### Logs Not Appearing in Grafana

```bash
# Check Promtail is running
docker-compose logs promtail

# Verify Loki is healthy
curl http://localhost:3100/ready

# Check Docker socket permissions
ls -la /var/run/docker.sock
```

### High Memory Usage

```bash
# Reduce Loki cache
# Edit logging/loki/loki.yml: cache_config.enable_fifocache: false

# Reduce log retention
# Edit logging/loki/loki.yml: retention_period: 7d
```

### Alerts Not Sending

```bash
# Verify webhook URL
echo $ADMIN_ALERT_WEBHOOK

# Test webhook
curl -X POST $ADMIN_ALERT_WEBHOOK \
  -H "Content-Type: application/json" \
  -d '{"text":"Test alert"}'

# Check backend logs
docker-compose logs backend | grep -i alert
```

## Best Practices

1. **Always include trace_id** for request tracing
2. **Redact secrets** automatically (handled by StructuredLogger)
3. **Use appropriate log levels** (don't log everything as info)
4. **Include context** for debugging (user_id, project_id, etc.)
5. **Monitor alert fatigue** (adjust thresholds as needed)
6. **Archive logs** for compliance (30+ days retention)
7. **Test alerts** regularly to ensure they work

## References

- [Loki Documentation](https://grafana.com/docs/loki/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)
- [Winston Logger](https://github.com/winstonjs/winston)
- [Structured Logging Best Practices](https://www.kartar.net/2015/12/structured-logging/)
