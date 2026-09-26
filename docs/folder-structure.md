# CarbonLedger — Folder Structure

> This is the authoritative reference for the repository layout. When the README "Project Structure" section and this file conflict, this file takes precedence.
>
> ← Back to [README](../README.md)

```
carbonledger/
├── .github/                        # GitHub configuration: CI/CD workflows, issue templates, and PR template
│   ├── ISSUE_TEMPLATE/             # Bug report and feature request templates
│   └── workflows/                  # GitHub Actions pipelines (CI, staging, nightly, security scans)
├── AETHER_SOLUTIONS/               # Internal issue-tracking notes and solution write-ups
├── audit/                          # Pre-audit checklist and security review artifacts
├── backend/                        # NestJS REST API: auth, projects, credits, retirements, marketplace, oracle
│   ├── prisma/
│   │   └── schema.prisma           # Prisma database schema — defines all PostgreSQL models and relations
│   └── src/                        # NestJS modules (auth, admin, certificates, marketplace, etc.)
├── components/                     # Shared UI components used outside the Next.js app directory
│   └── ui/                         # Reusable primitive UI elements
├── circuits/                       # Circom ZK circuits (private retirement certificates, BLS12-381 Groth16)
│   └── retirement_private_cert/    # Poseidon commitment / nullifier circuit + snarkjs artifacts
├── contracts/                      # Soroban smart contracts written in Rust
│   ├── carbon_credit/              # Mint, transfer, and permanently retire tokenized carbon credits
│   ├── carbon_marketplace/         # Credit listings, purchases, and bulk corporate buying
│   ├── carbon_oracle/              # Receives and validates off-chain monitoring and price data
│   ├── carbon_registry/            # Carbon project registration, verification, and lifecycle status
│   ├── carbon_registry_v1/         # Legacy v1 registry contract (kept for upgrade path testing)
│   ├── carbon_registry_v2/         # Registry v2 used in upgrade path tests
│   ├── carbon_zk_verifier/         # Groth16 BLS12-381 verifier for private retirement certificates
│   └── Cargo.toml                  # Rust workspace manifest — declares all Soroban contract crates
├── docs/                           # Project documentation (guides, ADRs, runbooks, API references)
│   ├── adr/                        # Architecture Decision Records
│   └── runbooks/                   # Operational runbooks for incidents and deployments
├── frontend/                       # Next.js 14 (App Router) web application
│   ├── app/                        # Next.js route segments (marketplace, audit, dashboard, etc.)
│   ├── components/                 # React components scoped to the frontend app
│   ├── lib/                        # Stellar SDK helpers, Soroban client, Freighter wallet utilities
│   └── styles/                     # Design system tokens and global styles
├── hooks/                          # Shared React hooks used across the monorepo
├── infra/                          # Infrastructure-as-code (Terraform) for cloud provisioning
│   ├── bootstrap/                  # One-time bootstrap resources (state bucket, IAM)
│   └── main/                       # Main Terraform configuration for all environments
├── load-tests/                     # k6 load test scripts and results for the marketplace API
├── logging/                        # Observability stack configuration (Loki, Promtail, Grafana)
│   ├── grafana/                    # Grafana dashboard definitions
│   ├── loki/                       # Loki log aggregation configuration
│   └── promtail/                   # Promtail log shipping configuration
├── oracle/                         # Python oracle bridge: verification listener, price feeds, satellite monitor
├── scripts/                        # Developer utility scripts: setup, deploy, test runners, DB backup, ZK prove helpers
├── tests/                          # Cross-contract and upgrade path integration tests (Rust)
├── .env.example                    # Environment variable template — copy to .env before running locally
├── .env.staging.example            # Staging-specific environment variable template
├── docker-compose.yml              # Local development stack: PostgreSQL, Redis, backend, frontend, oracle, observability
├── docker-compose.prod.yml         # Production Docker Compose overrides
├── docker-compose.staging.yml      # Staging Docker Compose overrides
├── Stellar.toml                    # SEP-0001 metadata file — describes this project to the Stellar network
└── README.md                       # Primary entry point for the repository
```

## Directory Descriptions

| Directory / File | Purpose |
|---|---|
| `.github/` | GitHub configuration: CI/CD workflows, issue templates, and PR template |
| `AETHER_SOLUTIONS/` | Internal issue-tracking notes and solution write-ups |
| `audit/` | Pre-audit checklist and security review artifacts |
| `backend/` | NestJS REST API — auth, projects, credits, retirements, marketplace, oracle modules |
| `backend/prisma/schema.prisma` | Prisma database schema — defines all PostgreSQL models and relations |
| `components/` | Shared UI components used outside the Next.js app directory |
| `circuits/` | Circom ZK circuits for private retirement certificates (BLS12-381 Groth16) |
| `contracts/` | Soroban smart contracts written in Rust |
| `contracts/carbon_zk_verifier/` | On-chain Groth16 verifier (CAP-0059 / BLS12-381) for private certificates |
| `contracts/Cargo.toml` | Rust workspace manifest — declares all Soroban contract crates |
| `docs/` | Project documentation: guides, ADRs, runbooks, API references |
| `frontend/` | Next.js 14 (App Router) web application |
| `hooks/` | Shared React hooks used across the monorepo |
| `infra/` | Infrastructure-as-code (Terraform) for cloud provisioning |
| `load-tests/` | k6 load test scripts and results for the marketplace API |
| `logging/` | Observability stack configuration: Loki, Promtail, Grafana |
| `oracle/` | Python oracle bridge: verification listener, price feeds, satellite monitor |
| `scripts/` | Developer utility scripts: setup, deploy, test runners, DB backup, ZK prove helpers |
| `tests/` | Cross-contract and upgrade path integration tests (Rust) |
| `.env.example` | Environment variable template — copy to `.env` before running locally |
| `docker-compose.yml` | Local development stack definition — starts all services with a single command |
| `Stellar.toml` | SEP-0001 metadata file — describes this project to the Stellar network |
