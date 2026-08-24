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