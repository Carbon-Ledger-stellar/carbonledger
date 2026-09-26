import { logger } from '../logger';

interface Metric {
    name: string;
    value: number;
    tags?: Record<string, string>;
    timestamp?: number;
}

class MetricsCollector {
    private metrics: Metric[] = [];
    private flushInterval: number = 10000; // 10 seconds
    private intervalId: NodeJS.Timeout | null = null;

    constructor() {
        if (process.env.NODE_ENV === 'production') {
            this.startPeriodicFlush();
        }
    }

    record(metric: Metric) {
        this.metrics.push({
            ...metric,
            timestamp: metric.timestamp || Date.now(),
        });

        // If we have too many metrics, flush immediately
        if (this.metrics.length > 100) {
            this.flush();
        }
    }

    recordError(message: string, tags?: Record<string, string>) {
        this.record({
            name: 'app.error',
            value: 1,
            tags: { error: message, ...tags },
        });
    }

    recordLatency(operation: string, duration: number, tags?: Record<string, string>) {
        this.record({
            name: 'app.latency',
            value: duration,
            tags: { operation, ...tags },
        });
    }

    recordSuccess(operation: string, tags?: Record<string, string>) {
        this.record({
            name: 'app.success',
            value: 1,
            tags: { operation, ...tags },
        });
    }

    recordFailure(operation: string, tags?: Record<string, string>) {
        this.record({
            name: 'app.failure',
            value: 1,
            tags: { operation, ...tags },
        });
    }

    recordThroughput(operation: string, count: number = 1, tags?: Record<string, string>) {
        this.record({
            name: 'app.throughput',
            value: count,
            tags: { operation, ...tags },
        });
    }

    private flush() {
        if (this.metrics.length === 0) return;

        const metrics = this.metrics;
        this.metrics = [];

        // Log metrics as structured logs for DataDog/ELK
        for (const metric of metrics) {
            logger.info('metric', {
                metric_name: metric.name,
                metric_value: metric.value,
                tags: metric.tags,
                timestamp: metric.timestamp,
            });
        }
    }

    private startPeriodicFlush() {
        this.intervalId = setInterval(() => {
            this.flush();
        }, this.flushInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.flush();
    }
}

export const metrics = new MetricsCollector();

// Helper for measuring function execution time
export const measure = async <T>(
    operation: string,
    fn: () => Promise<T>,
    tags?: Record<string, string>
): Promise<T> => {
    const start = Date.now();
    try {
        const result = await fn();
        const duration = Date.now() - start;
        metrics.recordLatency(operation, duration, tags);
        metrics.recordSuccess(operation, tags);
        return result;
    } catch (error) {
        const duration = Date.now() - start;
        metrics.recordLatency(operation, duration, tags);
        metrics.recordFailure(operation, tags);
        metrics.recordError(error.message, tags);
        throw error;
    }
};

export default metrics;
