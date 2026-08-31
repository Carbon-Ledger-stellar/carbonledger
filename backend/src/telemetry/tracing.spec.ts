import {
  initializeTracing,
  shutdownTracing,
  getTraceId,
  enqueueWithTrace,
  processWithTrace,
  FilteredRatioSampler,
  TRACE_CONTEXT_FIELD,
} from './tracing';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';

describe('Tracing Telemetry Module', () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  describe('FilteredRatioSampler', () => {
    it('should drop spans for health and metrics endpoints (SamplingDecision.NOT_RECORD)', () => {
      const sampler = new FilteredRatioSampler(1.0);
      const healthResult = sampler.shouldSample(
        {},
        '12345678901234567890123456789012',
        'GET /health',
        1,
        { 'http.target': '/health' },
        [],
      );
      expect(healthResult.decision).toBe(SamplingDecision.NOT_RECORD);

      const readyResult = sampler.shouldSample(
        {},
        '12345678901234567890123456789012',
        'GET /health/ready',
        1,
        { 'http.target': '/health/ready' },
        [],
      );
      expect(readyResult.decision).toBe(SamplingDecision.NOT_RECORD);

      const metricsResult = sampler.shouldSample(
        {},
        '12345678901234567890123456789012',
        'GET /metrics',
        1,
        { 'http.target': '/metrics' },
        [],
      );
      expect(metricsResult.decision).toBe(SamplingDecision.NOT_RECORD);
    });

    it('should sample standard API requests when ratio is 1.0', () => {
      const sampler = new FilteredRatioSampler(1.0);
      const apiResult = sampler.shouldSample(
        {},
        '12345678901234567890123456789012',
        'GET /api/v1/credits',
        1,
        { 'http.target': '/api/v1/credits' },
        [],
      );
      expect(apiResult.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    });
  });

  describe('Tracing Lifecycle & Trace ID', () => {
    it('should initialize and shutdown tracing without error', async () => {
      expect(() => initializeTracing()).not.toThrow();
      await expect(shutdownTracing()).resolves.not.toThrow();
    });

    it('should return traceId string from getTraceId()', () => {
      const traceId = getTraceId();
      expect(typeof traceId).toBe('string');
    });
  });

  describe('Queue Trace Context Propagation', () => {
    it('should inject trace context into job data when enqueuing', async () => {
      initializeTracing();
      const mockAdd = jest.fn().mockImplementation(async (data) => data);

      const result = await enqueueWithTrace('testQueue', 'testJob', { key: 'value' }, mockAdd);

      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty(TRACE_CONTEXT_FIELD);
      expect(result[TRACE_CONTEXT_FIELD]).toBeDefined();
    });

    it('should extract trace context and execute job handler when processing', async () => {
      initializeTracing();
      const mockProcess = jest.fn().mockResolvedValue('processed_result');
      const jobData = {
        key: 'value',
        [TRACE_CONTEXT_FIELD]: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      };

      const result = await processWithTrace('testQueue', 'testJob', jobData, mockProcess);

      expect(mockProcess).toHaveBeenCalledTimes(1);
      expect(result).toBe('processed_result');
    });
  });
});
