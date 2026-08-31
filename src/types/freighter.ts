export interface FreighterWallet {
    isConnected: boolean;
    publicKey: string | null;
    network: string;
}

export interface FreighterError {
    code: string;
    message: string;
}

export interface TransactionPayload {
    contractId: string;
    method: string;
    args: any[];
    fee?: string;
    network?: 'testnet' | 'mainnet';
}

export type FreighterStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';
