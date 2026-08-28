# Oracle Sync - Quick Start

## 30-Second Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run database migration**
   ```bash
   npx prisma migrate dev --name add_oracle_sync_state
   ```

3. **Configure environment** (`.env`)
   ```env
   STELLAR_NETWORK=testnet
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   CARBON_ORACLE_CONTRACT_ID=your_contract_id
   ```

4. **Start backend**
   ```bash
   npm run start:dev
   ```

Done! Sync runs automatically every 6 hours.

## Test It

### Check Sync Status
```bash
curl http://localhost:3001/api/v1/oracle/sync/state
```

### Trigger Manual Sync
```bash
curl -X POST http://localhost:3001/api/v1/oracle/sync/trigger \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Check Health
```bash
curl http://localhost:3001/api/v1/oracle/sync/health
```

## What Happens

1. **Every 6 hours** → Scheduler runs sync
2. **Sync fetches** → New monitoring data from contract
3. **Sync upserts** → Records into database
4. **Logs results** → Number of records synced
5. **On error** → Logs error, sends alert, continues running

## Logs to Look For

```
[OracleSchedulerService] Starting scheduled oracle monitoring data sync
[OracleSyncService] Starting oracle monitoring data sync...
[OracleSyncService] Retrieved X records from contract
[OracleSyncService] Oracle sync completed: X records (Y new, Z updated) in Wms
```

## Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/oracle/sync/state` | Get current sync state |
| POST | `/oracle/sync/trigger` | Manually trigger sync |
| GET | `/oracle/sync/health` | Get scheduler health |
| POST | `/oracle/sync/reset` | Reset sync state |

## Configuration

### Change Sync Schedule

Edit `oracle-scheduler.service.ts`:

```typescript
@Cron('0 0 */6 * * *')  // Change this
async syncOracleData() { ... }
```

Common schedules:
- `0 0 * * * *` - Every hour
- `0 */6 * * * *` - Every 6 hours (default)
- `0 0 * * * *` - Every day at midnight

## Troubleshooting

### Sync Not Running?
1. Check logs: `npm run start:dev`
2. Verify scheduler is enabled in module
3. Check cron expression

### Sync Failing?
1. Check `lastError` in sync state
2. Verify contract is deployed
3. Check database connection
4. Check Stellar RPC connectivity

### No Records Synced?
1. Check if contract has monitoring data
2. Verify contract ID is correct
3. Check if data is newer than last sync

## Database

### Check Sync State
```sql
SELECT * FROM "OracleSyncState" ORDER BY "updatedAt" DESC LIMIT 1;
```

### Check Monitoring Data
```sql
SELECT * FROM "MonitoringData" ORDER BY "submittedAt" DESC LIMIT 10;
```

### Check for Errors
```sql
SELECT * FROM "OracleSyncState" WHERE "lastError" IS NOT NULL;
```

## Files

- **Services**: `src/oracle/oracle-*.ts`
- **Documentation**: `ORACLE_SYNC.md`
- **Database**: `prisma/schema.prisma`

## Next Steps

1. Read `ORACLE_SYNC.md` for detailed docs
2. Configure contract ID in `.env`
3. Test with manual sync
4. Monitor logs for scheduled runs
5. Set up alerting (optional)

## Support

- Full docs: `ORACLE_SYNC.md`
- Check logs: `npm run start:dev`
- Monitor sync: `GET /oracle/sync/health`
- Database: `npx prisma studio`
