# Visual Regression Tests

Automated visual regression testing using Playwright to detect unintended UI changes.

## Overview

Visual regression tests capture snapshots of key UI components and pages, then compare them against baseline images on each PR. This prevents accidental visual regressions from being merged.

## Setup

### Install Dependencies

```bash
cd frontend
npm install
npx playwright install --with-deps
```

### Configure Test Data Attributes

Add `data-testid` attributes to components for reliable snapshot targeting:

```tsx
// CreditCard.tsx
export function CreditCard({ credit }) {
  return (
    <div data-testid="credit-card">
      <h3>{credit.name}</h3>
      <p>{credit.price}</p>
    </div>
  );
}

// MarketplaceFilter.tsx
export function MarketplaceFilter() {
  return (
    <div data-testid="marketplace-filter">
      {/* filter controls */}
    </div>
  );
}

// RetirementCertificate.tsx
export function RetirementCertificate({ retirement }) {
  return (
    <div data-testid="retirement-certificate">
      {/* certificate content */}
    </div>
  );
}

// ProvenanceTrail.tsx
export function ProvenanceTrail({ credit }) {
  return (
    <div data-testid="provenance-trail">
      {/* trail content */}
    </div>
  );
}

// Marketplace container
export function Marketplace() {
  return (
    <div data-testid="marketplace-container">
      {/* marketplace content */}
    </div>
  );
}
```

## Running Tests

### Run All Visual Tests

```bash
npm run test:visual
```

### Run Specific Test

```bash
npx playwright test visual-regression.spec.ts
```

### Update Baselines

When intentional UI changes are made, update baseline images:

```bash
npx playwright test --update-snapshots
```

### Run in UI Mode

```bash
npx playwright test --ui
```

### Run with Headed Browser

```bash
npx playwright test --headed
```

## Test Coverage

### Components Tested

| Component | File | Snapshots |
|-----------|------|-----------|
| Marketplace Page | `marketplace-page.png` | Desktop, Mobile, Tablet, Dark Mode |
| Credit Card | `credit-card.png` | Desktop |
| Retirement Certificate | `retirement-certificate.png` | Desktop |
| Provenance Trail | `provenance-trail.png` | Desktop |
| Marketplace Filter | `marketplace-filter.png` | Desktop |

### Responsive Breakpoints

- **Desktop**: 1920x1080
- **Tablet**: 768x1024
- **Mobile**: 375x667

### States Tested

- ✅ Normal state
- ✅ Loading state
- ✅ Error state
- ✅ Dark mode
- ✅ Responsive layouts

## Baseline Images

Baseline images are stored in the repository:

```
frontend/tests/e2e/__screenshots__/
├── visual-regression.spec.ts/
│   ├── marketplace-page.png
│   ├── credit-card.png
│   ├── retirement-certificate.png
│   ├── provenance-trail.png
│   ├── marketplace-filter.png
│   ├── marketplace-mobile.png
│   ├── marketplace-tablet.png
│   ├── marketplace-dark-mode.png
│   ├── marketplace-loading.png
│   └── marketplace-error.png
```

## Pixel Diff Thresholds

Tests use configurable thresholds to allow minor rendering differences:

```typescript
await expect(page).toHaveScreenshot('marketplace-page.png', {
  maxDiffPixels: 100,      // Allow up to 100 pixels of difference
  threshold: 0.2,          // Allow up to 20% difference
});
```

Thresholds by component:
- **Full pages**: 100 pixels, 20% threshold
- **Components**: 50 pixels, 15% threshold
- **Responsive**: 150 pixels, 25% threshold

## CI/CD Integration

### GitHub Actions Workflow

Visual regression tests run automatically on:
- Pull requests (when frontend files change)
- Pushes to main branch

**Workflow file**: `.github/workflows/visual-regression.yml`

### PR Comments

Test results are automatically posted to PRs:

```
## Visual Regression Test Results

- ✅ Passed: 10
- ❌ Failed: 0
- ⏭️ Skipped: 0

[View detailed report](...)
```

