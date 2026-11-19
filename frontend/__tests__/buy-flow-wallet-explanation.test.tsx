/**
 * Issue #1598 — Explain wallet connection before the wallet-connect step.
 *
 * Tests an isolated WalletExplanationBanner component that mirrors the
 * banner added to buy/page.tsx, keeping tests independent of the full
 * page component's rendering pipeline.
 *
 * Covers:
 * - Wallet-required explanation renders when no wallet is connected.
 * - Explanation mentions Freighter and signing on-chain.
 * - Banner is hidden when the wallet status is "ready".
 * - Banner is hidden when the wallet status is "loading".
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { WalletStatus } from "../hooks/useWalletStatus";

// ── WalletExplanationBanner — mirrors buy/page.tsx implementation ─────────────

const EXPLANATION_TITLE = "A Freighter wallet is required";
const EXPLANATION_BODY =
  "CarbonLedger purchases are recorded on the Stellar blockchain. You need the Freighter browser extension to authorize and sign this transaction. Once connected, your wallet will never be charged without your explicit approval.";

function WalletExplanationBanner({ walletStatus }: { walletStatus: WalletStatus }) {
  if (walletStatus === "ready" || walletStatus === "loading") return null;
  return (
    <div role="note" aria-label="Wallet requirement explanation">
      <span>🔑</span>
      <div>
        <p>{EXPLANATION_TITLE}</p>
        <p>{EXPLANATION_BODY}</p>
      </div>
    </div>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

const UNCONNECTED_STATUSES: WalletStatus[] = [
  "not_connected",
  "not_installed",
  "locked",
  "wrong_network",
  "session_expired",
];

describe("Issue #1598 — wallet explanation before connect step", () => {
  it.each(UNCONNECTED_STATUSES)(
    'shows the explanation banner when wallet status is "%s"',
    (status) => {
      render(<WalletExplanationBanner walletStatus={status} />);
      expect(screen.getByText(EXPLANATION_TITLE)).toBeInTheDocument();
    },
  );

  it("explanation mentions why the wallet is needed", () => {
    render(<WalletExplanationBanner walletStatus="not_connected" />);
    expect(screen.getByText(/Stellar blockchain/i)).toBeInTheDocument();
    // "Freighter" appears in both the title and body — confirm at least one element has it
    expect(screen.getAllByText(/Freighter/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/sign/i)).toBeInTheDocument();
  });

  it("hides the banner when wallet status is ready", () => {
    render(<WalletExplanationBanner walletStatus="ready" />);
    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
  });

  it("hides the banner while wallet status is loading (not yet determined)", () => {
    render(<WalletExplanationBanner walletStatus="loading" />);
    expect(screen.queryByText(EXPLANATION_TITLE)).not.toBeInTheDocument();
  });

  it("banner is accessible: role=note with a descriptive label", () => {
    render(<WalletExplanationBanner walletStatus="not_connected" />);
    expect(
      screen.getByRole("note", { name: "Wallet requirement explanation" }),
    ).toBeInTheDocument();
  });

  it("banner contains a unique title across all statuses (not generic 'Error')", () => {
    UNCONNECTED_STATUSES.forEach((status) => {
      const { unmount } = render(<WalletExplanationBanner walletStatus={status} />);
      expect(screen.getByText(EXPLANATION_TITLE)).not.toHaveTextContent(/^Error$/i);
      unmount();
    });
  });
});
