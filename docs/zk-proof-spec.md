# ZK Proof of Retirement — Implementation Spec

**Component:** Circom circuit + `carbon_zk_verifier` + NestJS + CLI + frontend  
**Issue:** [#689](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/689)  
**Status:** Implemented (dev trusted setup — not mainnet-ready)  
**Date:** 2026-07-27

---

## 1. Purpose

Corporate buyers can prove they retired carbon credits **without revealing**
beneficiary name, project identity, tonne amount, or serial range — while still
producing a verifiable Groth16 certificate bound to the retiring wallet.

Companion threat model: [`zk-proof-security-analysis.md`](./zk-proof-security-analysis.md).

---

## 2. Toolchain choice (Soroban compatibility)

| Option | On-chain on Stellar |
|--------|---------------------|
| Circom/snarkjs **BN254** (default) | No (needs CAP-0074) |
| Circom/snarkjs **BLS12-381** (`-p bls12381`) | Yes via CAP-0059 / `env.crypto().bls12_381()` |
| arkworks circuit alone | Possible; Circom is the documented Stellar path |

**Decision:** Circom 2 + snarkjs Groth16 over **BLS12-381** for the circuit and
trusted setup. `ark-bls12-381` / `ark-serialize` are used only in
`carbon_zk_verifier` **tests** to map uncompressed G1/G2 points into Soroban
types (same pattern as
[stellar/soroban-examples/groth16_verifier](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier)).

The legacy XOR stub previously in `carbon_credit::verify_zk_proof_internal` was
removed from `main`; production verification targets `carbon_zk_verifier` only.

---

## 3. Circuit: `retirement_private_cert`

Path: `circuits/retirement_private_cert/retirement_private_cert.circom`

### Private inputs
`beneficiary`, `salt`, `retirementId`, `amount`, `projectId`, `serialStart`,
`serialEnd`, `retiredBy` (all field elements; strings are SHA-256→Fr encoded
off-circuit via `scripts/zk/field-encode.js`).

### Public outputs
1. `beneficiaryCommitment` = Poseidon(beneficiary, salt)
2. `nullifier` = Poseidon(retirementId, salt)
3. `retiredByHash` = Poseidon(retiredBy)

### Constraints
- `amount > 0`
- `serialEnd >= serialStart`
- Poseidon linkages above

**Wallet control:** API requires `retiredBy === req.user.publicKey` (or admin)
before proving. Full Ed25519-in-circuit is out of scope for v1.

**Existence of retirement:** enforced at prove-time by loading Prisma
`RetirementRecord` (no on-chain Merkle registry yet).

---

## 4. Verifier contract: `carbon_zk_verifier`

- Workspace member: `contracts/carbon_zk_verifier/` (soroban-sdk **25.3+** for
  CAP-0059 BLS host types; other contracts remain on 21.x in this PR)
- `initialize(vk)` — store Groth16 verification key
- `verify_proof(proof, pub_signals) -> bool`
- `verify_with_vk(...)` — stateless helper for tests

Public signal order: `[beneficiaryCommitment, nullifier, retiredByHash]`.

---

## 5. CLI

```bash
./scripts/generate-retirement-proof.sh --retirement-id <id> --secret <S>
./scripts/generate-retirement-proof.sh --witness.json ./record.json
```

Build pipeline:

```bash
bash scripts/zk/compile-circuit.sh   # requires circom
bash scripts/zk/trusted-setup.sh     # DEV ceremony only
bash scripts/zk/prove-fixture.sh     # snarkjs verify smoke test
```

Beneficiary is never printed to stdout.

---

## 6. Backend

- Prisma model `ZkRetirementProof`
- `POST /api/v1/retirements/:id/zk-proof` — corporation/admin, IDOR-checked,
  invokes CLI, stores proof (no raw beneficiary in response)
- `GET /api/v1/retirements/:id/zk-proof` — re-fetch stored certificate

---

## 7. Frontend

Retirement detail (`frontend/app/retire/[id]/page.tsx`): **Generate Private
Certificate** button → shows commitment / nullifier / wallet hash + JSON download.

---

## 8. Legacy stub

`carbon_credit` no longer ships the SHA-256 commitment + XOR PoK stub. Private
retirement certificates MUST use the Groth16 path in `carbon_zk_verifier`.

---

## 9. Artifact warning

Files under `circuits/retirement_private_cert/artifacts/` from
`trusted-setup.sh` are **single-contributor**. See
`artifacts/DEV_TRUSTED_SETUP_WARNING.md` and the security analysis before any
mainnet VK embed.
