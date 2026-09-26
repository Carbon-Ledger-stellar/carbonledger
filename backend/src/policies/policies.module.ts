/**
 * PoliciesModule
 *
 * Registers the ABAC policy engine (AbilityFactory + PoliciesGuard).
 * Import this module wherever ABAC enforcement is needed.
 *
 * The module is NOT global — controllers that opt into attribute-based checks
 * must add PoliciesModule to their own module's imports list, or the feature
 * module must import it. This keeps the dependency graph explicit.
 */

import { Module } from '@nestjs/common';
import { AbilityFactory } from './ability.factory';
import { PoliciesGuard } from './policies.guard';

@Module({
  providers: [AbilityFactory, PoliciesGuard],
  exports: [AbilityFactory, PoliciesGuard],
})
export class PoliciesModule {}
