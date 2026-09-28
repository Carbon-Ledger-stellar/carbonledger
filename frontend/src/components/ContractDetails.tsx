import React from 'react';

interface ContractPauseInfo {
  is_paused: boolean;
  paused_at?: string | null;
  paused_by?: string | null;
  pause_reason?: string | null;
}

interface ContractDetailsProps {
  contract: {
    id: string;
    name?: string;
    pause?: ContractPauseInfo | null;
  };
}

function formatTimestamp(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatPauseDuration(pausedAt?: string | null): string {
  if (!pausedAt) return '—';
  const start = new Date(pausedAt).getTime();
  if (Number.isNaN(start)) return '—';

  const diffMs = Date.now() - start;
  if (diffMs < 0) return '—';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

const ContractDetails: React.FC<ContractDetailsProps> = ({ contract }) => {
  const pause = contract.pause;
  const isPaused = Boolean(pause?.is_paused);

  return (
    <div className="contract-details">
      <h2>{contract.name ?? 'Contract Details'}</h2>

      <section className="contract-details__pause">
        <h3>Pause Status</h3>
        <dl>
          <dt>Status</dt>
          <dd>
            <span
              className={`pause-status ${isPaused ? 'pause-status--paused' : 'pause-status--active'}`}
            >
              {isPaused ? 'Paused' : 'Active'}
            </span>
          </dd>

          <dt>Paused At</dt>
          <dd>{isPaused ? formatTimestamp(pause?.paused_at) : '—'}</dd>

          <dt>Paused By</dt>
          <dd>{isPaused ? pause?.paused_by ?? '—' : '—'}</dd>

          <dt>Pause Reason</dt>
          <dd>{isPaused ? pause?.pause_reason ?? '—' : '—'}</dd>

          <dt>Pause Duration</dt>
          <dd>{isPaused ? formatPauseDuration(pause?.paused_at) : '—'}</dd>
        </dl>
      </section>
    </div>
  );
};

export default ContractDetails;
