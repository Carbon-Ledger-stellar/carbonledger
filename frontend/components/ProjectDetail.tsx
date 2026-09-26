"use client";

import { colors } from "../styles/design-system";
import { EmptyState } from "./EmptyState";
import type { CreditBatch } from "../lib/api";

interface ProjectDetailProject {
  id: string;
  name: string;
  description?: string;
}

interface ProjectDetailProps {
  project: ProjectDetailProject;
  creditBatches?: CreditBatch[];
}

/**
 * Project detail view: always shows the project's own info, plus its
 * credit batches — or an empty-state message when it has none.
 */
export function ProjectDetail({ project, creditBatches }: ProjectDetailProps) {
  return (
    <div>
      <h2 style={{ color: colors.neutral[900], margin: "0 0 0.25rem" }}>{project.name}</h2>
      {project.description && (
        <p style={{ color: colors.neutral[500], margin: "0 0 1.5rem" }}>{project.description}</p>
      )}

      {!creditBatches || creditBatches.length === 0 ? (
        <EmptyState
          title="No credit batches available"
          description="This project has no issued credit batches yet."
        />
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {creditBatches.map((batch) => (
            <div
              key={batch.id}
              data-testid="credit-batch-card"
              style={{
                padding: "1.25rem",
                background: colors.surface,
                borderRadius: "0.75rem",
                border: `1px solid ${colors.neutral[200]}`,
              }}
            >
              <p style={{ color: colors.neutral[900], fontWeight: 700, margin: "0 0 0.25rem" }}>
                {batch.batchId}
              </p>
              <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>
                {batch.vintageYear} · {batch.amount} tCO₂e · serials {batch.serialStart}–{batch.serialEnd}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
