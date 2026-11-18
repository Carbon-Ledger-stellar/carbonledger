import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import PurchaseConfirmation from "../PurchaseConfirmation";

jest.mock("../../styles/design-system", () => ({
  colors: {
    primary: { 50: "#f0fdf4", 600: "#16a34a", 700: "#15803d" },
    neutral: { 500: "#6b7280", 600: "#4b5563", 900: "#111827" },
    verified: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
    surface: "#ffffff",
  },
}));

const TXHASH =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("PurchaseConfirmation", () => {
  it("renders the project name, tonnes and total", () => {
    render(
      <PurchaseConfirmation
        projectName="Amazon Reforestation Project"
        tonnesLabel="10 tCO₂e"
        totalLabel="$100.00 USDC"
        txHash={TXHASH}
      />,
    );
    expect(
      screen.getByText("Amazon Reforestation Project"),
    ).toBeInTheDocument();
    expect(screen.getByText("10 tCO₂e")).toBeInTheDocument();
    expect(screen.getByText("$100.00 USDC")).toBeInTheDocument();
    expect(screen.getByText(/purchase confirmed/i)).toBeInTheDocument();
  });

  it("renders the transaction hash (truncated)", () => {
    render(
      <PurchaseConfirmation
        projectName="Project X"
        tonnesLabel="1 tCO₂e"
        totalLabel="$10.00 USDC"
        txHash={TXHASH}
      />,
    );
    const expected = `Tx ${TXHASH.slice(0, 12)}…${TXHASH.slice(-12)}`;
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("links to the purchase history", () => {
    render(
      <PurchaseConfirmation
        projectName="Project X"
        tonnesLabel="1 tCO₂e"
        totalLabel="$10.00 USDC"
        historyHref="/dashboard"
      />,
    );
    const link = screen.getByRole("link", { name: /view purchase history/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("omits the transaction hash line when no hash is provided", () => {
    render(
      <PurchaseConfirmation
        projectName="Project X"
        tonnesLabel="1 tCO₂e"
        totalLabel="$10.00 USDC"
      />,
    );
    expect(screen.queryByText(/^Tx /i)).not.toBeInTheDocument();
  });

  it("is announced as a polite status region", () => {
    render(
      <PurchaseConfirmation
        projectName="Project X"
        tonnesLabel="1 tCO₂e"
        totalLabel="$10.00 USDC"
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
