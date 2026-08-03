/**
 * ProvenanceTrail — filtering logic and helper unit tests
 */
import {
  applyFilters,
  hasActiveFilters,
  truncateAddress,
  formatDate,
  formatDateTime,
  ProvenanceEvent,
  ProvenanceFilters,
  EVENT_CONFIG,
  ACTOR_ROLE_LABELS,
} from "../components/ProvenanceTrail";

// ─── Sample data ──────────────────────────────────────────────────────────────

const makeEvent = (overrides: Partial<ProvenanceEvent> = {}): ProvenanceEvent => ({
  type: "registered",
  label: "Project Registered",
  timestamp: "2024-01-15T00:00:00Z",
  actor: "GABCDEFGHIJ",
  actorRole: "developer",
  detail: "Test detail",
  ...overrides,
});

const SAMPLE_EVENTS: ProvenanceEvent[] = [
  makeEvent({ type: "registered",  timestamp: "2024-01-01T00:00:00Z", actorRole: "developer",   actor: "GDEV123" }),
  makeEvent({ type: "verified",    timestamp: "2024-02-01T00:00:00Z", actorRole: "verifier",    actor: "GVER456", label: "Project Verified" }),
  makeEvent({ type: "minted",      timestamp: "2024-03-01T00:00:00Z", actorRole: "oracle",      actor: "GORACLE", label: "Credits Minted" }),
  makeEvent({ type: "listed",      timestamp: "2024-04-01T00:00:00Z", actorRole: "seller",      actor: "GSEL789", label: "Credits Listed" }),
  makeEvent({ type: "purchased",   timestamp: "2024-05-01T00:00:00Z", actorRole: "buyer",       actor: "GBUY000", label: "Credits Purchased" }),
  makeEvent({ type: "retired",     timestamp: "2024-06-01T00:00:00Z", actorRole: "beneficiary", actor: "GBEN999", label: "Credits Retired" }),
];

const EMPTY_FILTERS: ProvenanceFilters = {
  dateFrom: "",
  dateTo: "",
  status: "",
  actorRole: "",
  actorSearch: "",
};

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters()", () => {
  it("returns all events when no filter is active", () => {
    expect(applyFilters(SAMPLE_EVENTS, EMPTY_FILTERS)).toHaveLength(6);
  });

  it("filters by dateFrom (inclusive)", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, dateFrom: "2024-03-01" });
    expect(result).toHaveLength(4); // minted, listed, purchased, retired
    expect(result.every((e) => new Date(e.timestamp) >= new Date("2024-03-01"))).toBe(true);
  });

  it("filters by dateTo (inclusive, end of day)", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, dateTo: "2024-03-01" });
    expect(result).toHaveLength(3); // registered, verified, minted
  });

  it("filters by date range", () => {
    const result = applyFilters(SAMPLE_EVENTS, {
      ...EMPTY_FILTERS,
      dateFrom: "2024-02-01",
      dateTo: "2024-04-01",
    });
    expect(result).toHaveLength(3); // verified, minted, listed
  });

  it("date range with no matching events returns empty array", () => {
    const result = applyFilters(SAMPLE_EVENTS, {
      ...EMPTY_FILTERS,
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
    });
    expect(result).toHaveLength(0);
  });

  it("filters by event type (status)", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, status: "verified" });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("verified");
  });

  it("filters by event type 'retired'", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, status: "retired" });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("retired");
  });

  it("filters by actorRole", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, actorRole: "buyer" });
    expect(result).toHaveLength(1);
    expect(result[0].actorRole).toBe("buyer");
  });

  it("filters by actorRole 'verifier'", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, actorRole: "verifier" });
    expect(result).toHaveLength(1);
    expect(result[0].actorRole).toBe("verifier");
  });

  it("actor text search matches partial address (case insensitive)", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, actorSearch: "gdev" });
    expect(result).toHaveLength(1);
    expect(result[0].actor).toBe("GDEV123");
  });

  it("actor text search returns empty when no match", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, actorSearch: "ZZZZZZ" });
    expect(result).toHaveLength(0);
  });

  it("combines status + actorRole filters correctly", () => {
    const result = applyFilters(SAMPLE_EVENTS, {
      ...EMPTY_FILTERS,
      status: "purchased",
      actorRole: "buyer",
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("purchased");
  });

  it("returns empty array when status filter has no match", () => {
    const result = applyFilters(SAMPLE_EVENTS, { ...EMPTY_FILTERS, status: "transferred" });
    expect(result).toHaveLength(0);
  });

  it("handles events with no actorRole when filtering by actorRole", () => {
    const events = [makeEvent({ actorRole: undefined })];
    const result = applyFilters(events, { ...EMPTY_FILTERS, actorRole: "developer" });
    expect(result).toHaveLength(0);
  });

  it("handles empty events array", () => {
    expect(applyFilters([], EMPTY_FILTERS)).toHaveLength(0);
  });

  it("combines dateFrom + status", () => {
    const result = applyFilters(SAMPLE_EVENTS, {
      ...EMPTY_FILTERS,
      dateFrom: "2024-05-01",
      status: "retired",
    });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("retired");
  });
});

