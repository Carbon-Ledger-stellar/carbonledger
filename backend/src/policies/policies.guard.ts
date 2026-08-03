/**
 * PoliciesGuard
 *
 * Evaluates @CheckPolicies() handlers on a route using the CASL ability
 * built for the authenticated user.
 *
 * This guard is designed to be applied **in addition** to the existing
 * RolesGuard (which still handles JWT validation and populates req.user).
 * PoliciesGuard runs after RolesGuard because it relies on req.user being
 * set.
 *
 * Routes decorated with @Public() are skipped automatically.
 * Routes without @CheckPolicies() are also skipped (RolesGuard handles them).
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators';
import { AbilityFactory } from './ability.factory';
import { CHECK_POLICIES_KEY, PolicyHandler } from './check-policies.decorator';
import { AuthenticatedUser } from './types';

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip public routes — they need no permission check
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Retrieve policy handlers; if none, nothing to evaluate
    const handlers = this.reflector.get<PolicyHandler[]>(
      CHECK_POLICIES_KEY,
      context.getHandler(),
    );
    if (!handlers || handlers.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    // RolesGuard should have already populated req.user — guard ordering matters
    if (!user) {
      throw new ForbiddenException('User context not found');
    }

    const ability = this.abilityFactory.createForUser(user);

    const allAllowed = handlers.every((handler) => handler(ability));
    if (!allAllowed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
