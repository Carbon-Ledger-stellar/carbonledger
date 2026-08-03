import React from "react";
import { render, screen } from "@testing-library/react";
import CreditCard from "../components/CreditCard";
import ProvenanceTrail from "../components/ProvenanceTrail";
import OracleStatus from "../components/OracleStatus";
import DashboardPage from "../app/dashboard/page";
import { useOracleStatus, useProjects, useRetirements, useListings } from "../lib/api";

const mockUseOracleStatus = useOracleStatus as jest.Mock;
const mockUseProjects = useProjects as jest.Mock;
const mockUseRetirements = useRetirements as jest.Mock;
const mockUseListings = useListings as jest.Mock;

// ── Shared fixture ────────────────────────────────────────────────────────────

const baseListing = {
  id: "1",
  listingId: "L1",
  projectId: "P1",
  projectName: "Test Project",
  batchId: "B1",
  seller: "GXXX",
  amountAvailable: 100,
  pricePerCredit: "10000000",
  vintageYear: 2023,
  methodology: "VCS",
  country: "Brazil",
  status: "Active",
  createdAt: "2024-01-01",
};

// ── CreditCard ────────────────────────────────────────────────────────────────

describe("CreditCard", () => {
  it("renders with valid country and vintageYear", () => {
    render(<CreditCard listing={baseListing} />);
    expect(screen.getByText(/Brazil/)).toBeInTheDocument();
    expect(screen.getByText(/2023 Vintage/)).toBeInTheDocument();
  });

  it("renders fallback when country is null", () => {
    render(<CreditCard listing={{ ...baseListing, country: null as any }} />);
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
  });

  it("renders fallback when vintageYear is null", () => {
    render(<CreditCard listing={{ ...baseListing, vintageYear: null as any }} />);
    expect(screen.getByText(/Vintage N\/A/)).toBeInTheDocument();
  });

  it("renders fallback when both country and vintageYear are null", () => {
    render(<CreditCard listing={{ ...baseListing, country: null as any, vintageYear: null as any }} />);
    expect(screen.getByText(/Unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Vintage N\/A/)).toBeInTheDocument();
  });
});

// ── ProvenanceTrail ───────────────────────────────────────────────────────────

describe("ProvenanceTrail", () => {
  it("renders events when provided", () => {
    const events = [{
      type: "minted" as const,
      label: "Credits Minted",
      timestamp: "2024-01-01T00:00:00Z",
    }];
    render(<ProvenanceTrail events={events} />);
    expect(screen.getByText("Credits Minted")).toBeInTheDocument();
  });

  it("renders empty state when events is null", () => {
    render(<ProvenanceTrail events={null} />);
    expect(screen.getByText(/No provenance events recorded yet/)).toBeInTheDocument();
  });

  it("renders empty state when events is an empty array", () => {
    render(<ProvenanceTrail events={[]} />);
    expect(screen.getByText(/No provenance events recorded yet/)).toBeInTheDocument();
  });
});

// ── OracleStatus ──────────────────────────────────────────────────────────────

describe("OracleStatus", () => {
  it("shows loading state", () => {
    mockUseOracleStatus.mockReturnValue({ data: undefined, isLoading: true });
    render(<OracleStatus projectId="P1" />);
    expect(screen.getByText(/Checking oracle status/)).toBeInTheDocument();
  });

  it("shows 'No data' when data is null", () => {
    mockUseOracleStatus.mockReturnValue({ data: null, isLoading: false });
    render(<OracleStatus projectId="P1" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("shows 'No data' when data is undefined", () => {
    mockUseOracleStatus.mockReturnValue({ data: undefined, isLoading: false });
    render(<OracleStatus projectId="P1" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("shows monitoring current when isCurrent is true", () => {
    mockUseOracleStatus.mockReturnValue({
      data: { isCurrent: true, lastSubmittedAt: "2024-06-01T00:00:00Z", latestScore: 85 },
      isLoading: false,
    });
    render(<OracleStatus projectId="P1" />);
    expect(screen.getByText("Monitoring Current")).toBeInTheDocument();
  });

  it("shows stale state when isCurrent is false and lastSubmittedAt is null", () => {
    mockUseOracleStatus.mockReturnValue({
      data: { isCurrent: false, lastSubmittedAt: null, latestScore: null },
      isLoading: false,
    });
    render(<OracleStatus projectId="P1" />);
    expect(screen.getByText("Monitoring Data Stale")).toBeInTheDocument();
    expect(screen.getByText(/No monitoring data submitted yet/)).toBeInTheDocument();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

describe("DashboardPage", () => {
  beforeEach(() => {
    mockUseRetirements.mockReturnValue({ data: undefined });
  });

  it("renders with all null stats (new user)", () => {
    mockUseProjects.mockReturnValue({ data: null });
    mockUseListings.mockReturnValue({ data: null });
    render(<DashboardPage />);
    expect(screen.getByText("Project Developer Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Total Issued")).toBeInTheDocument();
  });

  it("renders with undefined data (loading state)", () => {
    mockUseProjects.mockReturnValue({ data: undefined });
    mockUseListings.mockReturnValue({ data: undefined });
    render(<DashboardPage />);
    expect(screen.getByText("Project Developer Dashboard")).toBeInTheDocument();
  });

  it("handles projects with null credit counts", () => {
    mockUseProjects.mockReturnValue({
      data: [{
        projectId: "P1", name: "Test", country: "Brazil", methodology: "VCS",
        status: "Verified", totalCreditsIssued: null, totalCreditsRetired: null,
      }],
    });
    mockUseListings.mockReturnValue({ data: [] });
    // Should not throw — null counts treated as 0
    expect(() => render(<DashboardPage />)).not.toThrow();
  });
});
