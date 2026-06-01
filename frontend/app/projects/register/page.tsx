"use client";

import { colors } from "../../../styles/design-system";
import ProjectRegistrationForm from "../../../components/ProjectRegistrationForm";

export default function RegisterProjectPage() {
  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "2.5rem 1.5rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <a href="/projects" style={{ fontSize: "0.875rem", color: colors.neutral[500], textDecoration: "none" }}>
          ← Back to Projects
        </a>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0.75rem 0 0.25rem" }}>
          Register a Carbon Project
        </h1>
        <p style={{ color: colors.neutral[500], margin: 0 }}>
          Submit your project for independent verification. Credits can be issued once approved.
        </p>
      </div>
      <ProjectRegistrationForm />
    </div>
  );
}
