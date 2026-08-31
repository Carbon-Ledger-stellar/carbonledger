"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useListings } from "../../../lib/api";
import { colors } from "../../../styles/design-system";

// BulkPurchaseWizard (32KB) is a multi-step wizard — lazy-load it so the
// page shell and loading indicator appear immediately on navigation.
const BulkPurchaseWizard = dynamic(
  () => import("../../../components/BulkPurchaseWizard"),
  {
    loading: () => (
      <div
        style={{
          padding: "4rem",
          textAlign: "center",
          color: colors.neutral[400],
        }}
      >
        Loading wizard…
      </div>
    ),
  }
);

export default function BulkWizardPage() {
  const router = useRouter();
  const { data, isLoading } = useListings();
  const listings = data?.listings ?? [];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.neutral[50],
        padding: "2rem 1rem",
      }}
    >
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <a
            href="/marketplace"
            style={{
              fontSize: "0.875rem",
              color: colors.primary[600],
              textDecoration: "none",
            }}
          >
            ← Back to Marketplace
          </a>
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 800,
              color: colors.neutral[900],
              margin: "0.75rem 0 0.5rem",
            }}
          >
            Bulk Purchase Wizard
          </h1>
          <p style={{ fontSize: "1rem", color: colors.neutral[600], margin: 0 }}>
            Build a diversified carbon credit portfolio from multiple projects in a
            single on-chain transaction.
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator />

        {/* Wizard content */}
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "1rem",
            overflow: "hidden",
          }}
        >
          {isLoading ? (
            <div
              style={{
                padding: "4rem",
                textAlign: "center",
                color: colors.neutral[400],
              }}
            >
              Loading listings…
            </div>
          ) : (
            <BulkPurchaseWizard
              availableListings={listings}
              onComplete={() => router.push("/dashboard")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator() {
  const steps = ["Select Credits", "Preview Portfolio", "Confirm & Execute"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: "1.5rem",
        gap: "0",
      }}
    >
      {steps.map((label, i) => (
        <div
          key={label}
          style={{ display: "flex", alignItems: "center", flex: 1 }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              flex: 1,
            }}
          >
            <div
              style={{
                width: "2rem",
                height: "2rem",
                borderRadius: "50%",
                background: colors.primary[600],
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "0.875rem",
              }}
            >
              {i + 1}
            </div>
            <span
              style={{
                fontSize: "0.75rem",
                color: colors.neutral[600],
                marginTop: "0.25rem",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: "2px",
                background: colors.neutral[200],
                marginBottom: "1.25rem",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
