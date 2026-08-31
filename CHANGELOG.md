# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Document changelog structure and release notes for project contributors. [#377](https://github.com/dev-fatima-24/carbonledger/issues/377)
- Add `CHANGELOG.md` reference in the main README for release history.
- **Secret Management** — Complete AWS Secrets Manager implementation for all production secrets. [#1066](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1066)
  - `docs/secret-management-complete.md` — Full inventory of every secret, AWS path, rotation schedule, access log query examples, emergency procedures, and quarterly rotation checklist.
  - `infra/main/secrets.tf` — Automated 90-day rotation (quarterly) for JWT secret, PostgreSQL credentials, and Redis password via Lambda-backed Secrets Manager rotation (previously 30 days).
  - `infra/main/cloudwatch.tf` — CloudWatch metric filters and alarms for Secrets Manager `GetSecretValue` events: high-volume access alarm (>100 calls/5 min) and anomalous principal alarm (any call from outside ECS task role or rotation Lambda).
  - `.gitignore` — Added `.env.staging`, `.env.production`, `*.tfvars.local`, `*.tfvars.secret`, and `infra/*/build/` to prevent accidental secret leaks to version control.
  - Audit confirmed: no secrets hardcoded in any `.tf`, `.tfvars`, or config file.
- **Disaster Recovery Plan** — Comprehensive DR plan and infrastructure for recovery within RTO < 1 hour and RPO < 15 minutes. [#1065](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1065)
  - `docs/disaster-recovery-plan.md` — Full DR plan covering: RTO/RPO targets, backup locations in 2+ regions, step-by-step recovery procedures for all components (database, application server, Redis, oracle, Stellar network degradation, full region failure, security incidents), communication plan with escalation path, 5 communication templates, quarterly DR test schedule, and leadership sign-off section.
  - `infra/main/storage-dr.tf` — Cross-region S3 replication for database backups from `us-east-1` to `us-west-2` DR bucket, with Replication Time Control (RTC, 15-minute SLA), IAM replication role, lifecycle policies, and a CloudWatch alarm for replication lag exceeding the RPO target.
  - `scripts/dr-test-quarterly.sh` — Executable quarterly DR test script validating: primary backup freshness, DR replication lag, RDS point-in-time restore with RTO measurement, secrets accessibility and rotation schedule, CloudWatch alarm states, re-index from on-chain events, and overall RTO validation. Supports `--env` and `--dry-run` flags; generates a timestamped report.

### Changed
- Prepare release notes for the first public version and update project documentation.
- **Secret rotation schedule** updated from 30 days to 90 days (quarterly) for JWT, Postgres, and Redis secrets to match `docs/secret-management-complete.md` quarterly rotation schedule. [#1066](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1066)

### Fixed
- Improve changelog discoverability for contributors and users.

### Security
- All production secrets confirmed to be in AWS Secrets Manager; no secrets in git or config files. [#1066](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1066)
- CloudWatch alarms added for anomalous Secrets Manager access patterns. [#1066](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1066)
- Disaster recovery procedures documented and quarterly testing scheduled. [#1065](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1065)

### Deprecated
- No deprecated items in this release.

### Removed
- No removed items in this release.

## [0.1.0] - 2026-04-26

### Added
- **Smart Contracts**:
  - `carbon_registry` for project registration, verification, and escrowed fee distribution.
  - `carbon_credit` for minting, retiring, and transferring carbon credits with serial numbers.
  - `carbon_marketplace` for listing, purchasing, and bulk purchase operations.
  - `carbon_oracle` for governance, data collection, and price feed infrastructure.
- **Backend API**:
  - NestJS-based backend with header-based API versioning via `Accept-Version`.
  - OpenAPI documentation export and API version lifecycle guidance. [docs/api-versioning.md]
- **DevOps & Deployment**:
  - Full local DevOps stack via `docker-compose.yml` with health checks and service dependencies. [#67](https://github.com/dev-fatima-24/carbonledger/issues/67)
  - Stellar Testnet deployment runbook with contract initialization, verification, and rollback procedures. [#68](https://github.com/dev-fatima-24/carbonledger/issues/68)
- **Observability**:
  - Structured JSON logging, alerts, and metrics tracking for backend services. [#112](https://github.com/dev-fatima-24/carbonledger/issues/112)
  - Grafana and Loki integration for log aggregation and dashboarding.
- **Testing**:
  - Visual regression tests for frontend UI flows and snapshots. [#119](https://github.com/dev-fatima-24/carbonledger/issues/119)
  - Load test harness for marketplace endpoints. [#93](https://github.com/dev-fatima-24/carbonledger/issues/93)
  - Contract upgrade path verification tests for version consistency across `carbon_registry_v1` and `carbon_registry_v2`.
- **Documentation**:
  - Comprehensive docs for deployment, observability, upgrade testing, and onboarding.
  - IPFS content integrity verification documentation. [#101](https://github.com/dev-fatima-24/carbonledger/issues/101)
  - Resource optimization profiling guidance. [#52](https://github.com/dev-fatima-24/carbonledger/issues/52)

### Changed
- Improved local development documentation and exact environment requirements across README and docs.
- Updated Docker Compose service health checks and startup ordering for PostgreSQL, Redis, backend, frontend, and oracle services.
- Introduced explicit contract version upgrade tracking and on-chain upgrade path tests.
- Added alerts for oracle data staleness and submission failure rates.

### Fixed
- Resolved service startup ordering issues in the local stack. [#67](https://github.com/dev-fatima-24/carbonledger/issues/67)
- Stabilized frontend visual regression snapshots and CI integration. [#119](https://github.com/dev-fatima-24/carbonledger/issues/119)
- Added coverage for SQL injection and XSS security checks. [#424](https://github.com/dev-fatima-24/carbonledger/issues/424), [#423](https://github.com/dev-fatima-24/carbonledger/issues/423)

### Security
- Added dedicated security tests for SQL injection and cross-site scripting. [#424](https://github.com/dev-fatima-24/carbonledger/issues/424), [#423](https://github.com/dev-fatima-24/carbonledger/issues/423)
- Added security and content integrity documentation for audit readiness.

### Deprecated
- No deprecated items in this release.

### Removed
- No removed items in this release.

[Unreleased]: https://github.com/dev-fatima-24/carbonledger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dev-fatima-24/carbonledger/releases/tag/v0.1.0

<!-- Helix Ops addressed issue: Implement Access Control Lists (ACLs) for Role Management -->
