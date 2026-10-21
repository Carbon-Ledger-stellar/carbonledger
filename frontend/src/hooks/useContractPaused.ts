import { useCallback, useEffect, useState } from 'react';

/**
 * Shape of the paused-state payload returned by the contract status endpoint.
 */
export interface ContractPausedState {
  paused: boolean;
  reason?: string;
}

/**
 * Endpoint that exposes the current contract pause status.
 * Kept as a constant so it can be swapped per environment if needed.
 */
export const CONTRACT_STATUS_ENDPOINT = '/api/contract/status';

/**
 * Link to the public status page shown in the pause banner.
 */
export const STATUS_PAGE_URL = '/status';

/**
 * Reads the contract paused state so the UI can render a prominent banner
 * on every page while operations are blocked.
 *
 * The banner is intentionally not persisted: dismissing it only hides it for
 * the current session, so a page refresh re-fetches the state and shows it
 * again while the contract remains paused.
 */
export function useContractPaused(): ContractPausedState {
  const [state, setState] = useState<ContractPausedState>({ paused: false });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(CONTRACT_STATUS_ENDPOINT, { signal });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as Partial<ContractPausedState>;
      setState({
        paused: Boolean(data.paused),
        reason: typeof data.reason === 'string' && data.reason.length > 0 ? data.reason : undefined,
      });
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        return;
      }
      // Status is best-effort: on failure we simply do not show the banner.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return state;
}

export default useContractPaused;
