# Pause Feature Operational Runbook (#1313)

## Emergency Pause Procedure
1. Notify on-call incident commander in `#incident-response`.
2. Authenticate using authorized admin hardware security key or multi-sig wallet.
3. Invoke `/admin/pause` specifying target contract (`carbon_credit` or `carbon_marketplace`) and max duration (max 72 hours).
4. Verify pause state via `GET /health/pause`.
5. Monitor public announcements and incoming webhook dispatches.

## Unpause Procedure
1. Confirm vulnerability mitigation or security resolution.
2. Invoke `/admin/unpause` with admin authorization.
3. Validate orderbook matching, credit transfers, and health status recovery.
