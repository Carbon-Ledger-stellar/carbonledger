"use client";

import { useState } from "react";
import { colors, borderRadius, shadows } from "../styles/design-system";
import { useFormValidation, ValidationRule } from "../hooks/useFormValidation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

const METHODOLOGIES = ["VCS", "Gold Standard", "ACR", "CAR"];
const COUNTRIES = [
  "Brazil", "Indonesia", "Kenya", "India", "Colombia",
  "Peru", "Congo", "Tanzania", "Mexico", "Vietnam",
];
const PROJECT_TYPES = [
  "Reforestation", "REDD+", "Renewable Energy", "Methane Capture",
  "Soil Carbon", "Blue Carbon", "Energy Efficiency",
];

interface FormState {
  name: string;
  methodology: string;
  projectType: string;
  country: string;
  latitude: string;
  longitude: string;
  vintageYear: string;
  description: string;
  contactEmail: string;
  documentsCid: string;
  developerPublicKey: string;
}

const EMPTY: FormState = {
  name: "", methodology: "", projectType: "", country: "",
  latitude: "", longitude: "", vintageYear: "",
  description: "", contactEmail: "", documentsCid: "", developerPublicKey: "",
};

const STEPS = ["Project Metadata", "Documentation", "Review & Submit"];

// ── Validation rules ──────────────────────────────────────────────────────────

const FIELD_RULES: Record<keyof FormState, ValidationRule[]> = {
  name: [{ type: "required", message: "Project name is required" }],
  methodology: [{ type: "required", message: "Please select a methodology" }],
  projectType: [{ type: "required", message: "Please select a project type" }],
  country: [{ type: "required", message: "Please select a country" }],
  latitude: [
    { type: "required", message: "Latitude is required" },
    { type: "numeric", message: "Latitude must be between -90 and 90", min: -90, max: 90 },
  ],
  longitude: [
    { type: "required", message: "Longitude is required" },
    { type: "numeric", message: "Longitude must be between -180 and 180", min: -180, max: 180 },
  ],
  vintageYear: [
    { type: "required", message: "Please select a vintage year" },
    { type: "numeric", message: "Vintage year must be a number" },
  ],
  description: [{ type: "required", message: "Project description is required" }],
  contactEmail: [
    { type: "required", message: "Contact email is required" },
    { type: "email", message: "Please enter a valid email address" },
  ],
  developerPublicKey: [{ type: "required", message: "Developer Stellar public key is required" }],
  documentsCid: [
    { type: "custom", message: "", validate: (value: string) => {
      if (!value) return null; // optional when file is uploaded
      const isUrl = /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value);
      const isCid = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-zA-Z0-9]{46,})$/.test(value);
      if (!isUrl && !isCid) return "Provide a valid IPFS CID or metadata URL";
      return null;
    } },
  ],
};

