# ADR-007: MultiSig Contract Upgrade

## Status
Accepted

## Context
The `carbon_registry` contract previously allowed a single `RegistryAdmin` key to
authorize WASM upgrades, creating a critical single point of failure. A compromised
admin key could silently replace the contract logic and alter project verification
status, undermining the integrity of the entire carbon credit registry.

## Decision
Replace the single-admin upgrade path with an opt-in multi-signer proposal/approval
flow:

- `initialize_multisig(signers, threshold)` — admin configures the signer set and
  approval threshold (e.g., 2-of-3).
- `propose_upgrade(wasm_hash)` — any registered signer creates a pending
  `UpgradeProposal`; the proposer's approval is counted automatically.
- `approve_upgrade(proposal_id)` — additional signers approve; once
  `approvals.len() >= threshold` the WASM upgrade executes atomically.
- `cancel_upgrade(proposal_id)` — any signer can cancel a pending proposal.

### Expiry window
Proposals expire after **518,400 ledgers** (approximately 72 hours at the Stellar
average of ~5 s/ledger). An `approve_upgrade` call on an expired proposal returns
`ProposalExpired`, ensuring stale proposals cannot be resurrected.

### Backward compatibility
The original single-admin `upgrade()` entry point is preserved. If `MultiSigConfig`
has not been set, the contract still supports single-admin upgrades so existing
deployments are unaffected.

## Error codes added
| Code | Name             |
|------|------------------|
| 23   | ProposalNotFound |
| 24   | ProposalExpired  |
| 25   | DuplicateApproval|
| 26   | ThresholdNotMet  |

## Consequences
- No single compromised key can silently upgrade the production registry.
- Upgrade coordination requires multiple keyholders to act within a 72-hour window.
- Slightly more complex upgrade workflow, mitigated by clear entry points and events.
- Proposer's approval is auto-counted to avoid a redundant second transaction.
