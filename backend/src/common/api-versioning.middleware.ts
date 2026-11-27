import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { API_VERSIONING_CONFIG } from '../versioning/versioning.config';

@Injectable()
export class ApiVersioningMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const versionFromPath = this.extractVersion(req.path);
    if (!versionFromPath) {
      next();
      return;
    }

    const rewrittenPath = this.rewritePath(req.path, versionFromPath);
    if (rewrittenPath) {
      req.url = rewrittenPath;
      req.originalUrl = rewrittenPath;
    }

    res.setHeader('X-API-Version', versionFromPath === 'v1' ? '1' : '2');
    const config = API_VERSIONING_CONFIG[versionFromPath];
    if (config?.deprecated && config.sunset) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', config.sunset.toUTCString());
      res.setHeader(
        'Link',
        `<https://docs.carbonledger.io/api/${config.successorVersion ?? 'v2'}>; rel="successor-version"`,
      );
      res.setHeader('Warning', '299 - "Deprecated API version; please use the successor version"');
    }

    next();
  }

  private extractVersion(path: string): 'v1' | 'v2' | null {
    const directMatch = path.match(/^\/((?:api\/)?v(\d+))(?:\/|$)/i);
    if (directMatch) {
      const version = directMatch[2] === '2' ? 'v2' : 'v1';
      return version;
    }

    return null;
  }

  private rewritePath(path: string, version: 'v1' | 'v2'): string {
    const versionedPrefix = version === 'v2' ? '/v2' : '/v1';
    const apiPrefix = '/api/v1';

    if (path === versionedPrefix || path === `${versionedPrefix}/`) {
      return '/';
    }

    if (path.startsWith(`${versionedPrefix}/`)) {
      return path.slice(versionedPrefix.length) || '/';
    }

    if (path.startsWith(`${apiPrefix}/`)) {
      return path.slice(apiPrefix.length) || '/';
    }

    return path;
  }
}
