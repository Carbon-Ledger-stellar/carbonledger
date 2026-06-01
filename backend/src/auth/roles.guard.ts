import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY, ROLES_KEY, UserRole } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Public routes — skip all checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 2. Extract and verify JWT
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new ForbiddenException('Authentication required');

    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(token, {
        secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      });
    } catch {
      throw new ForbiddenException('Invalid or expired token');
    }

    if (payload.type !== 'access') {
      throw new ForbiddenException('Invalid token type');
    }

    // 3. Fetch role from DB — JWT payload alone is not trusted for role
    const user = await this.prisma.user.findUnique({ where: { publicKey: payload.sub } });
    if (!user) throw new ForbiddenException('User not found');

    // Attach DB-sourced user to request for downstream use
    request.user = { publicKey: user.publicKey, role: user.role };

    // 4. Check required roles (if any declared)
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!requiredRoles.includes(user.role as UserRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }

  private extractToken(request: any): string | null {
    const auth: string = request.headers?.authorization ?? '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }
}
