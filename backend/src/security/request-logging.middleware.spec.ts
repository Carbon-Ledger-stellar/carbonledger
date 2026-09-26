import { RequestLoggingMiddleware, RequestLog } from './request-logging.middleware';
import { Request, Response, NextFunction } from 'express';
import { CorrelationIdContext } from '../logger/correlation-id.context';

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    middleware = new RequestLoggingMiddleware();

    // Capture console output
    jest.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
      consoleOutput.push(data);
      return true as any;
    });

    mockReq = {
      method: 'GET',
      path: '/api/v1/projects',
      user: undefined,
    } as any;

    mockRes = {
      statusCode: 200,
      send: jest.fn((data) => mockRes),
    } as any;

    mockNext = jest.fn();
    consoleOutput = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log basic request info with timestamp, method, path, and status', () => {
    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    // Simulate response sending
    (mockRes.send as jest.Mock)(JSON.stringify({ data: 'test' }));

    expect(consoleOutput.length).toBeGreaterThan(0);
    const logOutput = JSON.parse(consoleOutput[0]);

    expect(logOutput).toHaveProperty('timestamp');
    expect(logOutput.method).toBe('GET');
    expect(logOutput.path).toBe('/api/v1/projects');
    expect(logOutput.statusCode).toBe(200);
    expect(logOutput).toHaveProperty('durationMs');
  });

  it('should include userId when user is authenticated', () => {
    mockReq.user = { id: 'user123', email: 'test@example.com' } as any;

    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    (mockRes.send as jest.Mock)({});

    const logOutput = JSON.parse(consoleOutput[0]);
    expect(logOutput.userId).toBe('user123');
  });

  it('should include correlationId and traceId when set in context', () => {
    jest.spyOn(CorrelationIdContext, 'getCorrelationId').mockReturnValue('corr-123');
    jest.spyOn(CorrelationIdContext, 'getTraceId').mockReturnValue('trace-456');

    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    (mockRes.send as jest.Mock)({});

    const logOutput = JSON.parse(consoleOutput[0]);
    expect(logOutput.correlationId).toBe('corr-123');
    expect(logOutput.traceId).toBe('trace-456');
  });

  it('should calculate duration in milliseconds', () => {
    const startTime = Date.now();
    middleware.use(mockReq as Request, mockRes as Response, mockNext);

    // Simulate some delay
    jest.useFakeTimers();
    jest.advanceTimersByTime(50);

    (mockRes.send as jest.Mock)({});

    const logOutput = JSON.parse(consoleOutput[0]);
    expect(logOutput.durationMs).toBeGreaterThanOrEqual(50);

    jest.useRealTimers();
  });

  it('should include error message for error responses', () => {
    mockRes.statusCode = 400;

    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    (mockRes.send as jest.Mock)({
      message: 'Bad Request',
      error: 'Invalid input',
    });

    const logOutput = JSON.parse(consoleOutput[0]);
    expect(logOutput.statusCode).toBe(400);
    expect(logOutput.errorMessage).toBe('Bad Request');
  });

  it('should format output as JSON with newline', () => {
    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    (mockRes.send as jest.Mock)({});

    expect(consoleOutput[0]).toMatch(/^\{.*\}\n$/);
    expect(() => JSON.parse(consoleOutput[0].trim())).not.toThrow();
  });

  it('should call next middleware', () => {
    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle POST requests with body', () => {
    mockReq.method = 'POST';
    mockReq.path = '/api/v1/projects';

    middleware.use(mockReq as Request, mockRes as Response, mockNext);
    (mockRes.send as jest.Mock)({ id: '123' });

    const logOutput = JSON.parse(consoleOutput[0]);
    expect(logOutput.method).toBe('POST');
    expect(logOutput.statusCode).toBe(200);
  });

  it('should handle various HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    methods.forEach((method) => {
      consoleOutput = [];
      mockReq.method = method;

      middleware.use(mockReq as Request, mockRes as Response, mockNext);
      (mockRes.send as jest.Mock)({});

      const logOutput = JSON.parse(consoleOutput[0]);
      expect(logOutput.method).toBe(method);
    });
  });
});
