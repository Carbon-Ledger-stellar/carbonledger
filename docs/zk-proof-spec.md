# ZK Proof Verification — Cryptographic Specification & Threat Model

**Component:** `carbon_credit` Soroban contract  
**Issue:** [#535](https://github.com/YOUR_ORG/carbonledger/issues/535)  
**Status:** Stub implementation — production circuit verifier integration pending  
**Date:** 2026-07-16

---

## 1. Purpose

Corporate buyers retiring carbon credits may not want their beneficiary identity
(a real company name or subsidiary) visible on-chain to competitors. This
document describes the ZK proof interface that allows a retiring party to prove
they know a beneficiary identity without revealing it, while still binding the
on-chain retirement record to an unforgeable commitment.

---

## 2. Data Structures

### `ZkProof`

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `commitment` | `Bytes` | 32 bytes | Pedersen commitment `C = SHA-256(identity_bytes ∥ salt)` |
| `salt` | `Bytes` | 16 bytes | Random blinding factor (≥128-bit entropy, generated client-side) |
| `proof` | `Bytes` | 64 bytes | Schnorr-style PoK: `[challenge_32 ∥ response_32]` |

### `AnonymousRetirementCertificate`

Identical to `RetirementCertificate` except `beneficiary: String` is replaced
by `beneficiary_commitment: Bytes`. The real identity never touches the ledger.

---

## 3. Cryptographic Model

### 3.1 Commitment Scheme

```
commitment = SHA-256(identity_bytes ∥ salt)
```

- **Hiding:** Given `commitment` and no knowledge of `identity_bytes` or `salt`,
  an adversary learns nothing about the beneficiary's identity.  SHA-256 is
  computationally hiding under the random oracle assumption.
- **Binding:** A prover cannot open the same `commitment` to two different
  `identity_bytes` values without finding a SHA-256 collision (2^128 classical
  security, 2^85 quantum / Grover).

### 3.2 Proof-of-Knowledge (Stub)

The current stub implements a **format check** plus a **toy Schnorr relation**:

```
response[i] = challenge[i] XOR commitment[i]   for i in 0..32
```

This is intentionally weak — it checks structural integrity and ensures the
proof was constructed with knowledge of the commitment, but it is NOT
zero-knowledge against an adversary who can observe the proof bytes.

**Production replacement:** Replace the body of `verify_zk_proof_internal` with
a call to a Groth16 or PLONK verifier using a circuit that proves:

```
KNOW (identity, salt) SUCH THAT SHA-256(identity ∥ salt) == commitment
```

Recommended libraries at integration time:
- [bellman](https://github.com/zkcrypto/bellman) (Groth16, Rust)
- [halo2](https://github.com/privacy-scaling-explorations/halo2) (PLONK, Rust)
- [arkworks](https://github.com/arkworks-rs) (multiple backends, Rust)

---

## 4. Verification Algorithm

```
VERIFY(commitment C, salt S, proof P):
  1. assert len(C) == 32             → InvalidZkProofFormat
  2. assert len(S) == 16             → InvalidZkProofFormat
  3. assert len(P) == 64             → InvalidZkProofFormat
  4. challenge  ← P[0..32]
  5. response   ← P[32..64]
  6. for i in 0..32:
       assert response[i] == challenge[i] XOR C[i]  → ZkProofVerificationFailed
  7. return true
```

State mutations happen **only after** step 6 passes — a failed proof causes no
ledger writes (fail-fast, no partial state).

---

## 5. Integration with `retire_credits`

```rust
// Standard retirement (beneficiary visible on-chain)
contract.retire_credits(holder, batch_id, amount, reason, "Acme Corp", id, tx);

// Anonymous retirement (beneficiary hidden — only commitment stored)
let proof = ZkProof {
    commitment: sha256(identity_bytes ++ salt),
    salt:       random_16_bytes(),
    proof:      schnorr_prove(commitment, challenge),
};
contract.retire_credits_anonymous(holder, batch_id, amount, reason, proof, id, tx);
```

The anonymous path emits a `zk_ret` event containing only the commitment — the
real identity string never appears in events, storage, or XDR.

To verify off-chain that a specific company retired specific credits, the company
can reveal `(identity_bytes, salt)` and any auditor can recompute
`SHA-256(identity ∥ salt)` to confirm it matches the on-chain commitment.

---

## 6. Threat Model

### 6.1 Actors

| Actor | Trust level | Goal |
|-------|-------------|------|
| Retiring corporation | Untrusted caller | Hide beneficiary from on-chain observers |
| Competitor | Adversary | Learn the beneficiary identity from chain data |
| Regulator | Trusted off-chain | Obtain identity disclosure on request |
| Validator node | Trusted for execution | Correct contract execution |

### 6.2 Threats Mitigated

| Threat | Mitigation |
|--------|------------|
| Competitor reads beneficiary from ledger | Only commitment stored on-chain; identity stays off-chain |
| Prover forges a retirement for someone else's identity | Binding commitment + PoK prevents opening commitment to wrong identity |
| Double-retirement with anonymous proofs | Retirement ID uniqueness enforced; batch serial tracking unchanged |
| Proof replay across different retirements | `retirement_id` and `batch_id` are committed to in the cert, not the proof — each cert has a unique ID |

### 6.3 Threats NOT Mitigated (out of scope)

| Threat | Note |
|--------|------|
| Traffic analysis / tx timing correlation | Infrastructure-layer concern |
| Subpoena / legal disclosure | Off-chain key management, not a contract concern |
| Stub soundness (no real ZK circuit) | Replace stub before mainnet — see §3.2 |
| Salt brute-force if identity set is small | Callers MUST use ≥128-bit random salt, not deterministic salt |

### 6.4 Quantum Resistance

SHA-256 provides ~128-bit classical security and ~85-bit quantum security
(Grover's algorithm halves the effective key length). For post-quantum
deployments, replace the commitment hash with SHA-3/SHAKE-256 (128-bit quantum)
or Poseidon (ZK-friendly, ~128-bit quantum).

---

## 7. Privacy Guarantees and Limitations

### Guarantees (when production circuit is integrated)
- **Computational hiding:** No polynomial-time adversary can recover
  `identity_bytes` from `commitment` without the salt.
- **Binding:** A dishonest prover cannot create valid proofs for two different
  identities against the same commitment.
- **On-chain anonymity:** The beneficiary name never appears in contract storage,
  events, or XDR — only a 32-byte hash.

### Limitations
1. **Stub only:** The current contract ships with a structural stub.  The toy
   XOR relation is NOT zero-knowledge — a party who observes `proof` can recover
   `challenge` and therefore learn `response XOR commitment`.  Do not use in
   production without replacing with a real circuit verifier.
2. **Salt management is off-chain:** If the caller loses the salt, they cannot
   prove their identity to a regulator.  CarbonLedger recommends encrypted
   off-chain salt storage (e.g., HSM or SEP-0030 recovery).
3. **No forward secrecy:** Once a company voluntarily discloses `(identity, salt)`
   for regulatory purposes, the link is permanent.
4. **Small identity sets:** If the set of possible beneficiaries is small (e.g.,
   Fortune 500), a brute-force dictionary attack on the commitment is feasible
   even with a proper hash — mitigate by enforcing a minimum salt entropy of
   128 bits.

---

## 8. Design Review Notes

- The `retire_credits_anonymous` function is additive — it does not alter
  the existing `retire_credits` function. Both paths are available; callers
  choose based on their privacy requirements.
- All ZK-related storage uses a separate `ZkKey::AnonymousCert` enum variant so
  anonymous and standard certificates are clearly separated in storage.
- Error codes 19 (`InvalidZkProofFormat`) and 20 (`ZkProofVerificationFailed`)
  are appended to the existing `CarbonError` enum without renumbering existing
  codes — no breaking change to existing integrations.
- The event emitted by `retire_credits_anonymous` uses symbol `zk_ret` (distinct
  from `retired`) so off-chain indexers can filter anonymous retirements
  separately.

---

## 9. References

- [Pedersen Commitments](https://link.springer.com/chapter/10.1007/3-540-46766-1_9)
- [Schnorr Identification Protocol](https://link.springer.com/article/10.1007/BF00196725)
- [Groth16 zkSNARK](https://eprint.iacr.org/2016/260)
- [PLONK](https://eprint.iacr.org/2019/953)
- [Zcash Sapling — anonymous note commitment](https://zips.z.cash/protocol/sapling.pdf)
- [SHA-256 NIST FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
