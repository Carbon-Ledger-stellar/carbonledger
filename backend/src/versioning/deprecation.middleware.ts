import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  API_VERSIONING_CONFIG,
  API_VERSIONING_CONFIG_TOKEN,
  ApiVersionConfig,
} from './versioning.config';

/** Backward-compatible view of configured sunset dates for consumers of this module. */
export const API_DEPRECATION_DATES: Record<string, Date> = Object.fromEntries(
  Object.entries(API_VERSIONING_CONFIG)
    .filter(([, config]) => config.deprecated && config.sunset)
    .map(([version, config]) => [version, config.sunset as Date]),
);

/** Adds version and RFC 8594 deprecation headers to versioned API responses. */
@Injectable()
export class DeprecationMiddleware implements NestMiddleware {
  constructor(
    @Inject(API_VERSIONING_CONFIG_TOKEN)
    private readonly versionConfig: Record<string, ApiVersionConfig> = API_VERSIONING_CONFIG,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const version = this.extractVersion(req.path);
    if (!version) {
      next();
      return;
    }

    res.setHeader('X-API-Version', version);
    const config = this.versionConfig[`v${version}`];
    if (!config?.deprecated || !config.sunset) {
      next();
      return;
    }

    const sunset = config.sunset.toUTCString();
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', sunset);

    const links: string[] = [];
    if (config.successorVersion) {
      links.push(
        `<${this.buildSuccessorUrl(req, config.successorVersion)}>; rel="successor-version"`,
      );
    }
    if (config.migrationGuide) {
      links.push(`<${config.migrationGuide}>; rel="deprecation"`);
      res.setHeader('X-API-Migration-Guide', config.migrationGuide);
    }
    if (links.length > 0) res.setHeader('Link', links.join(', '));
    res.setHeader('X-API-Deprecated', 'true');
    res.setHeader('X-API-Sunset', sunset);
    res.setHeader('Warning', '299 - "Deprecated API version; please use the successor version"');
    next();
  }

  private extractVersion(path: string): string | undefined {
    return path.match(/^\/api\/v(\d+)(\/|$)/)?.[1];
  }

  private buildSuccessorUrl(req: Request, successorVersion: string): string {
    const successorPath = req.path.replace(/^\/api\/v\d+(?=\/|$)/, `/api/${successorVersion}`);
    return `${req.protocol}://${req.get('host')}${successorPath}`;
  }
}
