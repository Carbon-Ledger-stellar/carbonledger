# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial setup for Oracle Layer (Phase 2).
- Verification listener service skeleton.
- Price oracle service skeleton.
- Satellite monitor service skeleton.

## [0.1.0] - 2026-04-26

### Added
- **Smart Contracts (Phase 1)**:
    - `carbon_registry`: Project registration and verification logic.
    - `carbon_credit`: Minting, retiring, and transferring carbon credits with serial numbers.
    - `carbon_marketplace`: Listing, purchasing, and bulk purchase functionality.
    - `carbon_oracle`: Infrastructure for monitoring data and price feeds.
- **Testing**:
    - 30 Rust unit tests covering core contract logic.
- **Deployment**:
    - Initial deployment to Stellar Testnet.
- **Documentation**:
    - Comprehensive README, Contributing guide, and Quick Start guides.
    - Architecture Decision Records (ADRs).
