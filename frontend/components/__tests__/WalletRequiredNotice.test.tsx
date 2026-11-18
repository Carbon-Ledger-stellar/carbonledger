import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import WalletRequiredNotice from "../WalletRequiredNotice";

jest.mock("../../styles/design-system", () => ({
  colors: {
    primary: { 50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 600: "#16a34a", 700: "#15803d" },
    neutral: { 500: "#6b7280", 600: "#4b5563", 800: "#1f2937" },
    surface: "#ffffff",
  },
}));

describe("WalletRequiredNotice", () => {
  it("renders the wallet-required explanation when visible", () => {
    render(<WalletRequiredNotice visible={true} />);
    expect(
      screen.getByText(/a stellar wallet is required to sign this purchase/i),
    ).toBeInTheDocument();
    // Explains *why* and *when* the connection happens, before the connect step.
    expect(screen.getByText(/connect your freighter wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/before checkout/i)).toBeInTheDocument();
  });

  it("renders nothing when not visible (wallet is ready)", () => {
    const { container } = render(<WalletRequiredNotice visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes an accessible label so screen readers announce the notice", () => {
    render(<WalletRequiredNotice visible={true} />);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute(
      "aria-label",
      "Wallet required to complete this purchase",
    );
  });
});
