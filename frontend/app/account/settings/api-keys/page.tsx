"use client";

import { useState } from "react";
import SettingsCard from "../SettingsCard";
import { createApiKey, CreatedApiKey } from "../../../../lib/api";
import { colors } from "../../../../styles/design-system";

const inputStyle = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.375rem",
  fontSize: "0.9rem",
  boxSizing: "border-box" as const,
};

export default function ApiKeysSettingsPage() {
  const [organizationName, setOrganizationName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setCreated(await createApiKey({ organizationName, contactEmail }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create API key");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsCard title="API keys">
      <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: colors.neutral[500] }}>
        Generate a key for the public API.
      </p>

      {created ? (
        <div role="status">
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600, color: colors.neutral[700] }}>
            New key for {created.organizationName}
          </p>
          <code style={{ display: "block", padding: "0.75rem", background: colors.neutral[100], borderRadius: "0.375rem", wordBreak: "break-all", fontSize: "0.85rem" }}>
            {created.key}
          </code>
          <button
            type="button"
            onClick={() => { setCreated(null); setOrganizationName(""); setContactEmail(""); }}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: "0.375rem", border: `1px solid ${colors.neutral[300]}`, background: "transparent", cursor: "pointer" }}
          >
            Generate another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            Organization name
            <input required minLength={2} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} style={{ ...inputStyle, marginTop: "0.25rem" }} />
          </label>
          <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            Contact email
            <input required type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} style={{ ...inputStyle, marginTop: "0.25rem" }} />
          </label>
          {error && <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#B91C1C" }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            style={{ justifySelf: "start", padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "none", background: colors.primary[600], color: "#fff", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Generating…" : "Generate API key"}
          </button>
        </form>
      )}
    </SettingsCard>
  );
}