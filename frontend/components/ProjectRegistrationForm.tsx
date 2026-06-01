"use client";

import { useState } from "react";
import { colors, borderRadius, shadows } from "../styles/design-system";

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

export default function ProjectRegistrationForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const set = (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setForm(f => {
        const updated = { ...f, [k]: value };
        // Clear error for this field when user starts typing
        if (errors[k]) {
          setErrors(prev => {
            const next = { ...prev };
            delete next[k];
            return next;
          });
        }
        return updated;
      });
    };

  function validateField(field: keyof FormState, value: string): string | null {
    switch (field) {
      case 'name':
        return !value.trim() ? 'Project name is required' : null;
      case 'methodology':
        return !value ? 'Please select a methodology' : null;
      case 'projectType':
        return !value ? 'Please select a project type' : null;
      case 'country':
        return !value ? 'Please select a country' : null;
      case 'latitude': {
        const lat = Number(value);
        if (!value || isNaN(lat)) return 'Latitude is required';
        if (lat < -90 || lat > 90) return 'Latitude must be between -90 and 90';
        return null;
      }
      case 'longitude': {
        const lng = Number(value);
        if (!value || isNaN(lng)) return 'Longitude is required';
        if (lng < -180 || lng > 180) return 'Longitude must be between -180 and 180';
        return null;
      }
      case 'vintageYear':
        return !value || isNaN(Number(value)) ? 'Please select a vintage year' : null;
      case 'description':
        return !value.trim() ? 'Project description is required' : null;
      case 'contactEmail': {
        if (!value) return 'Contact email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address';
        return null;
      }
      case 'developerPublicKey':
        return !value.trim() ? 'Developer Stellar public key is required' : null;
      case 'documentsCid':
        return !value.trim() && !docFile ? 'Upload a document or provide a CID' : null;
      default:
        return null;
    }
  }

  function handleBlur(field: keyof FormState) {
    const value = form[field];
    const error = validateField(field, value);
    if (error) {
      setErrors(prev => ({ ...prev, [field]: error }));
    }
  }

  function validateStep0(): boolean {
    const e: Partial<FormState> = {};
    const nameError = validateField('name', form.name);
    if (nameError) e.name = nameError;
    
    const methodologyError = validateField('methodology', form.methodology);
    if (methodologyError) e.methodology = methodologyError;
    
    const projectTypeError = validateField('projectType', form.projectType);
    if (projectTypeError) e.projectType = projectTypeError;
    
    const countryError = validateField('country', form.country);
    if (countryError) e.country = countryError;
    
    const latError = validateField('latitude', form.latitude);
    if (latError) e.latitude = latError;
    
    const lngError = validateField('longitude', form.longitude);
    if (lngError) e.longitude = lngError;
    
    const yearError = validateField('vintageYear', form.vintageYear);
    if (yearError) e.vintageYear = yearError;
    
    const descError = validateField('description', form.description);
    if (descError) e.description = descError;
    
    const emailError = validateField('contactEmail', form.contactEmail);
    if (emailError) e.contactEmail = emailError;
    
    const keyError = validateField('developerPublicKey', form.developerPublicKey);
    if (keyError) e.developerPublicKey = keyError;
    
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep1(): boolean {
    const e: Partial<FormState> = {};
    const docError = validateField('documentsCid', form.documentsCid);
    if (docError) e.documentsCid = docError;
    setErrors(e);
    return Object.keys(e).length === 0;
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
      setErrors(e => ({ ...e, documentsCid: "Upload failed — paste CID manually" }));
    } finally {
      setUploading(false);
    }
  }

  function advance() {
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    setErrors({});
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
              placeholder="Amazon Reforestation Initiative" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Field label="Latitude" error={errors.latitude}>
              <input style={inputStyle(!!errors.latitude)} value={form.latitude} onChange={set("latitude")}
                onBlur={() => handleBlur('latitude')}
                placeholder="-3.4653" type="number" step="any" />
            </Field>
            <Field label="Longitude" error={errors.longitude}>
              <input style={inputStyle(!!errors.longitude)} value={form.longitude} onChange={set("longitude")}
                onBlur={() => handleBlur('longitude')}
                placeholder="-62.2159" type="number" step="any" />
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
              value={form.contactEmail} onChange={set("contactEmail")}
              onBlur={() => handleBlur('contactEmail')}
              placeholder="you@example.com" />
          </Field>
          <Field label="Developer Stellar Public Key" error={errors.developerPublicKey}>
            <input style={inputStyle(!!errors.developerPublicKey)}
              value={form.developerPublicKey} onChange={set("developerPublicKey")}
              onBlur={() => handleBlur('developerPublicKey')}
              placeholder="G..." />
          </Field>
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
                onChange={e => { setDocFile(e.target.files?.[0] ?? null); setErrors({}); }} />
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
          <button type="button" onClick={advance} style={btnStyle(colors.primary[600])}>
            Next →
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={status === "loading"}
            style={btnStyle(status === "loading" ? colors.neutral[400] : colors.primary[600])}>
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
  padding: "2rem",
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
  width: "100%", padding: "0.5rem 0.75rem", boxSizing: "border-box",
  border: `1px solid ${hasError ? colors.suspended.border : colors.neutral[300]}`,
  borderRadius: borderRadius.md, fontSize: "0.875rem", color: colors.neutral[800],
  background: colors.surface, outline: "none",
});

const btnStyle = (bg: string): React.CSSProperties => ({
  padding: "0.6rem 1.25rem", background: bg, color: "#fff",
  border: "none", borderRadius: borderRadius.md, cursor: "pointer",
  fontSize: "0.875rem", fontWeight: 600,
});
