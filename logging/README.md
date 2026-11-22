# CarbonLedger Log Aggregation System

This directory contains the configuration for the CarbonLedger log aggregation system using Loki + Grafana stack.

## Overview

The log aggregation system provides:
- **Centralized log storage** with Loki
- **Log collection** from Docker containers via Promtail
- **Visualization and alerting** through Grafana
- **30-day retention policy** as required
- **Searchable logs** by service, level, correlation ID, and time range
- **Automated alerting** for ERROR level logs exceeding 10 per minute

## Architecture

```
Docker Containers → Promtail → Loki → Grafana
                                ↓
                           Alert Manager
```

## Components

### Loki (`loki/`)
- **Purpose**: Log storage and indexing
- **Configuration**: `loki.yml` (production), `loki-staging.yml` (staging)
- **Features**:
  - 30-day retention policy (720 hours)
  - Filesystem storage with automatic compaction
  - Enhanced query performance settings
  - Support for correlation ID indexing

### Promtail (`promtail/`)
- **Purpose**: Log collection from Docker containers
- **Configuration**: `promtail.yml`
- **Features**:
  - Automatic service discovery via Docker socket
  - JSON log parsing with structured field extraction
  - Correlation ID extraction from log messages
  - Rate limiting to prevent log flooding
  - Support for multiple log formats

### Grafana (`grafana/`)
- **Purpose**: Log visualization, dashboards, and alerting
- **Configuration**: `provisioning/` directory
- **Features**:
  - Pre-configured Loki datasource
  - Automated alert rules for error monitoring
  - Staging-specific dashboards
  - Built-in authentication and user management

## Grafana Dashboards

Dashboards are provisioned automatically from
`logging/grafana/provisioning/dashboards/dashboards.yml`. The provisioning
config loads every JSON dashboard from the configured path and places each
one in the folder named in the file. The following dashboards are shipped:

### CarbonLedger (folder: `CarbonLedger`)

The primary operational dashboard for the production log stack. Use it as the
first stop when investigating an incident.

| Panel | What it shows | How to interpret |
|-------|---------------|------------------|
| **Log Volume by Service** | `sum by (service) (rate({service=~".+"}[5m]))` — log lines/sec per service | A sudden spike usually means a crash loop or a retry storm. A drop to zero for a service that should be active means Promtail lost the container or the service is down. |
| **Error Rate** | `sum(count_over_time({service=~".+"} \| json \| level="error" [1m]))` — ERROR lines per minute | This is the metric behind the *High Error Rate* alert (>10/min). Sustained values above the threshold page on-call. |
| **Log Level Distribution** | Stacked breakdown of `level` across all services | A shift toward `error`/`warn` indicates degradation even if total volume is flat. |
| **Recent Errors** | Live log panel filtered to `level="error"` | Read the `message` and `correlation_id` fields to identify the failing request path. |
| **Correlation ID Search** | Log panel filtered by a `correlation_id` template variable | Paste a correlation ID from an API response or client report to trace a single request across services. |
| **Ingestion Rate** | Total `sum(rate({service=~".+"}[5m]))` | Compare against Loki's `ingestion_rate_mb` limit; sustained saturation causes dropped logs. |

### CarbonLedger/Pause (folder: `CarbonLedger/Pause`)

Focused dashboard for the Pause service. Use it when Pause-specific behaviour
is suspected (e.g. paused-project state transitions).

| Panel | What it shows | How to interpret |
|-------|---------------|------------------|
| **Pause Service Logs** | `{service="pause"}` log stream | Raw stream for ad-hoc inspection; filter by `level` as needed. |
| **Pause Error Rate** | ERROR lines/min for `service="pause"` | Rising errors here correlate with failed pause/resume operations. |
| **Pause Request Latency** | `duration_ms` from parsed JSON logs | High latency on pause endpoints often precedes timeouts in the backend. |
| **Pause Event Timeline** | Count of pause/resume events over time | Gaps or bursts indicate upstream scheduling issues. |

### CarbonLedger/Staging (folder: `CarbonLedger/Staging`)

Mirror of the production dashboard pointed at the staging environment. Use it
to validate logging and alerting changes before promoting them.

