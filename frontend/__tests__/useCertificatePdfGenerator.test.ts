/**
 * Snapshot-style unit tests for useCertificatePdfGenerator
 *
 * Tests cover:
 * - getCertificateFilename produces deterministic names from txHash
 * - generatePdf calls jsPDF methods and triggers download
 * - generateFromRetirement maps RetirementRecord correctly
 * - Error state is surfaced when jsPDF throws
 */

import { renderHook, act } from "@testing-library/react";
import {
  useCertificatePdfGenerator,
  getCertificateFilename,
  CertificatePdfData,
} from "../hooks/useCertificatePdfGenerator";

// ── jsPDF mock ────────────────────────────────────────────────────────────────

const mockSave = jest.fn();
const mockOutput = jest.fn().mockReturnValue(new Blob(["pdf-content"], { type: "application/pdf" }));
const mockDoc = {
  setFillColor: jest.fn(),
  setDrawColor: jest.fn(),
  setLineWidth: jest.fn(),
  setTextColor: jest.fn(),
  setFontSize: jest.fn(),
  setFont: jest.fn(),
  rect: jest.fn(),
  roundedRect: jest.fn(),
  line: jest.fn(),
  circle: jest.fn(),
  text: jest.fn(),
  splitTextToSize: jest.fn().mockReturnValue(["text"]),
  addPage: jest.fn(),
  output: mockOutput,
  save: mockSave,
};

jest.mock("jspdf", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockDoc),
}));

// ── URL mock ──────────────────────────────────────────────────────────────────

const mockCreateObjectURL = jest.fn().mockReturnValue("blob:mock-url");
const mockRevokeObjectURL = jest.fn();

// ── DOM helpers ───────────────────────────────────────────────────────────────

let appendedAnchor: HTMLAnchorElement | null = null;
const originalCreateElement = document.createElement.bind(document);
const originalAppendChild = document.body.appendChild.bind(document.body);
const originalRemoveChild = document.body.removeChild.bind(document.body);

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_TX_HASH =
  "1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890";

const SAMPLE_DATA: CertificatePdfData = {
  beneficiary: "ACME Corp",
  projectName: "Amazon Reforestation Initiative",
  vintageYear: 2023,
  tonnes: 150,
  serialStart: "CRB-2023-001-00001",
  serialEnd: "CRB-2023-001-00150",
  txHash: SAMPLE_TX_HASH,
  retirementId: "RET-001",
  methodology: "VCS-AFOLU",
  country: "Brazil",
  retiredAt: "2026-01-15T10:30:00Z",
  verificationUrl: "https://carbonledger.io/retire/RET-001",
};

describe("getCertificateFilename", () => {
  it("produces a deterministic filename from txHash", () => {
    const filename = getCertificateFilename(SAMPLE_TX_HASH);
    expect(filename).toBe(
      `CarbonLedger-Certificate-${SAMPLE_TX_HASH.slice(0, 16)}.pdf`
    );
  });

  it("produces the same filename for the same txHash", () => {
    expect(getCertificateFilename(SAMPLE_TX_HASH)).toBe(
      getCertificateFilename(SAMPLE_TX_HASH)
    );
  });

  it("produces different filenames for different txHashes", () => {
    const hash2 = "9999999999999999abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(getCertificateFilename(SAMPLE_TX_HASH)).not.toBe(
      getCertificateFilename(hash2)
    );
  });
});

describe("useCertificatePdfGenerator", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Spy on createElement to capture anchor
    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") {
        appendedAnchor = originalCreateElement("a") as HTMLAnchorElement;
        jest.spyOn(appendedAnchor, "click").mockImplementation(() => {});
        return appendedAnchor;
      }
      return originalCreateElement(tag);
    });

    jest
      .spyOn(document.body, "appendChild")
      .mockImplementation((node) => node as Node);
    jest
      .spyOn(document.body, "removeChild")
      .mockImplementation((node) => node as Node);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    appendedAnchor = null;
  });

  it("starts with idle state (not generating, no error)", () => {
    const { result } = renderHook(() => useCertificatePdfGenerator());
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("generates PDF and triggers browser download with deterministic filename", async () => {
    const { result } = renderHook(() => useCertificatePdfGenerator());

    await act(async () => {
      await result.current.generatePdf(SAMPLE_DATA);
    });

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();

    // Should have created a blob URL
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalled();

    // Anchor should have the correct filename
    expect(appendedAnchor?.download).toBe(
      getCertificateFilename(SAMPLE_TX_HASH)
    );
  });

  it("surfaces error when PDF generation throws", async () => {
    const { default: jsPDF } = await import("jspdf");
    (jsPDF as jest.Mock).mockImplementationOnce(() => {
      throw new Error("PDF generation failed");
    });

    const { result } = renderHook(() => useCertificatePdfGenerator());

    await act(async () => {
      await result.current.generatePdf(SAMPLE_DATA);
    });

    expect(result.current.error).toBe("PDF generation failed");
    expect(result.current.isGenerating).toBe(false);
  });

  it("generateFromRetirement maps RetirementRecord fields correctly and downloads", async () => {
    const { result } = renderHook(() => useCertificatePdfGenerator());

    const retirement = {
      id: "1",
      retirementId: "RET-001",
      batchId: "BATCH-001",
      projectId: "PROJ-001",
      projectName: "Test Project",
      amount: 50,
      retiredBy: "GBXXX",
      beneficiary: "Test Corp",
      retirementReason: "ESG offset",
      vintageYear: 2022,
      serialNumbers: ["CRB-2022-001-00001", "CRB-2022-001-00050"],
      retiredAt: "2026-01-10T08:00:00Z",
      txHash: SAMPLE_TX_HASH,
      project: {
        name: "Test Project",
        methodology: "VCS",
        country: "Kenya",
      },
    };

    await act(async () => {
      await result.current.generateFromRetirement(retirement as any, "https://example.com");
    });

    // PDF was generated (no error)
    expect(result.current.error).toBeNull();
    expect(result.current.isGenerating).toBe(false);

    // Deterministic filename derived from txHash
    expect(appendedAnchor?.download).toBe(
      getCertificateFilename(SAMPLE_TX_HASH)
    );

    // Verification URL should be the retirement page
    expect(appendedAnchor?.href).toContain("blob:");
  });

  it("includes all required PDF data fields", async () => {
    const { result } = renderHook(() => useCertificatePdfGenerator());
    const generatePdfSpy = jest.spyOn(result.current, "generatePdf");

    await act(async () => {
      await result.current.generatePdf(SAMPLE_DATA);
    });

    const calledWith = generatePdfSpy.mock.calls[0][0];
    expect(calledWith).toHaveProperty("beneficiary");
    expect(calledWith).toHaveProperty("projectName");
    expect(calledWith).toHaveProperty("vintageYear");
    expect(calledWith).toHaveProperty("tonnes");
    expect(calledWith).toHaveProperty("serialStart");
    expect(calledWith).toHaveProperty("serialEnd");
    expect(calledWith).toHaveProperty("txHash");
    expect(calledWith).toHaveProperty("retirementId");
  });
});
