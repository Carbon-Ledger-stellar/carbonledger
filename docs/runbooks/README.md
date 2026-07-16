# Incident Response Runbooks

Runbooks for CarbonLedger production incidents. Each runbook follows the same structure: **Detection → Containment → Recovery → Post-mortem**.

## Runbooks

| # | Scenario | Severity | Runbook |
|---|---|---|---|
| 1 | Oracle failure | High | [oracle-failure.md](oracle-failure.md) |
| 2 | Contract exploit detected | Critical | [contract-exploit.md](contract-exploit.md) |
| 3 | Double-counting alert | Critical | [double-counting.md](double-counting.md) |
| 4 | Database corruption | High | [database-corruption.md](database-corruption.md) |
| 5 | Key compromise | Critical | [key-compromise.md](key-compromise.md) |
| 6 | Contract upgrade | High | [contract-upgrade.md](contract-upgrade.md) |

## Supporting Docs

- [contacts.md](contacts.md) — On-call contacts per incident type
- [escalation.md](escalation.md) — Escalation path and SLA thresholds

## Severity Definitions

| Level | Response time | Examples |
|---|---|---|
| **Critical** | Immediate / 24×7 | Exploit, double-counting, key compromise |
| **High** | < 1 hour business hours, < 2 hours off-hours | Oracle failure, DB corruption |
| **Medium** | < 4 hours | Degraded performance, stale price feeds |

## General Principles

1. **Contain first, investigate second.** Stop the bleeding before root-causing.
2. **Never delete on-chain data.** Stellar ledger entries are immutable; focus on off-chain containment.
3. **Communicate early.** Notify stakeholders within 15 minutes of a Critical incident, even if the cause is unknown.
4. **Document everything.** Open a timestamped incident channel immediately and log every action taken.
