/**
 * offline-report-queue.test.ts
 *
 * Tests for the IndexedDB-backed offline draft report queue.
 * Uses fake-indexeddb to simulate IndexedDB in a Node.js test environment.
 */

import "fake-indexeddb/auto";

// Node 20+/jest-jsdom environment polyfill: fake-indexeddb uses
// structuredClone for value cloning, which is not available inside
// the jest jsdom sandbox by default.
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

import {
  saveDraftReport,
  getPendingDrafts,
  getAllDrafts,
  markDraftSynced,
  markDraftFailed,
  removeDraft,
  clearSyncedDrafts,
  getPendingDraftCount,
  hasPendingDraft,
} from "../lib/offline-report-queue";

const SAMPLE_DRAFT = {
  projectId: "proj-001",
  projectName: "Amazon Forest Conservation",
  decision: "verify" as const,
  rejectReason: "",
  checkedItems: ["documentation_reviewed", "vcs_validation_body"],
};

describe("offline-report-queue", () => {
  afterEach(async () => {
    // Clean up all drafts after each test
    const all = await getAllDrafts();
    for (const d of all) {
      if (d.id != null) await removeDraft(d.id);
    }
  });

  it("should save a draft report and return an id", async () => {
    const id = await saveDraftReport(SAMPLE_DRAFT);
    expect(id).toBeGreaterThan(0);
  });

  it("should retrieve pending drafts after saving", async () => {
    await saveDraftReport(SAMPLE_DRAFT);
    const pending = await getPendingDrafts();
    expect(pending).toHaveLength(1);
    expect(pending[0].projectId).toBe("proj-001");
    expect(pending[0].decision).toBe("verify");
    expect(pending[0].synced).toBe(false);
    expect(pending[0].createdAt).toBeGreaterThan(0);
  });

  it("should mark a draft as synced", async () => {
    const id = await saveDraftReport(SAMPLE_DRAFT);
    await markDraftSynced(id);
    const pending = await getPendingDrafts();
    expect(pending).toHaveLength(0);
    const all = await getAllDrafts();
    const draft = all.find((d) => d.id === id);
    expect(draft?.synced).toBe(true);
  });

  it("should mark a draft as failed", async () => {
    const id = await saveDraftReport(SAMPLE_DRAFT);
    await markDraftFailed(id, "Network error");
    const pending = await getPendingDrafts();
    const draft = pending.find((d) => d.id === id);
    expect(draft?.syncError).toBe("Network error");
    expect(draft?.synced).toBe(false);
  });

  it("should remove a single draft", async () => {
    const id = await saveDraftReport(SAMPLE_DRAFT);
    await removeDraft(id);
    const all = await getAllDrafts();
    expect(all.find((d) => d.id === id)).toBeUndefined();
  });

  it("should clear only synced drafts", async () => {
    const id1 = await saveDraftReport(SAMPLE_DRAFT);
    const id2 = await saveDraftReport({
      ...SAMPLE_DRAFT,
      projectId: "proj-002",
      projectName: "Mangrove Restoration",
    });
    await markDraftSynced(id1);
    await clearSyncedDrafts();
    const all = await getAllDrafts();
    expect(all).toHaveLength(1);
    expect(all[0].projectId).toBe("proj-002");
  });

  it("should return the correct pending count", async () => {
    expect(await getPendingDraftCount()).toBe(0);
    await saveDraftReport(SAMPLE_DRAFT);
    await saveDraftReport({
      ...SAMPLE_DRAFT,
      projectId: "proj-002",
      projectName: "Mangrove Restoration",
    });
    expect(await getPendingDraftCount()).toBe(2);
  });

  it("should detect whether a project has a pending draft", async () => {
    await saveDraftReport(SAMPLE_DRAFT);
    const existing = await hasPendingDraft("proj-001");
    expect(existing).toBeDefined();
    expect(existing?.projectId).toBe("proj-001");
    const missing = await hasPendingDraft("proj-999");
    expect(missing).toBeUndefined();
  });

  it("should save a reject decision with reason", async () => {
    const id = await saveDraftReport({
      ...SAMPLE_DRAFT,
      decision: "reject",
      rejectReason: "Missing documentation",
    });
    const pending = await getPendingDrafts();
    const draft = pending.find((d) => d.id === id);
    expect(draft?.decision).toBe("reject");
    expect(draft?.rejectReason).toBe("Missing documentation");
  });
});