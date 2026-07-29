/**
 * Policy scenario tests
 *
 * Tests the attribute-based conditions that replaced the ad-hoc inline
 * ForbiddenException checks that existed before the ABAC refactor:
 *
 *  1. Retirement owner check (was: `if (retirement.retiredBy !== req.user.publicKey && ...`)
 *  2. Marketplace delist IDOR (was: `if (listing.seller !== req.user.publicKey && ...`)
 *  3. ZK proof ownership check
 *  4. Notification preference scoping
 *  5. Public project status gate (Verified only)
 *  6. Project developer update own vs. others
 *
 * These tests use the `subject()` helper from CASL to attach resource attributes
 * to the subject class, verifying that conditional rules fire correctly.
 */

import { subject } from '@casl/ability';
import { AbilityFactory } from '../ability.factory';
import {
  AuthenticatedUser,
  RetirementSubject,
  MarketListingSubject,
  ZkProofSubject,
  NotificationSubject,
  ProjectSubject,
} from '../types';

const factory = new AbilityFactory();

// ── Actors ────────────────────────────────────────────────────────────────────

const corpAlice: AuthenticatedUser = { publicKey: 'GALICE', role: 'corporation' };
const corpBob: AuthenticatedUser   = { publicKey: 'GBOB',   role: 'corporation' };
const devCarol: AuthenticatedUser  = { publicKey: 'GCAROL', role: 'project_developer' };
const adminUser: AuthenticatedUser = { publicKey: 'GADMIN', role: 'admin' };

// ── Scenario 1: Retirement owner access control ───────────────────────────────

describe('Retirement ownership scoping', () => {
  it('owner can read their own retirement', () => {
    const ability = factory.createForUser(corpAlice);
    const retirement = subject(RetirementSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('read', retirement)).toBe(true);
  });

  it('other corporation cannot read a retirement they do not own', () => {
    const ability = factory.createForUser(corpBob);
    const alicesRetirement = subject(RetirementSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.cannot('read', alicesRetirement)).toBe(true);
  });

  it('admin can read any retirement', () => {
    const ability = factory.createForUser(adminUser);
    const alicesRetirement = subject(RetirementSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('read', alicesRetirement)).toBe(true);
  });

  it('owner can export their own retirement', () => {
    const ability = factory.createForUser(corpAlice);
    const retirement = subject(RetirementSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('export', retirement)).toBe(true);
  });

  it('other corporation cannot export a retirement they do not own', () => {
    const ability = factory.createForUser(corpBob);
    const alicesRetirement = subject(RetirementSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.cannot('export', alicesRetirement)).toBe(true);
  });
});

// ── Scenario 2: Marketplace delist IDOR ──────────────────────────────────────

describe('Marketplace delist IDOR prevention', () => {
  it('seller can delist their own listing', () => {
    const ability = factory.createForUser(corpAlice);
    const listing = subject(MarketListingSubject, { seller: corpAlice.publicKey });
    expect(ability.can('delist', listing)).toBe(true);
  });

  it('corporation cannot delist another seller\'s listing', () => {
    const ability = factory.createForUser(corpBob);
    const alicesListing = subject(MarketListingSubject, { seller: corpAlice.publicKey });
    expect(ability.cannot('delist', alicesListing)).toBe(true);
  });

  it('project developer can delist their own listing', () => {
    const ability = factory.createForUser(devCarol);
    const carolListing = subject(MarketListingSubject, { seller: devCarol.publicKey });
    expect(ability.can('delist', carolListing)).toBe(true);
  });

  it('project developer cannot delist someone else\'s listing', () => {
    const ability = factory.createForUser(devCarol);
    const alicesListing = subject(MarketListingSubject, { seller: corpAlice.publicKey });
    expect(ability.cannot('delist', alicesListing)).toBe(true);
  });

  it('admin can delist any listing', () => {
    const ability = factory.createForUser(adminUser);
    const alicesListing = subject(MarketListingSubject, { seller: corpAlice.publicKey });
    expect(ability.can('delist', alicesListing)).toBe(true);
  });
});

// ── Scenario 3: ZK proof ownership ──────────────────────────────────────────

