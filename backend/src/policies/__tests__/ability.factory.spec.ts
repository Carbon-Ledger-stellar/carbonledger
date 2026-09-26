/**
 * Unit tests for AbilityFactory
 *
 * Covers every role × resource × action combination with both positive
 * (allowed) and negative (denied) cases.
 *
 * Test structure:
 *   describe('AbilityFactory') {
 *     describe('<role>') {
 *       describe('<resource>') {
 *         it('<positive case>') ...
 *         it('<negative case — denied action>') ...
 *       }
 *     }
 *   }
 *
 * Note on subject usage:
 *   ability.can(action, SubjectClass)         — unconditional check (class constructor)
 *   ability.can(action, subject(Cls, attrs))  — conditional check (attributes matched)
 *
 * CASL accepts either a class constructor or a subject instance. The TypeScript
 * PureAbility signature expects Subjects, which in this codebase means instances.
 * We cast unconditional checks via `as any` where needed to keep tests clean.
 */

import { subject } from '@casl/ability';
import { AbilityFactory } from '../ability.factory';
import {
  AuthenticatedUser,
  ProjectSubject,
  CreditBatchSubject,
  RetirementSubject,
  MarketListingSubject,
  OracleDataSubject,
  UserSubject,
  AuditLogSubject,
  UploadSubject,
  ExportSubject,
  StatsSubject,
  NotificationSubject,
  ZkProofSubject,
} from '../types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN: AuthenticatedUser          = { publicKey: 'GADMIN', role: 'admin' };
const VERIFIER: AuthenticatedUser       = { publicKey: 'GVERIFIER', role: 'verifier' };
const DEV: AuthenticatedUser            = { publicKey: 'GDEV', role: 'project_developer' };
const CORP: AuthenticatedUser           = { publicKey: 'GCORP', role: 'corporation' };
const PUBLIC_USER: AuthenticatedUser    = { publicKey: '', role: 'public' };
const OTHER_CORP: AuthenticatedUser     = { publicKey: 'GOTHER', role: 'corporation' };

// Subject instances — used for both unconditional and attribute-conditional checks
const VERIFIED_PROJECT   = subject(ProjectSubject,      { ownerAddress: DEV.publicKey, status: 'Verified' });
const PENDING_PROJECT    = subject(ProjectSubject,      { ownerAddress: DEV.publicKey, status: 'Pending' });
const OTHER_DEV_PROJECT  = subject(ProjectSubject,      { ownerAddress: 'GOTHER_DEV', status: 'Verified' });
const CREDIT_BATCH       = subject(CreditBatchSubject,  { projectId: 'proj-1' });
const ORACLE_DATA        = subject(OracleDataSubject,   {});
const USER_SUBJECT       = subject(UserSubject,         { publicKey: 'GSOME' });
const AUDIT_LOG          = subject(AuditLogSubject,     {});
const UPLOAD             = subject(UploadSubject,       {});
const EXPORT_SUBJECT     = subject(ExportSubject,       {});
const STATS              = subject(StatsSubject,        {});

// Ownership-conditioned subjects
const OWN_RETIREMENT     = subject(RetirementSubject,   { retiredBy: CORP.publicKey });
const OTHER_RETIREMENT   = subject(RetirementSubject,   { retiredBy: 'GOTHER' });
const OWN_LISTING        = subject(MarketListingSubject, { seller: CORP.publicKey });
const OTHER_LISTING      = subject(MarketListingSubject, { seller: 'GOTHER' });
const OWN_NOTIFICATION   = subject(NotificationSubject, { ownerPublicKey: CORP.publicKey });
const OTHER_NOTIFICATION = subject(NotificationSubject, { ownerPublicKey: 'GOTHER' });
const OWN_ZK_PROOF       = subject(ZkProofSubject,      { retiredBy: CORP.publicKey });
const OTHER_ZK_PROOF     = subject(ZkProofSubject,      { retiredBy: 'GOTHER' });

// ── Helpers ──────────────────────────────────────────────────────────────────

let factory: AbilityFactory;

beforeEach(() => {
  factory = new AbilityFactory();
});

