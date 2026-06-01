import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { name: "marketplace", path: "/marketplace" },
  { name: "audit",       path: "/audit" },
];

for (const { name, path } of PAGES) {
  test(`${name} page has no axe-core WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path);
    // Wait for main content to be rendered
    await page.waitForSelector("main", { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(
      results.violations,
      `axe violations on ${path}:\n${formatViolations(results.violations)}`
    ).toHaveLength(0);
  });
}

function formatViolations(violations: { id: string; impact?: string | null; description: string; nodes: { html: string }[] }[]) {
  return violations
    .map(v => `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.map(n => n.html).join("\n  ")}`)
    .join("\n\n");
}
