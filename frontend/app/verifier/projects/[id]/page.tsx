"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import VerifierConfirmDialog, { REJECT_MIN_LENGTH } from "../../../../components/VerifierConfirmDialog";
import TransactionStatus, { TxStatus } from "../../../../components/TransactionStatus";
import Toast, { useToast } from "../../../../components/Toast";
import {
  useProject,
  syncProjectVerification,
  syncProjectRejection,
  invalidateVerifierCaches,
  type PendingVerifierProject,
} from "../../../../lib/api";
import { breakdownMethodologyScore, RUBRIC_DIMENSIONS } from "../../../../lib/methodology-scoring";
import { useVerifierAuth } from "../../../../lib/use-verifier-auth";
import {
  verifyProjectOnChain,
  rejectProjectOnChain,
  SorobanPollTimeoutError,
} from "../../../../lib/soroban";
import { getContractErrorMessage } from "../../../../lib/wallet-errors";
import { colors } from "../../../../styles/design-system";

type PendingAction = { decision: "verify" | "reject" };

function projectDocCid(p: PendingVerifierProject | undefined): string | undefined {
  if (!p) return undefined;
  return (p as PendingVerifierProject).documentCid ?? p.metadataCid;
}

export default function VerifierProjectReviewPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? "");
  const { publicKey, token } = useVerifierAuth();
  const { data: project, error, isLoading, mutate } = useProject(projectId);
  const { toasts, addToast, dismiss } = useToast();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | undefined>();
  const [pollProgress, setPollProgress] = useState<{ current: number; max: number } | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const breakdown = useMemo(
    () => (project ? breakdownMethodologyScore(project.methodologyScore) : null),
    [project],
  );

  const docCid = projectDocCid(project);

  async function runOnChainReview() {
    if (!pending || !project || !publicKey || !token) return;

    const { decision } = pending;
    setPending(null);
    setSubmitting(true);
    setTxHash(null);
    setTxMessage(undefined);
    setPollProgress(undefined);

    const onProgress = (phase: "building" | "signing" | "submitting" | "polling", poll?: { current: number; max: number }) => {
      if (phase === "building") setTxStatus("building");
      if (phase === "signing") setTxStatus("signing");
      if (phase === "submitting") setTxStatus("submitting");
      if (phase === "polling") {
        setTxStatus("polling");
        setPollProgress(poll);
      }
    };

    try {
      let hash: string;
      if (decision === "verify") {
        hash = await verifyProjectOnChain(publicKey, project.projectId, onProgress);
        await syncProjectVerification(project.id, publicKey, token);
        addToast({ type: "success", title: "Project verified", message: "On-chain attestation recorded.", txHash: hash });
      } else {
        const reason = rejectReason.trim();
        hash = await rejectProjectOnChain(publicKey, project.projectId, reason, onProgress);
        await syncProjectRejection(project.id, publicKey, reason, token);
        addToast({ type: "success", title: "Project rejected", message: "Rejection recorded on-chain.", txHash: hash });
      }

      setTxHash(hash);
      setTxStatus("confirmed");
      setRejectReason("");
      await invalidateVerifierCaches(publicKey);
      await mutate();
      router.push("/verifier/dashboard");
    } catch (e: unknown) {
      if (e instanceof SorobanPollTimeoutError) {
        setTxHash(e.txHash);
        setTxStatus("timed_out");
        setTxMessage(undefined);
        addToast({ type: "warning", title: "Still confirming", message: "Check Stellar Expert for final status.", txHash: e.txHash });
      } else {
        const message = getContractErrorMessage(e);
        setTxStatus("failed");
        setTxMessage(message);
        addToast({ type: "error", title: "Submission failed", message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return <main style={mainStyle}><p>Loading project…</p></main>;
  }

  if (error || !project) {
    return (
      <main style={mainStyle}>
        <p role="alert" style={{ color: "#dc2626" }}>{error?.message ?? "Project not found"}</p>
        <Link href="/verifier/dashboard">← Back to dashboard</Link>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <Link href="/verifier/dashboard" style={{ color: colors.primary[700], fontSize: "0.875rem" }}>
        ← Pending projects
      </Link>

      <h1 style={{ margin: "0.75rem 0 0.25rem" }}>{project.name}</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        {project.projectId} · {project.methodology} · {project.country} · Vintage {project.vintageYear}
      </p>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Project metadata</h2>
        <dl style={dlStyle}>
          <Meta label="Status" value={project.status} />
          <Meta label="Type" value={project.projectType} />
          <Meta label="Methodology score" value={`${project.methodologyScore}/100`} />
          <Meta label="Submitted" value={new Date(project.createdAt).toLocaleString()} />
          <Meta label="Metadata CID" value={project.metadataCid} mono />
        </dl>
      </section>

      {breakdown && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Methodology score breakdown</h2>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[500], marginTop: 0 }}>
            Per METHODOLOGY_SCORING_RUBRIC.md — dimension weights sum to 100.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Dimension</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Score</th>
                <th style={{ textAlign: "right", padding: "0.5rem 0" }}>Max</th>
              </tr>
            </thead>
            <tbody>
              {RUBRIC_DIMENSIONS.map(dim => (
                <tr key={dim.key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "0.45rem 0" }}>{dim.label}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{breakdown[dim.key]}</td>
                  <td style={{ textAlign: "right", color: colors.neutral[500] }}>{dim.max}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: "0.5rem 0", fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{breakdown.total}</td>
                <td style={{ textAlign: "right", color: colors.neutral[500] }}>100</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {docCid && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Project documentation (IPFS)</h2>
          <iframe
            src={`https://ipfs.io/ipfs/${docCid}`}
            title={`Documentation for ${project.name}`}
            style={{
              width: "100%",
              height: "55vh",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
            }}
          />
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
            <a href={`https://ipfs.io/ipfs/${docCid}`} target="_blank" rel="noopener noreferrer">
              Open PDF in new tab ↗
            </a>
          </p>
        </section>
      )}

      {txStatus && (
        <div style={{ marginBottom: "1rem" }}>
          <TransactionStatus
            status={txStatus}
            txHash={txHash ?? undefined}
            message={txMessage}
            pollProgress={pollProgress}
            onRetry={txStatus === "failed" ? () => setPending({ decision: pending?.decision ?? "verify" }) : undefined}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setPending({ decision: "verify" })}
          style={{ ...actionBtn, background: "#16a34a" }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setRejectReason("");
            setPending({ decision: "reject" });
          }}
          style={{ ...actionBtn, background: "#dc2626" }}
        >
          Reject
        </button>
      </div>

      {pending && (
        <VerifierConfirmDialog
          project={project}
          decision={pending.decision}
          rejectReason={rejectReason}
          onRejectReasonChange={setRejectReason}
          onCancel={() => {
            if (!submitting) {
              setPending(null);
              setRejectReason("");
            }
          }}
          onConfirm={runOnChainReview}
          confirmDisabled={submitting || (pending.decision === "reject" && rejectReason.trim().length < REJECT_MIN_LENGTH)}
        />
      )}

      <Toast toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ fontWeight: 600, color: colors.neutral[700] }}>{label}</dt>
      <dd style={{ margin: "0 0 0.65rem", fontFamily: mono ? "monospace" : undefined, fontSize: mono ? "0.8rem" : undefined }}>
        {value}
      </dd>
    </>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 960, margin: "2.5rem auto", padding: "0 1rem" };
const sectionStyle: React.CSSProperties = {
  marginTop: "1.75rem",
  padding: "1.25rem",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
};
const h2Style: React.CSSProperties = { margin: "0 0 0.75rem", fontSize: "1.05rem" };
const dlStyle: React.CSSProperties = { margin: 0, display: "grid", gridTemplateColumns: "140px 1fr", gap: "0.25rem 1rem" };
const actionBtn: React.CSSProperties = {
  padding: "0.65rem 1.25rem",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
};
