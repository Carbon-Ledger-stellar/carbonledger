# Distributed tracing

The backend uses OpenTelemetry with W3C trace context propagation. HTTP requests
are instrumented automatically, BullMQ jobs carry their parent trace context in
the job payload, and queue workers create consumer spans. Node HTTP instrumentation
also traces outbound HTTP calls made by the Soroban SDK and other clients.

## Local Jaeger

Start any OTLP-compatible collector or Jaeger all-in-one locally. For Jaeger
2.x, OTLP/HTTP is normally available on port 4318:

```powershell
docker run --name carbonledger-jaeger --rm -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest
```

Run the backend with tracing enabled (it is enabled by default):

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
$env:OTEL_SERVICE_NAME = 'carbonledger-backend'
npm run start:dev
```

Open `http://localhost:16686` to inspect traces. To use a collector or Zipkin
OTLP endpoint, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to its OTLP/HTTP traces
URL, for example `http://collector:4318/v1/traces`.

Set `OTEL_ENABLED=false` to disable exporting in development or tests.

## What is propagated

The producer injects the standard W3C `traceparent` and `tracestate` values into
the internal `__traceContext` job field. Workers extract that context before
starting their processing span. The field is internal metadata and is ignored
by business handlers.

Useful environment variables:

| Variable | Default |
| --- | --- |
| `OTEL_ENABLED` | `true` |
| `OTEL_SERVICE_NAME` | `carbonledger-backend` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |
## Pause feature traces (#1307)

`PauseService` (`src/admin/pause.service.ts`) wraps every emergency pause and
unpause in one trace, so the latency of each step is visible in Jaeger:

```
pause.pause_contract | pause.unpause_contract   root span
  ├─ pause.contract_call   Soroban pause_operations / unpause_operations
  ├─ pause.db_update       AdminConfig pause state + hash-chained AuditLog row
  └─ pause.event_emit      contract.paused / contract.unpaused webhook dispatch
```

Endpoints (admin role required):

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/admin/contracts/:contract/pause` | — |
| `POST` | `/admin/contracts/:contract/pause` | `{ "untilTimestamp": <unix seconds, ≤ 72h ahead> }` |
| `POST` | `/admin/contracts/:contract/unpause` | — |

`:contract` is `carbon_credit` or `carbon_marketplace`.

Span attributes:

| Attribute | Span | Meaning |
| --- | --- | --- |
| `carbonledger.pause.action` | root | `pause` or `unpause` |
| `carbonledger.contract.name` / `carbonledger.contract.id` | root | Target contract |
| `carbonledger.admin` | root | Admin public key that requested the change |
| `carbonledger.pause.until` | root | Pause expiry (unix seconds), pause only |
| `stellar.tx_hash` | root, contract_call | Transaction hash |
| `rpc.method`, `stellar.ledger`, `stellar.tx_status` | contract_call | Soroban invocation details |
| `carbonledger.event.type` | event_emit | Webhook event dispatched |

A failing step records the exception and sets `ERROR` status on both the step
and the root span; later steps are not run, so a missing `pause.db_update`
span means the contract call failed.

### Finding a pause trace

In Jaeger (`http://localhost:16686`), select service `carbonledger-backend`
and operation `pause.pause_contract` or `pause.unpause_contract`, or search
by tag `carbonledger.contract.name=carbon_credit`.

### Correlating with logs

The trace id is available in three places:

- the API response (`traceId`) and the `X-Trace-ID` response header,
- the structured `contract paused` / `contract unpaused` log line (`traceId` field),
- the `AuditLog` row for the action (`metadata.traceId`, action `contract.pause` / `contract.unpause`).

Paste any of these into Jaeger's trace-id search to open the trace. Going the
other way, filter logs by the trace id shown in Jaeger.

Pause operations are rare and high-impact. If `OTEL_TRACES_SAMPLER_ARG` is
below `1.0`, a pause request may not be sampled. Send the request with a sampled
`traceparent` header (flag `01`) to force a trace, because the root sampler is
parent-based.
