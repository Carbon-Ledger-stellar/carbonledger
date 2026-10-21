# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly by emailing security@example.com. Do not open a public issue for security-sensitive reports. We will acknowledge your report within 72 hours and work with you on a coordinated disclosure.

## Secrets Management

All application secrets (database credentials, API keys, signing keys, RPC/provider tokens) are centralized in a secrets manager (HashiCorp Vault or the cloud provider's managed secrets service). Secrets are **never** committed to this repository and **never** stored as plaintext environment variables in compose files or CI configuration.

### How secrets are loaded

- **Runtime (services):** Containers fetch secrets from the secrets manager at startup via the secrets-manager agent/sidecar or the cloud provider's secret-injection mechanism. Secrets are mounted as files or injected into the process environment at runtime only — they are not baked into images or compose files.
- **CI/CD:** Workflows authenticate to the secrets manager using short-lived, OIDC-issued credentials and read the secrets they need at deploy time. No long-lived static credentials are stored in GitHub Actions secrets beyond the bootstrap identity.
- **Local development:** Developers pull secrets from the secrets manager into a local, git-ignored `.env` file using the documented helper. Never commit `.env` files.

### Compose files

`docker-compose*.yml` files must reference secrets by name only (e.g. via the `secrets:` top-level key and `secrets:` service entries) or via environment variables that are populated from the secrets manager at deploy time. Plaintext secret values must not appear in any compose file.

### Rotation

Secrets are rotated on a regular schedule and immediately upon suspected compromise. Rotation is performed in the secrets manager; consumers pick up new values on restart or via the agent's refresh mechanism.

See `secrets-management.md` for the full operational runbook covering secret provisioning, access policies, and rotation procedures.

## Supported Versions

Security fixes are applied to the latest release. Please ensure you are running a supported version before reporting an issue.
