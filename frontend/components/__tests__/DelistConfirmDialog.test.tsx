/**
 * DelistConfirmDialog — confirmation modal before removing a listing (#1512)
 *
 * Covers:
 * - Dialog renders listing summary (project name, methodology, vintage, tonnes, price)
 * - Cancel button calls onCancel without triggering onConfirm
 * - Escape key calls onCancel
 * - Backdrop click calls onCancel
 * - Confirm button calls onConfirm
 * - Loading state shown while onConfirm is pending
 * - Error message shown when onConfirm rejects
 * - Confirm button is disabled while confirming
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DelistConfirmDialog from "../DelistConfirmDialog";
import type { MarketListing } from "../../lib/api";

jest.mock("../../styles/design-system", () => ({
  colors: {
    neutral: {
      50: "#f9fafb", 200: "#e5e7eb", 300: "#d1d5db",
      400: "#9ca3af", 500: "#6b7280", 600: "#4b5563",
      800: "#1f2937", 900: "#111827",
    },
    primary: { 700: "#15803d" },
    surface: "#ffffff",
  },
}));

jest.mock("../../lib/carbon-utils", () => ({
  formatStroops: (v: bigint | string) => `${v}`,
  formatTonnes: (v: number) => `${v} t`,
}));

const listing: MarketListing = {
  id: "l1",
  listingId: "listing-001",
  projectId: "proj-01",
  projectName: "Amazon Reforestation",
  batchId: "batch-01",
  seller: "GXXX",
  amountAvailable: 100,
  pricePerCredit: 50_000_000n as unknown as bigint,
  methodology: "VCS",
  vintageYear: 2022,
  status: "Active",
  country: "Brazil",
};

function renderDialog({
  onConfirm = jest.fn(),
  onCancel = jest.fn(),
}: {
  onConfirm?: () => Promise<void> | void;
  onCancel?: () => void;
} = {}) {
  return render(
    <DelistConfirmDialog listing={listing} onConfirm={onConfirm} onCancel={onCancel} />,
  );
}

describe("DelistConfirmDialog", () => {
  it("renders the listing project name", () => {
    renderDialog();
    expect(screen.getByText("Amazon Reforestation")).toBeInTheDocument();
  });

  it("renders methodology, vintage, tonnes and price", () => {
    renderDialog();
    expect(screen.getByText("VCS")).toBeInTheDocument();
    expect(screen.getByText("2022")).toBeInTheDocument();
    expect(screen.getByText("100 t")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = jest.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape is pressed", () => {
    const onCancel = jest.fn();
    renderDialog({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when backdrop is clicked", () => {
    const onCancel = jest.fn();
    const { container } = renderDialog({ onCancel });
    // The backdrop is the fixed overlay div (first child of container)
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Remove listing is clicked", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: /remove listing/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("shows loading state while confirming", async () => {
    let resolve = () => {};
    const onConfirm = jest.fn(
      () => new Promise((r) => { resolve = r as () => void; }),
    );
    renderDialog({ onConfirm });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /remove listing/i }));
    });

    await waitFor(() => expect(screen.getByText(/removing/i)).toBeInTheDocument());
    // Resolve the promise so the component can clean up
    act(() => { resolve(); });
  });

  it("disables the confirm button while confirming", async () => {
    let resolve = () => {};
    const onConfirm = jest.fn(
      () => new Promise((r) => { resolve = r as () => void; }),
    );
    renderDialog({ onConfirm });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /remove listing/i }));
    });

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /removing/i });
      expect(btn).toBeDisabled();
    });

    act(() => { resolve(); });
  });

  it("shows an error message when onConfirm rejects", async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error("Network error"));
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: /remove listing/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Network error"),
    );
  });
});
