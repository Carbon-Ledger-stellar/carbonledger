import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

// Initialize tracer provider
const provider = new NodeTracerProvider({
    resource: {
        attributes: {
            'service.name': 'carbonledger',
            'service.version': '1.0.0',
            'deployment.environment': process.env.NODE_ENV || 'development',
        },
    },
});

// Configure exporter
const exporter = new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
});

// Add span processor
provider.addSpanProcessor(new BatchSpanProcessor(exporter));

// Register instrumentations
registerInstrumentations({
    instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
    ],
});

// Set global tracer
provider.register();

export const tracer = provider.getTracer('carbonledger');

// Create custom spans
export const startSpan = (name: string, fn: (span: any) => any) => {
    const span = tracer.startSpan(name);
    return new Promise((resolve, reject) => {
        try {
            const result = fn(span);
            span.end();
            resolve(result);
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message });
            span.end();
            reject(error);
        }
    });
};

export default tracer;
