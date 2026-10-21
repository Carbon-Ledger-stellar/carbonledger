'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PauseEvent } from '@/types/pause';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start: string, end?: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '—';
  }
  const totalSeconds = Math.floor((endMs - startMs) / 1000);
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function PauseEventCard({ event }: { event: PauseEvent }) {
  const isActive = !event.resumedAt;
  return (
    <li className="relative pl-10">
      <span
        className={`absolute left-0 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 ${
          isActive
            ? 'border-amber-500 bg-amber-100 text-amber-700'
            : 'border-slate-300 bg-white text-slate-500'
        }`}
        aria-hidden="true"
      >
        <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-amber-500' : 'bg-slate-400'}`} />
      </span>
      <article className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md focus-within:border-slate-300 focus-within:shadow-md">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white"
              aria-hidden="true"
            >
              {initials(event.adminName)}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-medium text-slate-900">{event.adminName}</p>
              <p className="text-xs text-slate-500">{formatDate(event.pausedAt)}</p>
            </div>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isActive
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isActive ? 'Active' : 'Resumed'}
          </span>
        </header>
        <p className="mt-3 text-sm text-slate-700">{event.reason}</p>
        <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Duration:{' '}
            <span className="font-medium text-slate-700">
              {formatDuration(event.pausedAt, event.resumedAt)}
            </span>
          </span>
          {event.resumedAt && <span>Resumed {formatDate(event.resumedAt)}</span>}
        </footer>
      </article>
    </li>
  );
}

export default function PauseHistoryPage() {
  const [events, setEvents] = useState<PauseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/pause/history');
        if (!res.ok) throw new Error(`Failed to load pause history (${res.status})`);
        const data = (await res.json()) as PauseEvent[];
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load pause history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(b.pausedAt).getTime() - new Date(a.pausedAt).getTime()),
    [events],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Pause History</h1>
      <p className="mt-1 text-sm text-slate-500">Chronological record of pause events.</p>

      {loading && <p className="mt-6 text-sm text-slate-500">Loading pause history…</p>}
      {error && (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      {!loading && !error && sorted.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">No pause events recorded.</p>
      )}

      {sorted.length > 0 && (
        <ol className="relative mt-6 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
          {sorted.map((event) => (
            <PauseEventCard key={event.id} event={event} />
          ))}
        </ol>
      )}
    </main>
  );
}
