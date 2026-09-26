import { useState, useEffect, useCallback } from 'react';
import {
    isConnected as freighterIsConnected,
    getPublicKey,
    signTransaction as freighterSignTransaction,
    setAllowed,
} from '@stellar/freighter-api';
import { TransactionBuilder, Networks, Operation, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { FreighterStatus, FreighterWallet, FreighterError, TransactionPayload } from '../types/freighter';

const NETWORK = process.env.REACT_APP_STELLAR_NETWORK || 'testnet';
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' 
    ? Networks.PUBLIC 
    : Networks.TESTNET;

export const useFreighter = () => {
    const [status, setStatus] = useState<FreighterStatus>('idle');
    const [wallet, setWallet] = useState<FreighterWallet>({
        isConnected: false,
        publicKey: null,
        network: NETWORK,
    });
    const [error, setError] = useState<FreighterError | null>(null);
    const [isFreighterInstalled, setIsFreighterInstalled] = useState<boolean>(false);

    // Check if Freighter is installed
    useEffect(() => {
        const checkFreighter = async () => {
            try {
                const isInstalled = typeof window !== 'undefined' && 
                    !!window.freighterApi;
                setIsFreighterInstalled(isInstalled);
                if (isInstalled) {
                    // Request allowed sites
                    await setAllowed();
                }
            } catch (err) {
                console.error('Failed to check Freighter:', err);
                setIsFreighterInstalled(false);
            }
        };
        checkFreighter();
    }, []);

    // Check connection status on mount
    useEffect(() => {
        const checkConnection = async () => {
            if (!isFreighterInstalled) return;

            try {
                const connected = await freighterIsConnected();
                if (connected) {
                    const publicKey = await getPublicKey();
                    setWallet({
                        isConnected: true,
                        publicKey,
                        network: NETWORK,
                    });
                    setStatus('connected');
                }
            } catch (err) {
                console.error('Failed to check connection:', err);
            }
        };
        checkConnection();
    }, [isFreighterInstalled]);

    // Connect wallet
    const connect = useCallback(async () => {
        if (!isFreighterInstalled) {
            setError({
                code: 'FREIGHTER_NOT_INSTALLED',
                message: 'Freighter wallet is not installed. Please install it from the Chrome Web Store.',
            });
            setStatus('error');
            return;
        }

        setStatus('connecting');
        setError(null);

        try {
            const publicKey = await getPublicKey();
            setWallet({
                isConnected: true,
                publicKey,
                network: NETWORK,
            });
            setStatus('connected');
        } catch (err: any) {
            const error: FreighterError = {
                code: err.code || 'CONNECTION_FAILED',
                message: err.message || 'Failed to connect to Freighter',
            };
            setError(error);
            setStatus('error');
            console.error('Freighter connection error:', err);
        }
    }, [isFreighterInstalled]);

    // Disconnect wallet
    const disconnect = useCallback(() => {
        setWallet({
            isConnected: false,
            publicKey: null,
            network: NETWORK,
        });
        setStatus('disconnected');
        setError(null);
    }, []);

    // Sign transaction
    const signTransaction = useCallback(async (
        payload: TransactionPayload
    ): Promise<string> => {
        if (!wallet.isConnected || !wallet.publicKey) {
            throw new Error('Wallet not connected');
        }

        try {
            // Build the transaction
            const txBuilder = new TransactionBuilder(
                wallet.publicKey,
                {
                    fee: payload.fee || '100',
                    networkPassphrase: NETWORK_PASSPHRASE,
                }
            );

            // Add the contract call operation
            const operation = Operation.invokeContractFunction({
                contract: payload.contractId,
                functionName: payload.method,
                args: payload.args,
            });

            txBuilder.addOperation(operation);
            const transaction = txBuilder.build();

            // Sign with Freighter
            const signedTx = await freighterSignTransaction(
                transaction.toXDR(),
                NETWORK_PASSPHRASE
            );

            return signedTx;
        } catch (err: any) {
            const error: FreighterError = {
                code: err.code || 'SIGN_FAILED',
                message: err.message || 'Failed to sign transaction',
            };
            setError(error);
            throw error;
        }
    }, [wallet]);

    // Get abbreviated public key
    const abbreviatedPublicKey = useCallback(() => {
        if (!wallet.publicKey) return '';
        return `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-4)}`;
    }, [wallet.publicKey]);

    return {
        status,
        wallet,
        error,
        isFreighterInstalled,
        connect,
        disconnect,
        signTransaction,
        abbreviatedPublicKey: abbreviatedPublicKey(),
    };
};
