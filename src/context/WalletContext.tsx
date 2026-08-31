import React, { createContext, useContext, ReactNode } from 'react';
import { useFreighter } from '../hooks/useFreighter';
import { FreighterWallet, FreighterStatus } from '../types/freighter';

interface WalletContextType {
    status: FreighterStatus;
    wallet: FreighterWallet;
    connect: () => Promise<void>;
    disconnect: () => void;
    signTransaction: (payload: any) => Promise<string>;
    abbreviatedPublicKey: string;
    isFreighterInstalled: boolean;
    error: any;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const wallet = useFreighter();

    return (
        <WalletContext.Provider value={wallet}>
            {children}
        </WalletContext.Provider>
    );
};

export const useWallet = (): WalletContextType => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};
