"use client";

import { useState } from "react";
import { useSerialSingleLookup, useSerialRangeLookup, SerialLookupResult } from "../lib/api";
import ProvenanceTrail from "./ProvenanceTrail";
import { colors } from "../styles/design-system";

// ── Input mode toggle ─────────────────────────────────────────────────────────

type Mode = "single" | "range";

// ── Sub-components ────────────────────────────────────────────────────────────

function CreditDetails({ result }: { result: SerialLookupResult }) {
  const isRetired = result.status === "retired";

  return (
    <div style={{
      background: isRetired ? colors.primary[50] : colors.neutral[50],
      border: `1px solid ${isRetired ? colors.primary[200] : colors.neutral[200]}`,
      borderRadius: "0.5rem",
      padding: "1rem",
      marginBottom: "1rem",
    }}>
      {/* Status header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "1.1rem" }}>{isRetired ? "🔒" : "🌱"}</span>
        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: isRetired ? colors.primary[800] : colors.primary[700] }}>
          {isRetired ? "Permanently Retired" : "Active Credit"}
        </span>
        <span style={{
          marginLeft: "auto",
          fontSize: "0.7rem", fontWeight: 600,
          background: isRetired ? colors.primary[100] : colors.neutral[100],
          color: isRetired ? colors.primary[700] : colors.neutral[600],
          border: `1px solid ${isRetired ? colors.primary[200] : colors.neutral[200]}`,
          borderRadius: "9999px", padding: "0.15rem 0.6rem",
        }}>
          #{result.serialNumber}
        </span>
      </div>

      {/* Core fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "0.75rem" }}>
        {[
          ["Batch ID",     result.batchId],
          ["Project",      result.projectName ?? result.projectId],
          ["Vintage Year", result.vintageYear],
          ["Methodology",  result.methodology ?? "—"],
          ["Country",      result.country ?? "—"],
          ["Current Owner", result.currentOwner ?? "—"],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p style={{ fontSize: "0.68rem", color: colors.neutral[500], margin: "0 0 0.1rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {label}
            </p>
            <p style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.neutral[800], margin: 0, wordBreak: "break-all" }}>
              {value as string}
            </p>
          </div>
        ))}
      </div>

      {/* Retirement-specific fields */}
      {isRetired && (
        <>
          <div style={{
            borderTop: `1px solid ${colors.primary[200]}`,
            paddingTop: "0.75rem",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem",
            marginBottom: "0.75rem",
          }}>
            {[
              ["Beneficiary",       result.beneficiary ?? "—"],
              ["Retirement Reason", result.retirementReason ?? "—"],
              ["Retired On",        result.retiredAt ? new Date(result.retiredAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"],
              ["Tx Hash",           result.txHash ? result.txHash.slice(0, 18) + "…" : "—"],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p style={{ fontSize: "0.68rem", color: colors.neutral[500], margin: "0 0 0.1rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {label}
                </p>
                <p style={{ fontSize: "0.82rem", fontWeight: 600, color: colors.neutral[800], margin: 0, wordBreak: "break-all" }}>
                  {value as string}
                </p>
              </div>
            ))}
          </div>
          {result.retirementId && (
            <a
              href={`/retire/${result.retirementId}`}
              style={{ fontSize: "0.8rem", color: colors.primary[600], fontWeight: 600 }}
            >
              View Retirement Certificate →
            </a>
          )}
        </>
      )}
    </div>
  );
}

function ProvenanceSection({ result }: { result: SerialLookupResult }) {
  if (!result.provenance?.length) return null;
  return (
    <div>
      <p style={{ fontSize: "0.75rem", fontWeight: 700, color: colors.neutral[600], textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.75rem" }}>
        Chain of Custody
      </p>
      <ProvenanceTrail events={result.provenance} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SerialNumberLookup() {
  const [mode, setMode] = useState<Mode>("single");
  const [singleInput, setSingleInput] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  // Committed search state (only set on submit)
  const [committedSingle, setCommittedSingle] = useState("");
  const [committedRange, setCommittedRange] = useState<{ start: string; end: string } | null>(null);

  const { data: singleResult, isLoading: singleLoading, error: singleError } =
    useSerialSingleLookup(committedSingle);

  const { data: rangeResults, isLoading: rangeLoading, error: rangeError } =
    useSerialRangeLookup(committedRange?.start ?? "", committedRange?.end ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "single") {
      setCommittedSingle(singleInput.trim());
      setCommittedRange(null);
    } else {
      setCommittedRange({ start: rangeStart.trim(), end: rangeEnd.trim() });
      setCommittedSingle("");
    }
  }

  const isLoading = mode === "single" ? singleLoading : rangeLoading;
  const error     = mode === "single" ? singleError  : rangeError;

  const inputStyle = {
    border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.5rem",
    padding: "0.6rem 1rem",
    fontSize: "0.875rem",
    fontFamily: "monospace",
    outline: "none",
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
    }}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: "0 0 0.25rem" }}>
        Serial Number Lookup
      </h3>
      <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 1rem" }}>
        Enter any credit serial number to see its complete chain of custody — minted → transferred → retired.
      </p>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["single", "range"] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "0.3rem 0.9rem",
              fontSize: "0.8rem", fontWeight: 600,
              borderRadius: "9999px",
              border: `1px solid ${mode === m ? colors.primary[600] : colors.neutral[300]}`,
              background: mode === m ? colors.primary[600] : "transparent",
              color: mode === m ? "#fff" : colors.neutral[600],
              cursor: "pointer",
            }}
          >
            {m === "single" ? "Single" : "Range"}
          </button>
        ))}
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {mode === "single" ? (
          <input
            type="text"
            placeholder="e.g. 1042"
            value={singleInput}
            onChange={e => setSingleInput(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: "8rem" }}
          />
        ) : (
          <>
            <input
              type="text"
              placeholder="Start e.g. 1001"
              value={rangeStart}
              onChange={e => setRangeStart(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: "7rem" }}
            />
            <span style={{ alignSelf: "center", color: colors.neutral[400], fontSize: "0.875rem" }}>–</span>
            <input
              type="text"
              placeholder="End e.g. 1050"
              value={rangeEnd}
              onChange={e => setRangeEnd(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: "7rem" }}
            />
          </>
        )}
        <button
          type="submit"
          disabled={mode === "single" ? !singleInput.trim() : !rangeStart.trim() || !rangeEnd.trim()}
          style={{
            background: colors.primary[600],
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.6rem 1.25rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
            opacity: (mode === "single" ? !singleInput.trim() : !rangeStart.trim() || !rangeEnd.trim()) ? 0.5 : 1,
          }}
        >
          Look Up
        </button>
      </form>

      {/* States */}
      {isLoading && (
        <p style={{ color: colors.neutral[400], fontSize: "0.875rem" }}>Searching…</p>
      )}
      {error && !isLoading && (
        <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>
          {mode === "single" ? "Serial number not found." : "No credits found in that range."}
        </p>
      )}

      {/* Single result */}
      {!isLoading && !error && singleResult && mode === "single" && (
        <>
          <CreditDetails result={singleResult} />
          <ProvenanceSection result={singleResult} />
        </>
      )}

      {/* Range results */}
      {!isLoading && !error && rangeResults && mode === "range" && (
        <div>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 0.75rem" }}>
            {rangeResults.length} credit{rangeResults.length !== 1 ? "s" : ""} found
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {rangeResults.map(r => (
              <CreditDetails key={r.serialNumber} result={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
