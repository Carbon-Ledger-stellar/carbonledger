# Retirement Certificate Signing (#594)

Every retirement certificate CarbonLedger issues is signed with an Ed25519
(Stellar) key pair so a regulator or ESG auditor can verify authenticity
using **only** the public key published in [`Stellar.toml`](../../../Stellar.toml)
— no trust in the CarbonLedger backend or database is required.

## How signing works

1. `CertificateSigningService` (`certificate-signing.service.ts`) loads the
   signing key pair from the `CERTIFICATE_SIGNING_SECRET` environment
   variable (a Stellar secret seed, `S...`).
2. `retirements/certificate.service.ts` builds the certificate's substantive
   content (`project_id`, `vintage_year`, `serial_start`/`serial_end`,
   `tx_hash`, `beneficiary`, `retired_at`, etc.) and canonicalizes it
   (deterministic, key-sorted JSON) before hashing with SHA-256.
3. The SHA-256 digest is signed with the Ed25519 key. The certificate JSON
   embeds `content_hash`, `issuer_signature` (hex), and `issuer_public_key`
   alongside the signed fields.
4. `certificate_cid` is deliberately **excluded** from the signed content —
   it's filled in after IPFS pinning (a separate concern, #600) and would
   create a chicken-and-egg problem if it were part of the signature.

## How verification works

Verification needs only the certificate JSON and a public key — it never
touches the database:

- **Backend endpoint**: `POST /retirements/verify-signature` (public, no
  auth) — `RetirementsService.verifyCertificateSignature()`.
- **Standalone CLI**: `node backend/scripts/verify-certificate.js
  <certificate.json> [Stellar.toml path]` — reads the certificate and the
  `CERTIFICATE_SIGNING_KEY` field from `Stellar.toml` and verifies the
  signature independently. This is the tool a third party who does not
  trust CarbonLedger's backend should use.

Both implementations share the same canonicalization + SHA-256 + Ed25519
verify logic (`CertificateSigningService.verify` /
`scripts/verify-certificate.js`'s `verifyCertificate`), so they always agree.

## Key rotation procedure

Because `Stellar.toml` is the trust root, rotation must never leave a
verifier unable to check a certificate that was already issued. The
procedure keeps the outgoing key valid for a transition window using a
second, optional field:

1. **Generate a new key pair.** Do this offline; never let the secret seed
   touch a log or ticket.
2. **Publish both keys before rotating the secret.** In `Stellar.toml`:
   - Move the current `CERTIFICATE_SIGNING_KEY` value into
     `CERTIFICATE_SIGNING_KEY_PREVIOUS`.
   - Set `CERTIFICATE_SIGNING_KEY` to the new public key.
   - Deploy `Stellar.toml` to `https://carbonledger.io/.well-known/stellar.toml`
     and bump `VERSION`.
3. **Roll the backend secret.** Set `CERTIFICATE_SIGNING_SECRET` to the new
   secret seed and redeploy the backend. From this point, all *newly
   generated* certificates are signed with the new key.
4. **Old certificates keep verifying.** `verifyCertificateSignature()` and
   the CLI verify a certificate using the public key **embedded in that
   certificate** (`issuer_public_key`), not the currently-published one —
   the cross-check against `CERTIFICATE_SIGNING_KEY` /
   `CERTIFICATE_SIGNING_KEY_PREVIOUS` only annotates the result
   (`keyIsCurrent` / `keyIsKnownPrevious`) for the auditor's information. A
   certificate signed under the old key remains cryptographically valid
   forever; `CERTIFICATE_SIGNING_KEY_PREVIOUS` just lets verifiers confirm
   that key was a legitimately-rotated-out CarbonLedger key rather than an
   unknown one.
5. **Retire the previous key field once it's no longer useful to confirm**
   (e.g. after the compliance retention period for certificates signed
   under it has passed). Remove `CERTIFICATE_SIGNING_KEY_PREVIOUS` from
   `Stellar.toml`. This does not invalidate old certificates — it only
   means new lookups can no longer confirm that key was an official
   CarbonLedger rotation (the embedded signature is still mathematically
   verifiable by anyone who kept a copy of that old public key).

### Compromise (emergency) rotation

If `CERTIFICATE_SIGNING_SECRET` is suspected compromised, skip step 2's
grace period: publish the new `CERTIFICATE_SIGNING_KEY` immediately, roll
the secret, and treat any certificate signed by the compromised key issued
after the suspected compromise time as untrusted (this must be
communicated out-of-band — the signature scheme itself cannot express
"this key was valid until time T").