// ── Admin ─────────────────────────────────────────────────────────────────────

describe('AbilityFactory', () => {
  // ── admin ────────────────────────────────────────────────────────────────

  describe('admin role', () => {
    let ability: ReturnType<AbilityFactory['createForUser']>;
    beforeEach(() => { ability = factory.createForUser(ADMIN); });

    it('can manage all resources (wildcard)', () => {
      expect(ability.can('manage', 'all')).toBe(true);
    });

    it('can create projects', () => {
      expect(ability.can('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('can verify projects', () => {
      expect(ability.can('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('can reject projects', () => {
      expect(ability.can('reject', PENDING_PROJECT)).toBe(true);
    });

    it('can mint credit batches', () => {
      expect(ability.can('mint', CREDIT_BATCH)).toBe(true);
    });

    it('can retire credits', () => {
      expect(ability.can('retire', OWN_RETIREMENT)).toBe(true);
    });

    it('can read any retirement', () => {
      expect(ability.can('read', OTHER_RETIREMENT)).toBe(true);
    });

    it('can delist any listing', () => {
      expect(ability.can('delist', OTHER_LISTING)).toBe(true);
    });

    it('can assign roles', () => {
      expect(ability.can('assignRole', USER_SUBJECT)).toBe(true);
    });

    it('can read audit logs', () => {
      expect(ability.can('read', AUDIT_LOG)).toBe(true);
    });

    it('can export data', () => {
      expect(ability.can('export', EXPORT_SUBJECT)).toBe(true);
    });

    it('can reindex', () => {
      expect(ability.can('reindex', 'all')).toBe(true);
    });

    it('can hold oracle price updates', () => {
      expect(ability.can('hold', ORACLE_DATA)).toBe(true);
    });

    it('can approve oracle price updates', () => {
      expect(ability.can('approve', ORACLE_DATA)).toBe(true);
    });

    it('can generate ZK proof for any retirement', () => {
      expect(ability.can('generateProof', OTHER_ZK_PROOF)).toBe(true);
    });

    it('can read any notification', () => {
      expect(ability.can('read', OTHER_NOTIFICATION)).toBe(true);
    });
  });

  // ── verifier ─────────────────────────────────────────────────────────────

  describe('verifier role', () => {
    let ability: ReturnType<AbilityFactory['createForUser']>;
    beforeEach(() => { ability = factory.createForUser(VERIFIER); });

    it('can read projects', () => {
      expect(ability.can('read', VERIFIED_PROJECT)).toBe(true);
    });

    it('can verify a project', () => {
      expect(ability.can('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('can reject a project', () => {
      expect(ability.can('reject', PENDING_PROJECT)).toBe(true);
    });

    it('can read credit batches', () => {
      expect(ability.can('read', CREDIT_BATCH)).toBe(true);
    });

    it('can read audit logs', () => {
      expect(ability.can('read', AUDIT_LOG)).toBe(true);
    });

    it('can read stats', () => {
      expect(ability.can('read', STATS)).toBe(true);
    });

    it('can read user subjects', () => {
      expect(ability.can('read', USER_SUBJECT)).toBe(true);
    });

    // Negative cases
    it('cannot mint credits', () => {
      expect(ability.cannot('mint', CREDIT_BATCH)).toBe(true);
    });

    it('cannot retire credits', () => {
      expect(ability.cannot('retire', OWN_RETIREMENT)).toBe(true);
    });

    it('cannot create a project', () => {
      expect(ability.cannot('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot purchase listings', () => {
      expect(ability.cannot('purchase', OWN_LISTING)).toBe(true);
    });

    it('cannot delete users', () => {
      expect(ability.cannot('delete', USER_SUBJECT)).toBe(true);
    });

    it('cannot export data', () => {
      expect(ability.cannot('export', EXPORT_SUBJECT)).toBe(true);
    });

    it('cannot hold oracle price updates', () => {
      expect(ability.cannot('hold', ORACLE_DATA)).toBe(true);
    });
  });

  // ── project_developer ─────────────────────────────────────────────────────

  describe('project_developer role', () => {
    let ability: ReturnType<AbilityFactory['createForUser']>;
    beforeEach(() => { ability = factory.createForUser(DEV); });

    it('can create a project', () => {
      expect(ability.can('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('can read any project', () => {
      expect(ability.can('read', VERIFIED_PROJECT)).toBe(true);
      expect(ability.can('read', OTHER_DEV_PROJECT)).toBe(true);
    });

    it('can update own project', () => {
      const ownProject = subject(ProjectSubject, { ownerAddress: DEV.publicKey, status: 'Pending' });
      expect(ability.can('update', ownProject)).toBe(true);
    });

    it('cannot update another developer\'s project', () => {
      expect(ability.cannot('update', OTHER_DEV_PROJECT)).toBe(true);
    });

    it('can list credits for sale', () => {
      expect(ability.can('list', OWN_LISTING)).toBe(true);
    });

    it('can delist own listing', () => {
      const ownDevListing = subject(MarketListingSubject, { seller: DEV.publicKey });
      expect(ability.can('delist', ownDevListing)).toBe(true);
    });

    it('cannot delist another seller\'s listing', () => {
      expect(ability.cannot('delist', OTHER_LISTING)).toBe(true);
    });

    it('can upload documents', () => {
      expect(ability.can('create', UPLOAD)).toBe(true);
    });

    it('can read stats', () => {
      expect(ability.can('read', STATS)).toBe(true);
    });

    it('can read own notification preferences', () => {
      const ownNotification = subject(NotificationSubject, { ownerPublicKey: DEV.publicKey });
      expect(ability.can('read', ownNotification)).toBe(true);
    });

    it('can update own notification preferences', () => {
      const ownNotification = subject(NotificationSubject, { ownerPublicKey: DEV.publicKey });
      expect(ability.can('update', ownNotification)).toBe(true);
    });

    it('cannot read another user\'s notification preferences', () => {
      expect(ability.cannot('read', OTHER_NOTIFICATION)).toBe(true);
    });

    // Negative cases
    it('cannot mint credits', () => {
      expect(ability.cannot('mint', CREDIT_BATCH)).toBe(true);
    });

    it('cannot verify a project', () => {
      expect(ability.cannot('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot retire credits', () => {
      expect(ability.cannot('retire', OWN_RETIREMENT)).toBe(true);
    });

    it('cannot read audit logs', () => {
      expect(ability.cannot('read', AUDIT_LOG)).toBe(true);
    });

    it('cannot assign roles', () => {
      expect(ability.cannot('assignRole', USER_SUBJECT)).toBe(true);
    });

    it('cannot purchase listings', () => {
      expect(ability.cannot('purchase', OWN_LISTING)).toBe(true);
    });

    it('cannot export admin data', () => {
      expect(ability.cannot('export', EXPORT_SUBJECT)).toBe(true);
    });
  });

  // ── corporation ───────────────────────────────────────────────────────────

  describe('corporation role', () => {
    let ability: ReturnType<AbilityFactory['createForUser']>;
    beforeEach(() => { ability = factory.createForUser(CORP); });

    it('can read credit batches', () => {
      expect(ability.can('read', CREDIT_BATCH)).toBe(true);
    });

    it('can retire credits', () => {
      expect(ability.can('retire', OWN_RETIREMENT)).toBe(true);
    });

    it('can read own retirements', () => {
      expect(ability.can('read', OWN_RETIREMENT)).toBe(true);
    });

    it('cannot read another corporation\'s retirements', () => {
      expect(ability.cannot('read', OTHER_RETIREMENT)).toBe(true);
    });

    it('can export own retirement data', () => {
      expect(ability.can('export', OWN_RETIREMENT)).toBe(true);
    });

    it('cannot export another user\'s retirement data', () => {
      expect(ability.cannot('export', OTHER_RETIREMENT)).toBe(true);
    });

    it('can generate ZK proof for own retirement', () => {
      expect(ability.can('generateProof', OWN_ZK_PROOF)).toBe(true);
    });

    it('cannot generate ZK proof for another user\'s retirement', () => {
      expect(ability.cannot('generateProof', OTHER_ZK_PROOF)).toBe(true);
    });

    it('can read own ZK proof', () => {
      expect(ability.can('read', OWN_ZK_PROOF)).toBe(true);
    });

    it('cannot read another user\'s ZK proof', () => {
      expect(ability.cannot('read', OTHER_ZK_PROOF)).toBe(true);
    });

    it('can read marketplace listings', () => {
      expect(ability.can('read', OWN_LISTING)).toBe(true);
      expect(ability.can('read', OTHER_LISTING)).toBe(true);
    });

    it('can purchase listings', () => {
      expect(ability.can('purchase', OWN_LISTING)).toBe(true);
    });

    it('can list credits for sale', () => {
      expect(ability.can('list', OWN_LISTING)).toBe(true);
    });

    it('can delist own listing', () => {
      expect(ability.can('delist', OWN_LISTING)).toBe(true);
    });

    it('cannot delist another seller\'s listing', () => {
      expect(ability.cannot('delist', OTHER_LISTING)).toBe(true);
    });

    it('can upload certificates', () => {
      expect(ability.can('create', UPLOAD)).toBe(true);
    });

    it('can read projects', () => {
      expect(ability.can('read', VERIFIED_PROJECT)).toBe(true);
    });

    it('can read stats', () => {
      expect(ability.can('read', STATS)).toBe(true);
    });

    it('can read own notification preferences', () => {
      expect(ability.can('read', OWN_NOTIFICATION)).toBe(true);
    });

    it('can update own notification preferences', () => {
      expect(ability.can('update', OWN_NOTIFICATION)).toBe(true);
    });

    it('cannot read another user\'s notification preferences', () => {
      expect(ability.cannot('read', OTHER_NOTIFICATION)).toBe(true);
    });

    it('can export data (ExportSubject)', () => {
      expect(ability.can('export', EXPORT_SUBJECT)).toBe(true);
    });

    // Negative cases
    it('cannot mint credits', () => {
      expect(ability.cannot('mint', CREDIT_BATCH)).toBe(true);
    });

    it('cannot verify a project', () => {
      expect(ability.cannot('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot create a project', () => {
      expect(ability.cannot('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot read audit logs', () => {
      expect(ability.cannot('read', AUDIT_LOG)).toBe(true);
    });

    it('cannot assign roles', () => {
      expect(ability.cannot('assignRole', USER_SUBJECT)).toBe(true);
    });

    it('cannot hold oracle price updates', () => {
      expect(ability.cannot('hold', ORACLE_DATA)).toBe(true);
    });

    it('cannot update another user\'s project', () => {
      expect(ability.cannot('update', OTHER_DEV_PROJECT)).toBe(true);
    });
  });

  // ── public ────────────────────────────────────────────────────────────────

  describe('public role', () => {
    let ability: ReturnType<AbilityFactory['createForUser']>;
    beforeEach(() => { ability = factory.createForUser(PUBLIC_USER); });

    it('can read verified projects', () => {
      expect(ability.can('read', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot read pending (non-verified) projects', () => {
      expect(ability.cannot('read', PENDING_PROJECT)).toBe(true);
    });

    it('can read credit batches', () => {
      expect(ability.can('read', CREDIT_BATCH)).toBe(true);
    });

    it('can read stats', () => {
      expect(ability.can('read', STATS)).toBe(true);
    });

    it('can read retirements (public audit trail)', () => {
      expect(ability.can('read', OWN_RETIREMENT)).toBe(true);
    });

    it('can read marketplace listings', () => {
      expect(ability.can('read', OWN_LISTING)).toBe(true);
    });

    // Negative cases
    it('cannot create a project', () => {
      expect(ability.cannot('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot update a project', () => {
      expect(ability.cannot('update', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot mint credits', () => {
      expect(ability.cannot('mint', CREDIT_BATCH)).toBe(true);
    });

    it('cannot retire credits', () => {
      expect(ability.cannot('retire', OWN_RETIREMENT)).toBe(true);
    });

    it('cannot purchase listings', () => {
      expect(ability.cannot('purchase', OWN_LISTING)).toBe(true);
    });

    it('cannot list credits for sale', () => {
      expect(ability.cannot('list', OWN_LISTING)).toBe(true);
    });

    it('cannot delist listings', () => {
      expect(ability.cannot('delist', OWN_LISTING)).toBe(true);
    });

    it('cannot read audit logs', () => {
      expect(ability.cannot('read', AUDIT_LOG)).toBe(true);
    });

    it('cannot export data', () => {
      expect(ability.cannot('export', EXPORT_SUBJECT)).toBe(true);
    });

    it('cannot assign roles', () => {
      expect(ability.cannot('assignRole', USER_SUBJECT)).toBe(true);
    });

    it('cannot read notification preferences', () => {
      expect(ability.cannot('read', OWN_NOTIFICATION)).toBe(true);
    });

    it('cannot verify projects', () => {
      expect(ability.cannot('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('cannot hold oracle price updates', () => {
      expect(ability.cannot('hold', ORACLE_DATA)).toBe(true);
    });
  });

  // ── Cross-role boundary tests ─────────────────────────────────────────────

  describe('cross-role ownership boundaries', () => {
    it('corporation A cannot read corporation B\'s retirement', () => {
      const corpAAbility  = factory.createForUser(CORP);
      const corpBAbility  = factory.createForUser(OTHER_CORP);
      const corpARetirement = subject(RetirementSubject, { retiredBy: CORP.publicKey });
      // Corp A can read their own
      expect(corpAAbility.can('read', corpARetirement)).toBe(true);
      // Corp B cannot read Corp A's
      expect(corpBAbility.cannot('read', corpARetirement)).toBe(true);
    });

    it('verifier cannot perform admin actions', () => {
      const verAbility = factory.createForUser(VERIFIER);
      expect(verAbility.cannot('assignRole', USER_SUBJECT)).toBe(true);
      expect(verAbility.cannot('reindex', 'all')).toBe(true);
      expect(verAbility.cannot('delete', USER_SUBJECT)).toBe(true);
    });

    it('project_developer cannot verify their own project', () => {
      const devAbility = factory.createForUser(DEV);
      expect(devAbility.cannot('verify', VERIFIED_PROJECT)).toBe(true);
    });

    it('corporation cannot create a project', () => {
      const corpAbility = factory.createForUser(CORP);
      expect(corpAbility.cannot('create', VERIFIED_PROJECT)).toBe(true);
    });

    it('public user cannot perform any write operation on project', () => {
      const pubAbility = factory.createForUser(PUBLIC_USER);
      const writeActionsOnProject = ['create', 'update', 'delete', 'verify', 'reject'] as const;
      for (const action of writeActionsOnProject) {
        expect(pubAbility.cannot(action, VERIFIED_PROJECT)).toBe(true);
      }
    });

    it('public user cannot retire, purchase, list, mint or export', () => {
      const pubAbility = factory.createForUser(PUBLIC_USER);
      expect(pubAbility.cannot('mint', CREDIT_BATCH)).toBe(true);
      expect(pubAbility.cannot('retire', OWN_RETIREMENT)).toBe(true);
      expect(pubAbility.cannot('purchase', OWN_LISTING)).toBe(true);
      expect(pubAbility.cannot('list', OWN_LISTING)).toBe(true);
      expect(pubAbility.cannot('export', EXPORT_SUBJECT)).toBe(true);
    });
  });

  // ── Admin wildcard coverage ───────────────────────────────────────────────

  describe('admin wildcard coverage', () => {
    it('admin can perform every defined action on "all"', () => {
      const ability = factory.createForUser(ADMIN);
      const actions = ['create', 'read', 'update', 'delete', 'verify', 'reject', 'mint', 'retire', 'list', 'delist', 'purchase', 'export', 'ingest', 'hold', 'approve', 'generateProof', 'assignRole', 'reindex'] as const;
      for (const action of actions) {
        expect(ability.can(action, 'all')).toBe(true);
      }
    });
  });
});
