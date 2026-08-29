# Browser and Wallet Extension Compatibility Matrix

This document describes the supported browser/wallet combinations for CarbonLedger, 
the automated test coverage for each combination, and any known incompatibilities.

---

## Supported Combinations

| Browser | Wallet Extension | Status    | Notes                                                                                  |
|---------|-----------------|-----------|----------------------------------------------------------------------------------------|
| Chrome  | Freighter       | ✅ Supported | Primary validation target for wallet connect and transaction flows.                  |
| Chrome  | Xbull           | ✅ Supported | Injected API shim mirrors the Xbull public surface.                                  |
| Firefox | Freighter       | ✅ Supported | Verified in CI via the Playwright browser matrix.                                    |
| Firefox | Xbull           | ✅ Supported | Verified in CI via the Playwright browser matrix.                                    |
| Brave   | Freighter       | ✅ Supported | Run as Chromium with Brave's default privacy/fingerprinting flags enabled in tests.  |
| Brave   | Xbull           | ✅ Supported | Same as Brave + Freighter — Chromium engine with Brave-specific launch flags.        |

---

## Out of Scope

| Browser / Wallet     | Reason                                                                                            |
|----------------------|---------------------------------------------------------------------------------------------------|
| Safari               | No browser extension support for Stellar wallets. Tracked in issue #650 if Safari support lands. |
| Mobile browsers      | Extension injection is not supported on mobile. Mobile app support is a separate roadmap item.   |
| Ledger hardware wallet | Hardware signing flow requires a dedicated e2e suite. Tracked in issue #651.                  |

---

## Critical Flows Tested

Each supported browser/wallet combination is validated against three critical user flows:

| Flow              | Description                                                                    |
|-------------------|--------------------------------------------------------------------------------|
| Wallet connect    | Page detects the injected extension, reads the public key, shows connected UI. |
| Credit purchase   | Navigates marketplace → buy page, fills amount, confirms transaction.          |
| Credit retirement | Navigates retire page, fills beneficiary and reason, confirms retirement.      |

---

## Failure Reporting

When a test fails, the CI report includes:

- **Browser name** (from `testInfo.project.name`, e.g. `firefox-xbull`)
- **Browser engine version** (from Playwright's device descriptor or channel)
- **Extension name** (`Freighter` or `Xbull`)
- **Extension version** (hardcoded in the shim config — update when bumping the shim)
- **Failure detail** (attached as a JSON artifact under `compat-<browser>-<wallet>`)

Example artifact content:

```json
{
  "browser": "firefox-xbull",
  "browserVersion": "default",
  "walletExtension": "Xbull",
  "walletVersion": "0.9.0",
  "publicKey": "GCBVQ4T7K6QTTJZ2ZQH...",
  "outcome": "fail",
  "failureDetail": "expect(heading).toBeVisible timeout",
  "timestamp": "2026-07-27T10:00:00.000Z"
}
```

---

## CI Behavior

The Playwright test suite runs in parallel across all six browser/wallet projects using
the matrix defined in `frontend/playwright.config.ts`.

### Workflow: `browser-compatibility` (`.github/workflows/browser-compatibility.yml`)

```
browser-compatibility job
  └── matrix: [chrome-freighter, chrome-xbull, firefox-freighter,
               firefox-xbull, brave-freighter, brave-xbull]
      Each shard runs: npx playwright test --project=<project-name>
```

The job uploads:
- `playwright-report/` — HTML report artifact with screenshots and traces
- `test-results/junit.xml` — JUnit XML parsed by GitHub Actions for inline annotations
- `compat-*.json` — per-combination metadata attachments

---

## Known Incompatibilities

| Combination         | Issue                                                                              | Workaround / Tracking                                            |
|---------------------|------------------------------------------------------------------------------------|------------------------------------------------------------------|
| Brave × any wallet  | Brave's `--disable-blink-features=AutomationControlled` flag may suppress some DOM events in very fast test runs. | Use `waitForLoadState('networkidle')` before interacting with wallet UI. |
| Firefox × Freighter | Freighter's `signTransaction` occasionally resolves after 3–5 s in Firefox due to the extension's message-passing delay. | CI retries are set to 2; Playwright's `timeout` per action is 15 s. |

If you encounter a new incompatibility, open an issue with the label `browser-compat`
and include the artifact JSON from the failing CI run.

---

## Updating the Wallet Shim

The wallet API shim is defined in `frontend/tests/e2e/wallet-compatibility.spec.ts`
under `WALLET_VARIANTS`. When Freighter or Xbull ships a breaking API change:

1. Update the `version` field for the affected wallet.
2. Update the shim function body to match the new API surface.
3. Run `npx playwright test --project=chrome-freighter` locally to verify.
4. Open a PR referencing this document.

---

## Running the Compatibility Tests Locally

```bash
cd frontend

# Install Playwright browsers (first time only)
npx playwright install --with-deps

# Run all browser/wallet combinations
npx playwright test tests/e2e/wallet-compatibility.spec.ts

# Run a specific combination (e.g. firefox × Xbull)
npx playwright test tests/e2e/wallet-compatibility.spec.ts --project=firefox-xbull

# Open the HTML report
npx playwright show-report
```
