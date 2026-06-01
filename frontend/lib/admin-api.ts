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
