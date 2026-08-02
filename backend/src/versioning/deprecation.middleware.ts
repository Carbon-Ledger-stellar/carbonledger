import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Deprecation dates for each API version.
 * RFC 8594 Sunset header format: HTTP-date (e.g. Sat, 01 Nov 2025 00:00:00 GMT).
 */
export const API_DEPRECATION_DATES: Record<string, Date> = {
  v1: new Date('2027-01-01T00:00:00.000Z'),
};

/**
 * DeprecationMiddleware
 *
 * Adds RFC 8594 deprecation headers to responses for deprecated API versions.
 *
 * Headers added for v1 routes:
 *   Deprecation: true
 *   Sunset: Thu, 01 Jan 2027 00:00:00 GMT
 *   Link: <https://api.carbonledger.io/api/v2>; rel="successor-version"
 *   X-API-Version: 1
 *   X-API-Deprecated: true
 *   X-API-Migration-Guide: https://api.carbonledger.io/docs/migration/v1-to-v2
 *
 * Headers added for v2 routes:
 *   X-API-Version: 2
 *
 * The middleware is path-aware: it inspects the URL prefix to determine which
 * version is being accessed.
 */
@Injectable()
export class DeprecationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DeprecationMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const version = this.extractVersion(req.path);

    if (!version) {
      return next();
    }

    // Always set the current API version header
    res.setHeader('X-API-Version', version);

    if (version === '1') {
      const sunsetDate = API_DEPRECATION_DATES.v1;
      const sunsetDateStr = sunsetDate.toUTCString();

      // RFC 8594 — Deprecation header (https://datatracker.ietf.org/doc/html/rfc8594)
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', sunsetDateStr);

      // Link header pointing to the v2 successor
      res.setHeader(
        'Link',
        [
          `<${this.buildV2Url(req)}>; rel="successor-version"`,
          `<https://api.carbonledger.io/docs/migration/v1-to-v2>; rel="deprecation"`,
        ].join(', '),
      );

      // Convenience headers for API consumers
      res.setHeader('X-API-Deprecated', 'true');
      res.setHeader('X-API-Sunset', sunsetDateStr);
      res.setHeader(
        'X-API-Migration-Guide',
        'https://api.carbonledger.io/docs/migration/v1-to-v2',
      );
    }

    next();
  }

  /**
   * Extracts the version number from the request path.
   * Returns '1' for /api/v1/..., '2' for /api/v2/..., undefined otherwise.
   */
  private extractVersion(path: string): string | undefined {
    const match = path.match(/^\/api\/v(\d+)(\/|$)/);
    return match?.[1];
  }

  /**
   * Builds the equivalent v2 URL for the current v1 request.
   */
  private buildV2Url(req: Request): string {
    const v2Path = req.path.replace(/^\/api\/v1\//, '/api/v2/');
    return `${req.protocol}://${req.get('host')}${v2Path}`;
  }
}
