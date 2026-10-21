# Emergency Pause Analytics

Tracks how the emergency pause on the `carbon_credit` and `carbon_marketplace`
contracts is used: how often contracts are paused, for how long, why, and by
whom (#1324).

## How data is collected

```
pause_operations / unpause_operations  (contract)
        │  emits (c_ledger, paused|unpaused)
        ▼
EventIndexerService  ──►  PauseEvent row  ◄──  POST /admin/pause-analytics/events
                              │                  (admin records the reason)
                              ├─► AnalyticsService: contract_paused / contract_unpaused
                              └─► structured log line ──► Loki ──► Grafana dashboard
```

| Source | Provides |
|---|---|
| On-chain event (via the indexer) | contract, admin, `until_timestamp`, ledger timestamp, event id |
| Admin API | reason |

The contract call takes no reason, so the admin records it separately against
the transaction hash. Rows are joined on `(txHash, action)`, so either side may
arrive first.

### Analytics events

Sent once per pause/unpause, the first time the backend sees it:

| Event | Properties |
|---|---|
| `contract_paused` | `contract`, `admin`, `reason`, `txHash`, `occurredAt`, `pausedUntil`, `requestedSeconds` |
| `contract_unpaused` | `contract`, `admin`, `reason`, `txHash`, `occurredAt`, `pauseDurationSeconds` |

`AnalyticsService` hashes the user id before it reaches Segment/Mixpanel.
`reason` is `unspecified` if the reason arrives after the indexer has already
seen the event. The summary, report, and export endpoints always show the
latest reason.

## Recording a reason

Right after submitting `pause_operations` or `unpause_operations`, record the reason:

```bash
curl -X POST "$API/admin/pause-analytics/events" \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{
        "contract": "marketplace",
        "action": "pause",
        "txHash": "<64-hex transaction hash>",
        "reason": "Suspected price manipulation on listing L-123",
        "pausedUntil": "2026-09-27T12:00:00Z"
      }'
```

`contract` is `credit` or `marketplace`, and `action` is `pause` or `unpause`.
`reason` must be 3–500 characters.

## Reports and exports

All endpoints require an admin JWT. `from` and `to` are ISO-8601 and default
to the last 30 days. `contract` is optional.

| Endpoint | Returns |
|---|---|
| `GET /admin/pause-analytics/summary` | JSON: totals, per-contract counts, pauses per day, duration stats, reasons, admins, and every pause period |
| `GET /admin/pause-analytics/report` | The same data as a Markdown report |
| `GET /admin/pause-analytics/export?format=csv\|json` | Raw events as a downloadable file (CSV by default) |

### How durations are computed

A pause period starts at a `pause` event and ends at the first of:

| Ending | When |
|---|---|
| `manual` | an `unpause` on the same contract |
| `expired` | the `until_timestamp` window elapsed (the contract auto-unpauses) |
| `renewed` | a new `pause` on the same contract replaced the window |
| `ongoing` | still paused when the report was generated |

Only events inside the query window are considered, so a pause that started
before `from` does not appear.

## Dashboard

`logging/grafana/dashboards/pause-analytics.json` is the "Emergency Pause
Analytics" Grafana dashboard. It queries the backend's JSON logs in Loki for
`message.event = "contract_pause"` / `"contract_pause_reason"` and shows:

- pause and unpause counts
- mean pause duration and mean requested window
- pause frequency by contract
- reasons, pauses by admin, and a log of every event

To load it, either import the file in Grafana (**Dashboards → New → Import**),
or mount `logging/grafana/dashboards` at `/etc/grafana/dashboards` so the
existing file provider (`logging/grafana/provisioning/dashboards/canary.yml`)
picks it up.

The dashboard shows only what reaches the logs. For exact numbers, including
pauses that expired on their own, use the summary/report endpoints.
