/**
 * WCAG 2.1 AA — ARIA live region tests
 *
 * Acceptance criteria:
 *  - Transaction status updates announced via aria-live="polite"
 *  - Oracle status changes announced via aria-live="polite"
 *  - Filter result count updates announced (e.g. "24 listings found")
 *  - Error messages announced via aria-live="assertive"
 *  - Live regions do not cause duplicate announcements
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter:      () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("../lib/admin-api", () => ({
  useOracleHealth: jest.fn(),
}));

import { useOracleHealth } from "../lib/admin-api";
const mockUseOracleHealth = useOracleHealth as jest.Mock;

import TransactionStatus from "../components/TransactionStatus";
import OracleStatus      from "../components/OracleStatus";
import MarketplaceFilter, { EMPTY_FILTERS } from "../components/MarketplaceFilter";
import Toast, { ToastMessage } from "../components/Toast";

// ─── TransactionStatus ────────────────────────────────────────────────────────

describe("TransactionStatus — ARIA live regions", () => {
  it("has a single live region (no duplicates) for polite statuses", () => {
    render(<TransactionStatus status="building" />);
    const liveRegions = document.querySelectorAll("[aria-live]");
    expect(liveRegions).toHaveLength(1);
  });

  it("uses aria-live=polite for in-progress statuses", () => {
    const inProgress = ["building", "signing", "submitting", "polling", "pending", "submitted"] as const;
    for (const status of inProgress) {
      const { unmount } = render(<TransactionStatus status={status} />);
      const region = document.querySelector("[aria-live]");
      expect(region).toHaveAttribute("aria-live", "polite");
      unmount();
    }
  });

  it("uses aria-live=assertive and role=alert for failed status", () => {
    render(<TransactionStatus status="failed" />);
    const region = document.querySelector("[aria-live]");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveAttribute("role", "alert");
  });

  it("uses aria-live=polite and role=status for confirmed status", () => {
    render(<TransactionStatus status="confirmed" />);
    const region = document.querySelector("[aria-live]");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("role", "status");
  });

  it("wraps both label and message in the single live region", () => {
    render(<TransactionStatus status="failed" message="Something went wrong" />);
    const region = document.querySelector("[aria-live]")!;
    expect(region).toHaveTextContent("Transaction failed");
    expect(region).toHaveTextContent("Something went wrong");
  });

  it("has aria-atomic=true on the live region", () => {
    render(<TransactionStatus status="confirmed" />);
    expect(document.querySelector("[aria-live]")).toHaveAttribute("aria-atomic", "true");
  });
});

// ─── OracleStatus ─────────────────────────────────────────────────────────────

describe("OracleStatus — ARIA live regions", () => {
  it("wraps dynamic content in aria-live=polite region", () => {
    mockUseOracleHealth.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<OracleStatus />);
    expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it("announces error via assertive live region", () => {
    mockUseOracleHealth.mockReturnValue({ data: null, isLoading: false, error: new Error("fail") });
    render(<OracleStatus />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Failed to load oracle health data.");
  });

  it("does not duplicate live regions — exactly one polite wrapper", () => {
    mockUseOracleHealth.mockReturnValue({
      data: [{ projectId: "p1", projectName: "Test Project", daysSinceUpdate: 10, lastMonitored: new Date().toISOString() }],
      isLoading: false,
      error: null,
    });
    render(<OracleStatus />);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });
});

// ─── MarketplaceFilter ────────────────────────────────────────────────────────

describe("MarketplaceFilter — ARIA live regions", () => {
  it("announces result count via polite live region", () => {
    render(<MarketplaceFilter filters={EMPTY_FILTERS} onChange={jest.fn()} resultCount={24} />);
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("24 listings found");
  });

  it("uses singular form for 1 result", () => {
    render(<MarketplaceFilter filters={EMPTY_FILTERS} onChange={jest.fn()} resultCount={1} />);
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent("1 listing found");
  });

  it("renders no live region when resultCount is undefined", () => {
    render(<MarketplaceFilter filters={EMPTY_FILTERS} onChange={jest.fn()} />);
    expect(document.querySelector('[aria-live="polite"]')).not.toBeInTheDocument();
  });

  it("live region is visually hidden (not visible to sighted users)", () => {
    render(<MarketplaceFilter filters={EMPTY_FILTERS} onChange={jest.fn()} resultCount={5} />);
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region.style.position).toBe("absolute");
    expect(region.style.width).toBe("1px");
    expect(region.style.height).toBe("1px");
  });
});

// ─── Toast ────────────────────────────────────────────────────────────────────

describe("Toast — ARIA live regions", () => {
  const makeToast = (overrides: Partial<ToastMessage>): ToastMessage => ({
    id: "t1", type: "info", title: "Info", ...overrides,
  });

  it("uses role=status and aria-live=polite for success toasts", () => {
    render(<Toast toasts={[makeToast({ type: "success", title: "Saved" })]} onDismiss={jest.fn()} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("uses role=alert and aria-live=assertive for error toasts", () => {
    render(<Toast toasts={[makeToast({ type: "error", title: "Failed" })]} onDismiss={jest.fn()} />);
    const el = screen.getByRole("alert");
    expect(el).toHaveAttribute("aria-live", "assertive");
  });

  it("uses role=alert and aria-live=assertive for warning toasts", () => {
    render(<Toast toasts={[makeToast({ type: "warning", title: "Warning" })]} onDismiss={jest.fn()} />);
    const el = screen.getByRole("alert");
    expect(el).toHaveAttribute("aria-live", "assertive");
  });

  it("uses role=status and aria-live=polite for info toasts", () => {
    render(<Toast toasts={[makeToast({ type: "info", title: "FYI" })]} onDismiss={jest.fn()} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("each toast has aria-atomic=true", () => {
    render(<Toast toasts={[makeToast({ type: "success", title: "Done" })]} onDismiss={jest.fn()} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  });

  it("multiple toasts each have their own live region (no shared wrapper)", () => {
    const toasts = [
      makeToast({ id: "1", type: "success", title: "A" }),
      makeToast({ id: "2", type: "error",   title: "B" }),
    ];
    render(<Toast toasts={toasts} onDismiss={jest.fn()} />);
    // One status + one alert — each toast is its own live region
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
