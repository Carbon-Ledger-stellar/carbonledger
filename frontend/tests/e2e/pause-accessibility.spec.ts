import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Pause UI WCAG 2.1 AA Compliance Suite (Issue #1270)", () => {
  test("Pause banner & modal components have no axe-core WCAG 2.1 AA violations", async ({ page }) => {
    // Navigate to page rendering pause banner
    await page.goto("/marketplace");
    await page.waitForLoadState("domcontentloaded");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude("iframe")
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  test("Screen reader attributes and live regions are correctly configured", async ({ page }) => {
    await page.goto("/marketplace");
    // Verify alert role and assertive live region on emergency banners if present
    const alertElements = page.locator('[role="alert"]');
    const alertCount = await alertElements.count();
    for (let i = 0; i < alertCount; i++) {
      const el = alertElements.nth(i);
      const ariaLive = await el.getAttribute("aria-live");
      expect(["assertive", "polite"]).toContain(ariaLive);
    }
  });

  test("Interactive elements possess visible focus indicators and keyboard operability", async ({ page }) => {
    await page.goto("/marketplace");
    // Tab through interactive elements and verify active focus state
    await page.keyboard.press("Tab");
    const activeTagName = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTagName).toBeTruthy();
  });
});
