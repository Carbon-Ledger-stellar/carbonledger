'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { freighterWallet, WalletState } from './FreighterWallet';

interface WalletContextValue extends WalletState {
  connect: () => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  checkNetwork: () => Promise<{ isCorrect: boolean; currentNetwork: string | null }>;
  signTransaction: (xdr: string) => Promise<string | null>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(freighterWallet.getState());

  useEffect(() => {
    const unsubscribe = freighterWallet.subscribe(setState);
    return () => unsubscribe();
  }, []);

  const value: WalletContextValue = {
    ...state,
    connect: freighterWallet.connect.bind(freighterWallet),
    disconnect: freighterWallet.disconnect.bind(freighterWallet),
    checkNetwork: freighterWallet.checkNetwork.bind(freighterWallet),
    signTransaction: freighterWallet.signTransaction.bind(freighterWallet),
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}