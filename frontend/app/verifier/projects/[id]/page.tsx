"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";
import VerifierConfirmDialog, { REJECT_MIN_LENGTH } from "../../../../components/VerifierConfirmDialog";
import TransactionStatus, { TxStatus } from "../../../../components/TransactionStatus";
import Toast, { useToast } from "../../../../components/Toast";
import {
  useProject,
  invalidateVerifierCaches,
  type PendingVerifierProject,
} from "../../../../lib/api";
import { breakdownMethodologyScore, RUBRIC_DIMENSIONS } from "../../../../lib/methodology-scoring";
import { getAttestationChecklist } from "../../../../lib/attestation-checklist";
import { useVerifierAuth } from "../../../../lib/use-verifier-auth";
import {
  verifyProjectOnChain,
  rejectProjectOnChain,
  SorobanPollTimeoutError,
} from "../../../../lib/soroban";
import { getContractErrorMessage } from "../../../../lib/wallet-errors";
import { colors } from "../../../../styles/design-system";
import {
  saveDraftReport,
  hasPendingDraft,
  getPendingDraftCount,
} from "../../../../lib/offline-report-queue";
import { OFFLINE_SYNC_EVENT } from "../../../../lib/offline-sync";

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
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingDraft, setPendingDraft] = useState<boolean>(false);
  const [draftCount, setDraftCount] = useState<number>(0);

  // Detect online/offline state changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  // Check whether this project already has a pending offline draft
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    hasPendingDraft(project.projectId).then((draft) => {
      if (!cancelled) setPendingDraft(Boolean(draft));
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  // Refresh the global pending-draft count when the sync event fires
  useEffect(() => {
    const refresh = () => {
      getPendingDraftCount().then(setDraftCount).catch(() => {});
    };
    window.addEventListener(OFFLINE_SYNC_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_SYNC_EVENT, refresh);
  }, []);

  const saveOfflineDraft = useCallback(
    async (decision: "verify" | "reject") => {
      if (!project) return;
      try {
        await saveDraftReport({
          projectId: project.projectId,
          projectName: project.name,
          decision,
          rejectReason: decision === "reject" ? rejectReason.trim() : "",
          checkedItems: Array.from(checkedItems),
        });
        setPendingDraft(true);
        await getPendingDraftCount().then(setDraftCount);
        setPending(null);
        addToast({
          type: "success",
          title: "Review saved offline",
          message:
            "You're offline. Your decision was queued and will be synced automatically when connectivity returns.",
        });
      } catch (err) {
        console.error("[offline] Failed to save draft:", err);
        addToast({
          type: "error",
          title: "Could not save draft",
          message:
            err instanceof Error ? err.message : "IndexedDB unavailable in this browser.",
        });
      }
    },
    [project, checkedItems, rejectReason, addToast],
  );

  const onConfirmReview = useCallback(() => {
    if (!pending) return;
    if (!isOnline) {
      saveOfflineDraft(pending.decision);
      return;
    }
    runOnChainReview();
  }, [pending, isOnline, saveOfflineDraft]);

  const breakdown = useMemo(
    () => (project ? breakdownMethodologyScore(project.methodologyScore) : null),
    [project],
  );

  const checklist = useMemo(
    () => (project ? getAttestationChecklist(project.methodology) : []),
    [project],
  );
  const checklistComplete = checklist.length > 0 && checklist.every(item => checkedItems.has(item.key));

  function toggleChecklistItem(key: string) {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
        addToast({ type: "success", title: "Project verified", message: "On-chain attestation recorded.", txHash: hash });
      } else {
        const reason = rejectReason.trim();
        hash = await rejectProjectOnChain(publicKey, project.projectId, reason, onProgress);
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
      {/* Offline banner */}
      {!isOnline && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 6,
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.875rem",
            color: "#92400e",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          role="alert"
        >
          <span style={{ fontSize: "1.1rem" }}>📡</span>
          <span>
            You are offline. Your review decisions will be saved locally and
            submitted when connectivity is restored.
          </span>
        </div>
      )}

      {/* Pending drafts indicator */}
      {draftCount > 0 && isOnline && (
        <div
          style={{
            background: "#e0f2fe",
            border: "1px solid #38bdf8",
            borderRadius: 6,
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.875rem",
            color: "#075985",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          role="status"
        >
          <span style={{ fontSize: "1.1rem" }}>📋</span>
          <span>
            You have{" "}
            <strong>
              {draftCount} pending offline review{draftCount !== 1 ? "s" : ""}
            </strong>
            . Reopen them to submit on-chain.
          </span>
        </div>
      )}

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

      <section style={sectionStyle}>
        <h2 style={h2Style}>Attestation checklist — {project.methodology}</h2>
        <p style={{ fontSize: "0.8rem", color: colors.neutral[500], marginTop: 0 }}>
          Every item must be confirmed before an on-chain attestation can be submitted.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {checklist.map(item => (
            <label key={item.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={checkedItems.has(item.key)}
                onChange={() => toggleChecklistItem(item.key)}
                style={{ marginTop: "0.2rem" }}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
        {!checklistComplete && (
          <p style={{ fontSize: "0.75rem", color: colors.neutral[500], marginTop: "0.75rem" }}>
            {checkedItems.size}/{checklist.length} confirmed
          </p>
        )}
      </section>

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
          disabled={submitting || !checklistComplete}
          title={!checklistComplete ? "Complete the attestation checklist first" : undefined}
          onClick={() => setPending({ decision: "verify" })}
          style={{ ...actionBtn, background: "#16a34a", opacity: submitting || !checklistComplete ? 0.5 : 1 }}
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
          onConfirm={onConfirmReview}
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