describe('ZK proof ownership scoping', () => {
  it('owner can generate a ZK proof for their own retirement', () => {
    const ability = factory.createForUser(corpAlice);
    const proof = subject(ZkProofSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('generateProof', proof)).toBe(true);
  });

  it('other corporation cannot generate ZK proof for someone else\'s retirement', () => {
    const ability = factory.createForUser(corpBob);
    const alicesProof = subject(ZkProofSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.cannot('generateProof', alicesProof)).toBe(true);
  });

  it('owner can read their own ZK proof', () => {
    const ability = factory.createForUser(corpAlice);
    const proof = subject(ZkProofSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('read', proof)).toBe(true);
  });

  it('other corporation cannot read another owner\'s ZK proof', () => {
    const ability = factory.createForUser(corpBob);
    const alicesProof = subject(ZkProofSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.cannot('read', alicesProof)).toBe(true);
  });

  it('admin can generate and read any ZK proof', () => {
    const ability = factory.createForUser(adminUser);
    const alicesProof = subject(ZkProofSubject, { retiredBy: corpAlice.publicKey });
    expect(ability.can('generateProof', alicesProof)).toBe(true);
    expect(ability.can('read', alicesProof)).toBe(true);
  });
});

// ── Scenario 4: Notification preference scoping ───────────────────────────────

describe('Notification preference ownership scoping', () => {
  it('user can read their own notification preferences', () => {
    const ability = factory.createForUser(corpAlice);
    const pref = subject(NotificationSubject, { ownerPublicKey: corpAlice.publicKey });
    expect(ability.can('read', pref)).toBe(true);
  });

  it('user cannot read another user\'s notification preferences', () => {
    const ability = factory.createForUser(corpBob);
    const alicesPref = subject(NotificationSubject, { ownerPublicKey: corpAlice.publicKey });
    expect(ability.cannot('read', alicesPref)).toBe(true);
  });

  it('user can update their own notification preferences', () => {
    const ability = factory.createForUser(corpAlice);
    const pref = subject(NotificationSubject, { ownerPublicKey: corpAlice.publicKey });
    expect(ability.can('update', pref)).toBe(true);
  });

  it('user cannot update another user\'s notification preferences', () => {
    const ability = factory.createForUser(corpBob);
    const alicesPref = subject(NotificationSubject, { ownerPublicKey: corpAlice.publicKey });
    expect(ability.cannot('update', alicesPref)).toBe(true);
  });

  it('admin can read any notification preferences', () => {
    const ability = factory.createForUser(adminUser);
    const alicesPref = subject(NotificationSubject, { ownerPublicKey: corpAlice.publicKey });
    expect(ability.can('read', alicesPref)).toBe(true);
  });
});

// ── Scenario 5: Project status-based access (public can only see Verified) ───

describe('Public project status-scoped access', () => {
  it('public user can read Verified projects', () => {
    const ability = factory.createForUser({ publicKey: '', role: 'public' });
    const verified = subject(ProjectSubject, { ownerAddress: 'GDEV', status: 'Verified' });
    expect(ability.can('read', verified)).toBe(true);
  });

  it('public user cannot read Pending projects', () => {
    const ability = factory.createForUser({ publicKey: '', role: 'public' });
    const pending = subject(ProjectSubject, { ownerAddress: 'GDEV', status: 'Pending' });
    expect(ability.cannot('read', pending)).toBe(true);
  });

  it('public user cannot read Rejected projects', () => {
    const ability = factory.createForUser({ publicKey: '', role: 'public' });
    const rejected = subject(ProjectSubject, { ownerAddress: 'GDEV', status: 'Rejected' });
    expect(ability.cannot('read', rejected)).toBe(true);
  });

  it('authenticated user can read any project regardless of status', () => {
    const ability = factory.createForUser(devCarol);
    const pending  = subject(ProjectSubject, { ownerAddress: 'GDEV', status: 'Pending' });
    const rejected = subject(ProjectSubject, { ownerAddress: 'GDEV', status: 'Rejected' });
    expect(ability.can('read', pending)).toBe(true);
    expect(ability.can('read', rejected)).toBe(true);
  });
});

// ── Scenario 6: Project developer update own vs. others ──────────────────────

describe('Project developer update scoping', () => {
  it('developer can update their own project', () => {
    const ability = factory.createForUser(devCarol);
    const ownProject = subject(ProjectSubject, { ownerAddress: devCarol.publicKey, status: 'Pending' });
    expect(ability.can('update', ownProject)).toBe(true);
  });

  it('developer cannot update a project owned by another developer', () => {
    const ability = factory.createForUser(devCarol);
    const otherProject = subject(ProjectSubject, { ownerAddress: 'GOTHER_DEV', status: 'Verified' });
    expect(ability.cannot('update', otherProject)).toBe(true);
  });

  it('admin can update any project', () => {
    const ability = factory.createForUser(adminUser);
    const anyProject = subject(ProjectSubject, { ownerAddress: devCarol.publicKey, status: 'Pending' });
    expect(ability.can('update', anyProject)).toBe(true);
  });
});
