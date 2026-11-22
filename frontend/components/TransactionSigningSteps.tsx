"use client";

import { colors } from "../styles/design-system";
import { TxStatus } from "./TransactionStatus";

type Step = {
  id: TxStatus | "idle";
  label: string;
  hint?: string;
};

const STEPS: Step[] = [
  { id: "building", label: "Preparing", hint: "Building the transaction…" },
  {
    id: "signing",
    label: "Sign in wallet",
    hint: "Open Freighter and approve the transaction.",
  },
  { id: "submitting", label: "Submitting", hint: "Broadcasting to Stellar…" },
  { id: "confirmed", label: "Confirmed", hint: "Transaction recorded on-chain." },
];

function stepIndex(status: TxStatus | null): number {
  if (!status) return -1;
  if (status === "building") return 0;
  if (status === "signing") return 1;
  if (status === "submitting" || status === "polling") return 2;
  if (status === "confirmed") return 3;
  return -1;
}

interface Props {
  status: TxStatus | null;
  /** Called when the timeout/still-confirming message should appear */
  timedOut?: boolean;
}

export default function TransactionSigningSteps({ status, timedOut }: Props) {
  if (!status || status === "failed") return null;

  const current = stepIndex(status);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Transaction progress"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 0,
        marginBottom: "1rem",
        overflowX: "auto",
      }}
    >
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const future = i > current;

        const dotColor = done
          ? colors.verified.text
          : active
          ? colors.primary[600]
          : colors.neutral[300];

        const lineColor = done ? colors.verified.text : colors.neutral[200];

        return (
          <div
            key={step.id}
            style={{ display: "flex", alignItems: "flex-start", flex: 1, minWidth: 0 }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              {/* connector line + dot row */}
              <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                {/* left connector */}
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: i === 0 ? "transparent" : lineColor,
                  }}
                />
                {/* dot */}
                <div
                  aria-current={active ? "step" : undefined}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: done ? colors.verified.text : active ? colors.primary[600] : colors.neutral[200],
                    border: `2px solid ${done ? colors.verified.text : active ? colors.primary[600] : colors.neutral[300]}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: "0.65rem",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {done ? "✓" : i + 1}
                </div>
                {/* right connector */}
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: i === STEPS.length - 1 ? "transparent" : done ? colors.verified.text : colors.neutral[200],
                  }}
                />
              </div>

              {/* label */}
              <span
                style={{
                  marginTop: "0.4rem",
                  fontSize: "0.7rem",
                  fontWeight: active ? 700 : done ? 600 : 400,
                  color: done
                    ? colors.verified.text
                    : active
                    ? colors.primary[700]
                    : colors.neutral[400],
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  paddingLeft: "0.25rem",
                  paddingRight: "0.25rem",
                }}
              >
                {step.label}
              </span>

              {/* active hint */}
              {active && step.hint && (
                <span
                  style={{
                    marginTop: "0.2rem",
                    fontSize: "0.68rem",
                    color: colors.neutral[500],
                    textAlign: "center",
                    paddingLeft: "0.25rem",
                    paddingRight: "0.25rem",
                    whiteSpace: "normal",
                  }}
                >
                  {step.hint}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Timeout guidance */}
      {timedOut && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            marginTop: "3.5rem",
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "0.375rem",
            padding: "0.6rem 0.9rem",
            fontSize: "0.78rem",
            color: "#92400e",
          }}
        >
          Taking longer than expected — your transaction may still confirm. Check Stellar Expert for the final status.
        </div>
      )}
    </div>
  );
}
