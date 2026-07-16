# Runbook: Key Compromise

**Severity:** Critical  
**Contacts:** See [contacts.md](contacts.md) → Security  
**Escalation:** See [escalation.md](escalation.md)

---

## Affected Keys

| Key | Purpose | Impact if compromised |
|---|---|---|
| `ADMIN_SECRET_KEY` | Deploy contracts, suspend/reject projects | Full protocol control |
| `ORACLE_SECRET_KEY` | Submit monitoring data, flag projects, update prices | Fraudulent credit issuance |
| `JWT_SECRET` | Sign user session tokens | Account takeover for all users |
| `IPFS_API_KEY` / `IPFS_SECRET_KEY` | Pin metadata to IPFS | Metadata tampering |
| `DATABASE_URL` (credentials) | PostgreSQL access | Data exfiltration or corruption |

---

## Detection

- Unexpected transactions from `ADMIN_PUBLIC_KEY` or `ORACLE_PUBLIC_KEY` on Stellar Horizon.
- JWT tokens accepted for accounts that should not be active.
- Secret scanning alert (GitHub, GitGuardian, truffleHog) on a commit or PR.
- Credential found in logs, error messages, or a public paste site.
- Unusual IPFS pin activity or unexpected CIDs appearing in project metadata.
- Database access from an unexpected IP or at an unexpected time.

---

## Containment

### Stellar keypairs (ADMIN or ORACLE)

Stellar keypairs cannot be "revoked" — the key is the identity. Containment means **replacing the key and revoking the old key's authority**:

1. **Generate a new keypair immediately:**
   ```bash
   stellar keys generate new-admin --network testnet
   stellar keys address new-admin
   ```

2. **Add the new key as a signer** on the admin/oracle Stellar account with the old key (while you still control it):
   ```bash
   stellar tx new --source OLD_PUBLIC_KEY ... add-signer NEW_PUBLIC_KEY weight 1
   ```

3. **Remove the compromised key as a signer:**
   ```bash
   stellar tx new --source NEW_SECRET_KEY ... remove-signer OLD_PUBLIC_KEY
   ```

4. **Update all contract authorizations** — if the compromised key was registered as an authorized verifier or oracle in the contracts, call the appropriate admin function to replace it.

5. **Update `.env`** on all servers with the new keypair. Rotate secrets in your secrets manager (AWS Secrets Manager, Vault, etc.).

6. **Audit all transactions** made by the compromised key from the time of suspected compromise:
   ```bash
   curl "https://horizon-testnet.stellar.org/accounts/$OLD_PUBLIC_KEY/operations?order=desc&limit=200"
   ```

### JWT_SECRET

1. **Rotate the secret immediately** — update `JWT_SECRET` in `.env` and restart the backend. All existing sessions are instantly invalidated (this is intentional).
2. Notify users that they will need to log in again.
3. Audit backend logs for suspicious authenticated requests in the compromise window.

### Database credentials

1. **Rotate the PostgreSQL password immediately:**
   ```sql
   ALTER USER carbonledger PASSWORD 'new-strong-password';
   ```
2. Update `DATABASE_URL` in `.env` and restart the backend.
3. Audit `pg_stat_activity` and PostgreSQL logs for queries made during the compromise window.
4. Check for new database users or permission grants:
   ```sql
   SELECT usename, usesuper, usecreatedb FROM pg_user;
   ```

### IPFS / Pinata keys

1. Revoke the compromised API key in the Pinata dashboard.
2. Generate a new key and update `.env`.
3. Audit recently pinned CIDs for unexpected content.

---

## Recovery

1. **Verify no fraudulent on-chain actions were taken** with the compromised key — check for unauthorized `mint_credits`, `verify_project`, `submit_monitoring_data`, or `update_credit_price` calls.
2. **Reverse any fraudulent off-chain state** (DB records, IPFS pins) where possible.
3. **For fraudulent on-chain credits:** follow [double-counting.md](double-counting.md) or [contract-exploit.md](contract-exploit.md) as appropriate.
4. **Notify affected users** if JWT compromise led to account access.
5. **File a security incident report** and determine how the key was exposed (logs, repo, environment variable leak).

---

## Prevention Checklist

- [ ] Secrets never committed to git (`.env` in `.gitignore`, secret scanning enabled)
- [ ] Production keys stored in a secrets manager, not in `.env` files on disk
- [ ] Stellar admin account uses multi-sig (threshold > 1) for Critical operations
- [ ] Key rotation schedule: oracle key every 90 days, JWT secret every 30 days
- [ ] Principle of least privilege: oracle key cannot call admin-only contract functions

---

## Post-mortem

- How was the key exposed? (git commit, log leak, phishing, insider)
- What actions were taken with the compromised key?
- Time from exposure to detection to rotation.
- Add the exposure vector to the secret scanning ruleset.
