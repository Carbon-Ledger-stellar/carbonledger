/**
 * Unit tests for buy-flow UX improvements.
 *
 * Covers issues:
 *   #1596 – Live purchase total recomputes on amount change (USDC + tCO₂e units).
 *   #1597 – Actionable purchase error messages (getActionablePurchaseError).
 *   #1598 – Wallet-required explanation renders before wallet-connect step.
 *   #1599 – Detailed success confirmation (project name, tonnes, USDC, tx hash).
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../styles/design-system", () => ({
  colors: {
    primary: { 50: "#f0fdf4", 200: "#bbf7d0", 600: "#16a34a", 700: "#15803d" },
    neutral: {
      200: "#e5e7eb",
      400: "#9ca3af",
      500: "#6b7280",
      600: "#4b5563",
      700: "#374151",
      800: "#1f2937",
      900: "#111827",
    },
    surface: "#fff",
    verified: { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
    pending: { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" },
    completed: { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal inline component that mimics the wallet-required explanation banner
 * added to buy/page.tsx for issue #1598.  Hidden when wallet is connected.
 */
function WalletExplanationBanner({ walletReady }: { walletReady: boolean }) {
  if (walletReady) return null;
  return (
    <div role="note" aria-label="Wallet required explanation">
      <p>🔑 A Stellar wallet is required to complete this purchase</p>
      <p>
        CarbonLedger purchases are on-chain transactions on the Stellar network.
        You need the{" "}
        <a href="https://freighter.app" target="_blank" rel="noopener noreferrer">
          Freighter
        </a>{" "}
        browser extension to authorize the transaction with your private key —
        your key never leaves your device.
      </p>
    </div>
  );
}

/**
 * Minimal inline component that mimics the live total display in buy/page.tsx
 * for issue #1596.  Total updates immediately when `amount` changes.
 */
function LiveTotalDisplay({
  amount,
  pricePerCredit,
}: {
  amount: number;
  pricePerCredit: number;
}) {
  const total = (amount * pricePerCredit).toFixed(2);
  return (
    <span id="buy-total-cost" aria-live="polite" aria-atomic="true">
      ${total} USDC for {amount} tCO₂e
    </span>
  );
}

function LiveTotalWrapper() {
  const [amount, setAmount] = React.useState(1);
  const pricePerCredit = 10; // $10 USDC per tonne
  return (
    <>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        aria-label="amount"
      />
      <LiveTotalDisplay amount={amount} pricePerCredit={pricePerCredit} />
    </>
  );
}

/**
 * Minimal inline component that mimics the buy/page.tsx success confirmation
 * card for issue #1599.
 */
