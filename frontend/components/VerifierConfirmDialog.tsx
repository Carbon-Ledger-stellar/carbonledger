"use client";

import { useEffect, useRef } from "react";
import type { PendingVerifierProject } from "../lib/api";

export type VerifierDecision = "verify" | "reject";

interface Props {
  project: PendingVerifierProject;
  decision: VerifierDecision;
  rejectReason: string;
  onRejectReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}

export const REJECT_MIN_LENGTH = 50;

export default function VerifierConfirmDialog({
  project,
  decision,
  rejectReason,
  onRejectReasonChange,
  onConfirm,
  onCancel,
  confirmDisabled,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") return onCancel();
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const nodes = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const rejectTooShort =
    decision === "reject" && rejectReason.trim().length < REJECT_MIN_LENGTH;

  return (
    <div style={overlayStyle} role="presentation">
      <div
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verifier-confirm-title"
      >
        <h2 id="verifier-confirm-title" style={{ margin: "0 0 0.5rem", fontSize: "1.125rem" }}>
          {decision === "verify" ? "✅ Approve Project" : "❌ Reject Project"}
        </h2>
        <p style={{ color: "#6b7280", margin: "0 0 1.25rem", fontSize: "0.875rem" }}>
          This action will be recorded permanently on-chain and cannot be undone.
        </p>

        <div style={summaryStyle}>
          <Row label="Project" value={`${project.name} (${project.projectId})`} />
          <Row label="Methodology" value={project.methodology} />
          <Row label="Country" value={project.country} />
          <Row label="Submitted" value={new Date(project.createdAt).toLocaleDateString()} />
          <Row
            label="Action"
            value={
              decision === "verify"
                ? "Approve — issue attestation"
                : "Reject — permanently block issuance"
            }
          />
        </div>

        {decision === "reject" && (
          <div style={{ marginTop: "1rem" }}>
            <label
              htmlFor="reject-reason"
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#374151",
                display: "block",
                marginBottom: "0.4rem",
              }}
            >
              Reason for rejection <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <textarea
              id="reject-reason"
              rows={4}
              placeholder="Describe why this project is being rejected (minimum 50 characters)…"
              value={rejectReason}
              onChange={e => onRejectReasonChange(e.target.value)}
              aria-describedby="reject-reason-hint"
              style={{
                width: "100%",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                padding: "0.5rem 0.75rem",
                fontSize: "0.875rem",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <p
              id="reject-reason-hint"
              style={{
                fontSize: "0.75rem",
                color: rejectTooShort ? "#dc2626" : "#6b7280",
                margin: "0.35rem 0 0",
              }}
            >
              {rejectReason.trim().length}/{REJECT_MIN_LENGTH} characters minimum
            </p>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button ref={cancelRef} type="button" onClick={onCancel} style={cancelBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled || rejectTooShort}
            aria-disabled={confirmDisabled || rejectTooShort}
            data-testid="verifier-confirm-action"
            style={{
              ...(decision === "verify" ? approveBtn : rejectBtn),
              opacity: confirmDisabled || rejectTooShort ? 0.5 : 1,
              cursor: confirmDisabled || rejectTooShort ? "not-allowed" : "pointer",
            }}
          >
            {decision === "verify" ? "Confirm Approval" : "Confirm Rejection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "0.4rem 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</span>
      <span
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "#111827",
          maxWidth: "60%",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};
const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "1.75rem",
  width: "100%",
  maxWidth: 480,
  boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
};
const summaryStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "0.75rem 1rem",
};
const approveBtn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#16a34a",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};
const rejectBtn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};
const cancelBtn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  cursor: "pointer",
};
