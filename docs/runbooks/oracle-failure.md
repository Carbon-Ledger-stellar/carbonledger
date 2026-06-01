# Runbook: Oracle Failure

**Severity:** High  
**Contacts:** See [contacts.md](contacts.md) → Oracle  
**Escalation:** See [escalation.md](escalation.md)

---

## Detection

The oracle is considered failed when **any** of the following are true:

- `GET /api/v1/health` returns non-200 for > 5 minutes
- `carbon_oracle.is_monitoring_current()` returns `false` for an active project (no data in 365 days — but alert at 30 days)
- Price feed last updated > 24 hours ago (TTL breach — see `docs/ttl-cost.md`)
- Oracle process logs show repeated `ConnectionError` or `AuthenticationError`
- Monitoring alert fires on `oracle_last_update_age_hours > 24`

**Automated alert sources:** uptime monitor on oracle host, Stellar Horizon event stream, price-feed staleness cron.

---

## Containment

1. **Identify which oracle component failed** (verification listener, price oracle, or satellite monitor):
   ```bash
   # Check process status on oracle host
   systemctl status verification_listener price_oracle satellite_monitor
   # Or in Docker
   docker ps --filter name=oracle
   docker logs carbonledger-oracle --tail 100
   ```

2. **Freeze new credit issuance** if monitoring data is stale and new mint requests are pending:
   - Call `carbon_registry.suspend_project(<project_id>)` for affected projects via admin keypair.
   - This prevents minting credits against unverified monitoring data.

3. **Do not push stale or fabricated monitoring data** to the contract. A gap is safer than bad data.

4. **Notify stakeholders** (see [contacts.md](contacts.md)) that price feeds and/or monitoring submissions are delayed.

---

## Recovery

### Price oracle down

1. Restart the price oracle process:
   ```bash
   python3 oracle/price_oracle.py
   # or
   docker restart carbonledger-price-oracle
   ```
2. Verify it fetches and submits a price update within one cycle (12 hours max).
3. Confirm `carbon_oracle.get_benchmark_price()` returns a fresh value on-chain.

### Verification listener down

1. Check Stellar RPC connectivity:
   ```bash
   curl https://soroban-testnet.stellar.org/health
   ```
2. Rotate `ORACLE_SECRET_KEY` if authentication errors are the cause (follow [key-compromise.md](key-compromise.md) if key is suspected stolen).
3. Restart listener; confirm it processes any backlogged verification events.

### Satellite monitor down (webhook receiver)

1. Check that the webhook endpoint is reachable from Google Earth Engine / Planet Labs.
2. Replay missed webhook payloads from the satellite provider's dashboard if available.
3. If replay is not possible, manually submit monitoring data via `carbon_oracle.submit_monitoring_data()` using verified off-chain records.

### Unsuspend projects

Once oracle is confirmed healthy:
```bash
stellar contract invoke --id $CARBON_REGISTRY_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY --network testnet \
  -- update_project_status --project_id <id> --status Active
```

---

## Post-mortem

- Document root cause, timeline, and affected projects in the incident channel.
- File a GitHub issue if a code or config change is needed.
- Review alert thresholds — did we detect this fast enough?
