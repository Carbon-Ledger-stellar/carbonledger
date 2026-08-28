import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-api-key'];
    if (!key) throw new UnauthorizedException('API key required');

    const record = await this.prisma.apiKey.findUnique({ where: { key } });
    if (!record || !record.isActive) throw new UnauthorizedException('Invalid or inactive API key');

    // Attach key record to request for downstream use (e.g. rate limit tracking)
    request.apiKey = record;
    return true;
  }
}
