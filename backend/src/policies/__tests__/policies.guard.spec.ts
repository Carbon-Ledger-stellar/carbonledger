/**
 * Unit tests for PoliciesGuard
 *
 * Tests that the guard:
 *  - Skips @Public() routes
 *  - Skips routes without @CheckPolicies()
 *  - Allows when all policy handlers return true
 *  - Throws ForbiddenException when any handler returns false
 *  - Throws ForbiddenException when req.user is missing
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PoliciesGuard } from '../policies.guard';
import { AbilityFactory } from '../ability.factory';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../check-policies.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators';
import { AuthenticatedUser, ProjectSubject } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(
  user: AuthenticatedUser | undefined,
  isPublic: boolean,
  handlers: PolicyHandler[] | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any as ExecutionContext;
}

function makeReflector(isPublic: boolean, handlers: PolicyHandler[] | undefined): Reflector {
  return {
    getAllAndOverride: (_key: string) => isPublic,
    get: (key: string) => handlers,
  } as any as Reflector;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PoliciesGuard', () => {
  let guard: PoliciesGuard;
  let reflector: Reflector;
  let abilityFactory: AbilityFactory;

  const adminUser: AuthenticatedUser  = { publicKey: 'GADMIN', role: 'admin' };
  const publicUser: AuthenticatedUser = { publicKey: '',       role: 'public' };

  beforeEach(() => {
    abilityFactory = new AbilityFactory();
  });

  it('returns true for @Public() routes regardless of handlers', () => {
    reflector = {
      getAllAndOverride: () => true,      // isPublic = true
      get: () => [() => false],          // handler would deny
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(undefined, true, [() => false]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when no @CheckPolicies handlers are registered', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => undefined,
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(adminUser, false, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when all handlers return true', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => [
        (ability: any) => ability.can('manage', 'all'),
        (ability: any) => ability.can('read', ProjectSubject),
      ] as PolicyHandler[],
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(adminUser, false, []);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when a handler returns false', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => [
        (ability: any) => ability.can('mint', ProjectSubject), // public cannot mint
      ] as PolicyHandler[],
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(publicUser, false, []);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when req.user is missing', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => [(ability: any) => true] as PolicyHandler[],
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(undefined, false, []);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AND-s multiple handlers — fails if any single handler returns false', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => [
        (ability: any) => ability.can('read', ProjectSubject),  // public can read
        (ability: any) => ability.can('create', ProjectSubject), // public CANNOT create
      ] as PolicyHandler[],
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(publicUser, false, []);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('passes with empty handlers array (no restriction)', () => {
    reflector = {
      getAllAndOverride: () => false,
      get: () => [],
    } as any;
    guard = new PoliciesGuard(reflector, abilityFactory);
    const ctx = makeContext(publicUser, false, []);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