### Artifacts

Test artifacts are uploaded for 30 days:
- `playwright-report/` - Full test report with diffs
- `visual-baselines/` - Baseline images used

## Troubleshooting

### Tests Fail on First Run

Baseline images don't exist yet. Create them:

```bash
npx playwright test --update-snapshots
git add frontend/tests/e2e/__screenshots__/
git commit -m "chore: add visual regression baselines"
```

### Flaky Tests

If tests fail intermittently, increase wait times:

```typescript
// Wait for content to load
await page.waitForLoadState('networkidle');
await page.waitForSelector('[data-testid="marketplace-container"]', { timeout: 10000 });

// Add explicit wait for animations
await page.waitForTimeout(500);
```

### Different Results on CI vs Local

Ensure consistent environment:

```bash
# Use same Node version
nvm use 18

# Clear cache
rm -rf node_modules package-lock.json
npm install

# Run with CI flag
CI=true npm run test:visual
```

### Snapshot Mismatch on Different OS

Use Docker for consistent rendering:

```bash
docker run -it --rm -v $(pwd):/work -w /work/frontend node:18 \
  bash -c "npm install && npx playwright install --with-deps && npm run test:visual"
```

## Best Practices

1. **Keep snapshots small** - Test individual components, not entire pages
2. **Use data-testid** - Makes selectors stable across refactors
3. **Test key user flows** - Focus on critical paths
4. **Update baselines intentionally** - Review diffs before updating
5. **Commit baselines** - Store in git for version control
6. **Monitor threshold** - Adjust if too strict or too loose
7. **Run locally before PR** - Catch issues early

## Adding New Tests

1. **Identify component to test**
   ```tsx
   <div data-testid="my-component">...</div>
   ```

2. **Add test case**
   ```typescript
   test('my component snapshot', async ({ page }) => {
     await page.goto('/page-with-component');
     await page.waitForSelector('[data-testid="my-component"]');
     
     const component = page.locator('[data-testid="my-component"]');
     await expect(component).toHaveScreenshot('my-component.png', {
       maxDiffPixels: 50,
       threshold: 0.15,
     });
   });
   ```

3. **Generate baseline**
   ```bash
   npx playwright test --update-snapshots
   ```

4. **Commit baseline**
   ```bash
   git add frontend/tests/e2e/__screenshots__/
   git commit -m "test: add visual regression for my component"
   ```

## Performance

- **Test duration**: ~2-3 minutes for full suite
- **Parallel execution**: 4 workers on CI
- **Browsers tested**: Chromium, Firefox, WebKit

## Storybook Component Library

CarbonLedger uses Storybook for component documentation, visual testing, and automated accessibility auditing.

### Running Storybook

```bash
cd frontend
npm run storybook          # Start dev server on http://localhost:6006
npm run build-storybook    # Build static Storybook
```

### Storybook Features

- **Component Documentation**: Every component has stories documenting all states (loading, error, empty, populated, disabled)
- **Dark Mode Toggle**: Use the Theme toolbar to switch between Light, Dark, and System themes
- **Design Tokens**: Access design tokens (colors, typography, spacing, shadows) in the Storybook controls panel
- **Accessibility Audit**: `@storybook/addon-a11y` runs axe-core checks on every story — violations appear in the A11y panel
- **Interaction Testing**: Play functions using `@storybook/test` for interactive components (BulkPurchaseCart, MarketplaceFilter, RetireConfirmModal)

### Accessibility Testing

Every story is automatically audited by axe-core for WCAG 2.1 compliance:

1. Open any story in Storybook
2. Click the **A11y** tab in the bottom panel
3. View violations, incomplete checks, and passing rules
4. Violations are flagged as errors that block merge in CI

### Running A11y Audit in CI

The CI pipeline (`.github/workflows/ci.yml`) runs `@storybook/test-runner` against a built Storybook to catch accessibility regressions before merge:

