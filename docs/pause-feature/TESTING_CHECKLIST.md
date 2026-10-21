# Pause Feature — Testing Checklist

> **Related:** [Specification](./SPECIFICATION.md) · [Deployment checklist](./DEPLOYMENT_CHECKLIST.md) · [Release notes](./RELEASE_NOTES.md)

Work through this checklist before any release that touches the pause feature. Items marked **(existing)** are already covered by a test in the repo; check that they still pass. Items marked **(proposed)** apply to the layers still being designed in the specification. Mark each of those N/A until that layer is built.

Record the result for every item as ✅ pass, ❌ fail (link the issue) or N/A (give the reason).

Useful commands:

```bash
cargo test -p carbon_credit -p carbon_marketplace          # contract unit tests
cargo test -p adversarial_tests --test role_authorization  # auth matrix (existing pause tests)
cd backend && npm test                                     # API unit tests
cd frontend && npm test && npx playwright test             # UI unit + e2e
```

---

## 1. Contract testing (15 items)

Run each item against **both** `carbon_credit` and `carbon_marketplace` unless it says otherwise.

- [ ] **C-01** Admin can call `pause_operations` with `until = now + 3600`. *(existing: `cred_pause_ok`, `mkt_pause_ok`)*
- [ ] **C-02** A non-admin calling `pause_operations` gets `UnauthorizedVerifier`. *(existing: `cred_pause_unauthorized`, `mkt_pause_unauthorized`)*
- [ ] **C-03** Admin can call `unpause_operations` even when the contract is not paused (idempotent). *(existing: `cred_unpause_ok`, `mkt_unpause_ok`)*
- [ ] **C-04** A non-admin calling `unpause_operations` gets `UnauthorizedVerifier`. *(existing)*
- [ ] **C-05** `until == now` is rejected with `InvalidPauseWindow` (credit 28, marketplace 26).
- [ ] **C-06** `until < now` (a past timestamp) is rejected with `InvalidPauseWindow`.
- [ ] **C-07** `until == now + 259_200` (exactly 72 h) is accepted. `until == now + 259_201` is rejected.
- [ ] **C-08** While paused, **every** gated function listed in spec §4.4 returns `EmergencyPaused` (credit 29, marketplace 27). Use one table-driven test per contract so the list cannot drift.
- [ ] **C-09** While paused, every read-only/view function still returns data.
- [ ] **C-10** While paused, `grant_role` and `revoke_role` on credit still succeed, and so do `set_oracle_contract` and `set_price_freshness_window` on marketplace.
- [ ] **C-11** Auto-expiry: pause, advance the ledger timestamp to `until`, and a gated call succeeds. Afterwards `PauseEnabled == false` and `PauseUntil == 0` (lazy clear).
- [ ] **C-12** Calling `pause_operations` again while paused overwrites `until`. Check both extending and shortening the window.
- [ ] **C-13** Unpausing early lets gated calls succeed straight away in the same ledger.
- [ ] **C-14** Cross-contract: pause **only** credit, and `purchase_credits` and `bulk_purchase` on marketplace fail. No USDC moves and the listing's `amount_available` is unchanged.
- [ ] **C-15** Events: `pause_operations` and `unpause_operations` emit no events today *(existing: EVT-NOEVENT-02/03)*. When the spec §4.6 events land, replace this with assertions on the exact topic and payload.

## 2. API testing (20 items) — proposed layer

- [ ] **A-01** `GET /status/pause` returns both contracts with `paused: false` on a freshly initialized network.
- [ ] **A-02** `GET /status/pause` reports `paused: true` and the correct `until` after an on-chain pause.
- [ ] **A-03** `GET /status/pause` reports `paused: false` after the deadline passes, **even though no gated call has cleared the raw flag yet** (it uses the effective check).
- [ ] **A-04** `GET /status/pause` is public: it works without a JWT.
- [ ] **A-05** `GET /status/pause` is served from Redis on the second call inside 30 s. Verify the cache hit metric or a mocked RPC call count.
- [ ] **A-06** When Redis is down, `GET /status/pause` falls back to an RPC simulation and does not return 500.
- [ ] **A-07** `POST /admin/pause/:contract/prepare` without a JWT returns 401.
- [ ] **A-08** The same call with a non-admin JWT returns 403 (RolesGuard).
- [ ] **A-09** The same call with an unknown `:contract` returns 400.
- [ ] **A-10** A `untilTimestamp` in the past, or more than 72 h ahead, returns 400.
- [ ] **A-11** A missing reason, or one shorter than 10 characters, returns 400.
- [ ] **A-12** A valid request returns unsigned XDR plus a simulation result. The backend never asks for or stores a secret key.
- [ ] **A-13** `POST /admin/unpause/:contract/prepare` returns valid XDR for `unpause_operations`.
- [ ] **A-14** `POST /admin/pause/submit` with signed XDR submits it, returns `txHash` and clears the cache, so the next `GET` shows the new state.
- [ ] **A-15** `submit` with XDR that does not match `action`/`contract` returns 400. Tampered XDR must be rejected.
- [ ] **A-16** Every successful pause or unpause writes exactly one `audit_logs` row with `action`, `actor_id`, `reason` and `txHash`.
- [ ] **A-17** A failed submission (for example, the contract rejects it) writes an audit row with the failure result and leaves the cache alone.
- [ ] **A-18** Existing write endpoints (purchase, list, retire, transfer) return 503 `ContractPaused` with a correct `Retry-After` when the contract returns `EmergencyPaused`.
- [ ] **A-19** Error decoding uses the right contract: credit code 29 and marketplace code 27 both map to `ContractPaused`, and marketplace code 29 (`ListingExpired`) does **not**.
- [ ] **A-20** The new routes appear in the exported OpenAPI spec (`cd backend && npm run export:openapi`) with request and response schemas.

