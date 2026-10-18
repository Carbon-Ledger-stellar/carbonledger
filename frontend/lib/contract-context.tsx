"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { PauseStatusSyncService } from "./pause-status-sync";
import {
  INITIAL_CONTRACT_STATE,
  contractReducer,
  persistPauseStatus,
  readPersistedPauseStatus,
  updatePauseStatus,
  type ContractAction,
  type ContractState,
} from "./contract-state";

interface ContractContextValue {
  state: ContractState;
  dispatch: Dispatch<ContractAction>;
  syncService: PauseStatusSyncService;
}

const ContractContext = createContext<ContractContextValue | undefined>(undefined);

export function ContractProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(contractReducer, INITIAL_CONTRACT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncService = useMemo(() => new PauseStatusSyncService({
    getStatus: () => stateRef.current.contract.pauseStatus,
    onUpdate: (status) => dispatch(updatePauseStatus(status)),
  }), []);

  useEffect(() => {
    const cached = readPersistedPauseStatus();
    if (cached) dispatch(updatePauseStatus(cached));

    const unsubscribe = syncService.subscribe();
    return () => {
      unsubscribe();
      syncService.stop();
    };
  }, [syncService]);

  useEffect(() => {
    persistPauseStatus(state.contract.pauseStatus);
  }, [state.contract.pauseStatus]);

  const value = useMemo(() => ({ state, dispatch, syncService }), [state, syncService]);
  return <ContractContext.Provider value={value}>{children}</ContractContext.Provider>;
}

/** Consumers dispatch updatePauseStatus/setPauseReason and read the shared selectors. */
export function useContractState(): ContractContextValue {
  const context = useContext(ContractContext);
  if (!context) throw new Error("useContractState must be used within a ContractProvider");
  return context;
}
