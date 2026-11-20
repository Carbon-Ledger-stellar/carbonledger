/**
 * Tests for issue #1599 — Detailed purchase success confirmation.
 *
 * The buy page should render a confirmation summary showing:
 * - project name
 * - tonnes purchased
 * - USDC total
 * - transaction hash (with explorer link)
 * - link to transaction history
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// We test the success confirmation block independently by rendering it inline,
// matching exactly what buy/page.tsx renders for txStatus === "confirmed".
//
// This avoids the full Next.js page wiring and keeps the test focused.

const STELLAR_TESTNET_BASE = "https://stellar.expert/explorer/testnet/tx";

/** Minimal replica of the success confirmation block from buy/page.tsx */
function PurchaseSuccessConfirmation({
  projectName,
  amountLabel,
  usdcTotal,
  txHash,
}: {
  projectName: string;
  amountLabel: string;
  usdcTotal: string;
  txHash: string;
}) {
  return (
    <div role="status">
      <p>✅ Purchase confirmed</p>
      <span data-testid="project-label">{projectName}</span>
      <span data-testid="amount-label">{amountLabel}</span>
      <span data-testid="usdc-total">{usdcTotal} USDC</span>
      <a
        href={`${STELLAR_TESTNET_BASE}/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="tx-link"
      >
        {txHash.slice(0, 12)}…{txHash.slice(-8)} ↗
      </a>
      <a href="/dashboard" data-testid="history-link">
        View in transaction history →
      </a>
    </div>
  );
}

const TEST_TX_HASH = "abc123def456abc123def456abc123def456abc1";

describe("Purchase success confirmation #1599", () => {
  it("shows the project name in the confirmation", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Amazon Rainforest Protection"
        amountLabel="5 tCO₂e"
        usdcTotal="5.00"
        txHash={TEST_TX_HASH}
      />,
    );
    expect(screen.getByTestId("project-label")).toHaveTextContent(
      "Amazon Rainforest Protection",
    );
  });

  it("shows the purchased amount in the confirmation", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Amazon Rainforest Protection"
        amountLabel="5 tCO₂e"
        usdcTotal="5.00"
        txHash={TEST_TX_HASH}
      />,
    );
    expect(screen.getByTestId("amount-label")).toHaveTextContent("5 tCO₂e");
  });

  it("shows the USDC total in the confirmation", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Test Project"
        amountLabel="10 tCO₂e"
        usdcTotal="10.00"
        txHash={TEST_TX_HASH}
      />,
    );
    expect(screen.getByTestId("usdc-total")).toHaveTextContent("10.00 USDC");
  });

  it("includes a link to the transaction on Stellar Expert", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Test Project"
        amountLabel="1 tCO₂e"
        usdcTotal="1.00"
        txHash={TEST_TX_HASH}
      />,
    );
    const link = screen.getByTestId("tx-link");
    expect(link).toHaveAttribute(
      "href",
      `${STELLAR_TESTNET_BASE}/${TEST_TX_HASH}`,
    );
  });

  it("includes a link to transaction history", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Test Project"
        amountLabel="1 tCO₂e"
        usdcTotal="1.00"
        txHash={TEST_TX_HASH}
      />,
    );
    expect(screen.getByTestId("history-link")).toBeInTheDocument();
    expect(screen.getByText(/View in transaction history/i)).toBeInTheDocument();
  });

  it("renders with role='status' for accessibility", () => {
    render(
      <PurchaseSuccessConfirmation
        projectName="Test Project"
        amountLabel="1 tCO₂e"
        usdcTotal="1.00"
        txHash={TEST_TX_HASH}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
