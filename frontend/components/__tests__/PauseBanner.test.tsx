/**
 * PauseBanner – unit tests (Issue #1174)
 *
 * Covers the acceptance criteria from Issue #1174:
 *  ✓ Banner renders when isPaused=true, hidden when isPaused=false
 *  ✓ Color / contrast compliance (class presence for WCAG tokens)
 *  ✓ Text hierarchy (badge → headline → reason → countdown → admin)
 *  ✓ Light/dark mode variants (Tailwind dark: class presence)
 *  ✓ ARIA: role="alert", aria-live="assertive", aria-atomic
 *  ✓ Dismissal: clicking × hides the banner, onDismiss callback fires
 *  ✓ onViewDetails button renders and fires callback
 *  ✓ pausedBy address is truncated and shown
 *  ✓ isDismissible=false hides the dismiss button
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PauseBanner } from "../pause/PauseBanner";

// ── helpers ──────────────────────────────────────────────────────────────────

const FUTURE_TIMESTAMP = Math.floor(Date.now() / 1000) + 3600; // 1 h from now
const ADMIN_ADDRESS =
  "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ"; // example

function renderBanner(overrides: Partial<React.ComponentProps<typeof PauseBanner>> = {}) {
  const props = {
    isPaused: true,
    ...overrides,
  };
  return render(<PauseBanner {...props} />);
}

// ── Visibility ────────────────────────────────────────────────────────────────

describe("PauseBanner – visibility", () => {
  it("renders when isPaused=true", () => {
    renderBanner();
    expect(screen.getByTestId("pause-banner")).toBeInTheDocument();
  });

  it("does NOT render when isPaused=false", () => {
    renderBanner({ isPaused: false });
    expect(screen.queryByTestId("pause-banner")).not.toBeInTheDocument();
  });
});

// ── ARIA / Accessibility ──────────────────────────────────────────────────────

describe("PauseBanner – accessibility", () => {
  it("has role=alert", () => {
    renderBanner();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has aria-live=assertive", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner).toHaveAttribute("aria-live", "assertive");
  });

  it("has aria-atomic=true", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner).toHaveAttribute("aria-atomic", "true");
  });

  it("has a descriptive aria-label", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner).toHaveAttribute("aria-label");
    expect(banner.getAttribute("aria-label")).toMatch(/paused/i);
  });

  it("dismiss button has an aria-label", () => {
    renderBanner({ isDismissible: true });
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn).toHaveAttribute("aria-label");
  });
});

// ── Color / contrast tokens (WCAG AA ≥ 4.5:1) ────────────────────────────────

describe("PauseBanner – color tokens (WCAG AA)", () => {
  it("applies rose-700 background in light mode (contrast 6.4:1)", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    // Tailwind class presence validates the design token is applied.
    expect(banner.className).toContain("bg-rose-700");
  });

  it("applies dark:bg-rose-950 for dark mode (contrast 15.2:1)", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner.className).toContain("dark:bg-rose-950");
  });

  it("uses white foreground text (always ≥ 4.5:1 on rose-700/950)", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner.className).toContain("text-white");
  });

  it("focus ring is visible: focus-visible:ring-white class present on dismiss button", () => {
    renderBanner({ isDismissible: true });
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-white");
  });
});

// ── Text hierarchy ────────────────────────────────────────────────────────────

describe("PauseBanner – text hierarchy", () => {
  it("renders the EMERGENCY NOTICE badge (level 1)", () => {
    renderBanner();
    expect(screen.getByText(/emergency notice/i)).toBeInTheDocument();
  });

  it("renders the status headline (level 2)", () => {
    renderBanner();
    expect(
      screen.getByText(/contract operations are temporarily paused/i)
    ).toBeInTheDocument();
  });

  it("renders optional reason text (level 3)", () => {
    renderBanner({ reason: "Security investigation in progress." });
    expect(
      screen.getByText("Security investigation in progress.")
    ).toBeInTheDocument();
  });

  it("does NOT render reason element when reason is omitted", () => {
    renderBanner({ reason: undefined });
    expect(
      screen.queryByText(/security investigation/i)
    ).not.toBeInTheDocument();
  });

  it("renders countdown when pausedUntil is provided (level 4)", () => {
    renderBanner({ pausedUntil: FUTURE_TIMESTAMP });
    // Should contain 'h' and 'm' or 'remaining'
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
  });

  it("renders paused-by address when provided (level 5)", () => {
    renderBanner({ pausedBy: ADMIN_ADDRESS });
    // Full or truncated address should appear
    expect(screen.getByText(/paused by/i)).toBeInTheDocument();
  });

  it("truncates a long Stellar address to compact form", () => {
    renderBanner({ pausedBy: ADMIN_ADDRESS });
    // Full 56-char address should NOT be visible verbatim (truncated)
    expect(screen.queryByText(ADMIN_ADDRESS)).not.toBeInTheDocument();
    // But the truncated version (G...UJUJ) should appear somewhere
    expect(screen.getByText(/G…/)).toBeInTheDocument();
  });
});

// ── Light / dark mode variants ────────────────────────────────────────────────

describe("PauseBanner – light/dark mode variants", () => {
  it("applies dark:border-b and dark:border-rose-800", () => {
    renderBanner();
    const banner = screen.getByTestId("pause-banner");
    expect(banner.className).toContain("dark:border-b");
    expect(banner.className).toContain("dark:border-rose-800");
  });

  it("Details button has dark mode hover class", () => {
    renderBanner({ onViewDetails: jest.fn() });
    const btn = screen.getByRole("button", { name: /details/i });
    expect(btn.className).toContain("dark:hover:bg-rose-800");
  });

  it("badge uses translucent white/20 background (visible in both modes)", () => {
    renderBanner();
    const badge = screen.getByText(/emergency notice/i);
    expect(badge.className).toContain("bg-white/20");
  });
});

// ── Icon / typography balance ─────────────────────────────────────────────────

describe("PauseBanner – icon presence", () => {
  it("renders the warning SVG icon", () => {
    renderBanner();
    const icon = screen
      .getByTestId("pause-banner")
      .querySelector("svg");
    expect(icon).toBeInTheDocument();
  });

  it("icon wrapper has aria-hidden=true (does not add redundant AT text)", () => {
    renderBanner();
    const iconWrapper = screen
      .getByTestId("pause-banner")
      .querySelector("[aria-hidden='true']");
    expect(iconWrapper).toBeInTheDocument();
  });
});

// ── Dismissal ─────────────────────────────────────────────────────────────────

describe("PauseBanner – dismissal", () => {
  it("hides the banner when dismiss button is clicked", () => {
    renderBanner({ isDismissible: true });
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("pause-banner")).not.toBeInTheDocument();
  });

  it("calls onDismiss callback when dismiss is clicked", () => {
    const onDismiss = jest.fn();
    renderBanner({ isDismissible: true, onDismiss });
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does NOT render dismiss button when isDismissible=false", () => {
    renderBanner({ isDismissible: false });
    expect(
      screen.queryByRole("button", { name: /dismiss/i })
    ).not.toBeInTheDocument();
  });
});

// ── Details button ────────────────────────────────────────────────────────────

describe("PauseBanner – onViewDetails", () => {
  it("renders Details button when onViewDetails is provided", () => {
    renderBanner({ onViewDetails: jest.fn() });
    expect(screen.getByRole("button", { name: /details/i })).toBeInTheDocument();
  });

  it("calls onViewDetails when Details is clicked", () => {
    const onViewDetails = jest.fn();
    renderBanner({ onViewDetails });
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("does NOT render Details button when onViewDetails is omitted", () => {
    renderBanner({ onViewDetails: undefined });
    expect(
      screen.queryByRole("button", { name: /details/i })
    ).not.toBeInTheDocument();
  });
});

// ── Customisation ─────────────────────────────────────────────────────────────

describe("PauseBanner – className prop", () => {
  it("appends extra className to the root element", () => {
    renderBanner({ className: "my-custom-class" });
    const banner = screen.getByTestId("pause-banner");
    expect(banner.className).toContain("my-custom-class");
  });
});
