# Pause Feature Documentation

Cross-stack documentation for the emergency pause on the `carbon_credit` and `carbon_marketplace` Soroban contracts.

| Document | Purpose |
|---|---|
| [SPECIFICATION.md](./SPECIFICATION.md) | Requirements, architecture, contract/API/DB/UI specs, security and performance requirements |
| [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md) | 80-item QA checklist across contract, API, frontend, integration, performance and security |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) | Pre-deployment gate, monitoring, and rollback procedures |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Release notes for admins, users and integrators |

Source of truth: `pause_operations`, `unpause_operations` and `require_not_paused` in
`contracts/carbon_credit/src/lib.rs` and `contracts/carbon_marketplace/src/lib.rs`.