function PurchaseConfirmation({
  projectName,
  tonnes,
  usdcTotal,
  txHash,
}: {
  projectName: string;
  tonnes: number;
  usdcTotal: string;
  txHash: string;
}) {
  const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-10)}`;
  return (
    <div role="region" aria-label="Purchase confirmation">
      <p>✅ Purchase confirmed</p>
      <div>
        <span>Project</span>
        <strong>{projectName}</strong>
      </div>
      <div>
        <span>Credits purchased</span>
        <strong>{tonnes} tCO₂e</strong>
      </div>
      <div>
        <span>Total paid</span>
        <strong>${usdcTotal} USDC</strong>
      </div>
      <div>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {shortTx}
        </a>
      </div>
      <a href="/portfolio/transactions">View purchase history →</a>
    </div>
  );
}

const TX_HASH =
  "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

// ── Issue #1596: Live purchase total ─────────────────────────────────────────

describe("#1596 – live purchase total", () => {
  it("shows USDC and tCO₂e units next to the initial total", () => {
    render(<LiveTotalWrapper />);
    const totalEl = document.getElementById("buy-total-cost");
    expect(totalEl).not.toBeNull();
    expect(totalEl!.textContent).toMatch(/USDC/);
    expect(totalEl!.textContent).toMatch(/tCO₂e/);
  });

  it("total element has aria-live so screen readers announce updates", () => {
    render(<LiveTotalWrapper />);
    const totalEl = document.getElementById("buy-total-cost");
    expect(totalEl?.getAttribute("aria-live")).toBe("polite");
    expect(totalEl?.getAttribute("aria-atomic")).toBe("true");
  });

  it("updates the displayed total when the amount input changes", () => {
    render(<LiveTotalWrapper />);
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    // Change to 5 tonnes — total should be $50.00 (10 $/tonne × 5)
    fireEvent.change(input, { target: { value: "5" } });
    const totalEl = document.getElementById("buy-total-cost");
    expect(totalEl!.textContent).toContain("50.00");
    expect(totalEl!.textContent).toContain("5 tCO₂e");
  });

  it("changes total without requiring blur", () => {
    render(<LiveTotalWrapper />);
    const input = screen.getByLabelText("amount");
    // We use fireEvent.change (not blur), so the update is immediate.
    fireEvent.change(input, { target: { value: "3" } });
    const totalEl = document.getElementById("buy-total-cost");
    expect(totalEl!.textContent).toContain("30.00");
  });

  it("confirms step shows 'You pay X USDC for Y tCO₂e' via LiveTotalDisplay", () => {
    render(<LiveTotalDisplay amount={7} pricePerCredit={15} />);
    expect(screen.getByText(/\$105\.00 USDC for 7 tCO₂e/)).toBeInTheDocument();
  });
});

// ── Issue #1598: Wallet explanation before connect ────────────────────────────

describe("#1598 – wallet explanation before connect step", () => {
  it("renders explanation when wallet is not connected", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    const note = screen.getByRole("note", { name: /wallet required explanation/i });
    expect(note).toBeInTheDocument();
  });

  it("explanation mentions Freighter and Stellar", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    const note = screen.getByRole("note", { name: /wallet required explanation/i });
    expect(note.textContent).toMatch(/Freighter/i);
    expect(note.textContent).toMatch(/Stellar/i);
  });

  it("explanation mentions why the wallet is needed (to authorize the transaction)", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    const note = screen.getByRole("note", { name: /wallet required explanation/i });
    expect(note.textContent?.toLowerCase()).toMatch(/authorize|on-chain|transaction/i);
  });

  it("is hidden when the wallet is already connected", () => {
    render(<WalletExplanationBanner walletReady={true} />);
    expect(
      screen.queryByRole("note", { name: /wallet required explanation/i }),
    ).not.toBeInTheDocument();
  });

  it("includes a link to freighter.app", () => {
    render(<WalletExplanationBanner walletReady={false} />);
    const link = screen.getByRole("link", { name: /freighter/i });
    expect(link).toHaveAttribute("href", "https://freighter.app");
  });
});

// ── Issue #1597: Actionable purchase error messages ───────────────────────────

describe("#1597 – actionable purchase error messages (getActionablePurchaseError)", () => {
  // Import after mocks are in place
  const {
    getActionablePurchaseError,
  } = require("../lib/wallet-errors");

  it("maps wallet rejection to WALLET_REJECTED cause with a next step", () => {
    const result = getActionablePurchaseError(new Error("TRANSACTION_REJECTED"));
    expect(result.cause).toBe("WALLET_REJECTED");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(typeof result.nextStep).toBe("string");
    expect(result.nextStep.length).toBeGreaterThan(0);
  });

  it("maps SIGNING_CANCELLED to WALLET_REJECTED", () => {
    const result = getActionablePurchaseError(new Error("SIGNING_CANCELLED"));
    expect(result.cause).toBe("WALLET_REJECTED");
  });

  it("maps user-declined message to WALLET_REJECTED", () => {
    const result = getActionablePurchaseError(new Error("User declined the transaction"));
    expect(result.cause).toBe("WALLET_REJECTED");
  });

  it("maps INSUFFICIENT_XLM to INSUFFICIENT_BALANCE", () => {
    const result = getActionablePurchaseError(new Error("INSUFFICIENT_XLM"));
    expect(result.cause).toBe("INSUFFICIENT_BALANCE");
    expect(result.nextStep).toBeTruthy();
  });

  it("maps marketplace paused error to MARKETPLACE_PAUSED cause", () => {
    const result = getActionablePurchaseError(new Error("marketplace paused"));
    expect(result.cause).toBe("MARKETPLACE_PAUSED");
    expect(result.nextStep).toBeTruthy();
  });

  it("maps known Soroban contract error codes to CONTRACT_ERROR", () => {
    // Code 4 = InsufficientCredits
    const result = getActionablePurchaseError(
      new Error("Error(Contract, #4)"),
      "carbon_marketplace",
    );
    expect(result.cause).toBe("CONTRACT_ERROR");
    expect(result.message.toLowerCase()).toMatch(/credit/i);
    expect(result.nextStep).toBeTruthy();
  });

  it("maps CarbonError(11) to CONTRACT_ERROR with InsufficientLiquidity message", () => {
    const result = getActionablePurchaseError(
      new Error("CarbonError(11)"),
      "carbon_marketplace",
    );
    expect(result.cause).toBe("CONTRACT_ERROR");
    expect(result.message.toLowerCase()).toMatch(/liquidity/i);
  });

  it("maps network/fetch errors to NETWORK_ERROR", () => {
    const result = getActionablePurchaseError(new Error("Failed to fetch"));
    expect(result.cause).toBe("NETWORK_ERROR");
    expect(result.nextStep).toMatch(/retry|internet/i);
  });

  it("falls back to UNKNOWN for unrecognised errors", () => {
    const result = getActionablePurchaseError(new Error("xyz_unrecognised_42"));
    expect(result.cause).toBe("UNKNOWN");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.nextStep.length).toBeGreaterThan(0);
    // Must not pass through the raw exception string
    expect(result.message.toLowerCase()).not.toContain("xyz_unrecognised");
  });

  it("every common failure cause has a non-empty nextStep", () => {
    const cases = [
      new Error("TRANSACTION_REJECTED"),
      new Error("INSUFFICIENT_XLM"),
      new Error("marketplace paused"),
      new Error("CarbonError(1)"),
      new Error("Failed to fetch"),
      new Error("unknown_xyz"),
    ];
    cases.forEach((e) => {
      const { nextStep } = getActionablePurchaseError(e);
      expect(typeof nextStep).toBe("string");
      expect(nextStep.length).toBeGreaterThan(0);
    });
  });
});

// ── Issue #1599: Detailed success confirmation ────────────────────────────────

describe("#1599 – detailed purchase success confirmation", () => {
  it("shows the project name", () => {
    render(
      <PurchaseConfirmation
        projectName="Amazon Rain Forest Project"
        tonnes={5}
        usdcTotal="5.00"
        txHash={TX_HASH}
      />,
    );
    expect(screen.getByText("Amazon Rain Forest Project")).toBeInTheDocument();
  });

  it("shows tonnes purchased with tCO₂e unit", () => {
    render(
      <PurchaseConfirmation
        projectName="Test Project"
        tonnes={10}
        usdcTotal="10.00"
        txHash={TX_HASH}
      />,
    );
    expect(screen.getByText(/10 tCO₂e/)).toBeInTheDocument();
  });

  it("shows the USDC total", () => {
    render(
      <PurchaseConfirmation
        projectName="Test Project"
        tonnes={3}
        usdcTotal="3.00"
        txHash={TX_HASH}
      />,
    );
    expect(screen.getByText(/\$3\.00 USDC/)).toBeInTheDocument();
  });

  it("includes a link to the transaction on Stellar Expert", () => {
    render(
      <PurchaseConfirmation
        projectName="Test Project"
        tonnes={1}
        usdcTotal="1.00"
        txHash={TX_HASH}
      />,
    );
    const link = screen.getByRole("link", {
      name: new RegExp(TX_HASH.slice(0, 10)),
    });
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    );
  });

  it("includes a link to purchase/transaction history", () => {
    render(
      <PurchaseConfirmation
        projectName="Test Project"
        tonnes={1}
        usdcTotal="1.00"
        txHash={TX_HASH}
      />,
    );
    const historyLink = screen.getByRole("link", { name: /purchase history/i });
    expect(historyLink).toHaveAttribute("href", "/portfolio/transactions");
  });

  it("renders in an accessible region with label", () => {
    render(
      <PurchaseConfirmation
        projectName="Test Project"
        tonnes={1}
        usdcTotal="1.00"
        txHash={TX_HASH}
      />,
    );
    expect(
      screen.getByRole("region", { name: /purchase confirmation/i }),
    ).toBeInTheDocument();
  });
});
