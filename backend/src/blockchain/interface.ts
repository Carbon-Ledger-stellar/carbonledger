/**
 * Blockchain Provider Interface
 * 
 * Defines the contract that both real and mock blockchain providers must implement.
 * This allows the application to switch between real Soroban and in-memory mock
 * implementations for testing.
 */

import { xdr } from '@stellar/stellar-sdk';

export interface TransactionReceipt {
  txHash: string;
  status: 'success' | 'failed';
  error?: string;
  events?: any[];
  ledger: number;
  ledgerClosedAt: string;
}

export interface ContractCallOptions {
  contractId: string;
  method: string;
  args: any[];
  sourceAccount?: string;
  timeout?: number;
}

export interface ContractReadOptions {
  contractId: string;
  method: string;
  args: any[];
}

export interface AccountBalance {
  address: string;
  balances: {
    native: string;
    tokens: Record<string, string>;
  };
}

export interface BlockchainState {
  accounts: Map<string, AccountBalance>;
  contractData: Map<string, Map<string, any>>;
  transactionHistory: TransactionReceipt[];
  currentLedger: number;
}

export interface MockError {
  type: 'INSUFFICIENT_BALANCE' | 'INVALID_CONTRACT' | 'OVERLAPPING_SERIAL' | 'NETWORK_ERROR';
  message: string;
}

export interface IBlockchainProvider {
  /**
   * Invoke a contract method (write operation)
   */
  invokeContract(options: ContractCallOptions): Promise<TransactionReceipt>;

  /**
   * Read contract state (read operation)
   */
  readContract(options: ContractReadOptions): Promise<any>;

  /**
   * Get account balance
   */
  getAccountBalance(address: string): Promise<AccountBalance>;

  /**
   * Get the current ledger sequence
   */
  getCurrentLedger(): Promise<number>;

  /**
   * Get transaction receipt by hash
   */
  getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null>;

  /**
   * Check if the provider is healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get the provider type (for DI)
   */
  getProviderType(): 'real' | 'mock';
}
