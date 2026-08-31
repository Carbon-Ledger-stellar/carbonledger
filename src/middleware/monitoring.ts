import { Request, Response, NextFunction } from 'express';
import { logger, logRequest } from '../logger';
import { metrics, measure } from '../metrics';
import { startSpan } from '../logger/tracer';

export const monitoringMiddleware = {
    // Request logging
    log: logRequest,

    // Metrics collection
    metrics: (req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        const operation = `${req.method} ${req.path}`;

        res.on('finish' as any, () => {
            const duration = Date.now() - start;
            const tags = {
                method: req.method,
                path: req.path,
                status: res.statusCode.toString(),
            };

            metrics.recordLatency(operation, duration, tags);

            if (res.statusCode >= 400) {
                metrics.recordError(`HTTP ${res.statusCode}`, tags);
            } else {
                metrics.recordSuccess(operation, tags);
            }
        });

        next();
    },

    // Tracing
    trace: (req: Request, res: Response, next: NextFunction) => {
        const operation = `${req.method} ${req.path}`;
        startSpan(operation, (span) => {
            span.setAttribute('http.method', req.method);
            span.setAttribute('http.url', req.url);
            span.setAttribute('http.user_agent', req.headers['user-agent']);

            res.on('finish' as any, () => {
                span.setAttribute('http.status_code', res.statusCode);
                span.end();
            });

            next();
        });
    },

    // Error tracking
    error: (err: Error, req: Request, res: Response, next: NextFunction) => {
        logger.error('Error occurred', {
            error: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method,
            ip: req.ip,
        });

        metrics.recordError(err.message, {
            path: req.path,
            method: req.method,
        });

        next(err);
    },
};

export default monitoringMiddleware;
