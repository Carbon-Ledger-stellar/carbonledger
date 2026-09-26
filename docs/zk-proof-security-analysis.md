# ZK Retirement Proof — Security Analysis

**Related:** [`zk-proof-spec.md`](./zk-proof-spec.md), issue #689  
**Date:** 2026-07-27

---

## 1. What is revealed vs hidden

| Data | Public certificate | Private ZK certificate |
|------|--------------------|------------------------|
| Beneficiary name | Revealed | **Hidden** (Poseidon commitment) |
| Project / methodology | Revealed | **Hidden** (private witness) |
| Amount (tonnes) | Revealed | **Hidden** |
| Serial range | Revealed | **Hidden** (order constrained only) |
| Retirement UUID | Revealed | **Hidden** (nullifier = Poseidon(id, salt)) |
| Retiring wallet | Often visible on-chain | Bound via `retiredByHash` (Poseidon of encoded key) |
| Proof bytes | N/A | Revealed (Groth16 π) |

Anyone with the private certificate JSON can verify the proof against the
published verification key and learn the three public signals above — nothing
else from the witness.

---

## 2. Trusted setup requirements

Groth16 requires a circuit-specific trusted setup. **Development artifacts**
shipped from `scripts/zk/trusted-setup.sh` are a **single-contributor**
ceremony:

- Toxic waste is not securely destroyed across independent parties.
- A malicious setup actor could forge proofs for this circuit.

**Before mainnet:**

1. Run a multi-party computation (MPC) ceremony (or reuse an audited
   Powers-of-Tau + circuit-specific contribution with public transcripts).
2. Publish contribution hashes and verification procedures.
3. Embed only the resulting VK in `carbon_zk_verifier::initialize`.
4. Rotate / redeploy if the ceremony is compromised.

Until then, treat all proofs as **testnet / demo only**.

---

## 3. Soundness & zero-knowledge (assumptions)

- **Soundness:** Groth16 over BLS12-381 under the q-PKE / algebraic group model
  assumptions used by snarkjs; pairing checks via Soroban CAP-0059 host
  functions.
- **ZK:** Honest-verifier zero-knowledge for Groth16; salt must have ≥128 bits
  entropy so commitments/nullifiers are unpredictable.

---

## 4. Replay / nullifier

`nullifier = Poseidon(retirementId, salt)` is unique per (retirement, salt).
The DB enforces uniqueness on `ZkRetirementProof.nullifier`. Re-issuing the
same retirement with a new salt produces a different nullifier — product
policy currently refuses a second proof per retirement (`ConflictException`)
to keep one canonical private certificate.

---

## 5. Authorization binding

- NestJS endpoint requires authenticated `corporation|admin` and
  `retiredBy === req.user.publicKey` (same IDOR pattern as `GET :id`).
- Circuit binds `retiredByHash` so a proof generated for wallet A cannot be
  presented as binding to wallet B without breaking the proof.
- **Limitation:** Ed25519 signature verification is **not** inside the circuit.
  A compromised API session for the owner can still generate a valid proof.

---

## 6. Dictionary / small-set risk

If an adversary knows a short list of possible beneficiaries and the salt
leaks, they can recompute Poseidon commitments. Mitigations: high-entropy salt
(server-generated), never log salt/beneficiary, treat certificate JSON as
sensitive.

Field encoding uses SHA-256→Fr; collisions are negligible for practical
string spaces but encoding is **not** a second commitment scheme.

---

## 7. What is not mitigated (v1)

- No on-chain **Merkle membership** of all retirements — existence is trusted
  to the backend at prove-time.
- No in-circuit **Ed25519** wallet ownership proof.
- Timing side channels on the API/prover host.
- Legal compulsion / subpoena of DB records (ZK does not erase server copies).
- Quantum attacks on bilinear pairings / hashes (same class as other Groth16
  deployments).
- Compromised or single-party trusted setup (see §2).

---

## 8. Operational checklist

- [ ] Multi-party ceremony completed and VK audited
- [ ] Salt and witness temp files wiped after prove
- [ ] Logs scrubbed of beneficiary / salt
- [ ] Optional on-chain `verify_proof` call recorded (`verifiedOnChain`)
- [ ] Public docs link to this analysis from any “private certificate” UI
