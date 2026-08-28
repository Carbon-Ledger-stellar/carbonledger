/**
 * ProvenanceTrail — component rendering, interaction, and PDF export tests
 */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProvenanceTrail, exportProvenancePdf, ProvenanceEvent } from "../components/ProvenanceTrail";

// ─── Mock jsPDF ───────────────────────────────────────────────────────────────

const mockSave   = jest.fn();
const mockAddPage = jest.fn();
const mockText   = jest.fn();
const mockLine   = jest.fn();
const mockSetPage = jest.fn();
const mockAddImage = jest.fn();

jest.mock("jspdf", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    setFontSize: jest.fn(),
    setTextColor: jest.fn(),
    setDrawColor: jest.fn(),
    setLineWidth: jest.fn(),
    text: mockText,
    line: mockLine,
    addPage: mockAddPage,
    setPage: mockSetPage,
    addImage: mockAddImage,
    splitTextToSize: jest.fn((str: string) => [str]),
    save: mockSave,
    internal: { getNumberOfPages: jest.fn().mockReturnValue(1) },
  })),
}));

// ─── Suppress console.error noise ────────────────────────────────────────────

beforeAll(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterAll(() => (console.error as jest.Mock).mockRestore());
beforeEach(() => { mockSave.mockClear(); mockText.mockClear(); mockAddPage.mockClear(); });

// ─── Sample data ──────────────────────────────────────────────────────────────

const SAMPLE_EVENTS: ProvenanceEvent[] = [
  {
    type: "registered",
    label: "Project Registered",
    timestamp: "2024-01-01T00:00:00Z",
    actor: "GDEV1234567890ABCDE",
    actorRole: "developer",
    detail: "Amazon project registered",
    txHash: "reg-tx-001",
  },
  {
    type: "verified",
    label: "Project Verified",
    timestamp: "2024-02-01T00:00:00Z",
    actor: "GVER1234567890ABCDE",
    actorRole: "verifier",
    detail: "Verified by Gold Standard",
    txHash: "ver-tx-002",
  },
  {
    type: "minted",
    label: "Credits Minted",
    timestamp: "2024-03-01T00:00:00Z",
    actorRole: "oracle",
    detail: "1000 tonnes minted",
    txHash: "mint-tx-003",
  },
  {
    type: "listed",
    label: "Credits Listed",
    timestamp: "2024-04-01T00:00:00Z",
    actor: "GSEL1234567890ABCDE",
    actorRole: "seller",
    txHash: "list-tx-004",
  },
  {
    type: "purchased",
    label: "Credits Purchased",
    timestamp: "2024-05-01T00:00:00Z",
    actor: "GBUY1234567890ABCDE",
    actorRole: "buyer",
    txHash: "buy-tx-005",
  },
  {
    type: "retired",
    label: "Credits Retired",
    timestamp: "2024-06-01T00:00:00Z",
    actor: "GBEN1234567890ABCDE",
    actorRole: "beneficiary",
    detail: "200 tonnes retired for ESG",
    txHash: "ret-tx-006",
  },
];

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("ProvenanceTrail — empty state", () => {
  it("renders empty state message when events is empty array", () => {
    render(<ProvenanceTrail events={[]} />);
    expect(screen.getByText(/no provenance events found/i)).toBeInTheDocument();
  });

  it("renders empty state when events is null", () => {
    render(<ProvenanceTrail events={null} />);
    expect(screen.getByText(/no provenance events found/i)).toBeInTheDocument();
  });

  it("does not render timeline items when empty", () => {
    render(<ProvenanceTrail events={[]} />);
    expect(screen.queryAllByTestId("timeline-item")).toHaveLength(0);
  });
});

// ─── Timeline rendering ───────────────────────────────────────────────────────

describe("ProvenanceTrail — timeline view rendering", () => {
  it("renders all 6 sample events as timeline items", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(6);
  });

  it("renders event labels", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByText("Project Registered")).toBeInTheDocument();
    expect(screen.getByText("Project Verified")).toBeInTheDocument();
    expect(screen.getByText("Credits Retired")).toBeInTheDocument();
  });

  it("shows FINALIZED badge on retired events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByText("FINALIZED")).toBeInTheDocument();
  });

  it("renders the event count status", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 6 events");
  });

  it("renders timeline view by default", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const timelineBtn = screen.getByRole("button", { name: /Timeline/i });
    expect(timelineBtn).toHaveAttribute("aria-pressed", "true");
  });
});

