"use client";

import { useState, useRef } from "react";
import { registerProject, uploadToIpfs, FieldErrors } from "../../../lib/api";
import { colors } from "../../../styles/design-system";
import Toast, { useToast } from "../../../components/Toast";

const METHODOLOGIES = ["VCS", "Gold Standard", "ACR", "CAR"];
const PROJECT_TYPES = ["Forestry", "Renewable Energy", "Methane Capture", "Blue Carbon", "Soil Carbon"];
const COUNTRIES     = ["Brazil", "Indonesia", "Kenya", "India", "Colombia", "Peru", "Vietnam", "Ghana"];

export default function NewProjectPage() {
  const [fields, setFields] = useState({
    name: "", methodology: "", country: "", projectType: "",
    vintageYear: new Date().getFullYear(), coordinates: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [docFile, setDocFile]         = useState<File | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toasts, addToast, dismiss } = useToast();

  function set(key: string, value: string | number) {
    setFields(f => ({ ...f, [key]: value }));
    setFieldErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    try {
      let metadataCid = "";
      if (docFile) metadataCid = await uploadToIpfs(docFile);

      const project = await registerProject({ ...fields, metadataCid });
      window.location.href = `/projects/${project.projectId}`;
    } catch (err: any) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length) {
        setFieldErrors(err.fieldErrors);
      } else {
        addToast({
          type: "error",
          title: "Submission failed",
          message: err.message || "Network error. Please try again.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${colors.neutral[300]}`, borderRadius: "0.5rem",
    padding: "0.65rem 0.875rem", fontSize: "0.875rem", color: colors.neutral[900],
    background: colors.surface, boxSizing: "border-box",
  };
  const errorStyle: React.CSSProperties = { fontSize: "0.75rem", color: "#dc2626", marginTop: "0.25rem" };
  const labelStyle: React.CSSProperties = { fontSize: "0.875rem", fontWeight: 600, color: colors.neutral[700], display: "block", marginBottom: "0.35rem" };

  function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
    return (
      <div>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        {children}
        {error && <p style={errorStyle}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <a href="/projects" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
        ← Back to Projects
      </a>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "1rem 0 0.25rem" }}>
        Register a Carbon Project
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem", fontSize: "0.875rem" }}>
        Submit your project for independent verification. Credits can be issued once verified.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <Field id="name" label="Project Name" error={fieldErrors.name}>
          <input id="name" style={{ ...inputStyle, borderColor: fieldErrors.name ? "#dc2626" : colors.neutral[300] }}
            value={fields.name} onChange={e => set("name", e.target.value)} required />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <Field id="methodology" label="Methodology" error={fieldErrors.methodology}>
            <select id="methodology" style={{ ...inputStyle, borderColor: fieldErrors.methodology ? "#dc2626" : colors.neutral[300] }}
              value={fields.methodology} onChange={e => set("methodology", e.target.value)} required>
              <option value="">Select…</option>
              {METHODOLOGIES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>

          <Field id="projectType" label="Project Type" error={fieldErrors.projectType}>
            <select id="projectType" style={{ ...inputStyle, borderColor: fieldErrors.projectType ? "#dc2626" : colors.neutral[300] }}
              value={fields.projectType} onChange={e => set("projectType", e.target.value)} required>
              <option value="">Select…</option>
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <Field id="country" label="Country" error={fieldErrors.country}>
            <select id="country" style={{ ...inputStyle, borderColor: fieldErrors.country ? "#dc2626" : colors.neutral[300] }}
              value={fields.country} onChange={e => set("country", e.target.value)} required>
              <option value="">Select…</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field id="vintageYear" label="Vintage Year" error={fieldErrors.vintageYear}>
            <input id="vintageYear" type="number" min={2000} max={2030}
              style={{ ...inputStyle, borderColor: fieldErrors.vintageYear ? "#dc2626" : colors.neutral[300] }}
              value={fields.vintageYear} onChange={e => set("vintageYear", Number(e.target.value))} required />
          </Field>
        </div>

        <Field id="coordinates" label="Project Coordinates (lat, lng)" error={fieldErrors.coordinates}>
          <input id="coordinates" placeholder="e.g. -3.4653, -62.2159"
            style={{ ...inputStyle, borderColor: fieldErrors.coordinates ? "#dc2626" : colors.neutral[300] }}
            value={fields.coordinates} onChange={e => set("coordinates", e.target.value)} required />
        </Field>

        <div>
          <label style={labelStyle}>Project Documents (PDF, optional)</label>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx"
            onChange={e => setDocFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: "0.875rem", color: colors.neutral[600] }} />
          {docFile && (
            <p style={{ fontSize: "0.75rem", color: colors.primary[600], marginTop: "0.25rem" }}>
              {docFile.name} — will be uploaded to IPFS before submission
            </p>
          )}
        </div>

        <button type="submit" disabled={submitting} style={{
          background: submitting ? colors.primary[400] : colors.primary[600],
          color: "#fff", border: "none", borderRadius: "0.5rem",
          padding: "0.875rem", fontSize: "1rem", fontWeight: 700,
          cursor: submitting ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
        }}>
          {submitting && (
            <>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span style={{
                width: "1rem", height: "1rem", border: "2px solid #ffffff60",
                borderTopColor: "#fff", borderRadius: "50%",
                display: "inline-block", animation: "spin 0.7s linear infinite",
              }} />
            </>
          )}
          {submitting ? "Submitting…" : "Submit Project for Verification"}
        </button>
      </form>

      <Toast toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
