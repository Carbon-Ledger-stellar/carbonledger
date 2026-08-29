"use client";
import { useState, useRef } from "react";
import { useOfflineSync } from "../../../hooks/useOfflineSync";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export default function VerifierApplyPage() {
  const [form, setForm] = useState({
    publicKey: "", organizationName: "", accreditationBody: "",
    accreditationId: "", contactEmail: "", documentsCid: "",
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "queued">("idle");
  const [message, setMessage] = useState("");
  const submitted = useRef(false);
  const { pendingCount, syncNow } = useOfflineSync();
  const { isOnline } = useNetworkStatus();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted.current) return; // avoid double-submit
    submitted.current = true;
    setStatus("loading");
    try {
      const res = await fetch(`${API}/verifiers/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("success");
      setMessage("Application submitted. You will be notified once reviewed by an admin.");
    } catch (err: any) {
      // Network failure (offline or flaky connection) → persist locally and
      // let offline-sync flush the queue when connectivity returns.
      const isNetworkError =
        err instanceof TypeError || err.message === "Failed to fetch" || !isOnline;
      if (isNetworkError) {
        const { enqueue } = await import("../../../lib/offline-sync");
        try {
          await enqueue(`${API}/verifiers/apply`, "POST", form);
          setStatus("queued");
          setMessage(
            "No connection detected — your application was saved locally and will be submitted automatically once you're back online."
          );
        } catch (idbErr: any) {
          submitted.current = false;
          setStatus("error");
          setMessage(`Unable to save offline: ${idbErr?.message ?? String(idbErr)}`);
        }
      } else {
        submitted.current = false;
        setStatus("error");
        setMessage(err.message);
      }
    }
  }

  if (status === "success") {
    return (
      <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Application Submitted</h1>
        <p>{message}</p>
      </main>
    );
  }

  if (status === "queued") {
    return (
      <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          ⏳ Application Saved Offline
        </h1>
        <p>{message}</p>
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
          {pendingCount > 0
            ? `${pendingCount} queued item${pendingCount > 1 ? "s" : ""} waiting to sync.`
            : "Queue is empty — everything has been submitted."}
        </p>
        {isOnline && (
          <button
            onClick={() => syncNow()}
            style={btnStyle}
          >
            {pendingCount > 0 ? "Sync Now" : "Retry Now"}
          </button>
        )}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Apply as a Verifier</h1>
      <p>
        Accredited verifiers approve carbon projects and earn an attestation fee per verified project.
        Submit your credentials below. An admin will review your application.
      </p>
      {!isOnline && (
        <p style={{ background: "#FEF3C7", color: "#92400E", padding: "0.75rem", borderRadius: 4 }}>
          ⚠️ You are offline. Your application will be saved locally and submitted automatically when connectivity returns.
        </p>
      )}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Stellar Public Key
          <input required value={form.publicKey} onChange={set("publicKey")}
            placeholder="G..." style={inputStyle} />
        </label>

        <label>
          Organization Name
          <input required value={form.organizationName} onChange={set("organizationName")}
            style={inputStyle} />
        </label>

        <label>
          Accreditation Body
          <select required value={form.accreditationBody} onChange={set("accreditationBody")}
            style={inputStyle}>
            <option value="">Select...</option>
            <option value="Gold Standard">Gold Standard</option>
            <option value="Verra VCS">Verra VCS</option>
            <option value="American Carbon Registry">American Carbon Registry</option>
            <option value="Climate Action Reserve">Climate Action Reserve</option>
          </select>
        </label>

        <label>
          Accreditation ID
          <input required value={form.accreditationId} onChange={set("accreditationId")}
            style={inputStyle} />
        </label>

        <label>
          Contact Email
          <input required type="email" value={form.contactEmail} onChange={set("contactEmail")}
            style={inputStyle} />
        </label>

        <label>
          Credential Documents (IPFS CID)
          <input required value={form.documentsCid} onChange={set("documentsCid")}
            placeholder="Qm... or bafy..." style={inputStyle} />
          <small>Upload your accreditation documents to IPFS first, then paste the CID here.</small>
        </label>

        {status === "error" && <p style={{ color: "red" }}>{message}</p>}

        <button type="submit" disabled={status === "loading"} style={btnStyle}>
          {status === "loading" ? "Submitting..." : "Submit Application"}
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "0.5rem",
  marginTop: "0.25rem", boxSizing: "border-box",
};
const btnStyle: React.CSSProperties = {
  padding: "0.75rem", background: "#7C3AED", color: "#fff",
  border: "none", borderRadius: 4, cursor: "pointer",
};