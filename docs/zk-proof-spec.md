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

---

## 10. End-to-end tutorial: generate and submit a proof

This section walks through the full lifecycle: build the circuit, run the dev
trusted setup, generate a proof, and submit it to `carbon_zk_verifier` (both
directly and via the backend API).

> ⚠️ The trusted setup produced here is a **single-contributor dev ceremony**.
> Do not use these artifacts for mainnet. See §9.

### 10.1 Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| `circom` | **2.2+** | `cargo install --git https://github.com/iden3/circom.git --tag v2.2.0` or prebuilt binary |
| `node` / `npm` | Node 18+ | snarkjs is installed via `npm` |
| `snarkjs` | latest | `npm install -g snarkjs` (or use the repo-local install) |
| `bash` | any | scripts are POSIX-ish bash |
| Rust / `soroban` CLI | for contract calls | only needed to submit on-chain |

Verify your toolchain:

```bash
circom --version      # must print 2.2.x or newer
node --version        # >= 18
snarkjs --version
```

### 10.2 Step 1 — Compile the circuit

From the repo root:

```bash
bash scripts/zk/compile-circuit.sh
```

This compiles `circuits/retirement_private_cert/retirement_private_cert.circom`
with the **BLS12-381** prime (`-p bls12381`) and writes the R1CS + WASM
witness generator into `circuits/retirement_private_cert/build/`:

```
build/retirement_private_cert.r1cs
build/retirement_private_cert_js/retirement_private_cert.wasm
```

### 10.3 Step 2 — Trusted setup (DEV ONLY)

```bash
bash scripts/zk/trusted-setup.sh
```

Produces the Groth16 proving/verifying keys under
`circuits/retirement_private_cert/artifacts/`:

```
artifacts/retirement_private_cert_final.zkey
artifacts/verification_key.json
```

Read `artifacts/DEV_TRUSTED_SETUP_WARNING.md` before proceeding. For a real
deployment you must run a multi-party ceremony and embed the resulting VK.

### 10.4 Step 3 — Smoke-test the pipeline

```bash
bash scripts/zk/prove-fixture.sh
```

This generates a proof for the bundled fixture witness, runs
`snarkjs groth16 verify`, and exits non-zero on failure. If this passes, your
toolchain and artifacts are consistent.

### 10.5 Step 4 — Generate a proof for a real retirement

Two input modes are supported by `scripts/generate-retirement-proof.sh`:

**A. By retirement ID (fetches the record, prompts for the secret):**

```bash
./scripts/generate-retirement-proof.sh --retirement-id <id> --secret <S>
```

**B. From a prepared witness JSON (offline / CI):**

```bash
./scripts/generate-retirement-proof.sh --witness.json ./record.json
```

The witness JSON must contain the private inputs described in §3. Strings are
field-encoded with `scripts/zk/field-encode.js` (SHA-256 → Fr). Example:

```json
{
  "beneficiary": "Acme Corp",
  "salt": "0x1f3a...",
  "retirementId": "ret_123",
  "amount": 500,
  "projectId": "VCS-1234",
  "serialStart": 1000,
  "serialEnd": 1499,
  "retiredBy": "GABC...XYZ"
}
```

The script writes a proof bundle to the output directory (default
`./proof-output/`):

```
proof-output/proof.json     # Groth16 proof (pi_a, pi_b, pi_c)
proof-output/public.json    # public signals, in order
```

`public.json` is an array in the fixed order
`[beneficiaryCommitment, nullifier, retiredByHash]`. The raw beneficiary is
**never** written to stdout or to these files.

### 10.6 Step 5 — Submit to `carbon_zk_verifier`

#### Option A — via the backend API (recommended)

The backend loads the `RetirementRecord`, enforces wallet control
(`retiredBy === req.user.publicKey` or admin), invokes the CLI, stores the
proof, and returns the certificate (without the raw beneficiary):

```bash
curl -X POST https://api.example.com/api/v1/retirements/<id>/zk-proof \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"secret": "<S>"}'
```

Response (abridged):

```json
{
  "retirementId": "ret_123",
  "beneficiaryCommitment": "0x...",
  "nullifier": "0x...",
  "retiredByHash": "0x...",
  "proof": { "pi_a": [...], "pi_b": [...], "pi_c": [...] },
  "publicSignals": ["0x...", "0x...", "0x..."]
}
```

Re-fetch a stored certificate with:

```bash
curl https://api.example.com/api/v1/retirements/<id>/zk-proof \
  -H "Authorization: Bearer <JWT>"
```

#### Option B — directly against the contract

If you already have `proof.json` and `public.json` from Step 4, you can call the
verifier contract directly. The contract's `verify_proof(proof, pub_signals)`
expects the proof points as uncompressed BLS12-381 G1/G2 values and the public
signals in the order `[beneficiaryCommitment, nullifier, retiredByHash]`.

```bash
# Pseudocode — adapt to your soroban CLI invocation / SDK bindings
soroban contract invoke \
  --id <CARBON_ZK_VERIFIER_CONTRACT_ID> \
  --fn verify_proof \
  -- \
  --proof "$(cat proof-output/proof.json)" \
  --pub_signals "$(cat proof-output/public.json)"
```

A successful call returns `true`. A `false` return (or a host error) means the
proof did not verify — see §10.7.

### 10.7 Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `circom: command not found` / version < 2.2 | Circom not installed or too old | Install Circom 2.2+ (`cargo install --git https://github.com/iden3/circom.git --tag v2.2.0`) and re-run `compile-circuit.sh` |
| `Error: zkey not found` / `artifacts/..._final.zkey` missing | Trusted setup not run, or run against a different build | Re-run `bash scripts/zk/trusted-setup.sh` after `compile-circuit.sh`; ensure the `.r1cs` matches the `.zkey` |
| `Error: Invalid field element` / `field-encode` errors | A string input was passed raw instead of field-encoded, or an integer is out of the Fr range | Encode strings with `scripts/zk/field-encode.js`; ensure numeric inputs are within the BLS12-381 scalar field |
| Witness generation fails (`Assert Failed`, `Not enough values`) | Input JSON missing a key, wrong types, or a constraint violated (e.g. `amount <= 0`, `serialEnd < serialStart`) | Check the witness JSON against §3; verify `amount > 0` and `serialEnd >= serialStart`; confirm all 8 inputs are present |
| `snarkjs groth16 verify` returns `INVALID` | Proof generated against a different `.zkey`/VK than the one used to verify, or public signals reordered | Regenerate the proof with the same artifacts; keep public signal order `[beneficiaryCommitment, nullifier, retiredByHash]` |
| Contract `verify_proof` returns `false` | Proof/VK mismatch, wrong public signal order, or points not in uncompressed BLS12-381 form | Confirm the on-chain VK matches the `.zkey`; pass signals in the documented order; serialize points as uncompressed G1/G2 |
| `prove-fixture.sh` fails but real proofs work | Stale build artifacts | `rm -rf circuits/retirement_private_cert/build circuits/retirement_private_cert/artifacts` and re-run Steps 1–3 |
| API returns `403` on `POST .../zk-proof` | Caller is not the retiring wallet and not admin | Authenticate as the wallet in `retiredBy`, or as an admin |

If a problem persists, capture the output of `prove-fixture.sh` and the exact
`circom`/`snarkjs` versions — these are the fastest signals for triage.