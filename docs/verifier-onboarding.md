# Verifier Onboarding

Verifiers are accredited third parties who approve carbon projects for credit issuance. They must be whitelisted by a CarbonLedger admin before they can approve projects.

## Flow

```
Verifier submits application (off-chain credentials + IPFS docs)
        ↓
Admin reviews application via API
        ↓
Admin approves → verifier address added to registry contract + user role set to "verifier"
        ↓
Verifier logs in and sees pending projects on their dashboard
        ↓
Verifier approves project → credits can be minted
        ↓
Verifier earns attestation fee
```

## Step 1 — Submit Application

Navigate to `/verifier/apply` or call the API directly:

```bash
curl -X POST http://localhost:3001/api/v1/verifiers/apply \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "GVERIFIER...",
    "organizationName": "Green Audit Ltd",
    "accreditationBody": "Gold Standard",
    "accreditationId": "GS-AUD-12345",
    "contactEmail": "auditor@greenaudit.example",
    "documentsCid": "QmYourIPFSCID..."
  }'
```

Upload credential documents (accreditation certificate, auditor license) to IPFS first and include the CID.

## Step 2 — Admin Review

Admin lists pending applications:

```bash
curl -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:3001/api/v1/verifiers?status=pending
```

Admin approves:

```bash
curl -X PATCH http://localhost:3001/api/v1/verifiers/:id/review \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"adminPublicKey": "GADMIN...", "decision": "approved"}'
```

On approval the backend:
1. Sets `VerifierApplication.status = "approved"`
2. Upserts the verifier's `User` record with `role = "verifier"`

The admin must also whitelist the verifier address in the `carbon_registry` Soroban contract:

```bash
stellar contract invoke \
  --id $CARBON_REGISTRY_CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --network testnet \
  -- add_verifier --verifier GVERIFIER...
```

## Step 3 — Verifier Dashboard

Verifiers log in at `/verifier/dashboard` to see projects assigned to them for review.

The dashboard calls:
```
GET /api/v1/verifiers/:publicKey/pending-projects
```

## Step 4 — Approve a Project

From the dashboard, click **Approve** or **Reject** on each project. This calls:

```
POST /api/v1/projects/:id/verify   { verifierPublicKey }
POST /api/v1/projects/:id/reject   { verifierPublicKey, reason }
```

The backend submits the on-chain `verify_project()` call to `carbon_registry`.

## Attestation Fee

Verifiers earn a fee for each project they approve. The fee is:

| Action | Fee |
|--------|-----|
| Project approval | 50 USDC (flat fee, paid by project developer at registration) |
| Monitoring period attestation | 25 USDC per period |

Fees are held in escrow in the `carbon_registry` contract and released to the verifier's Stellar address upon successful `verify_project()` execution.

> Note: Fee amounts are configurable by admin via `carbon_registry.set_verifier_fee()` and may change based on market conditions.

## Accreditation Bodies Supported

- Gold Standard
- Verra VCS (Verified Carbon Standard)
- American Carbon Registry (ACR)
- Climate Action Reserve (CAR)