```bash
# Local: build Storybook and run test-runner
npm run build-storybook
npx test-storybook --url http://localhost:6006
```

### Component Story Coverage

| Component | File | States |
|-----------|------|--------|
| CreditCard | `CreditCard.stories.tsx` | Active, Delisted, StaleOracle, Methodologies, PriceRanges |
| LoadingSkeleton | `LoadingSkeleton.stories.tsx` | 7 variants with counts |
| Toast | `Toast.stories.tsx` | Success, Error, Warning, Info, Multiple, LongMessage |
| ProvenanceTrail | `ProvenanceTrail.stories.tsx` | Populated, Partial, Single, Empty, Recent, Long |
| RetirementCertificate | `RetirementCertificate.stories.tsx` | Populated, LargeAmount, SmallAmount, VariousBeneficiaries |
| ProjectMap | `ProjectMap.stories.tsx` | Empty, Single, Clustered, Filtered |
| Highlight | `Highlight.stories.tsx` | Default, NoMatch, EmptyQuery, CaseInsensitive, MultipleMatches |
| TransactionStatus | `TransactionStatus.stories.tsx` | All 8 statuses with retry |
| TransactionHistory | `TransactionHistory.stories.tsx` | Populated, Loading, Empty, Single |
| MarketplaceError | `MarketplaceError.stories.tsx` | Default, NetworkError, ServerError |
| Tooltip | `Tooltip.stories.tsx` | Default, LongContent, MultiLine, Disabled |
| ThemeToggle | `ThemeToggle.stories.tsx` | Default |
| WalletPrompt | `WalletPrompt.stories.tsx` | NotInstalled, NotConnected, WrongNetwork, Loading, Ready |
| NetworkStatusIndicator | `NetworkStatusIndicator.stories.tsx` | Online, Offline, Syncing, Conflict, Error, BackOnline |
| MapFallbackTable | `MapFallbackTable.stories.tsx` | Populated, Empty, SingleProject |
| RetirementSuccessState | `RetirementSuccessState.stories.tsx` | Default, SmallAmount, LargeAmount |
| RetireConfirmModal | `RetireConfirmModal.stories.tsx` | Default, WithoutOptionalFields, LargeAmount, KeyboardNavigation |
| ErrorBoundary | `ErrorBoundary.stories.tsx` | NoError, WithError, CustomFallback, DevMode |
| BulkPurchaseCart | `BulkPurchaseCart.stories.tsx` | Empty, WithItems, MultipleItems |
| MarketplaceFilter | `MarketplaceFilter.stories.tsx` | Default, WithActiveFilters, WithSearch, Interaction |
| SerialNumberLookup | `SerialNumberLookup.stories.tsx` | Default |
| AuditExplorer | `AuditExplorer.stories.tsx` | Default |
| EsgBarChart | `EsgBarChart.stories.tsx` | Populated, Empty, SingleYear |
| EsgPieChart | `EsgPieChart.stories.tsx` | Populated, Empty, SingleMethodology |
| EsgKpiCards | `EsgKpiCards.stories.tsx` | Default, HighValues, ZeroValues |
| EsgDateRangeFilter | `EsgDateRangeFilter.stories.tsx` | Default, CustomRange, EmptyRange |
| Navbar | `Navbar.stories.tsx` | Default, WithWallet |

### Design Token Reference

Design tokens from `frontend/styles/design-system.ts` are exposed in Storybook controls:

- **Colors**: Primary (green palette), Neutral (gray palette), Semantic (verified, pending, suspended, rejected, completed)
- **Typography**: Font families (Inter, JetBrains Mono), font sizes (xs-5xl), font weights
- **Spacing**: 0-24 scale in rem
- **Border Radius**: sm-full scale
- **Shadows**: sm-xl + certificate shadow

## References

- [Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Tests](https://playwright.dev/docs/debug)
- [Storybook Accessibility Addon](https://storybook.js.org/addons/@storybook/addon-a11y)
- [Storybook Test Runner](https://storybook.js.org/docs/writing-tests/test-runner)
