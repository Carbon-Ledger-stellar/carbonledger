# Incident Contacts

> **Keep this file up to date.** Stale contacts are as bad as no contacts.  
> Last reviewed: 2026-04-25

---

## On-Call Rotation

| Role | Primary | Backup | Contact |
|---|---|---|---|
| Backend / Infrastructure | Backend Lead | Senior Backend Engineer | Slack `#oncall` · PagerDuty |
| Smart Contracts | Contracts Lead | Senior Rust Engineer | Slack `#oncall` · PagerDuty |
| Oracle / Data | Oracle Engineer | Backend Lead | Slack `#oncall` |
| Security | Security Lead | CTO | Slack `#security-incidents` (private) |

---

## Contact by Incident Type

### Oracle Failure
- **Primary:** Oracle Engineer
- **Escalate to:** Backend Lead → CTO
- **External:** Stellar Developer Discord (`#soroban-help`), Stellar support (support@stellar.org)

### Contract Exploit
- **Primary:** Security Lead + Contracts Lead (page both simultaneously)
- **Escalate to:** CTO immediately
- **External:** Stellar Development Foundation security team (security@stellar.org), smart contract auditor on retainer

### Double-Counting Alert
- **Primary:** Contracts Lead + Registry Integrity contact
- **Escalate to:** CTO + Legal/Compliance
- **External:** Affected verifier organisation, Verra VCS (if methodology overlap), Gold Standard

### Database Corruption
- **Primary:** Backend Lead / Infrastructure
- **Escalate to:** CTO
- **External:** PostgreSQL support (if managed DB: AWS RDS / Supabase support ticket)

### Key Compromise
- **Primary:** Security Lead (page immediately, any hour)
- **Escalate to:** CTO + Legal/Compliance
- **External:** Stellar Development Foundation (if admin key), affected users (if JWT), Pinata support (if IPFS key)

---

## External Contacts

| Organisation | Purpose | Contact |
|---|---|---|
| Stellar Development Foundation | Protocol security, Soroban bugs | security@stellar.org |
| Verra VCS | Methodology / registry disputes | https://verra.org/contact |
| Gold Standard | Methodology / registry disputes | https://goldstandard.org/contact |
| Pinata | IPFS key rotation | https://app.pinata.cloud/support |
| Smart contract auditor | Exploit analysis, patch review | *(add retainer contact)* |
| Legal / Compliance counsel | Regulatory notification obligations | *(add firm contact)* |

---

## Communication Templates

### Initial stakeholder notification (Critical, < 15 min)

> **[INCIDENT]** We are investigating a [brief description] affecting CarbonLedger. The team is actively responding. Further updates in 30 minutes. No action required from users at this time.

### Resolution notification

> **[RESOLVED]** The [incident type] has been resolved as of [UTC time]. [One sentence on impact and fix]. A full post-mortem will be published within 48 hours.
