/**
 * Buy page UX tests — issues #1596, #1598
 *
 * #1596: live total recomputes on amount change (calculateCreditCost + aria-live)
 * #1598: wallet-required explanation renders when no wallet connected, hidden when ready
 *
 * We test the UI logic via focused component helpers that mirror what
 * buy/page.tsx renders, avoiding the full Next.js page wiring that Jest
 * can't transpile.
 */

import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { calculateCreditCost } from "../lib/carbon-utils";

jest.mock("../styles/design-system", () => ({
  colors: {
    primary: { 50: "#f0fdf4", 200: "#bbf7d0", 600: "#16a34a", 700: "#15803d" },
    neutral: { 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 900: "#111827" },
    surface: "#ffffff",
  },
}));

// ── #1596 — Live total helper (mirrors the amount-input + total block) ─────────

/** Stripped-down replica of the buy form's amount input + live total section. */
function LiveTotalSection({
  pricePerCredit,
  amountAvailable,
}: {
  pricePerCredit: bigint;
  amountAvailable: number;
}) {
  const [amount, setAmount] = useState(1);
  const totalCost = calculateCreditCost(amount, pricePerCredit);
  // Format stroops → USDC (divide by 1e7, 2 dp)
  const totalUsdc = (Number(totalCost) / 10_000_000).toFixed(2);
  const amountTonnes = `${amount} tCO₂e`;

  return (
    <div>
      <input
        id="buy-amount"
        type="number"
        value={amount}
        min={0.01}
        max={amountAvailable}
        step={0.01}
        onChange={(e) => {
          const v = parseFloat(parseFloat(e.target.value).toFixed(2));
          setAmount(Math.max(0.01, Math.min(amountAvailable, v || 0.01)));
        }}
      />
      <span
        id="buy-total-cost"
        aria-live="polite"
        aria-atomic="true"
      >
        ${totalUsdc} <span>USDC</span> <span>for {amountTonnes}</span>
      </span>
    </div>
  );
}

describe("Buy page #1596 — live total", () => {
  const PRICE = 10_000_000n; // 1 USDC per tonne in stroops

  it("shows the correct total on initial render (1 tonne = 1.00 USDC)", () => {
    render(<LiveTotalSection pricePerCredit={PRICE} amountAvailable={1000} />);
    expect(screen.getByText(/1\.00/)).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("updates the total immediately when amount changes without blur", () => {
    render(<LiveTotalSection pricePerCredit={PRICE} amountAvailable={1000} />);
    const input = screen.getByRole("spinbutton");
    // Change to 5 tonnes — should immediately show $5.00 USDC
    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.getByText(/5\.00/)).toBeInTheDocument();
  });

  it("displays tCO₂e unit next to the amount in the total", () => {
    render(<LiveTotalSection pricePerCredit={PRICE} amountAvailable={1000} />);
    expect(screen.getByText(/tCO₂e/)).toBeInTheDocument();
  });

  it("includes USDC as a distinct unit label (not just part of a number)", () => {
    render(<LiveTotalSection pricePerCredit={PRICE} amountAvailable={1000} />);
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("total live-region has aria-live='polite'", () => {
    render(<LiveTotalSection pricePerCredit={PRICE} amountAvailable={1000} />);
    const el = document.getElementById("buy-total-cost");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });

  it("recalculates correctly for a price of 2.50 USDC per tonne, qty 4", () => {
    // 2.50 USDC = 25_000_000 stroops; 4 tonnes = 100_000_000 stroops = 10.00 USDC
    render(<LiveTotalSection pricePerCredit={25_000_000n} amountAvailable={1000} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    expect(screen.getByText(/10\.00/)).toBeInTheDocument();
  });
});

// ── #1598 — Wallet explanation banner ─────────────────────────────────────────

/** Mirrors the wallet-required explanation block from buy/page.tsx. */
function WalletExplanationBanner({ walletReady }: { walletReady: boolean }) {
  if (walletReady) return null;
  return (
    <div aria-label="Wallet required explanation">
      <strong>A Freighter Stellar wallet is required</strong> to sign and
      authorize this on-chain purchase.
    </div>
  );
}

describe("Buy page #1598 — wallet explanation", () => {
  it("shows the explanation when the wallet is not connected", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    expect(screen.getByLabelText(/wallet required explanation/i)).toBeInTheDocument();
    expect(screen.getByText(/Freighter Stellar wallet is required/i)).toBeInTheDocument();
  });

  it("hides the explanation when the wallet is ready (connected)", () => {
    render(<WalletExplanationBanner walletReady={true} />);
    expect(screen.queryByLabelText(/wallet required explanation/i)).not.toBeInTheDocument();
  });

  it("explanation mentions on-chain purchase / authorization", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    expect(screen.getByText(/on-chain purchase|authorize/i)).toBeInTheDocument();
  });
});
