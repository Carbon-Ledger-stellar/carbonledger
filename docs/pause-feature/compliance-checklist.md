# Pause Feature Compliance Checklist

Closes #1328.

This checklist covers the security, privacy and regulatory requirements for
the emergency pause feature:

- the `pause_operations` / `unpause_operations` entry points in the
  `carbon_credit` and `carbon_marketplace` contracts,
- the backend `PauseService` and the `/admin/contracts/:contract/(un)pause` routes,
- the audit logs, traces and webhooks that a pause produces.

Complete it before a release that changes any of these. Record the reviewer and
date for each section in the sign-off table at the end.

Legend: **[x]** the codebase meets this today. **[ ]** confirm or complete it per
deployment.

---

## 1. Personal data processed by a pause

| Data | Where it appears | Classification |
| --- | --- | --- |
| Admin Stellar public key | Contract call args, `AuditLog.userId`, trace attribute `carbonledger.admin`, webhook payload `admin`, structured logs | Pseudonymous identifier (personal data under GDPR if linkable to a person) |
| Requester IP address | HTTP request logs, HTTP spans | Personal data |
| Contract id, tx hash, pause window | Everywhere above | Not personal data |

A pause processes no end-user (buyer, developer, verifier) data. The only data
subjects are the platform administrators who trigger it.

## 2. GDPR

- [x] **Lawful basis.** Legitimate interest (Art. 6(1)(f)): protecting the platform
  and its users during an incident. It also supports the security-of-processing
  obligation (Art. 32).
- [x] **Data minimisation.** Only the admin public key is recorded. No names,
  e-mails or free-text reasons are stored with the pause.
- [ ] **Transparency.** The admin/staff privacy notice states that privileged
  actions are logged with the operator's public key and IP address.
- [ ] **Right of access / erasure.** On an erasure request, redact the admin key
  from traces and application logs. The on-chain record and the hash-chained
  `AuditLog` cannot be erased. Document this as a legal-obligation / legal-claims
  exemption (Art. 17(3)(b)/(e)) in the staff privacy notice.
- [ ] **Processors.** Jaeger, the log aggregator and every webhook subscriber
  endpoint that receives `contract.paused` / `contract.unpaused` are listed in the
  record of processing activities (Art. 30). DPAs are in place where the
  recipient is a third party.
- [ ] **International transfers.** Trace and log storage regions are recorded. A
  transfer outside the EEA has an adequacy decision or SCCs.
- [x] **Public-ledger disclosure.** The pause transaction, including the admin
  address, is public and permanent on Stellar. Admin keys are operational keys
  and are not tied to personal wallets.

## 3. SOC 2 (Trust Services Criteria)

| Criterion | Control | Status |
| --- | --- | --- |
| CC6.1 Logical access | `@Roles('admin')` global guard + `PoliciesGuard` (`update` on `all`) on the backend. `require_role(Role::Admin)` + `require_auth()` in the contract. | [x] |
| CC6.2 Access provisioning | Admin role grants go through `POST /admin/users/:publicKey/role` and are themselves audited | [x] |
| CC6.3 Least privilege | Only the admin role can pause. Verifiers, developers and corporations cannot. | [x] |
| CC7.2 Monitoring | Every pause emits a trace (`pause.*` spans), a structured log line and a webhook | [x] |
| CC7.3 Incident evaluation | A pause is tied to an incident ticket per `docs/INCIDENT_RESPONSE.md` | [ ] |
| CC7.4 Incident response | Runbook `docs/runbooks/contract-exploit.md` references the pause endpoints | [ ] |
| CC8.1 Change management | Contract changes to pause logic follow `docs/UPGRADE_GUIDE.md` and need two reviewers | [ ] |
| A1.2 Availability | The pause window is bounded to 72h on-chain and expires automatically, so a lost admin key cannot freeze the platform indefinitely | [x] |