// ─── hasActiveFilters ─────────────────────────────────────────────────────────

describe("hasActiveFilters()", () => {
  it("returns false when no filter is set", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("returns true when dateFrom is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, dateFrom: "2024-01-01" })).toBe(true);
  });

  it("returns true when dateTo is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, dateTo: "2024-12-31" })).toBe(true);
  });

  it("returns true when status is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: "minted" })).toBe(true);
  });

  it("returns true when actorRole is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, actorRole: "verifier" })).toBe(true);
  });

  it("returns true when actorSearch is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, actorSearch: "GDEV" })).toBe(true);
  });
});

// ─── truncateAddress ──────────────────────────────────────────────────────────

describe("truncateAddress()", () => {
  it("returns address unchanged if <= 16 chars", () => {
    expect(truncateAddress("GABC")).toBe("GABC");
    expect(truncateAddress("GABCDEFGHIJKLMNO")).toBe("GABCDEFGHIJKLMNO");
  });

  it("truncates long address to first 6 + … + last 6", () => {
    const addr = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    const result = truncateAddress(addr);
    expect(result).toContain("…");
    expect(result.startsWith("GABCDE")).toBe(true);
    expect(result.endsWith("34567890".slice(-6))).toBe(true);
  });
});

// ─── formatDate / formatDateTime ──────────────────────────────────────────────

describe("formatDate()", () => {
  it("returns a human-readable date string", () => {
    const result = formatDate("2024-06-15T00:00:00Z");
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/Jun/);
  });
});

describe("formatDateTime()", () => {
  it("returns a string containing the date", () => {
    const result = formatDateTime("2024-06-15T14:30:00Z");
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/Jun/);
  });
});

// ─── EVENT_CONFIG ─────────────────────────────────────────────────────────────

describe("EVENT_CONFIG", () => {
  const EXPECTED_TYPES = ["registered", "verified", "monitored", "minted", "listed", "purchased", "transferred", "retired"];

  it("has an entry for every expected event type", () => {
    EXPECTED_TYPES.forEach((t) => {
      expect(EVENT_CONFIG).toHaveProperty(t);
    });
  });

  it("every config entry has icon, color, label, role", () => {
    EXPECTED_TYPES.forEach((t) => {
      const cfg = EVENT_CONFIG[t as keyof typeof EVENT_CONFIG];
      expect(typeof cfg.icon).toBe("string");
      expect(typeof cfg.color).toBe("string");
      expect(typeof cfg.label).toBe("string");
      expect(typeof cfg.role).toBe("string");
    });
  });
});

// ─── ACTOR_ROLE_LABELS ────────────────────────────────────────────────────────

describe("ACTOR_ROLE_LABELS", () => {
  it("has a label for every actor role", () => {
    const roles = ["developer", "verifier", "oracle", "seller", "buyer", "beneficiary", "unknown"];
    roles.forEach((r) => {
      expect(ACTOR_ROLE_LABELS).toHaveProperty(r);
      expect(typeof ACTOR_ROLE_LABELS[r as keyof typeof ACTOR_ROLE_LABELS]).toBe("string");
    });
  });
});
