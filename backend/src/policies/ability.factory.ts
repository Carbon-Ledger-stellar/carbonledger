/**
 * AbilityFactory
 *
 * Builds a CASL `MongoAbility` instance for a given authenticated user.
 * This is the single source of truth for every permission decision in the app.
 *
 * Usage:
 *   const ability = abilityFactory.createForUser(req.user);
 *   if (ability.cannot('retire', subject(RetirementSubject, { retiredBy: user.publicKey }))) {
 *     throw new ForbiddenException();
 *   }
 */

import { Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import {
  AppAbility,
  AuthenticatedUser,
  AuditLogSubject,
  CreditBatchSubject,
  ExportSubject,
  MarketListingSubject,
  NotificationSubject,
  OracleDataSubject,
  ProjectSubject,
  RetirementSubject,
  StatsSubject,
  UploadSubject,
  UserSubject,
  ZkProofSubject,
} from './types';

export { subject };

@Injectable()
export class AbilityFactory {
  /**
   * Creates an `AppAbility` for the given user.
   *
   * Each role's permissions are expressed as positive `can()` rules.
   * Conditional rules accept a subject instance whose fields are matched
   * against the condition object (CASL mongo-style conditions).
   *
   * @param user  The authenticated user (from req.user after RolesGuard validates JWT)
   */
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    switch (user.role) {
      // ── Admin: unrestricted access to every resource ─────────────────────
      case 'admin':
        can('manage', 'all');
        break;

      // ── Verifier: read projects + approve/reject; read credit batches ────
      case 'verifier':
        // Projects
        can('read', ProjectSubject);
        can('verify', ProjectSubject);
        can('reject', ProjectSubject);

        // Credit batches — read-only
        can('read', CreditBatchSubject);

        // Stats — read-only
        can('read', StatsSubject);

        // Audit log — read-only
        can('read', AuditLogSubject);

        // Verifier applications
        can('read', UserSubject);
        break;

      // ── Project developer: create/manage own projects + upload docs ──────
      case 'project_developer':
        // Projects: create freely; read/update own projects only
        can('create', ProjectSubject);
        can('read', ProjectSubject);
        can('update', ProjectSubject, { ownerAddress: user.publicKey });

        // Credits: read batches belonging to projects they own (enforced in service)
        can('read', CreditBatchSubject);

        // Marketplace: list and delist own listings
        can('list', MarketListingSubject);
        can('read', MarketListingSubject);
        can('delist', MarketListingSubject, { seller: user.publicKey });

        // Uploads: upload and read own documents
        can('create', UploadSubject);
        can('read', UploadSubject);

        // Stats — read-only
        can('read', StatsSubject);

        // Notifications: manage own preferences
        can('read', NotificationSubject, { ownerPublicKey: user.publicKey });
        can('update', NotificationSubject, { ownerPublicKey: user.publicKey });
        break;

      // ── Corporation: purchase + retire credits, export ESG reports ───────
      case 'corporation':
        // Credits: read batches + retire own
        can('read', CreditBatchSubject);
        can('retire', RetirementSubject);

        // Own retirements only
        can('read', RetirementSubject, { retiredBy: user.publicKey });
        can('export', RetirementSubject, { retiredBy: user.publicKey });
        can('generateProof', ZkProofSubject, { retiredBy: user.publicKey });
        can('read', ZkProofSubject, { retiredBy: user.publicKey });

        // Marketplace: browse, purchase, list/delist own listings
        can('read', MarketListingSubject);
        can('purchase', MarketListingSubject);
        can('list', MarketListingSubject);
        can('delist', MarketListingSubject, { seller: user.publicKey });

        // Uploads: upload certificates
        can('create', UploadSubject);
        can('read', UploadSubject);

        // Projects: read only
        can('read', ProjectSubject);

        // Stats — read-only
        can('read', StatsSubject);

        // Notifications: manage own preferences
        can('read', NotificationSubject, { ownerPublicKey: user.publicKey });
        can('update', NotificationSubject, { ownerPublicKey: user.publicKey });

        // Export: own retirement data
        can('export', ExportSubject);
        break;

      // ── Public (unauthenticated-equivalent role): read-only, no PII ─────
      case 'public':
        can('read', ProjectSubject, { status: 'Verified' });
        can('read', CreditBatchSubject);
        can('read', StatsSubject);
        // Public audit trail for retirements (no PII)
        can('read', RetirementSubject);
        can('read', MarketListingSubject);
        break;

      default:
        // Unknown role — no permissions
        break;
    }

    return build({
      detectSubjectType: (item) => item.constructor as any,
    });
  }
}