Evidence to retain for the auditor for each pause:
- [ ] The `AuditLog` entry (action `contract.pause` / `contract.unpause`) and its hash-chain verification result
- [ ] The Stellar transaction hash
- [ ] The Jaeger trace (export JSON, since Jaeger's default storage is not durable)
- [ ] The incident ticket and approver

## 4. Audit logging requirements

- [x] Each pause and unpause writes an `AuditLog` row with the actor
  (`userId`), action, contract id (`resourceId`), result, tx hash, resulting
  state (`after`) and trace id (`metadata.traceId`).
- [x] `AuditLog` rows are SHA-256 hash-chained (`previousHash` / `entryHash`),
  so edits or deletions are detectable.
- [x] The audit row is written only after the on-chain call succeeds, so the log
  never records a pause that did not happen.
- [ ] Failed pause attempts are visible. Today they appear as `ERROR` spans and
  error log lines, but not in `AuditLog`. Decide whether SOC 2 scope requires a
  `Failure:` audit row, and add one if so.
- [ ] On-chain state is the source of truth. Reconcile `AdminConfig`
  `<contract>_paused` against the contract after every incident.
- [x] Audit logs are read-only through the API (`GET /admin/audit-logs`,
  `AuditLogSubject` read policy).

## 5. Data retention requirements

| Record | Retention | Mechanism | Status |
| --- | --- | --- | --- |
| `AuditLog` pause entries | 7 years | `AuditService` (`RETENTION_DAYS = 7 * 365`) + `AuditArchiveService` | [x] |
| On-chain pause transaction | Permanent | Stellar ledger | [x] |
| `AdminConfig` pause state | Overwritten on each change (current state only) | Upsert | [x] |
| Jaeger traces | Deployment dependent. The all-in-one image stores traces in memory and loses them on restart. | Jaeger storage backend | [ ] Configure durable storage with a defined TTL (e.g. 30 days), or export pause traces to the incident record |
| Application logs | Per log-aggregation policy (`docs/pr-log-aggregation.md`) | Log pipeline | [ ] Confirm the TTL matches the privacy notice |
| Webhook delivery logs | Per `WebhookDeliveryLog` retention job | Retention service | [ ] |

- [ ] Retention of personal data in traces and logs is no longer than needed,
  and shorter than audit-log retention.

## 6. Access control requirements

- [x] Pause and unpause need an authenticated JWT with the `admin` role.
- [x] The contract independently verifies `admin.require_auth()` and the
  on-chain `Admin` role. A compromised backend cannot pause without a valid
  admin signature.
- [x] The pause window is validated twice: in the backend (fail fast, ≤ 72h) and
  in the contract (`InvalidPauseWindow`).
- [x] Read access to pause state (`GET /admin/contracts/:contract/pause`) is limited to admins.
- [ ] Admin signing keys are held in an HSM, multisig or secrets manager, and
  rotated per `docs/KEY_ROTATION_PROCEDURES.md`.
- [ ] Two-person rule: a second admin approves each pause outside an active
  incident (process control).
- [ ] 2FA is enforced for admin accounts (`two-factor` module).
- [ ] Admin role membership is reviewed quarterly.

## 7. Encryption requirements

- [ ] **In transit.** API traffic is TLS 1.2+ only. OTLP export to Jaeger or the
  collector uses TLS when it crosses a network boundary (not required on a
  private docker network). Webhook subscriber URLs are HTTPS (enforced by DTO
  validation).
- [x] **Webhook integrity.** `contract.paused` / `contract.unpaused` deliveries
  are HMAC-signed with the subscription secret (see
  `docs/WEBHOOK_VERIFICATION_EXAMPLES.md`).
- [ ] **At rest.** The PostgreSQL volume (`AuditLog`, `AdminConfig`) and the trace
  and log stores use disk or volume encryption (e.g. RDS/EBS KMS).
- [ ] **Keys.** Admin signing keys and webhook secrets are stored in the secrets
  manager, never in `.env` in production (`docs/secrets-management.md`).
- [x] **On-chain.** Transactions are signed with Ed25519 by the Stellar protocol.

## 8. Operational and regulatory

- [ ] Stakeholders (registries, marketplace participants) are notified of any
  pause longer than 1h. Subscribing them to the `contract.paused` webhook covers
  this.
- [ ] If the platform operates under a carbon-registry agreement or financial
  regulation, confirm whether halting trading must be reported to that body and
  within what time.
- [ ] Post-incident review is completed and linked from the audit entry.

---

## Sign-off

| Section | Reviewer | Date | Notes |
| --- | --- | --- | --- |
| GDPR | | | |
| SOC 2 | | | |
| Audit logging | | | |
| Data retention | | | |
| Access control | | | |
| Encryption | | | |
