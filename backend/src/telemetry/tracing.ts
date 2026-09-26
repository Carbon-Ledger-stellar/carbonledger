import {
  context as otelContext,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  Sampler,
  SamplingDecision,
  SamplingResult,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

export const TRACE_CONTEXT_FIELD = '__traceContext';

type TraceCarrier = Record<string, string>;
type JobData = Record<string, unknown>;

export class FilteredRatioSampler implements Sampler {
  private readonly ratioSampler: TraceIdRatioBasedSampler;
  private readonly ignoredPaths = ['/health', '/health/ready', '/metrics'];

  constructor(ratio: number) {
    this.ratioSampler = new TraceIdRatioBasedSampler(ratio);
  }

  shouldSample(
    context: unknown,
    traceId: string,
    spanName: string,
    spanKind: any,
    attributes: Record<string, any>,
    links: any,
  ): SamplingResult {
    const target = attributes?.['http.target'] || attributes?.['http.path'] || attributes?.['url.path'] || spanName;
    if (typeof target === 'string' && this.ignoredPaths.some((path) => target.includes(path))) {
      return { decision: SamplingDecision.NOT_RECORD };
    }
    return this.ratioSampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return 'FilteredRatioSampler';
  }
}

let sdk: NodeSDK | undefined;

export function initializeTracing(): void {
  if (process.env.OTEL_ENABLED === 'false') return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_JAEGER_ENDPOINT ??
    `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`;

  const traceExporter = new OTLPTraceExporter({ url: endpoint });

  const sampleRatio = parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG ?? '1.0');
  const sampler = new ParentBasedSampler({
    root: new FilteredRatioSampler(sampleRatio),
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'carbonledger-backend',
    }),
    traceExporter,
    sampler,
    instrumentations: [
      getNodeAutoInstrumentations(),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}

export function getTraceId(): string {
  const activeSpan = trace.getActiveSpan();
  return activeSpan?.spanContext().traceId ?? '';
}

export function enqueueWithTrace<T>(
  queueName: string,
  jobName: string,
  data: JobData,
  add: (data: JobData) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('carbonledger.queue');
  return tracer.startActiveSpan(`bullmq enqueue ${queueName}/${jobName}`, async (span) => {
    span.setAttributes({ 'messaging.system': 'bullmq', 'messaging.destination.name': queueName });
    const carrier: TraceCarrier = {};
    propagation.inject(otelContext.active(), carrier);

    try {
      return await add({ ...data, [TRACE_CONTEXT_FIELD]: carrier });
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function processWithTrace<T>(
  queueName: string,
  jobName: string,
  data: JobData,
  process: () => Promise<T>,
): Promise<T> {
  const carrier = data[TRACE_CONTEXT_FIELD] as TraceCarrier | undefined;
  const parentContext = propagation.extract(otelContext.active(), carrier ?? {});
  const tracer = trace.getTracer('carbonledger.queue');

  return otelContext.with(parentContext, () =>
    tracer.startActiveSpan(`bullmq process ${queueName}/${jobName}`, async (span) => {
      span.setAttributes({ 'messaging.system': 'bullmq', 'messaging.destination.name': queueName });
      try {
        return await process();
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}

function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

