# Release Process

This document describes the end-to-end process for releasing the project, covering:

- [Versioning and SemVer policy](#versioning-and-semver-policy)
- [Tagging conventions](#tagging-conventions)
- [Changelog maintenance](#changelog-maintenance)
- [Deployment steps](#deployment-steps)
- [Smart-contract release checklist](#smart-contract-release-checklist)
- [Off-chain release checklist](#off-chain-release-checklist)

All contributors who cut a release are expected to follow this document. If something here is unclear or out of date, open an issue or PR to fix it.

---

## Versioning and SemVer policy

We follow [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`) for all release artifacts. Because this repository ships both **on-chain smart contracts** and **off-chain services** (backend, frontend, oracle bridge), the meaning of a version bump depends on the artifact being released.

### General rules

- **MAJOR** — incompatible changes that require coordinated action by integrators, operators, or users (e.g. breaking API changes, storage layout changes, migration requirements).
- **MINOR** — backwards-compatible additions (new endpoints, new optional fields, new contract functions that do not change existing behavior).
- **PATCH** — backwards-compatible bug fixes, security patches that do not change interfaces, documentation and dependency updates.

Pre-release versions use a hyphen suffix (`1.4.0-rc.1`, `2.0.0-beta.3`). Build metadata may be appended with `+` but is not used for ordering.

### Smart contracts

Smart contracts are the most sensitive artifact: once deployed, their interfaces and storage are effectively permanent. Treat the following as **MAJOR** changes:

- **Storage layout changes** — adding, removing, reordering, or changing the type of any state variable in an upgradeable contract. These require a storage-layout diff review and an explicit upgrade/migration plan.
- **ABI-breaking changes** — removing or renaming public/external functions, events, errors, or structs; changing function signatures, parameter types, return types, or revert reasons that integrators depend on.
- **Behavioral changes to access control, authorization, or invariants** that could affect existing integrations.
- **Proxy/admin changes** — changing the proxy pattern, admin, or upgrade authorization model.

Treat the following as **MINOR**:

- Adding new public/external functions, events, or errors.
- Adding new contracts or modules that do not alter existing ones.
- Backwards-compatible additions to existing interfaces (e.g. new optional parameters via overloads, new events).

Treat the following as **PATCH**:

- Bug fixes that do not change the ABI or storage layout.
- Gas optimizations with no behavioral change.
- Comment, NatSpec, and documentation updates.
- Dependency bumps that do not change compiled bytecode semantics.

> **Rule of thumb:** if an integrator must change their code, redeploy, or re-audit to stay compatible, it is a **MAJOR** bump. If a storage-layout diff is non-empty for an upgradeable contract, it is **at least** a **MAJOR** bump unless the change is explicitly proven safe and documented in the release notes.

Contract releases must record the compiled bytecode hash and the storage layout in the release notes so that on-chain deployments can be verified against the tagged source.

### Backend

- **MAJOR** — breaking API changes (removed/renamed endpoints, changed request/response shapes, changed auth), breaking database schema changes that require manual migration, or changes that require coordinated client updates.
- **MINOR** — new endpoints, new optional fields, new features that are backwards compatible.
- **PATCH** — bug fixes, performance improvements, dependency updates, internal refactors with no API change.

### Frontend

- **MAJOR** — breaking changes for integrators embedding the app, removal of supported routes, or changes that require users to take manual action.
- **MINOR** — new features and UI additions that are backwards compatible.
- **PATCH** — bug fixes, copy changes, styling fixes, dependency updates.

### Oracle bridge

- **MAJOR** — changes to the message format, signing scheme, supported chains, or relayer protocol that require coordinated upgrades on both sides of the bridge.
- **MINOR** — new supported assets, new optional configuration, additional observability.
- **PATCH** — bug fixes, retry/backoff tuning, dependency updates.

### Coordinated releases

When a release spans multiple artifacts (e.g. a contract upgrade plus a backend change to match a new ABI), tag each artifact with its own version and note the compatibility matrix in the changelog entry. The umbrella release tag (see below) records which artifact versions were shipped together.

---

## Tagging conventions

- All release tags are **annotated** git tags (`git tag -a`), never lightweight tags. The annotation must contain the version and a short summary, e.g.:

  ```sh
  git tag -a v1.4.0 -m "v1.4.0 — backend: new /health endpoint; contracts: no changes"
  ```

- Release tags use the `v` prefix: `vMAJOR.MINOR.PATCH` (e.g. `v1.4.0`). Pre-releases use `v1.4.0-rc.1`.
- **Audit tags** mark the exact commit that was audited and are named `audit/vX.Y` (e.g. `audit/v1.4`). An audit tag must point at the commit that was submitted for review; if fixes are applied after the audit, tag the fixed commit as `audit/vX.Y-fixed` and reference both in the changelog.
- **Contract deployment tags** are named `contracts/vX.Y.Z` and must point at the commit whose compiled bytecode matches the on-chain deployment.
- **Off-chain deployment tags** are named `backend/vX.Y.Z`, `frontend/vX.Y.Z`, and `oracle/vX.Y.Z` respectively.
- Tags are pushed explicitly: `git push origin v1.4.0` (or `git push --tags` when releasing several at once). Never move or delete a published tag; if a release is broken, cut a new PATCH release.
- Every tag must correspond to a commit on `main` (or the designated release branch) that has a matching entry in `CHANGELOG.md`.

---

## Changelog maintenance

We maintain a single [`CHANGELOG.md`](../CHANGELOG.md) at the repository root, following the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

- Add entries under the `## [Unreleased]` heading as changes land. Use the standard sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- On release, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` section above it.
- Add a link to the new version at the bottom of the file, following the existing link-reference style.
- Entries must be written for humans: describe the user-visible impact, not the commit message. Reference issues/PRs where helpful.
- Security fixes should be described without disclosing exploit details until a coordinated disclosure date; see [`SECURITY.md`](../SECURITY.md) for the disclosure policy.
- The changelog entry must state which artifacts were released (contracts, backend, frontend, oracle) and their versions.

---

## Deployment steps

The high-level flow for any release:

1. **Prepare** — ensure `main` is green in CI, the changelog is up to date, and any required audits are complete.
2. **Freeze** — announce the release freeze in the team channel; no new merges to `main` until the tag is pushed (hotfixes go through the PATCH process).
3. **Version bump** — update version files (e.g. `package.json`, contract version constants) and finalize `CHANGELOG.md`.
4. **Tag** — create the annotated tag(s) as described in [Tagging conventions](#tagging-conventions) and push them.
5. **Deploy** — follow the relevant checklist below.
6. **Verify** — confirm the deployed artifact matches the tag (bytecode hash for contracts, build artifact digest for services) and that health checks pass.
7. **Announce** — post the release notes (linking the changelog entry) to the team and any integrator channels.

If a deployment fails or a regression is found, follow the rollback steps in the relevant checklist and cut a PATCH release once fixed.

---

## Smart-contract release checklist

Use this checklist for any release that includes contract changes or a contract deployment.

- [ ] **Scope confirmed** — the set of contracts changed is listed in the release notes, and the version bump follows the [smart-contract SemVer rules](#smart-contracts).
- [ ] **Build reproducible** — contracts compile with the pinned toolchain/compiler version; the build is reproducible from a clean checkout of the tagged commit.
- [ ] **Tests pass** — full unit, integration, and fork tests pass in CI on the tagged commit.
- [ ] **Storage layout reviewed** — for upgradeable contracts, run a storage-layout diff against the currently deployed version and attach it to the release notes. Any non-empty diff is treated as MAJOR unless explicitly justified.
- [ ] **ABI diff reviewed** — compare the new ABI against the deployed ABI and document breaking changes.
- [ ] **Audit / re-audit complete** — new or changed contracts have been audited, or a re-audit has been performed for the changed surface. The audited commit is tagged `audit/vX.Y` (and `audit/vX.Y-fixed` if post-audit fixes were applied).
- [ ] **Upgrade authorization confirmed** — the upgrade transaction is authorized by the correct admin/multisig, and the required approvals are collected per the governance process.
- [ ] **Deployment dry run** — deploy and verify on a testnet (or fork) using the exact scripts and parameters that will be used in production.
- [ ] **Deploy to production** — execute the deployment/upgrade transaction(s).
- [ ] **On-chain verification** — verify source code on the block explorer(s), confirm the deployed bytecode hash matches the tagged build, and confirm the storage layout on-chain matches expectations.
- [ ] **Post-deploy smoke tests** — run read/write smoke tests against the deployed contracts.
- [ ] **Tag pushed** — `contracts/vX.Y.Z` (and `vX.Y.Z` if this is the umbrella release) is pushed and points at the deployed commit.
- [ ] **Changelog updated** — `CHANGELOG.md` records the contract version, deployment addresses, and any migration notes.
- [ ] **Announce** — integrators are notified of the deployment and any required actions.

---

## Off-chain release checklist

Use this checklist for backend, frontend, and oracle bridge releases. Each artifact is released independently but follows the same shape.

### Common (all off-chain artifacts)

- [ ] **Scope confirmed** — the changes are listed in the release notes and the version bump follows the [off-chain SemVer rules](#backend).
- [ ] **CI green** — all required checks (lint, typecheck, unit, integration, e2e) pass on the tagged commit.
- [ ] **Changelog updated** — `CHANGELOG.md` has an entry for the new version.
- [ ] **Rollback plan documented** — the previous known-good version is identified and the rollback procedure is written down in the release notes.
- [ ] **Tag pushed** — `backend/vX.Y.Z`, `frontend/vX.Y.Z`, or `oracle/vX.Y.Z` is pushed and points at the deployed commit.

### Backend

- [ ] **Database migrations reviewed** — migrations are backwards compatible (expand/contract pattern) or the maintenance window is scheduled and announced.
- [ ] **Migrations tested** — migrations have been run against a production-like snapshot and the rollback path is verified.
- [ ] **Config/secrets verified** — required environment variables and secrets are present in the target environment.
- [ ] **Deploy** — deploy the tagged build to staging, run smoke tests, then promote to production.
- [ ] **Health checks** — `/health` (and any readiness checks) pass after deploy; error rates and latency are within normal bounds.
- [ ] **Rollback ready** — the previous version remains deployable; if a regression is detected, roll back and cut a PATCH release.

### Frontend

- [ ] **Build verified** — the production build succeeds from the tagged commit and the artifact digest is recorded.
- [ ] **Staging deploy** — deploy to staging and verify critical user flows (wallet connect, core actions, error states).
- [ ] **Deploy to production** — promote the verified build; confirm CDN/cache invalidation completed.
- [ ] **Smoke tests** — verify the production URL loads, critical flows work, and no console errors are reported.
- [ ] **Rollback ready** — the previous build remains available for instant rollback.

### Oracle bridge

- [ ] **Compatibility confirmed** — the bridge version is compatible with the deployed contracts and supported chains; the compatibility matrix is recorded in the release notes.
- [ ] **Key management verified** — relayer keys and signing configuration are correct for the target environment.
- [ ] **Deploy** — deploy to staging, run end-to-end message relay tests, then promote to production.
- [ ] **Monitoring** — confirm relay success rate, latency, and alerting are healthy after deploy.
- [ ] **Rollback ready** — the previous version remains deployable; if a regression is detected, roll back and cut a PATCH release.

---

## References

- [`CHANGELOG.md`](../CHANGELOG.md) — release history, maintained per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- [`SECURITY.md`](../SECURITY.md) — vulnerability disclosure policy and security release handling.
- [Semantic Versioning 2.0.0](https://semver.org/)