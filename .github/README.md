# GitHub Actions — CarbonLedger CI/CD

This directory contains all CI/CD workflow definitions for CarbonLedger.

---

## Workflows

| File | Trigger | Purpose |
|------|---------|---------|
| `ci.yml` | PR to `main`/`develop`, push to `main`, weekly schedule | Main CI: security audit, Rust contracts, backend, frontend, E2E, oracle |
| `cd-testnet.yml` | After CI succeeds on `main` | Build and deploy to testnet |
| `smoke-tests.yml` | After Testnet CD completes | Post-deploy smoke tests for API, contracts, frontend |
| `ci-test-annotations.yml` | After CI completes | Parse test results and post PR annotations + summary comment |
| `backend-integration.yml` | PR touching `backend/`, push to `main` | Full integration test suite with real PostgreSQL |
| `browser-compatibility.yml` | PR touching `frontend/`, push to `main` | Playwright browser/wallet compatibility matrix |
| `visual-regression.yml` | PR to `main`/`develop` | Playwright visual regression screenshots |
| `contract-redeploy.yml` | Manual dispatch | Redeploy Soroban contracts to testnet |
| `staging.yml` | Push to `staging` branch | Staging deployment pipeline |
| `container-security-scan.yml` | PR, push to `main` | Trivy container image vulnerability scan |
| `e2e-nightly.yml` | Nightly cron | Extended E2E suite |
| `backend-tests.yml` | PR touching `backend/` | Focused backend unit test run |

---

## CI Test Result Annotations (`ci-test-annotations.yml`)

Closes [#646](https://github.com/giftben1763-ui/carbonledger/issues/646).

### What it does

1. **Rust contract test failures** — annotated at the failing file + line number by
   parsing `cargo test` output for `panicked at 'message', file.rs:42` patterns and
   emitting `::error file=...,line=...` workflow commands.

2. **Backend Jest failures** — annotated per-module using `dorny/test-reporter` with
   the JUnit XML produced by `jest-junit`. Failed tests appear as inline check
   annotations on the PR diff.

3. **Playwright E2E failures** — annotated using `dorny/test-reporter` with the JUnit
   XML emitted by Playwright's built-in `junit` reporter. Screenshots captured by
   Playwright on failure are re-uploaded as `e2e-failure-screenshots-<run_id>`.

4. **PR summary comment** — a structured comment is posted (or updated) on every push
   to the same PR. The comment format is:

   ```
   ## 🧪 Test Results — `abc1234`

   | Suite           | Passed | Failed | Skipped |
   |-----------------|--------|--------|---------|
   | ✅ Rust Contracts | 30     | 0      | 0       |
   | ✅ Backend (Jest) | 87     | 0      | 2       |
   | ❌ E2E (Playwright) | 18   | 2      | 0       |

   ### 📸 E2E Failure Screenshots
   - `checkout-firefox-failure.png` — uploaded as `e2e-failure-screenshots` artifact

   > 🔗 Full CI run logs
   > Commit `abc1234` · Updated automatically on every push
   ```

   The comment is **updated** (not duplicated) on subsequent pushes to the same PR
   by searching for a `<!-- ci-test-summary -->` marker in existing comments.

### Timing

Annotations appear within ~1 minute of the CI workflow completing, because
`ci-test-annotations.yml` triggers on `workflow_run` completion events.

### JUnit XML sources

| Suite | Produced by | Artifact name |
|-------|-------------|---------------|
| Backend unit tests | `jest-junit` reporter (`npm test -- --reporters=jest-junit`) | `backend-junit` |
| Backend integration tests | `jest-junit` in `backend-integration.yml` | `integration-junit` |
| Playwright E2E tests | Built-in `junit` reporter in `playwright.config.ts` | `playwright-report` |
| Browser compat matrix | `junit` reporter in `browser-compatibility.yml` | `playwright-report-<project>` |

### Screenshot links

When a Playwright test fails, the screenshot is saved under
`frontend/test-results/<test-name>/screenshot.png`. The `ci-test-annotations.yml`
workflow re-uploads all screenshots from CI artifacts as a single
`e2e-failure-screenshots-<run_id>` artifact, and includes links to them in the PR
comment. Screenshots are retained for **14 days**.

### Adding a new test suite

To have a new test suite's failures appear as PR annotations:

1. Configure the suite to emit JUnit XML (for Jest: `jest-junit`; for Playwright:
   the built-in `['junit', { outputFile: 'test-results/junit.xml' }]` reporter).
2. Upload the XML as a named artifact in your workflow:
   ```yaml
   - uses: actions/upload-artifact@v4
     if: always()
     with:
       name: my-suite-junit
       path: path/to/junit.xml
   ```
3. Add a `dorny/test-reporter` step in `ci-test-annotations.yml` that downloads
   and processes your artifact:
   ```yaml
   - name: Annotate my-suite failures
     uses: dorny/test-reporter@v1
     if: always()
     with:
       name: "My Suite"
       path: ci-artifacts/my-suite-junit/junit.xml
       reporter: jest-junit    # or java-junit
       fail-on-error: false
   ```

---

## Required Secrets

| Secret | Used by | Description |
|--------|---------|-------------|
| `GITHUB_TOKEN` | All workflows | Automatically provided by GitHub Actions |
| `TESTNET_SSH_HOST` | `cd-testnet.yml` | SSH host for testnet server |
| `TESTNET_SSH_USER` | `cd-testnet.yml` | SSH user |
| `TESTNET_SSH_KEY` | `cd-testnet.yml` | SSH private key |
| `VERCEL_TOKEN` | `cd-testnet.yml` | Vercel deployment token |
| `VERCEL_ORG_ID` | `cd-testnet.yml` | Vercel org ID |
| `VERCEL_PROJECT_ID` | `cd-testnet.yml` | Vercel project ID |
| `TESTNET_API_URL` | `smoke-tests.yml` | Testnet backend API base URL |
| `TESTNET_FRONTEND_URL` | `smoke-tests.yml` | Testnet frontend URL |
| `TESTNET_SOROBAN_RPC_URL` | `smoke-tests.yml` | Soroban RPC URL |
| `CARBON_*_CONTRACT_ID` | `smoke-tests.yml` | Deployed contract addresses |
| `SLACK_WEBHOOK_URL` | `cd-testnet.yml` | Slack notification webhook |

---

## Branch Protection Setup

To enforce CI as a required check before merging:

1. Go to **Settings → Branches → main** and add a branch protection rule.
2. Enable **Require status checks to pass before merging**.
3. Add the following required checks:
   - `Soroban Contract Tests`
   - `NestJS Backend`
   - `Next.js Frontend`
   - `Playwright E2E Tests`
   - `Browser Compatibility Gate`
   - `Backend Integration Tests`
4. Enable **Require branches to be up to date before merging**.

See [docs/BRANCH_PROTECTION_GUIDE.md](../docs/BRANCH_PROTECTION_GUIDE.md) for full details.