| Panel | What it shows | How to interpret |
|-------|---------------|------------------|
| **Staging Log Volume** | Per-service ingestion rate in staging | Confirms Promtail is shipping logs after a staging deploy. |
| **Staging Errors** | ERROR lines/min in staging | Should be near zero on a healthy deploy; use to catch regressions pre-production. |
| **Staging Alert Status** | Firing/pending state of staging alert rules | Verify new alert rules trigger as expected during testing. |

> **Tip:** All dashboards use the provisioned Loki datasource. If a panel is
> empty, first confirm the datasource is healthy (see *Health Checks* below)
> and that the selected time range contains data.

## Alert Reference

The following table lists every alert defined in `deploy/monitoring/alerts.yaml`
and `monitoring/prometheus/alerts.yml`. Runbook links point to the shared
runbook index (`docs/runbooks/README.md`) or the alert's `runbook_url`
annotation where one is defined.

| Alert | Severity | Condition | Runbook |
|-------|----------|-----------|---------|
| HighErrorRate | critical | >10 ERROR logs/min across all services (Loki) | [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| ServiceSpecificErrors | warning | >5 errors in 5 minutes for `backend` | [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| OracleServiceHealth | warning | >3 error/critical logs in 10 minutes for oracle services | [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| DatabaseConnectionIssues | critical | >2 database connection errors in 5 minutes | [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| ServiceDown | critical | `up == 0` for any scrape target for 2 minutes | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| HighCPUUsage | warning | CPU utilisation > 80% for 10 minutes | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| HighMemoryUsage | warning | Memory utilisation > 85% for 10 minutes | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| DiskSpaceLow | critical | Free disk space < 10% on any node | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| HighRequestLatency | warning | p95 request latency > 2s for 5 minutes | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |
| HighErrorRateHTTP | critical | 5xx response rate > 5% for 5 minutes | `runbook_url` annotation / [docs/runbooks/README.md](../../docs/runbooks/README.md) |

> **Note:** When an alert fires, open the linked runbook first. If an alert
> includes a `runbook_url` annotation, Grafana/Prometheus surfaces it directly
> in the alert detail view — prefer that link over the generic index.

## Quick Start

### 1. Start the Log Aggregation Stack

```bash
# Production environment
docker compose up -d loki promtail grafana

# Staging environment
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

### 2. Access Grafana

- **URL**: http://localhost:3200 (or https://grafana.carbonledger.com)
- **Username**: admin
- **Password**: Set via `GRAFANA_PASSWORD` environment variable

### 3. Query Logs

Navigate to Grafana → Explore → Select Loki datasource

**Example Queries**:

```logql
# All logs from backend service
{service="backend"}

# Error logs from all services
{service=~".+"} | json | level="error"

# Logs with specific correlation ID
{service=~".+"} | json | correlation_id="req_abc123"

# Database errors across all services
{service=~".+"} | json | message=~".*database.*error.*"

# High-latency requests (>5 seconds)
{service="backend"} | json | duration_ms > 5000
```

## Log Format Requirements

Services should emit structured JSON logs to stdout:

```json
{
  "timestamp": "2024-05-29T10:30:00.123Z",
  "level": "error",
  "service": "backend",
  "message": "Database connection failed",
  "correlationId": "req_abc123",
  "userId": "user_456",
  "context": {
    "method": "POST",
    "endpoint": "/api/v1/projects",
    "duration_ms": 1250,
    "error_code": "DB_CONNECTION_TIMEOUT"
  }
}
```

### Required Fields
- `timestamp`: ISO 8601 timestamp
- `level`: Log level (error, warn, info, debug)
- `service`: Service name
- `message`: Human-readable log message

### Optional Fields
- `correlationId`: Request correlation ID for tracing
- `userId`: User ID for user-specific filtering
- `context`: Additional structured data

## Alerting Rules

### Configured Alerts

1. **High Error Rate** (`enhanced-error-alerts.yml`):
   - **Trigger**: >10 error logs per minute across all services
   - **Severity**: Critical
   - **Action**: Immediate notification

2. **Service-Specific Errors**:
   - **Trigger**: >5 errors in 5 minutes for backend service
   - **Severity**: Warning
   - **Action**: Team notification

3. **Oracle Service Health**:
   - **Trigger**: >3 errors/critical logs in 10 minutes for oracle services
   - **Severity**: Warning
   - **Action**: DevOps notification

4. **Database Connection Issues**:
   - **Trigger**: >2 database connection errors in 5 minutes
   - **Severity**: Critical
   - **Action**: Immediate escalation

### Alert Destinations

Configure alert destinations in Grafana:
- Slack/Discord webhooks
- Email notifications
- PagerDuty (production)
- SMS (critical alerts)

## Retention Policy

- **Production**: 30 days (720 hours)
- **Staging**: 30 days (720 hours)
- **Development**: 7 days (168 hours)

Logs are automatically deleted after the retention period via Loki's compactor.

## Monitoring and Maintenance

### Health Checks

```bash
# Check Loki status
curl http://localhost:3100/ready

# Check Promtail status
curl http://localhost:9080/ready

# Check Grafana status
curl http://localhost:3200/api/health
```

### Log Volume Monitoring

Monitor log ingestion rates and storage usage:

```logql
# Log ingestion rate by service
sum by (service) (rate({service=~".+"}[5m]))

# Total log volume
sum(rate({service=~".+"}[5m]))
```

### Performance Tuning

**Loki Configuration**:
- Adjust `max_query_parallelism` for query performance
- Tune `ingestion_rate_mb` for high-volume services
- Configure `compaction_interval` for storage efficiency

**Promtail Configuration**:
- Set appropriate `rate` and `burst` limits
- Configure `batch_size` for network efficiency
- Adjust `positions` file location for persistence

## Troubleshooting

### Common Issues

1. **Logs Not Appearing**:
   ```bash
   # Check Promtail logs
   docker compose logs promtail
   
   # Verify Docker socket access
   docker compose exec promtail ls -la /var/run/docker.sock
   
   # Test Loki ingestion
   curl -X POST "http://localhost:3100/loki/api/v1/push" \
     -H "Content-Type: application/json" \
     -d '{"streams":[{"stream":{"service":"test"},"values":[["'$(date +%s%N)'","test message"]]}]}'
   ```

2. **High Memory Usage**:
   - Reduce log retention period
   - Increase compaction frequency
   - Add log filtering rules in Promtail

3. **Query Performance Issues**:
   - Use more specific label filters
   - Reduce query time ranges
   - Add indexes for frequently queried labels

4. **Alert Not Firing**:
   ```bash
   # Check alert rule syntax
   curl http://localhost:3100/loki/api/v1/rules
   
   # Verify query returns data
   curl -G "http://localhost:3100/loki/api/v1/query" \
     --data-urlencode 'query={service="backend"} | json | level="error"'
   ```

### Log Analysis Tips

1. **Use Correlation IDs**: Track requests across services
2. **Filter by Time Range**: Narrow down to specific incidents
3. **Combine Multiple Labels**: Use service + level + correlation_id
4. **Use Regex Patterns**: Search message content with `=~` operator
5. **Aggregate Data**: Use `count_over_time()` for metrics

## Security Considerations

1. **Access Control**: Configure Grafana authentication
2. **Network Security**: Use HTTPS for external access
3. **Log Sanitization**: Avoid logging sensitive data (passwords, tokens)
4. **Retention Compliance**: Ensure retention meets regulatory requirements
5. **Audit Logging**: Log access to the logging system itself

## Integration with CI/CD

The log aggregation system is automatically deployed with the application:

1. **Staging Deployment**: Includes enhanced logging configuration
2. **Production Deployment**: Uses production-optimized settings
3. **Health Checks**: Verify logging system during deployment
4. **Rollback Support**: Maintain logging during application rollbacks

## Support

For issues with the log aggregation system:

1. **Check Health Endpoints**: Verify all components are running
2. **Review Configuration**: Ensure environment variables are set
3. **Monitor Resource Usage**: Check CPU/memory/disk usage
4. **Contact DevOps Team**: devops@carbonledger.com

---

*Last Updated: May 29, 2026*
*Version: 2.0.0*