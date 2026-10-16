/**
 * lib/admin-api.ts
 * All admin-scoped API calls. Attaches JWT from localStorage on every request.
 * A 401 redirects to /login automatically.
 */
import useSWR from 'swr';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalProjects:       number;
  totalTonnesIssued:   number;
  totalTonnesRetired:  number;
  protocolFeesUsdc:    number;
  activeListings:      number;
  pendingVerification: number;
}

export interface OracleHealth {
  projectId:       string;
  projectName:     string;
  methodology:     string;
  lastMonitored:   string; // ISO date
  isCurrent:       boolean; // false = stale > 365 days
  daysSinceUpdate: number;
  oracleAddress:   string;
}

export interface VerifierActivity {
  verifierAddress:  string;
  verifierName:     string;
  projectsVerified: number;
  lastActivityDate: string; // ISO date
  pendingQueue:     number;
  totalFeesEarned:  number; // USDC
  status:           'active' | 'inactive';
}

export interface AdminProject {
  id:              string;
  name:            string;
  methodology:     string;
  country:         string;
  status:          'verified' | 'pending' | 'suspended' | 'rejected';
  tonnesIssued:    number;
  tonnesRetired:   number;
  verifierAddress: string;
  registeredAt:    string;
  lastOracleUpdate:string;
}

export interface SuspendProjectPayload {
  projectId: string;
  reason:    string;
}

export type PausableContract = 'carbon_credit' | 'carbon_marketplace';

export interface PauseStatus {
  contract: PausableContract;
  paused: boolean;
  pausedUntil: number | null;
}

export interface PauseActionResult extends PauseStatus {
  contractId: string;
  txHash: string;
  traceId: string;
}

export interface PausePeriod {
  contract: string;
  admin: string;
  reason: string;
  txHash: string;
  startedAt: string;
  endedAt: string;
  requestedSeconds: number | null;
  durationSeconds: number;
  endedBy: 'manual' | 'expired' | 'renewed' | 'ongoing';
}

export interface PauseSummary {
  periods: PausePeriod[];
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('cl_jwt') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers ?? {}) },
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string })?.message ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const fetchAdminStats    = () => request<AdminStats>('/admin/stats');
export const fetchOracleHealth  = () => request<OracleHealth[]>('/admin/oracle-health');
export const fetchVerifiers     = () => request<VerifierActivity[]>('/admin/verifiers');
export const fetchAdminProjects = () => request<AdminProject[]>('/admin/projects');

export const fetchPauseState = (contract: PausableContract) =>
  request<PauseStatus>(`/admin/contracts/${contract}/pause`);

export const pauseContract = (contract: PausableContract, untilTimestamp: number) =>
  request<PauseActionResult>(`/admin/contracts/${contract}/pause`, {
    method: 'POST',
    body: JSON.stringify({ untilTimestamp }),
  });

export const unpauseContract = (contract: PausableContract) =>
  request<PauseActionResult>(`/admin/contracts/${contract}/unpause`, { method: 'POST' });

export const recordPauseReason = (payload: {
  contract: 'credit' | 'marketplace';
  action: 'pause' | 'unpause';
  txHash: string;
  reason: string;
  pausedUntil?: string;
}) => request('/admin/pause-analytics/events', {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const fetchPauseSummary = () =>
  request<PauseSummary>('/admin/pause-analytics/summary');

/**
 * Calls POST /admin/projects/suspend
 * Backend invokes carbon_registry.suspend_project() via admin keypair.
 */
export const suspendProject = (payload: SuspendProjectPayload) =>
  request<{ txHash: string }>('/admin/projects/suspend', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });

// ─── SWR Hooks ────────────────────────────────────────────────────────────────

async function authedFetcher<T>(url: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cl_jwt') : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

/** Auto-refreshes every 60 s. Returns all projects' oracle health. */
export function useOracleHealth() {
  return useSWR<OracleHealth[]>(
    `${BASE}/admin/oracle-health`,
    authedFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
}
