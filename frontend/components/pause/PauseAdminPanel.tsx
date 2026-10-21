'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PauseBanner from './PauseBanner';
import PauseHistoryTimeline from './PauseHistoryTimeline';
import {
  fetchPauseState,
  fetchPauseSummary,
  recordPauseReason,
  pauseContract,
  unpauseContract,
  type PausableContract,
  type PausePeriod,
  type PauseStatus,
} from '../../lib/admin-api';

const CONTRACTS: Array<{ key: PausableContract; label: string; description: string }> = [
  { key: 'carbon_credit', label: 'Carbon credits', description: 'Mint, transfer, and retirement operations' },
  { key: 'carbon_marketplace', label: 'Marketplace', description: 'Listings, orders, and fulfillment operations' },
];

const REASONS = [
  'Security incident',
  'Unexpected oracle or data variance',
  'Planned maintenance',
  'Smart contract upgrade',
  'Other',
];
const MAX_REASON_LENGTH = 280;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The pause action could not be completed. Try again.';
}

function formatUntil(timestamp: number | null): string {
  if (!timestamp) return 'No expiry set';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(timestamp * 1000));
}

export default function PauseAdminPanel() {
  const [statuses, setStatuses] = useState<Record<PausableContract, PauseStatus | null>>({ carbon_credit: null, carbon_marketplace: null });
  const [periods, setPeriods] = useState<PausePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState<PausableContract>('carbon_credit');
  const [action, setAction] = useState<'pause' | 'unpause' | null>(null);
  const [reasonPreset, setReasonPreset] = useState(REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    setStatusError(null);
    try {
      const next = await Promise.all(CONTRACTS.map(async ({ key }) => [key, await fetchPauseState(key)] as const));
      setStatuses(Object.fromEntries(next) as Record<PausableContract, PauseStatus>);
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetchPauseSummary();
      setPeriods(response.periods ?? []);
    } catch (error) {
      setHistoryError(errorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatuses();
    void loadHistory();
  }, [loadStatuses, loadHistory]);

  useEffect(() => {
    if (!action) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        setAction(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, input, textarea, [href]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus());
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown); };
  }, [action, submitting]);

  const selectedStatus = statuses[selectedContract];
  const anyPaused = Object.values(statuses).some((status) => status?.paused);
  const pausedContract = CONTRACTS.find(({ key }) => statuses[key]?.paused);
  const customReasonValue = customReason.trim();
  const selectedReason = customReasonValue
    ? reasonPreset === 'Other' ? customReasonValue : `${reasonPreset}: ${customReasonValue}`
    : reasonPreset;
  const canSubmitPause = selectedReason.length >= 3 && acknowledged;

  const openAction = (nextAction: 'pause' | 'unpause', contract: PausableContract) => {
    setSelectedContract(contract);
    setAction(nextAction);
    setActionError(null);
    setSuccessMessage(null);
    setAcknowledged(false);
    setReasonPreset(REASONS[0]);
    setCustomReason('');
    setDurationHours(24);
  };

  const closeAction = () => {
    if (!submitting) setAction(null);
  };

  const submitAction = async () => {
    if (!action || !selectedStatus) return;
    if (action === 'pause' && !canSubmitPause) return;
    setSubmitting(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = action === 'pause'
        ? await pauseContract(selectedContract, Math.floor(Date.now() / 1000) + durationHours * 60 * 60)
        : await unpauseContract(selectedContract);
      let reasonWarning = false;
      try {
        await recordPauseReason({
          contract: selectedContract === 'carbon_credit' ? 'credit' : 'marketplace',
          action,
          txHash: result.txHash,
          reason: action === 'pause' ? selectedReason : 'Operations resumed after admin confirmation',
          ...(result.pausedUntil ? { pausedUntil: new Date(result.pausedUntil * 1000).toISOString() } : {}),
        });
      } catch {
        reasonWarning = true;
      }
      setSuccessMessage(`${CONTRACTS.find(({ key }) => key === selectedContract)?.label} ${action === 'pause' ? 'paused' : 'resumed'} successfully. Transaction ${result.txHash.slice(0, 10)}…${reasonWarning ? ' The action was recorded, but its reason is still syncing.' : ''}`);
      setAction(null);
      await Promise.all([loadStatuses(), loadHistory()]);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const bannerDetails = useMemo(() => {
    if (!pausedContract) return null;
    const status = statuses[pausedContract.key];
    return { status, label: pausedContract.label };
  }, [pausedContract, statuses]);

  return (
    <div className="pause-admin-panel">
      {bannerDetails?.status?.paused && (
        <PauseBanner
          isPaused
          reason={`${bannerDetails.label} operations are paused.`}
          pausedUntil={bannerDetails.status.pausedUntil ?? undefined}
          isDismissible={false}
          onViewDetails={() => document.getElementById('pause-history-title')?.scrollIntoView({ behavior: 'smooth' })}
        />
      )}

      <section className="pause-control-shell" aria-labelledby="pause-control-title">
        <div className="pause-panel-heading">
          <div>
            <p className="pause-eyebrow">Emergency controls</p>
            <h2 id="pause-control-title">Pause operations</h2>
            <p>Use a time-bound pause only when an incident requires state-changing operations to stop.</p>
          </div>
          <span className={`pause-status-chip ${anyPaused ? 'is-paused' : 'is-active'}`}>
            <span aria-hidden="true" />{loading ? 'Checking status' : anyPaused ? 'Paused' : 'All systems active'}
          </span>
        </div>

        {statusError && (
          <div className="pause-inline-error" role="alert"><span>{statusError}</span><button type="button" onClick={() => void loadStatuses()}>Retry</button></div>
        )}
        {successMessage && <div className="pause-success" role="status"><span aria-hidden="true">✓</span>{successMessage}</div>}

        <div className="pause-contract-grid">
          {CONTRACTS.map((contract) => {
            const status = statuses[contract.key];
            return (
              <article key={contract.key} className={`pause-contract-card ${status?.paused ? 'is-paused' : ''}`}>
                <div className="pause-contract-card__heading">
                  <div><h3>{contract.label}</h3><p>{contract.description}</p></div>
                  <span className={`pause-contract-state ${status?.paused ? 'is-paused' : 'is-active'}`}>
                    <span aria-hidden="true" />{loading ? 'Checking…' : status?.paused ? 'Paused' : 'Active'}
                  </span>
                </div>
                <div className="pause-contract-card__meta">
                  <span>{status?.paused ? `Until ${formatUntil(status.pausedUntil)}` : 'Ready for normal operations'}</span>
                </div>
                <button
                  type="button"
                  className={`pause-action-button ${status?.paused ? 'is-resume' : 'is-pause'}`}
                  onClick={() => openAction(status?.paused ? 'unpause' : 'pause', contract.key)}
                  disabled={loading || !status}
                >
                  <span aria-hidden="true">{status?.paused ? '▶' : 'Ⅱ'}</span>
                  {status?.paused ? 'Resume operations' : 'Emergency pause'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <PauseHistoryTimeline periods={periods} loading={historyLoading} error={historyError} onRetry={() => void loadHistory()} />

      {action && selectedStatus && (
        <div className="pause-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAction(); }}>
          <section ref={dialogRef} className="pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-dialog-title" aria-describedby="pause-dialog-description">
            <div className={`pause-dialog__header ${action === 'pause' ? 'is-danger' : 'is-safe'}`}>
              <span className="pause-dialog__icon" aria-hidden="true">{action === 'pause' ? 'Ⅱ' : '▶'}</span>
              <div><p className="pause-eyebrow">{action === 'pause' ? 'Emergency action' : 'Restore service'}</p><h2 id="pause-dialog-title">{action === 'pause' ? `Pause ${CONTRACTS.find(({ key }) => key === selectedContract)?.label}` : `Resume ${CONTRACTS.find(({ key }) => key === selectedContract)?.label}`}</h2></div>
              <button type="button" className="pause-dialog__close" onClick={closeAction} disabled={submitting} aria-label="Close confirmation dialog">×</button>
            </div>
            <div className="pause-dialog__body">
              <p id="pause-dialog-description" className="pause-dialog__lead">
                {action === 'pause' ? 'New transactions for this contract will stop immediately. Reads and monitoring remain available.' : 'State-changing operations will become available again for every user.'}
              </p>
              {action === 'pause' ? (
                <>
                  <fieldset className="pause-form-group">
                    <legend>Why are you pausing?</legend>
                    <div className="pause-reason-options">
                      {REASONS.map((reason) => <button key={reason} type="button" className={`pause-reason-option ${reasonPreset === reason ? 'is-selected' : ''}`} onClick={() => setReasonPreset(reason)}>{reason}</button>)}
                    </div>
                    <label htmlFor="pause-custom-reason">Add context <span className="pause-optional">{reasonPreset === 'Other' ? 'required' : 'optional'}</span></label>
                    <textarea id="pause-custom-reason" value={customReason} onChange={(event) => setCustomReason(event.target.value.slice(0, MAX_REASON_LENGTH))} maxLength={MAX_REASON_LENGTH} placeholder="Include the incident or maintenance context admins should see in the audit trail." aria-describedby="pause-reason-help pause-reason-count" rows={3} />
                    <div className="pause-field-footer"><span id="pause-reason-help">A concise reason helps responders understand the decision.</span><span id="pause-reason-count">{customReason.length}/{MAX_REASON_LENGTH}</span></div>
                  </fieldset>
                  <fieldset className="pause-form-group">
                    <legend>Pause window</legend>
                    <div className="pause-duration-options">
                      {[1, 6, 24, 72].map((hours) => <button key={hours} type="button" className={durationHours === hours ? 'is-selected' : ''} onClick={() => setDurationHours(hours)}>{hours}h<span>{hours === 72 ? 'maximum' : hours === 24 ? 'standard' : 'quick'}</span></button>)}
                    </div>
                    <p className="pause-help-text">The contract automatically expires a pause after 72 hours.</p>
                  </fieldset>
                </>
              ) : (
                <div className="pause-resume-summary"><strong>Ready to resume?</strong><p>Confirm only after the incident is contained and normal operations are safe to restore.</p></div>
              )}
              <label className="pause-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand this action affects all users of the {CONTRACTS.find(({ key }) => key === selectedContract)?.label.toLowerCase()}.</span></label>
              {actionError && <div className="pause-inline-error" role="alert"><span>{actionError}</span><button type="button" onClick={() => void submitAction()}>Try again</button></div>}
            </div>
            <div className="pause-dialog__footer"><button type="button" className="pause-secondary-button" onClick={closeAction} disabled={submitting}>Cancel</button><button type="button" className={`pause-primary-button ${action === 'pause' ? 'is-danger' : 'is-safe'}`} onClick={() => void submitAction()} disabled={submitting || !acknowledged || (action === 'pause' && !canSubmitPause)}>{submitting ? 'Submitting…' : action === 'pause' ? 'Confirm pause' : 'Confirm resume'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
