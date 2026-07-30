# Escalation Path

---

## Escalation Tiers

```
Tier 1 — On-call engineer (automated alert or self-detected)
    │  No resolution within SLA threshold ↓
Tier 2 — Team lead for the affected domain
    │  No resolution within SLA threshold ↓
Tier 3 — CTO + Security Lead (Critical) / Engineering Manager (High)
    │  Regulatory / legal impact ↓
Tier 4 — Legal/Compliance + external disclosure
```

---

## SLA Thresholds by Severity

| Severity | Tier 1 response | Escalate to Tier 2 | Escalate to Tier 3 |
|---|---|---|---|
| **Critical** | Immediate (page 24×7) | 15 minutes | 30 minutes |
| **High** | < 1 hour (business hours) / < 2 hours (off-hours) | 1 hour | 2 hours |
| **Medium** | < 4 hours | 4 hours | Next business day |

---

## Escalation by Incident Type

### Oracle Failure (High)

```
Oracle Engineer
  → (> 1 hr unresolved) Backend Lead
  → (> 2 hr unresolved) CTO
  → (regulatory data gap) Legal/Compliance
```

### Contract Exploit (Critical)

```
Security Lead + Contracts Lead  ← page simultaneously
  → (> 15 min) CTO
  → (user funds at risk) Legal/Compliance + public disclosure
  → (Soroban runtime bug) Stellar Development Foundation
```

### Double-Counting Alert (Critical)

```
Contracts Lead
  → (> 15 min) CTO + Registry Integrity
  → (confirmed fraud) Legal/Compliance + affected verifier
  → (external registry overlap) Verra VCS / Gold Standard
```

### Database Corruption (High)

```
Backend Lead / Infrastructure
  → (> 1 hr unresolved) CTO
  → (data loss confirmed) Legal/Compliance (assess notification obligations)
```

### Key Compromise (Critical)

```
Security Lead  ← page immediately
  → (> 15 min) CTO
  → (user data exposed) Legal/Compliance + user notification
  → (admin key) Stellar Development Foundation
```

---

## Incident Channel Protocol

1. Open `#incident-YYYY-MM-DD-<short-description>` in Slack immediately.
2. Pin the incident start time (UTC) and the on-call engineer's name.
3. Post a status update every **15 minutes** for Critical, every **30 minutes** for High.
4. Do not close the channel until the post-mortem is published.

---

## Post-mortem Requirements

All Critical and High incidents require a written post-mortem within **48 hours** of resolution, covering:

- Timeline (UTC timestamps)
- Root cause
- Impact (users affected, credits at risk, downtime duration)
- Containment and recovery actions taken
- Action items with owners and due dates

Post-mortems are filed as GitHub issues tagged `post-mortem` and linked from the incident channel.