export default function ProjectRegistrationForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const {
    errors,
    isValid,
    validateField,
    validateFieldDebounced,
    validateForm,
    clearFieldError,
    clearErrors,
    setFieldError,
  } = useFormValidation<FormState>({ fields: FIELD_RULES });

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm(f => {
        const updated = { ...f, [k]: value };
        return updated;
      });
      // Clear error immediately when user types
      if (errors[k]) clearFieldError(k);
      // Debounced full validation
      validateFieldDebounced(k, value);
    };

  function handleBlur(field: keyof FormState) {
    validateField(field, form[field]);
  }

  // Per-step validity: a step is valid when none of its fields has an error.
  const step0FieldsValid =
    !errors.name && !errors.methodology && !errors.projectType && !errors.country &&
    !errors.latitude && !errors.longitude && !errors.vintageYear &&
    !errors.description && !errors.contactEmail && !errors.developerPublicKey;
  const step1FieldsValid = !errors.documentsCid;

  function validateStep0(): boolean {
    const stepFields = ["name", "methodology", "projectType", "country", "latitude", "longitude", "vintageYear", "description", "contactEmail", "developerPublicKey"] as (keyof FormState)[];
    const values = stepFields.reduce((acc, f) => ({ ...acc, [f]: form[f] }), {} as Record<keyof FormState, unknown>);
    return validateForm(values);
  }

  function validateStep1(): boolean {
    const stepFields = ["documentsCid"] as (keyof FormState)[];
    const values = stepFields.reduce((acc, f) => ({ ...acc, [f]: form[f] }), {} as Record<keyof FormState, unknown>);
    return validateForm(values);
  }

  async function uploadToIPFS() {
    if (!docFile) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", docFile);
      const res = await fetch(`${API}/ipfs/upload`, { method: "POST", body: data });
      if (!res.ok) throw new Error("Upload failed");
      const { cid } = await res.json();
      setForm(f => ({ ...f, documentsCid: cid }));
    } catch {
      setFieldError("documentsCid", "Upload failed — paste CID manually");
    } finally {
      setUploading(false);
    }
  }

  function advance() {
    if (step === 0 && !validateStep0()) return;
    if (step === 1) {
      // Require either a file upload or a manually entered CID
      if (!form.documentsCid && !docFile) {
        setFieldError("documentsCid", "Upload a document or provide a CID");
        return;
      }
      if (!validateStep1()) return;
    }
    clearErrors();
    setStep(s => s + 1);
  }

  async function submit() {
    setStatus("loading");
    try {
      const res = await fetch(`${API}/projects/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          methodology: form.methodology,
          projectType: form.projectType,
          country: form.country,
          coordinates: { lat: Number(form.latitude), lng: Number(form.longitude) },
          vintageYear: Number(form.vintageYear),
          description: form.description,
          contactEmail: form.contactEmail,
          documentsCid: form.documentsCid,
          developerPublicKey: form.developerPublicKey,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? res.statusText);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message);
    }
  }

  if (status === "success") {
    return (
      <div style={cardStyle}>
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🌱</div>
          <h2 style={{ color: colors.primary[700], margin: "0 0 0.5rem" }}>Project Submitted!</h2>
          <p style={{ color: colors.neutral[500], margin: "0 0 1.5rem" }}>
            Your project is under review. You will be notified once a verifier approves it.
          </p>
          <a href="/projects" style={btnStyle(colors.primary[600])}>View All Projects</a>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
        {STEPS.map((label, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div style={{
              height: 4, borderRadius: 2, marginBottom: "0.4rem",
              background: i <= step ? colors.primary[500] : colors.neutral[200],
            }} />
            <span style={{
              fontSize: "0.7rem", fontWeight: i === step ? 700 : 400,
              color: i === step ? colors.primary[700] : colors.neutral[400],
            }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Step 0: Metadata */}
      {step === 0 && (
        <div style={fieldsetStyle}>
          <h2 style={headingStyle}>Project Metadata</h2>
          <Field label="Project Name" error={errors.name}>
            <input style={inputStyle(!!errors.name)} value={form.name} onChange={set("name")}
              onBlur={() => handleBlur('name')}
              autoComplete="organization"
              placeholder="Amazon Reforestation Initiative" />
          </Field>
          <div className="prf-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Field label="Methodology" error={errors.methodology}>
              <select style={inputStyle(!!errors.methodology)} value={form.methodology} onChange={set("methodology")}
                onBlur={() => handleBlur('methodology')}>
                <option value="">Select...</option>
                {METHODOLOGIES.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Project Type" error={errors.projectType}>
              <select style={inputStyle(!!errors.projectType)} value={form.projectType} onChange={set("projectType")}
                onBlur={() => handleBlur('projectType')}>
                <option value="">Select...</option>
                {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="prf-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Field label="Country" error={errors.country}>
              <select style={inputStyle(!!errors.country)} value={form.country} onChange={set("country")}
                onBlur={() => handleBlur('country')}>
                <option value="">Select...</option>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Vintage Year" error={errors.vintageYear}>
              <select style={inputStyle(!!errors.vintageYear)} value={form.vintageYear} onChange={set("vintageYear")}
                onBlur={() => handleBlur('vintageYear')}>
                <option value="">Select...</option>
                {["2020","2021","2022","2023","2024","2025"].map(y => <option key={y}>{y}</option>)}
              </select>
            </Field>
          </div>
          <div className="prf-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Field label="Latitude" error={errors.latitude}>
              <input style={inputStyle(!!errors.latitude)} value={form.latitude} onChange={set("latitude")}
                onBlur={() => handleBlur('latitude')}
                placeholder="-3.4653" type="number" inputMode="decimal" step="any" />
            </Field>
            <Field label="Longitude" error={errors.longitude}>
              <input style={inputStyle(!!errors.longitude)} value={form.longitude} onChange={set("longitude")}
                onBlur={() => handleBlur('longitude')}
                placeholder="-62.2159" type="number" inputMode="decimal" step="any" />
            </Field>
          </div>
          <Field label="Description" error={errors.description}>
            <textarea style={{ ...inputStyle(!!errors.description), minHeight: 80, resize: "vertical" }}
              value={form.description} onChange={set("description")}
              onBlur={() => handleBlur('description')}
              placeholder="Brief description of the project and its impact..." />
          </Field>
          <Field label="Contact Email" error={errors.contactEmail}>
            <input style={inputStyle(!!errors.contactEmail)} type="email"
              inputMode="email"
              autoComplete="email"
              value={form.contactEmail} onChange={set("contactEmail")}
              onBlur={() => handleBlur('contactEmail')}
              placeholder="you@example.com" />
          </Field>
          <Field label="Developer Stellar Public Key" error={errors.developerPublicKey}>
            <input style={inputStyle(!!errors.developerPublicKey)}
              autoComplete="off"
              inputMode="text"
              value={form.developerPublicKey} onChange={set("developerPublicKey")}
              onBlur={() => handleBlur('developerPublicKey')}
              placeholder="G..." />
          </Field>
          <style>{`
            @media (max-width: 639px) {
              .prf-grid-2 { grid-template-columns: 1fr !important; }
            }
          `}</style>
        </div>
      )}

      {/* Step 1: Documentation */}
      {step === 1 && (
        <div style={fieldsetStyle}>
          <h2 style={headingStyle}>Documentation Upload</h2>
          <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
            Upload your project methodology document, land title, or verification report as PDF.
            Files are stored on IPFS via Pinata.
          </p>
          <Field label="Upload PDF Document" error={errors.documentsCid}>
            <div style={{
              border: `2px dashed ${errors.documentsCid ? colors.suspended.border : colors.neutral[300]}`,
              borderRadius: borderRadius.lg, padding: "1.5rem", textAlign: "center",
              background: colors.surfaceAlt,
            }}>
              <input type="file" accept=".pdf" id="doc-upload"
                style={{ display: "none" }}
                onChange={e => { setDocFile(e.target.files?.[0] ?? null); clearErrors(); }} />
              <label htmlFor="doc-upload" style={{ cursor: "pointer" }}>
                {docFile ? (
                  <span style={{ color: colors.primary[700], fontWeight: 600 }}>📄 {docFile.name}</span>
                ) : (
                  <span style={{ color: colors.neutral[400] }}>Click to select a PDF file</span>
                )}
              </label>
              {docFile && !form.documentsCid && (
                <button type="button" onClick={uploadToIPFS} disabled={uploading}
                  style={{ ...btnStyle(colors.primary[600]), marginTop: "0.75rem", display: "block", width: "100%" }}>
                  {uploading ? "Uploading to IPFS..." : "Upload to IPFS"}
                </button>
              )}
              {form.documentsCid && (
                <p style={{ color: colors.primary[700], fontSize: "0.8rem", marginTop: "0.5rem", wordBreak: "break-all" }}>
                  ✓ CID: {form.documentsCid}
                </p>
              )}
            </div>
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "1rem 0" }}>
            <div style={{ flex: 1, height: 1, background: colors.neutral[200] }} />
            <span style={{ color: colors.neutral[400], fontSize: "0.8rem" }}>or paste CID directly</span>
            <div style={{ flex: 1, height: 1, background: colors.neutral[200] }} />
          </div>
          <Field label="IPFS CID" error={!docFile ? errors.documentsCid : undefined}>
            <input style={inputStyle(!!errors.documentsCid && !docFile)}
              value={form.documentsCid} onChange={set("documentsCid")}
              onBlur={() => handleBlur("documentsCid")}
              placeholder="Qm... or bafy..." />
          </Field>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div style={fieldsetStyle}>
          <h2 style={headingStyle}>Review & Submit</h2>
          <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
            Review your project details before submitting for verification.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {[
              ["Project Name", form.name],
              ["Methodology", form.methodology],
              ["Project Type", form.projectType],
              ["Country", form.country],
              ["Vintage Year", form.vintageYear],
              ["Coordinates", `${form.latitude}, ${form.longitude}`],
              ["Contact Email", form.contactEmail],
              ["Developer Key", form.developerPublicKey],
              ["Documents CID", form.documentsCid],
              ...(form.description ? [["Description", form.description]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", gap: "1rem",
                padding: "0.6rem 0.75rem", background: colors.surfaceAlt,
                borderRadius: borderRadius.md, fontSize: "0.875rem",
              }}>
                <span style={{ color: colors.neutral[500], flexShrink: 0 }}>{label}</span>
                <span style={{ color: colors.neutral[800], fontWeight: 500, wordBreak: "break-all", textAlign: "right" }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          {status === "error" && (
            <p style={{ color: colors.suspended.text, background: colors.suspended.bg,
              border: `1px solid ${colors.suspended.border}`, borderRadius: borderRadius.md,
              padding: "0.75rem", marginTop: "1rem", fontSize: "0.875rem" }}>
              {message}
            </p>
          )}
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
        {step > 0 ? (
          <button type="button" onClick={() => setStep(s => s - 1)} style={btnStyle(colors.neutral[500])}>
            ← Back
          </button>
        ) : (
          <a href="/projects" style={{ ...btnStyle(colors.neutral[400]), textDecoration: "none" }}>
            Cancel
          </a>
        )}
        {step < 2 ? (
          <button type="button" onClick={advance}
            disabled={step === 0 ? !step0FieldsValid : !step1FieldsValid}
            style={btnStyle((step === 0 ? step0FieldsValid : step1FieldsValid) ? colors.primary[600] : colors.neutral[400])}>
            Next →
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={status === "loading" || !isValid}
            style={btnStyle(status === "loading" || !isValid ? colors.neutral[400] : colors.primary[600])}>
            {status === "loading" ? "Submitting..." : "Submit Project"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.neutral[600] }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: "0.75rem", color: colors.suspended.text }}>{error}</span>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.neutral[200]}`,
  borderRadius: borderRadius.xl,
  padding: "1.5rem 1rem", // smaller padding on mobile (#1035)
  boxShadow: shadows.md,
  maxWidth: 640,
  margin: "0 auto",
};

const fieldsetStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "1rem",
};

const headingStyle: React.CSSProperties = {
  fontSize: "1.125rem", fontWeight: 700, color: colors.neutral[900], margin: 0,
};

const inputStyle = (hasError: boolean): React.CSSProperties => ({
  width: "100%",
  padding: "0.6rem 0.75rem",
  boxSizing: "border-box",
  border: `1px solid ${hasError ? colors.suspended.border : colors.neutral[300]}`,
  borderRadius: borderRadius.md,
  // 1rem = 16px: prevents iOS Safari auto-zoom on focus (#1035)
  fontSize: "1rem",
  color: colors.neutral[800],
  background: colors.surface,
  outline: "none",
  minHeight: "48px", // 48px touch target (#1035)
});

const btnStyle = (bg: string): React.CSSProperties => ({
  padding: "0.6rem 1.25rem", background: bg, color: "#fff",
  border: "none", borderRadius: borderRadius.md, cursor: "pointer",
  fontSize: "0.875rem", fontWeight: 600,
});
