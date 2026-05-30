# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Document changelog structure and release notes for project contributors. [#377](https://github.com/dev-fatima-24/carbonledger/issues/377)
- Add `CHANGELOG.md` reference in the main README for release history.

### Changed
- Prepare release notes for the first public version and update project documentation.

### Fixed
- Improve changelog discoverability for contributors and users.

### Security
- No security-specific changes yet.

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
