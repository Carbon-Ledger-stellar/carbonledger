"use client";
import { useState } from "react";
import OracleStatus from "../../../components/OracleStatus";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

interface Project {
  id: string;
  projectId: string;
  name: string;
  methodology: string;
  country: string;
  status: string;
  methodologyScore: number;
  createdAt: string;
  documentCid?: string; // IPFS CID for uploaded documentation
}

interface PendingAction {
  project: Project;
  decision: "verify" | "reject";
}

export default function VerifierDashboardPage() {
  const [publicKey, setPublicKey] = useState("");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [docProject, setDocProject] = useState<Project | null>(null);

  async function load() {
    if (!publicKey || !token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/verifiers/${publicKey}/pending-projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setProjects(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmReview() {
    if (!pending) return;
    const { project, decision } = pending;
    setPending(null);
    setRejectReason("");
    await fetch(`${API}/projects/${project.id}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        verifierPublicKey: publicKey,
        ...(decision === "reject" && { reason: rejectReason }),
      }),
    });
    load();
  }

  function openReject(project: Project) {
    setRejectReason("");
    setPending({ project, decision: "reject" });
  }

  return (
    <main style={{ maxWidth: 800, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Verifier Dashboard</h1>
      <p>Review projects pending your accreditation. Each approved project earns an attestation fee.</p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <input
          placeholder="Your Stellar public key (G...)"
          value={publicKey}
          onChange={e => setPublicKey(e.target.value)}
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <input
          placeholder="JWT token"
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button onClick={load} style={btnStyle}>Load</button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading && <p>Loading...</p>}

      {projects.length === 0 && !loading && (
        <p style={{ color: "#666" }}>No projects pending your review.</p>
      )}

      {projects.map(p => (
        <div key={p.id} style={cardStyle}>
          <div>
            <strong>{p.name}</strong> <span style={{ color: "#666" }}>({p.projectId})</span>
            <br />
            <small>
              {p.methodology} (Score: {p.methodologyScore}) · {p.country} ·{" "}
              submitted {new Date(p.createdAt).toLocaleDateString()}
            </small>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {p.documentCid && (
              <button onClick={() => setDocProject(p)} style={docBtn}>
                📄 Docs
              </button>
            )}
            <button onClick={() => setPending({ project: p, decision: "verify" })} style={approveBtn}>
              Approve
            </button>
            <button onClick={() => openReject(p)} style={rejectBtn}>
              Reject
            </button>
          </div>
        </div>
      ))}

      <hr style={{ margin: "2rem 0" }} />
      <OracleStatus />
      <hr style={{ margin: "2rem 0" }} />
      <p style={{ fontSize: "0.875rem", color: "#666" }}>
        <strong>Attestation fee:</strong> verifiers earn a fee per approved project as documented in{" "}
        <a href="/docs/verifier-onboarding.md">docs/verifier-onboarding.md</a>.
      </p>

      {/* Document viewer modal */}
      {docProject && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Project documentation">
          <div style={{ ...dialogStyle, maxWidth: 720, width: "95vw" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.125rem" }}>
                📄 {docProject.name} — Documentation
              </h2>
              <button onClick={() => setDocProject(null)} style={cancelBtn} aria-label="Close document viewer">
                ✕
              </button>
            </div>
            <iframe
              src={`https://ipfs.io/ipfs/${docProject.documentCid}`}
              title={`Documentation for ${docProject.name}`}
              style={{ width: "100%", height: "60vh", border: "1px solid #e5e7eb", borderRadius: 4 }}
            />
            <div style={{ marginTop: "0.75rem", textAlign: "right" }}>
              <a
                href={`https://ipfs.io/ipfs/${docProject.documentCid}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "0.8rem", color: "#7C3AED" }}
              >
                Open in new tab ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {pending && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div style={dialogStyle}>
            <h2 id="confirm-title" style={{ margin: "0 0 0.5rem", fontSize: "1.125rem" }}>
              {pending.decision === "verify" ? "✅ Approve Project" : "❌ Reject Project"}
            </h2>
            <p style={{ color: "#6b7280", margin: "0 0 1.25rem", fontSize: "0.875rem" }}>
              This action will be recorded permanently on-chain and cannot be undone.
            </p>

            <div style={summaryStyle}>
              <Row label="Project" value={`${pending.project.name} (${pending.project.projectId})`} />
              <Row label="Methodology" value={pending.project.methodology} />
              <Row label="Country" value={pending.project.country} />
              <Row label="Submitted" value={new Date(pending.project.createdAt).toLocaleDateString()} />
              <Row
                label="Action"
                value={pending.decision === "verify"
                  ? "Approve — issue attestation"
                  : "Reject — permanently block issuance"}
              />
            </div>

            {pending.decision === "reject" && (
              <div style={{ marginTop: "1rem" }}>
                <label
                  htmlFor="reject-reason"
                  style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: "0.4rem" }}
                >
                  Reason for rejection <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <textarea
                  id="reject-reason"
                  rows={3}
                  placeholder="Describe why this project is being rejected…"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  style={{
                    width: "100%", border: "1px solid #d1d5db", borderRadius: 4,
                    padding: "0.5rem 0.75rem", fontSize: "0.875rem",
                    resize: "vertical", boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button
                onClick={() => { setPending(null); setRejectReason(""); }}
                style={cancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={confirmReview}
                disabled={pending.decision === "reject" && !rejectReason.trim()}
                aria-disabled={pending.decision === "reject" && !rejectReason.trim()}
                style={{
                  ...(pending.decision === "verify" ? approveBtn : rejectBtn),
                  opacity: pending.decision === "reject" && !rejectReason.trim() ? 0.5 : 1,
                  cursor: pending.decision === "reject" && !rejectReason.trim() ? "not-allowed" : "pointer",
                }}
              >
                {pending.decision === "verify" ? "Confirm Approval" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{label}</span>
      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827", maxWidth: "60%", textAlign: "right" }}>{value}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem", background: "#7C3AED", color: "#fff",
  border: "none", borderRadius: 4, cursor: "pointer",
};
const approveBtn: React.CSSProperties = { ...btnStyle, background: "#16a34a" };
const rejectBtn: React.CSSProperties  = { ...btnStyle, background: "#dc2626" };
const docBtn: React.CSSProperties     = { ...btnStyle, background: "#0891b2" };
const cancelBtn: React.CSSProperties  = {
  padding: "0.5rem 1rem", background: "#fff", color: "#374151",
  border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
};
const cardStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "1rem", border: "1px solid #e5e7eb", borderRadius: 6, marginBottom: "0.75rem",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
};
const dialogStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: "1.75rem",
  width: "100%", maxWidth: 480, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
};
const summaryStyle: React.CSSProperties = {
  background: "#f9fafb", border: "1px solid #e5e7eb",
  borderRadius: 6, padding: "0.75rem 1rem",
};
