# Infrastructure Runbook: Redis High Availability

This document outlines the Redis High Availability (HA) configuration using AWS ElastiCache Replication Groups (Production/Staging) and Redis Sentinel (Local Development).

## Architecture Overview

### AWS ElastiCache (Production/Staging)
The infrastructure uses `aws_elasticache_replication_group` to provide a Multi-AZ Redis setup.
- **Nodes**: 1 Primary and 1 Replica.
- **Automatic Failover**: Enabled. If the primary node fails, AWS automatically promotes the replica and updates the Primary Endpoint DNS.
- **Multi-AZ**: Enabled across subnets for fault tolerance.

### Local Development (Docker Compose)
A Sentinel-based setup simulates production HA.
- **redis-primary**: The master node.
- **redis-replica**: A replica following the primary.
- **redis-sentinel**: Monitors the primary and manages failover.

## Failover Testing

### Local Failover Test
1. Start the services:
   ```bash
   docker-compose up -d
   ```
2. Verify initial state:
   ```bash
   docker-compose exec redis-sentinel redis-cli -p 26379 sentinel get-master-addr-by-name mymaster
   ```
   Should return the IP of `redis-primary`.
3. Simulate primary failure:
   ```bash
   docker stop carbonledger-redis-primary-1
   ```
4. Monitor Sentinel logs:
   ```bash
   docker-compose logs -f redis-sentinel
   ```
   Look for `+switch-master` logs indicating promotion of the replica.
5. Verify new primary:
   ```bash
   docker-compose exec redis-sentinel redis-cli -p 26379 sentinel get-master-addr-by-name mymaster
   ```
   Should now return the IP of `redis-replica`.
6. Verify backend connectivity:
   The backend should reconnect automatically via the Sentinel endpoint.

### AWS Failover Test
1. Navigate to the ElastiCache console.
2. Select the replication group.
3. Use the **Failover Primary** action.
4. Monitor the application logs for reconnection (should happen within 30-60 seconds as DNS updates).

## Data Integrity
- **Persistence**: BullMQ jobs are stored in Redis. The HA setup ensures that even if a node fails, the data is replicated to the standby node.
- **Loss Prevention**: `ioredis` with Sentinel/Replication Group support handles reconnections without dropping pending operations when possible.

## Troubleshooting
- **Sentinel Quorum**: Ensure at least 1 Sentinel is reachable for failover.
- **Connection Errors**: Check if `REDIS_SENTINELS` environment variable is correctly formatted (`host1:port1,host2:port2`).
- **AWS Primary Endpoint**: Always use the Primary Endpoint in the connection string, not individual node addresses.
