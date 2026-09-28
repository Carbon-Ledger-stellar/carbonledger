import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getContract } from "../api/contracts";
import type { Contract } from "../types/contract";

function formatDuration(fromIso: string, to: Date = new Date()): string {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return "—";
  const diffMs = Math.max(0, to.getTime() - from);
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function ContractDetails() {
  const { id } = useParams<{ id: string }>();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setLoading(true);
    getContract(id)
      .then((data) => {
        if (!cancelled) setContract(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load contract");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="contract-details">Loading…</div>;
  if (error) return <div className="contract-details error">{error}</div>;
  if (!contract) return <div className="contract-details">Contract not found.</div>;

  const isPaused = Boolean(contract.is_paused);

  return (
    <div className="contract-details">
      <h1>{contract.name ?? "Contract"}</h1>

      <section className="contract-details__pause">
        <h2>Pause Status</h2>
        <dl className="contract-details__pause-fields">
          <div className="contract-details__field">
            <dt>Status</dt>
            <dd>
              <span
                className={`pause-badge ${isPaused ? "pause-badge--paused" : "pause-badge--active"}`}
              >
                {isPaused ? "Paused" : "Active"}
              </span>
            </dd>
          </div>

          {isPaused && (
            <>
              <div className="contract-details__field">
                <dt>Paused At</dt>
                <dd>{formatTimestamp(contract.paused_at)}</dd>
              </div>

              <div className="contract-details__field">
                <dt>Paused By</dt>
                <dd>{contract.paused_by ?? "—"}</dd>
              </div>

              <div className="contract-details__field">
                <dt>Reason</dt>
                <dd>{contract.pause_reason ?? "—"}</dd>
              </div>

              <div className="contract-details__field">
                <dt>Paused For</dt>
                <dd>{contract.paused_at ? formatDuration(contract.paused_at) : "—"}</dd>
              </div>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
