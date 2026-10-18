import { normalizePauseStatus } from "./pause-api";

export interface ContractPauseStatus {
  /** null means the status has not been established, not that the contract is active. */
  paused: boolean | null;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  updatedAt: string | null;
  /** Local time of the last successful backend sync, in Unix milliseconds. */
  lastUpdated: number | null;
  loading: boolean;
  error: string | null;
}

export interface ContractState {
  contract: {
    pauseStatus: ContractPauseStatus;
  };
}

export const INITIAL_CONTRACT_STATE: ContractState = {
  contract: {
    pauseStatus: {
      paused: null,
      reason: null,
      pausedAt: null,
      pausedBy: null,
      updatedAt: null,
      lastUpdated: null,
      loading: true,
      error: null,
    },
  },
};

export type ContractAction =
  | { type: "contract/updatePauseStatus"; payload: Partial<ContractPauseStatus> }
  | { type: "contract/setPauseReason"; payload: string | null };

export function updatePauseStatus(payload: Partial<ContractPauseStatus>): ContractAction {
  return { type: "contract/updatePauseStatus", payload };
}

export function setPauseReason(reason: string | null): ContractAction {
  return { type: "contract/setPauseReason", payload: reason };
}

export function contractReducer(state: ContractState, action: ContractAction): ContractState {
  const current = state.contract.pauseStatus;
  switch (action.type) {
    case "contract/updatePauseStatus": {
      const pauseStatus = { ...current, ...action.payload };
      if (action.payload.paused === false) {
        pauseStatus.reason = null;
        pauseStatus.pausedAt = null;
        pauseStatus.pausedBy = null;
      }
      return { ...state, contract: { ...state.contract, pauseStatus } };
    }
    case "contract/setPauseReason":
      return {
        ...state,
        contract: {
          ...state.contract,
          pauseStatus: { ...current, reason: action.payload?.trim() || null },
        },
      };
    default:
      return state;
  }
}

export const selectPauseStatus = (state: ContractState) => state.contract.pauseStatus;
export const selectIsPaused = (state: ContractState) => selectPauseStatus(state).paused === true;
export const selectPauseStatusKnown = (state: ContractState) => selectPauseStatus(state).paused !== null;
export const selectPauseReason = (state: ContractState) => selectPauseStatus(state).reason;
export const selectPauseLastUpdated = (state: ContractState) => selectPauseStatus(state).lastUpdated;
export const selectPauseStatusLoading = (state: ContractState) => selectPauseStatus(state).loading;
export const selectPauseStatusError = (state: ContractState) => selectPauseStatus(state).error;

// Scope the cache to the API environment so switching backends cannot restore another status.
export const PAUSE_STATUS_STORAGE_KEY = `cl_contract_pause_status:${process.env.NEXT_PUBLIC_API_URL ?? "/api"}`;

export function readPersistedPauseStatus(): Partial<ContractPauseStatus> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PAUSE_STATUS_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached?.version !== 1) return null;
    const status = normalizePauseStatus(cached.pauseStatus);
    const lastUpdated = cached.pauseStatus.lastUpdated;
    return {
      ...status,
      lastUpdated: typeof lastUpdated === "number" && Number.isFinite(lastUpdated) && lastUpdated >= 0
        ? lastUpdated : null,
      // Cached data is provisional until the app-load sync succeeds.
      loading: true,
      error: null,
    };
  } catch {
    // Corrupt data, denied storage access, and SSR must never prevent app startup.
    return null;
  }
}

export function persistPauseStatus(status: ContractPauseStatus): void {
  if (typeof window === "undefined" || status.paused === null) return;
  try {
    const { loading: _loading, error: _error, ...snapshot } = status;
    window.localStorage.setItem(PAUSE_STATUS_STORAGE_KEY, JSON.stringify({
      version: 1,
      pauseStatus: snapshot,
    }));
  } catch {
    // Persistence is best-effort, including private mode and storage quota failures.
  }
}
