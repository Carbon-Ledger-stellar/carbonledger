import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

winston.addColors(colors);

// Format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`,
    ),
);

// Format for file output (JSON)
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
);

// Create transports
const transports: winston.transport[] = [
    // Console transport
    new winston.transports.Console({
        format: consoleFormat,
    }),
];

// Add file transports if in production
if (process.env.NODE_ENV === 'production') {
    // Error log rotation
    transports.push(
        new DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            format: fileFormat,
            maxFiles: '30d',
            maxSize: '20m',
        })
    );

    // Combined log rotation
    transports.push(
        new DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            format: fileFormat,
            maxFiles: '30d',
            maxSize: '20m',
        })
    );
}

// Create logger instance
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.metadata(),
    ),
    transports,
    exitOnError: false,
});

// Create a stream for Morgan HTTP logging
export const stream = {
    write: (message: string) => {
        logger.http(message.trim());
    },
};

// Helper to create child loggers
export const createChildLogger = (service: string) => {
    return logger.child({ service });
};

// Helper for request logging
export const logRequest = (req: any, res: any, next: any) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
        logger.http(message, {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });
    });
    next();
};

export default logger;