// ─── Tree view ────────────────────────────────────────────────────────────────

describe("ProvenanceTrail — tree view", () => {
  it("switches to tree view when Tree button clicked", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Tree/i }));
    expect(screen.getByRole("button", { name: /Tree/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Timeline/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("still shows all events in tree view", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Tree/i }));
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(6);
  });
});

// ─── Expand / collapse ────────────────────────────────────────────────────────

describe("ProvenanceTrail — expand and collapse", () => {
  it("event detail is hidden before clicking", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.queryByRole("region", { name: /Details for Project Registered/i })).not.toBeInTheDocument();
  });

  it("expands event detail when header is clicked", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const btn = screen.getByRole("button", { name: /Project Registered/i });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /Details for Project Registered/i })).toBeInTheDocument();
  });

  it("shows tx hash link in expanded view", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Project Registered/i }));
    expect(screen.getByRole("link", { name: /View Project Registered transaction/i })).toBeInTheDocument();
  });

  it("collapses when header is clicked again", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const btn = screen.getByRole("button", { name: /Project Registered/i });
    fireEvent.click(btn); // expand
    fireEvent.click(btn); // collapse
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: /Details for Project Registered/i })).not.toBeInTheDocument();
  });

  it("Expand all button expands all events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Expand all/i }));
    const details = screen.getAllByRole("region");
    expect(details.length).toBe(6);
  });

  it("Collapse all button collapses all events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Expand all/i }));
    fireEvent.click(screen.getByRole("button", { name: /Collapse all/i }));
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});

// ─── Filtering via UI ─────────────────────────────────────────────────────────

describe("ProvenanceTrail — filter UI", () => {
  it("renders the filter bar with event type select", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("combobox", { name: /Filter by event type/i })).toBeInTheDocument();
  });

  it("renders the filter bar with actor role select", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("combobox", { name: /Filter by actor role/i })).toBeInTheDocument();
  });

  it("renders actor address search input", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("searchbox", { name: /Search by actor address/i })).toBeInTheDocument();
  });

  it("filtering by event type reduces visible events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const select = screen.getByRole("combobox", { name: /Filter by event type/i });
    fireEvent.change(select, { target: { value: "retired" } });
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("1 of 6");
  });

  it("filtering by actor role reduces visible events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const select = screen.getByRole("combobox", { name: /Filter by actor role/i });
    fireEvent.change(select, { target: { value: "verifier" } });
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(1);
    expect(screen.getByText("Project Verified")).toBeInTheDocument();
  });

  it("actor search input filters by address substring", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const input = screen.getByRole("searchbox", { name: /Search by actor address/i });
    fireEvent.change(input, { target: { value: "GBUY" } });
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(1);
    expect(screen.getByText("Credits Purchased")).toBeInTheDocument();
  });

  it("shows 'no events match' message when filter yields no results", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const input = screen.getByRole("searchbox", { name: /Search by actor address/i });
    fireEvent.change(input, { target: { value: "ZZZZZZZZZZZZZZ" } });
    expect(screen.queryAllByTestId("timeline-item")).toHaveLength(0);
    expect(screen.getByText(/no events match/i)).toBeInTheDocument();
  });

  it("shows Clear button when a filter is active", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.queryByRole("button", { name: /Clear all filters/i })).not.toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: /Filter by event type/i });
    fireEvent.change(select, { target: { value: "minted" } });
    expect(screen.getByRole("button", { name: /Clear all filters/i })).toBeInTheDocument();
  });

  it("Clear button resets filter and shows all events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const select = screen.getByRole("combobox", { name: /Filter by event type/i });
    fireEvent.change(select, { target: { value: "minted" } });
    fireEvent.click(screen.getByRole("button", { name: /Clear all filters/i }));
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(6);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 6 events");
  });

  it("status message includes '(filtered)' when filter is active", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const select = screen.getByRole("combobox", { name: /Filter by event type/i });
    fireEvent.change(select, { target: { value: "verified" } });
    expect(screen.getByRole("status")).toHaveTextContent("filtered");
  });

  it("from date filter restricts displayed events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const fromInput = screen.getByLabelText(/Filter from date/i);
    fireEvent.change(fromInput, { target: { value: "2024-05-01" } });
    // purchased (May) + retired (June) = 2
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(2);
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("ProvenanceTrail — accessibility", () => {
  it("filter bar has role=search", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("search", { name: /Filter provenance events/i })).toBeInTheDocument();
  });

  it("status count has role=status and aria-live=polite", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("view mode buttons have aria-pressed", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("button", { name: /Timeline/i })).toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: /Tree/i })).toHaveAttribute("aria-pressed");
  });

  it("event expand buttons have aria-expanded and aria-controls", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const btn = screen.getByRole("button", { name: /Project Registered/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls");
  });
});