## 3. Frontend testing (15 items) — proposed layer

- [ ] **F-01** The maintenance banner appears when `/status/pause` reports any contract paused.
- [ ] **F-02** The banner shows the resume time in the user's local timezone.
- [ ] **F-03** Users cannot dismiss the banner while the pause is active.
- [ ] **F-04** The banner disappears within 30 s after the pause lifts, without a page reload.
- [ ] **F-05** With the marketplace paused, Buy, List and Delist are disabled and show a tooltip.
- [ ] **F-06** With credit paused, Retire, Transfer **and Buy** are disabled (cross-contract rule).
- [ ] **F-07** Portfolio, project pages, certificate download and the audit explorer keep working while paused.
- [ ] **F-08** If a transaction races the banner and hits `EmergencyPaused`, the UI shows the paused message from `carbon-error-codes.ts`, not a generic error.
- [ ] **F-09** `carbon-error-codes.ts` unit test: credit 28/29 and marketplace 26/27 map to the right variant names.
- [ ] **F-10** Admin console: non-admin users cannot see or reach the pause controls.
- [ ] **F-11** Admin console: the duration picker cannot go past 72 h, and a reason is required.
- [ ] **F-12** Admin console: the confirmation dialog asks the admin to type the contract name before signing.
- [ ] **F-13** Admin console: the countdown matches `until`, and Extend and Unpause update the state after the transaction is confirmed.
- [ ] **F-14** Accessibility: the banner has `role="status"`, disabled buttons expose `aria-disabled` with a description, and an axe scan finds no new violations.
- [ ] **F-15** Every new string is present in each `i18n` locale file, and visual regression snapshots have been reviewed.

## 4. Integration testing (10 items)

Run these on a local Soroban network (`docker-compose.yml`) or on testnet per [integration-testing.md](../integration-testing.md).

- [ ] **I-01** End to end: an admin pauses marketplace from the console, signs in Freighter, sees the banner, and a buyer's purchase is blocked.
- [ ] **I-02** End to end: an admin unpauses, the banner clears and the purchase succeeds.
- [ ] **I-03** Auto-expiry end to end: pause for a short window on a local network, wait, and confirm the first purchase after expiry succeeds and the API reports unpaused.
- [ ] **I-04** Pausing credit alone blocks marketplace purchases through the full stack and leaves listing untouched.
- [ ] **I-05** The indexer keeps processing other events during a pause, with no crash or stall on failed transactions.
- [ ] **I-06** (After the §4.6 events exist) the indexer writes `contract_pause_events` rows for paused and unpaused.
- [ ] **I-07** The audit log hash chain (`previousHash`/`entryHash`) still verifies after pause and unpause entries are added.
- [ ] **I-08** Webhooks and notifications for failed purchases during a pause carry the paused reason rather than a generic failure.
- [ ] **I-09** Upgrade sequence: an upgrade while paused fails, and unpause → `upgrade_contract` → re-pause succeeds back to back.
- [ ] **I-10** Reconciliation jobs (serial reconciliation, oracle sync) do not raise false alarms during a pause window.

## 5. Performance testing (8 items)

- [ ] **P-01** The gas and resource report (`audit/gas-optimization-report.md` method) shows the guard adds ≤ 2 persistent reads to each gated call.
- [ ] **P-02** `pause_operations` and `unpause_operations` resource usage is < 50 % of the default Soroban limits.
- [ ] **P-03** The first gated call after expiry (with the lazy clear writes) stays within limits for the heaviest gated function (`bulk_purchase`).
- [ ] **P-04** `benchmarks/` shows no regression beyond the CI threshold (see performance regression tracking, #1129).
- [ ] **P-05** `GET /status/pause` p95 < 50 ms when served from cache (k6, `load-tests/`).
- [ ] **P-06** `GET /status/pause` p95 < 500 ms on a cache miss.
- [ ] **P-07** Under k6 purchase load, write endpoints return 503 within 200 ms once the contract is paused and do not hold RPC connections.
- [ ] **P-08** 1,000 concurrent frontend clients polling every 30 s add < 5 % to the backend CPU baseline.

## 6. Security testing (12 items)

- [ ] **S-01** Only the stored admin can pause or unpause. Signing with any other key fails (C-02/C-04, plus a fuzz test over random addresses).
- [ ] **S-02** Calling `pause_operations` without `require_auth` (a mocked unsigned invocation) fails.
- [ ] **S-03** A window > 72 h cannot be set by any path, including repeated calls in the same ledger.
- [ ] **S-04** A `u64` overflow case: when `now` is near `u64::MAX`, `saturating_add` behaves correctly and does not wrap.
- [ ] **S-05** No gated function skips `require_not_paused`. Add a static check (a grep or test) that fails CI if a new state-changing `pub fn` is added without the guard or an explicit allowlist entry.
- [ ] **S-06** Role rotation (`revoke_role` old admin, `grant_role` new admin) works while paused, which is the key-compromise path.
- [ ] **S-07** Audit M-1 is tracked: document the pause-state leak in `update_treasury` and `suspend_project`, or verify the fix once merged.
- [ ] **S-08** The backend never logs or stores signed XDR secrets or admin keys. Grep the logs during an A-14 run.
- [ ] **S-09** The prepare and submit endpoints are rate limited (throttle module) and protected against CSRF and replay (idempotency module).
- [ ] **S-10** Replaying a submitted pause XDR fails because of the sequence number and does not duplicate the audit row.
- [ ] **S-11** A reentrancy attempt through `purchase_credits` while paused returns `EmergencyPaused` before the reentrancy lock is taken, and leaves no lock behind.
- [ ] **S-12** A security review of the diff (`/security-review` or the equivalent) finds no new high or critical findings.
