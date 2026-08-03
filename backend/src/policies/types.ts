/**
 * ABAC (Attribute-Based Access Control) type definitions.
 *
 * Every permission in the system is expressed as:
 *   a user with role X can perform action Y on resource Z if condition W is true
 *
 * Resources map 1-to-1 with the domain entities in the Prisma schema.
 * Actions follow a standard CRUD vocabulary extended with domain-specific verbs.
 */

import { MongoAbility, RawRuleOf } from '@casl/ability';

// ── Action vocabulary ────────────────────────────────────────────────────────

export type Action =
  | 'manage'        // wildcard — all actions
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'verify'        // verifier approves a project
  | 'reject'        // verifier rejects a project
  | 'mint'          // admin mints credit batch
  | 'retire'        // corporation retires credits
  | 'list'          // project_developer/corporation lists credits for sale
  | 'delist'        // owner removes their own listing
  | 'purchase'      // corporation buys credits
  | 'export'        // admin/corporation exports data
  | 'ingest'        // oracle ingest (monitoring/price data)
  | 'hold'          // admin holds a price update
  | 'approve'       // admin approves price update
  | 'generateProof' // corporation generates ZK proof
  | 'assignRole'    // admin assigns a user role
  | 'reindex';      // admin triggers re-index

// ── Subject classes ───────────────────────────────────────────────────────────
// Each class represents a resource kind. Attribute fields are used in
// CASL conditional rules (e.g. can('read', RetirementSubject, { retiredBy: user.publicKey })).

export class ProjectSubject {
  ownerAddress!: string;
  status!: string;
}

export class CreditBatchSubject {
  projectId!: string;
}

export class RetirementSubject {
  retiredBy!: string;
}

export class MarketListingSubject {
  seller!: string;
}

export class OracleDataSubject {}

export class UserSubject {
  publicKey!: string;
}

export class AuditLogSubject {}

export class UploadSubject {
  uploaderPublicKey?: string;
}

export class ExportSubject {}

export class StatsSubject {}

export class NotificationSubject {
  ownerPublicKey!: string;
}

export class ZkProofSubject {
  retiredBy!: string;
}

// ── AppAbility type ──────────────────────────────────────────────────────────
// Using MongoAbility with a broad subject type so that both:
//   ability.can('action', SubjectInstance)  — works at runtime via detectSubjectType
//   ability.can('action', 'all')            — works for admin wildcard
// This avoids the TS2345 mismatch between subject() branded types and PureAbility generics.

export type AppAbility = MongoAbility<[Action, any]>;

// ── Authenticated user shape (attached to req.user) ─────────────────────────

export interface AuthenticatedUser {
  publicKey: string;
  role: 'admin' | 'verifier' | 'project_developer' | 'corporation' | 'public';
}
