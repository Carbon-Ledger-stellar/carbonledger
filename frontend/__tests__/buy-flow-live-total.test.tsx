/**
 * Issue #1596 — Live purchase total in the buy flow.
 *
 * Tests the live-total logic and display independently of the full page component,
 * which has deep dependencies that are difficult to mock in this Babel/Jest setup.
 *
 * Covers:
 * - calculateCreditCost produces the correct total as amount changes.
 * - The LiveTotalBanner renders USDC and tCO₂e units at the given amount.
 * - Units are unambiguous next to every amount.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { calculateCreditCost } from "../lib/carbon-utils";

// ── Helper: a minimal LiveTotalBanner that mirrors the buy-flow implementation ─

function LiveTotalBanner({
  amount,
  pricePerCredit,
  formatCurrency,
}: {
  amount: number;
  pricePerCredit: bigint;
  formatCurrency: (n: bigint) => string;
}) {
  const total = calculateCreditCost(amount, pricePerCredit);
  return (
    <div aria-live="polite" aria-atomic="true">
      <span>You pay</span>
      <span id="buy-live-total">
        ${formatCurrency(total)} USDC{" "}
        <span>for {amount} tCO₂e</span>
      </span>
    </div>
  );
}

// ── Helper: an amount input that updates the total live ───────────────────────

function AmountWithLiveTotal({ pricePerCredit }: { pricePerCredit: bigint }) {
  const [amount, setAmount] = React.useState(1);
  const formatCurrency = (n: bigint) => (Number(n) / 1_000_000).toFixed(2);
  return (
    <>
      <input
        type="number"
        value={amount}
        aria-label="Amount (tonnes CO₂e)"
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v > 0) setAmount(v);
        }}
      />
      <LiveTotalBanner
        amount={amount}
        pricePerCredit={pricePerCredit}
        formatCurrency={formatCurrency}
      />
    </>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

const PRICE_PER_CREDIT = BigInt(5_000_000); // 5 USDC in stroops (10^6 per USDC)

describe("Issue #1596 — live purchase total", () => {
  describe("calculateCreditCost", () => {
    it("computes total correctly for integer amounts", () => {
      // 3 credits × 5 USDC = 15 USDC (expressed in stroops)
      expect(calculateCreditCost(3, BigInt(5_000_000))).toBe(BigInt(15_000_000));
    });

    it("scales proportionally when the amount doubles", () => {
      const base = calculateCreditCost(2, PRICE_PER_CREDIT);
      const doubled = calculateCreditCost(4, PRICE_PER_CREDIT);
      expect(doubled).toBe(base * 2n);
    });

    it("returns 0 for zero amount", () => {
      expect(calculateCreditCost(0, PRICE_PER_CREDIT)).toBe(0n);
    });
  });

  describe("LiveTotalBanner rendering", () => {
    const fmt = (n: bigint) => (Number(n) / 1_000_000).toFixed(2);

    it("renders 'You pay' label", () => {
      render(
        <LiveTotalBanner amount={1} pricePerCredit={PRICE_PER_CREDIT} formatCurrency={fmt} />,
      );
      expect(screen.getByText("You pay")).toBeInTheDocument();
    });

    it("renders USDC unit next to the total", () => {
      render(
        <LiveTotalBanner amount={2} pricePerCredit={PRICE_PER_CREDIT} formatCurrency={fmt} />,
      );
      expect(screen.getByText(/USDC/)).toBeInTheDocument();
    });

    it("renders tCO₂e unit next to the amount", () => {
      render(
        <LiveTotalBanner amount={3} pricePerCredit={PRICE_PER_CREDIT} formatCurrency={fmt} />,
      );
      expect(screen.getByText(/tCO₂e/)).toBeInTheDocument();
    });

    it("shows the correct total for amount=5 at 5 USDC/credit", () => {
      render(
        <LiveTotalBanner amount={5} pricePerCredit={PRICE_PER_CREDIT} formatCurrency={fmt} />,
      );
      expect(screen.getByText(/25\.00 USDC/)).toBeInTheDocument();
    });
  });

  describe("live update on input change", () => {
    it("updates the displayed total when the quantity input changes", () => {
      render(<AmountWithLiveTotal pricePerCredit={PRICE_PER_CREDIT} />);

      // Initial: 1 × 5 USDC = 5.00 USDC
      expect(screen.getByText(/5\.00 USDC/)).toBeInTheDocument();

      // Change to 3
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });

      // Now: 3 × 5 USDC = 15.00 USDC
      expect(screen.getByText(/15\.00 USDC/)).toBeInTheDocument();
    });

    it("the aria-live region updates without requiring a blur event", () => {
      render(<AmountWithLiveTotal pricePerCredit={PRICE_PER_CREDIT} />);

      // Fire change without blur — aria-live="polite" region should still update
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "7" } });

      // 7 × 5 USDC = 35.00 USDC
      expect(screen.getByText(/35\.00 USDC/)).toBeInTheDocument();
    });
  });
});
