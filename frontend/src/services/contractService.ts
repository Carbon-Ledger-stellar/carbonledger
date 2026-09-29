import { api } from './api';

export interface PauseStatus {
  paused: boolean;
  reason?: string;
  pausedAt?: string;
  pausedBy?: string;
}

export interface PauseResult {
  success: boolean;
  message?: string;
  status?: PauseStatus;
}

/**
 * Fetch the current pause status of the contract.
 */
export async function getPauseStatus(): Promise<PauseStatus> {
  const response = await api.get<PauseStatus>('/contract/pause-status');
  return response.data;
}

/**
 * Pause the contract with an optional reason.
 */
export async function pauseContract(reason?: string): Promise<PauseResult> {
  const response = await api.post<PauseResult>('/contract/pause', {
    reason: reason?.trim() || undefined,
  });
  return response.data;
}

/**
 * Unpause the contract.
 */
export async function unpauseContract(): Promise<PauseResult> {
  const response = await api.post<PauseResult>('/contract/unpause');
  return response.data;
}

export const contractService = {
  getPauseStatus,
  pauseContract,
  unpauseContract,
};

export default contractService;
