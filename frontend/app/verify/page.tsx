"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { useVerifierAuth } from "../../lib/use-verifier-auth";
import { usePendingVerifierProjects, invalidateVerifierCaches, type PendingVerifierProject } from "../../lib/api";
import { colors } from "../../styles/design-system";
import VerifierConfirmDialog, { REJECT_MIN_LENGTH } from "../../components/VerifierConfirmDialog";
import TransactionStatus, { TxStatus } from "../../components/TransactionStatus";
import Toast, { useToast } from "../../components/Toast";
import {
  verifyProjectOnChain,
  rejectProjectOnChain,
  SorobanPollTimeoutError,
} from "../../lib/soroban";
import { getContractErrorMessage } from "../../lib/wallet-errors";

type PendingAction = { decision: "verify" | "reject" };

function projectDocCid(p: PendingVerifierProject): string | undefined {
  return p.documentCid ?? p.metadataCid;
}

export default function VerifyPage() {
  const { state: authState, publicKey, token } = useVerifierAuth();
  const { data: projects = [], error, isLoading, mutate } = usePendingVerifierProjects(publicKey, token);
  const { toasts, addToast, dismiss } = useToast();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [target, setTarget] = useState<PendingVerifierProject | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | undefined>();
  const [pollProgress, setPollProgress] = useState<{ current: number; max: number } | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const runOnChainReview = useCallback(async () => {
    if (!pending || !target || !publicKey || !token) return;

    const { decision } = pending;
    const projectId = target.projectId;
    setSubmitting(true);
    setActiveId(projectId);
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
        hash = await verifyProjectOnChain(publicKey, projectId, onProgress);
        addToast({ type: "success", title: "Project verified", message: "On-chain attestation recorded.", txHash: hash });
      } else {
        const reason = rejectReason.trim();
        hash = await rejectProjectOnChain(publicKey, projectId, reason, onProgress);
        addToast({ type: "success", title: "Project rejected", message: "Rejection recorded on-chain.", txHash: hash });
      }

      setTxHash(hash);
      setTxStatus("confirmed");
      setRejectReason("");
      await invalidateVerifierCaches(publicKey);
      await mutate();
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
      setPending(null);
      setTarget(null);
      setActiveId(null);
    }
  }, [pending, target, publicKey, token, rejectReason, addToast, mutate]);

  const openReview = useCallback((p: PendingVerifierProject, decision: "verify" | "reject") => {
    setTarget(p);
    setRejectReason("");
    setPending({ decision });
  }, []);

  if (authState === "loading") {
    return (
      <main style={mainStyle}>
        <p style={{ color: colors.neutral[500] }}>Checking verifier access…</p>
      </main>
    );
  }

  if (authState === "needs_wallet") {
    return (
      <main style={mainStyle}>
        <h1 style={h1Style}>Verifier Review</h1>
        <p style={{ color: colors.neutral[600] }}>
          You must be an accredited verifier to review pending projects. Connect your Freighter wallet to continue.
        </p>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 style={h1Style}>Verify Pending Projects</h1>
      <p style={{ color: colors.neutral[600], marginTop: 0 }}>
        Projects awaiting your accreditation are shown below. Review the details and verification
        documentation for each card, then approve or reject. All decisions are recorded on-chain.
      </p>

      <div style={{ display: "flex", gap: "1.25rem", margin: "0 0 1.5rem" }}>
        <Link href="/verifier/dashboard" style={{ fontSize: "0.875rem", color: colors.primary[700] }}>
          Dashboard →
        </Link>
        <Link href="/verifier/history" style={{ fontSize: "0.875rem", color: colors.primary[700] }}>
          Attestation history →
        </Link>
        <Link href="/verifier/fees" style={{ fontSize: "0.875rem", color: colors.primary[700] }}>
          Fee tracker →
        </Link>
      </div>

      {error && (
        <p role="alert" style={{ color: "#dc2626" }}>{error.message}</p>
      )}

      {txStatus && (
        <div style={{ marginBottom: "1.25rem" }}>
          <TransactionStatus
            status={txStatus}
            txHash={txHash ?? undefined}
            message={txMessage}
            pollProgress={pollProgress}
          />
        </div>
      )}

      {isLoading ? (
        <p style={{ color: colors.neutral[500] }}>Loading pending projects…</p>
      ) : projects.length === 0 ? (
        <p style={{ color: colors.neutral[500] }}>No projects pending your review.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1.25rem" }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onReview={openReview} busy={activeId === p.projectId && submitting} />
          ))}
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={() => mutate()}
          style={{
            padding: "0.45rem 0.9rem",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Refresh list
        </button>
      </div>

      {pending && target && (
        <VerifierConfirmDialog
          project={target}
          decision={pending.decision}
          rejectReason={rejectReason}
          onRejectReasonChange={setRejectReason}
          onCancel={() => {
            if (!submitting) {
              setPending(null);
              setTarget(null);
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

function ProjectCard({
  project,
  onReview,
  busy,
}: {
  project: PendingVerifierProject;
  onReview: (p: PendingVerifierProject, decision: "verify" | "reject") => void;
  busy: boolean;
}) {
  const docCid = projectDocCid(project);
  return (
    <article
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: colors.neutral[900] }}>
          {project.name}
        </h2>
        <span style={{ color: "#6b7280", fontSize: "0.8rem", fontFamily: "monospace" }}>{project.projectId}</span>
      </header>

      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "110px 1fr", gap: "0.3rem 1rem", fontSize: "0.875rem" }}>
        <Meta label="Methodology" value={project.methodology} />
        <Meta label="Type" value={project.projectType} />
        <Meta label="Country" value={project.country} />
        <Meta label="Vintage" value={String(project.vintageYear ?? "—")} />
        <Meta label="Status" value={project.status} />
        <Meta label="Score" value={`${project.methodologyScore}/100`} />
        <Meta label="Submitted" value={new Date(project.createdAt).toLocaleDateString()} />
      </dl>

      <div style={{ fontSize: "0.875rem" }}>
        <span style={{ fontWeight: 600, color: colors.neutral[700] }}>Verification docs: </span>
        {docCid ? (
          <a
            href={`https://ipfs.io/ipfs/${docCid}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: colors.primary[700] }}
          >
            View documentation ↗
          </a>
        ) : (
          <span style={{ color: colors.neutral[500] }}>None attached</span>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "auto" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(project, "verify")}
          style={{ ...actionBtn, background: "#16a34a", flex: 1 }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(project, "reject")}
          style={{ ...actionBtn, background: "#dc2626", flex: 1 }}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ fontWeight: 600, color: colors.neutral[700] }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 1080, margin: "2.5rem auto", padding: "0 1.5rem" };
const h1Style: React.CSSProperties = { margin: "0 0 0.35rem", fontSize: "2rem", fontWeight: 800, color: colors.neutral[900] };
const actionBtn: React.CSSProperties = {
  padding: "0.6rem 1rem",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontWeight: 600,
  cursor: "pointer",
};
