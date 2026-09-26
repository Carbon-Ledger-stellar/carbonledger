/**
 * CheckPolicies decorator
 *
 * Attaches one or more policy handler functions to a route handler.
 * Each handler receives the resolved AppAbility and returns true/false.
 *
 * Usage:
 *   @CheckPolicies((ability) => ability.can('mint', CreditBatchSubject))
 *   @Post('mint')
 *   mint() { ... }
 *
 * Multiple handlers are AND-ed: all must return true.
 */

import { SetMetadata } from '@nestjs/common';
import { AppAbility } from './types';

export const CHECK_POLICIES_KEY = 'check_policies';

export type PolicyHandler = (ability: AppAbility) => boolean;

export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
