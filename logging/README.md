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