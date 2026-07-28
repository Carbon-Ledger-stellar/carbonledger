# Oracle Failure Runbook

## Overview
This runbook covers procedures for handling oracle failures, including DLQ drain and transaction recovery.

## Dead-Letter Queue (DLQ)

### What is the DLQ?
The DLQ stores transactions that failed after all retry attempts. Entries include:
- Transaction type (price_update, verification)
- Project ID
- Payload
- Attempt count
- Last error message
- Timestamp

### DLQ Location
# View entries with Python
python3 -c "
import redis
import json
r = redis.Redis(decode_responses=True)
entries = []
for i in range(10):
    entry = r.lindex('carbonledger:dlq:oracle', i)
    if entry:
        entries.append(json.loads(entry))
print(json.dumps(entries, indent=2))
"
# Run reprocessor once
python3 oracle/dlq_reprocessor.py --once

# Run with specific batch size
python3 oracle/dlq_reprocessor.py --once --batch-size 20

# Run with custom retry attempts
python3 oracle/dlq_reprocessor.py --once --max-retries 5
# Run reprocessor continuously
python3 oracle/dlq_reprocessor.py --interval 60

# In production, run as a cron job
# */5 * * * * /path/to/oracle/dlq_reprocessor.py --once
# Clear all entries (use with caution)
python3 oracle/dlq_reprocessor.py --clear

# Or via Redis
redis-cli DEL carbonledger:dlq:oracle
# Check oracle logs
tail -100 logs/oracle.log

# Check DLQ entries
python3 oracle/dlq_reprocessor.py --once --batch-size 1
# Check Soroban RPC
curl -X POST ${SOROBAN_RPC_URL} \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"getHealth","id":1}'

# Check Redis connectivity
redis-cli ping
# Run reprocessor
python3 oracle/dlq_reprocessor.py --once
# Check DLQ depth
redis-cli LLEN carbonledger:dlq:oracle

# Check metrics
curl http://localhost:8000/metrics | grep oracle_dlq
# Environment variables
DLQ_MAX_RETRIES=3                    # Maximum retry attempts
DLQ_RETRY_DELAYS=5,30,120            # Retry delay schedule
DLQ_BATCH_SIZE=10                    # DLQ drain batch size