// ─── PDF export ───────────────────────────────────────────────────────────────

describe("ProvenanceTrail — PDF export", () => {
  it("PDF button is present", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    expect(screen.getByRole("button", { name: /Export provenance trail as PDF/i })).toBeInTheDocument();
  });

  it("PDF button is disabled when no events", () => {
    render(<ProvenanceTrail events={[]} />);
    // Empty state renders no toolbar at all — no PDF button
    expect(screen.queryByRole("button", { name: /Export provenance trail as PDF/i })).not.toBeInTheDocument();
  });

  it("PDF button is disabled when filter results in zero events", () => {
    render(<ProvenanceTrail events={SAMPLE_EVENTS} />);
    const input = screen.getByRole("searchbox", { name: /Search by actor address/i });
    fireEvent.change(input, { target: { value: "ZZZZZZZ" } });
    const btn = screen.getByRole("button", { name: /Export provenance trail as PDF/i });
    expect(btn).toBeDisabled();
  });

  it("exportProvenancePdf calls jsPDF.save() with correct filename pattern", async () => {
    await exportProvenancePdf(SAMPLE_EVENTS, "CREDIT-001", "Test Project");
    expect(mockSave).toHaveBeenCalledTimes(1);
    const filename = mockSave.mock.calls[0][0] as string;
    expect(filename).toMatch(/CarbonLedger-Provenance-CREDIT-001/);
    expect(filename).toMatch(/\.pdf$/);
  });

  it("exportProvenancePdf includes project name in header text", async () => {
    await exportProvenancePdf(SAMPLE_EVENTS, "CREDIT-002", "My Test Project");
    const allTextCalls = mockText.mock.calls.map((c: any[]) => c[0]);
    expect(allTextCalls.some((t: string) => typeof t === "string" && t.includes("My Test Project"))).toBe(true);
  });

  it("exportProvenancePdf includes credit ID in header", async () => {
    await exportProvenancePdf(SAMPLE_EVENTS, "CRED-XYZ");
    const allTextCalls = mockText.mock.calls.map((c: any[]) => c[0]);
    expect(allTextCalls.some((t: string) => typeof t === "string" && t.includes("CRED-XYZ"))).toBe(true);
  });

  it("exportProvenancePdf writes all 6 event labels", async () => {
    await exportProvenancePdf(SAMPLE_EVENTS);
    const allTextCalls = mockText.mock.calls.map((c: any[]) => c[0]).join(" ");
    expect(allTextCalls).toMatch(/Project Registered/);
    expect(allTextCalls).toMatch(/Credits Retired/);
  });

  it("exportProvenancePdf handles empty events array gracefully (saves empty PDF)", async () => {
    await exportProvenancePdf([]);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("exportProvenancePdf works without creditId or projectName", async () => {
    await expect(exportProvenancePdf(SAMPLE_EVENTS)).resolves.toBeUndefined();
    expect(mockSave).toHaveBeenCalled();
  });
});

// ─── Props: creditId / projectName ───────────────────────────────────────────

describe("ProvenanceTrail — props", () => {
  it("renders with creditId and projectName props without crashing", () => {
    render(
      <ProvenanceTrail
        events={SAMPLE_EVENTS}
        creditId="CRED-001"
        projectName="Amazon Rainforest Project"
      />
    );
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(6);
  });
});
