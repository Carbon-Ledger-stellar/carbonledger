/**
 * Mock Blockchain Provider
 * 
 * In-memory implementation of the blockchain provider for testing.
 * Simulates contract calls, state changes, and transaction receipts
 * without requiring a real Soroban network.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IBlockchainProvider,
  ContractCallOptions,
  ContractReadOptions,
  TransactionReceipt,
  AccountBalance,
  BlockchainState,
  MockError,
} from './interface';

@Injectable()
export class MockBlockchainProvider implements IBlockchainProvider {
  private readonly logger = new Logger(MockBlockchainProvider.name);
  private state: BlockchainState;
  private ledgerCounter: number = 1000000;
  private txCounter: number = 0;
  
  // Configuration for error simulation
  private errorConfig: {
    simulateErrors: boolean;
    errorRate: number; // 0-1
    errorTypes: string[];
  } = {
    simulateErrors: false,
    errorRate: 0,
    errorTypes: [],
  };

  constructor() {
    this.state = {
      accounts: new Map(),
      contractData: new Map(),
      transactionHistory: [],
      currentLedger: 1000000,
    };
    this.logger.log('Mock blockchain provider initialized');
  }

  /**
   * Configure error simulation for testing specific failure scenarios
   */
  configureErrorSimulation(config: {
    simulateErrors?: boolean;
    errorRate?: number;
    errorTypes?: string[];
  }): void {
    this.errorConfig = {
      ...this.errorConfig,
      ...config,
    };
    this.logger.log(`Error simulation configured: ${JSON.stringify(this.errorConfig)}`);
  }

  /**
   * Pre-populate contract state for testing
   */
  setContractData(contractId: string, key: string, value: any): void {
    if (!this.state.contractData.has(contractId)) {
      this.state.contractData.set(contractId, new Map());
    }
    this.state.contractData.get(contractId)!.set(key, value);
  }

  /**
   * Set account balance for testing
   */
  setAccountBalance(address: string, balances: AccountBalance['balances']): void {
    this.state.accounts.set(address, {
      address,
      balances: {
        native: balances.native || '0',
        tokens: balances.tokens || {},
      },
    });
  }

  /**
   * Simulate a contract call (write operation)
   */
  async invokeContract(options: ContractCallOptions): Promise<TransactionReceipt> {
    this.logger.debug(
      `Invoking contract ${options.contractId}: ${options.method}(${JSON.stringify(options.args)})`
    );

    // Simulate errors if configured
    if (this.errorConfig.simulateErrors && this.shouldSimulateError()) {
      return this.simulateErrorResponse(options);
    }

    // Check if contract exists
    if (!this.state.contractData.has(options.contractId)) {
      return this.createReceipt('failed', 'Contract not found');
    }

    const contractData = this.state.contractData.get(options.contractId)!;
    this.ledgerCounter += 1;
    this.txCounter += 1;

    try {
      // Handle specific contract methods
      let result: any;
      const method = options.method;

      if (method === 'mint_credits') {
        result = this.handleMintCredits(contractData, options.args);
      } else if (method === 'retire_credits') {
        result = this.handleRetireCredits(contractData, options.args);
      } else if (method === 'transfer_credits') {
        result = this.handleTransferCredits(contractData, options.args);
      } else if (method === 'get_balance') {
        result = this.handleGetBalance(contractData, options.args);
      } else if (method === 'get_batch') {
        result = this.handleGetBatch(contractData, options.args);
      } else {
        // Generic state update
        const key = `${method}-${JSON.stringify(options.args)}`;
        contractData.set(key, { success: true, timestamp: Date.now() });
        result = { success: true };
      }

      const receipt = this.createReceipt('success', undefined, result);
      this.state.transactionHistory.push(receipt);
      return receipt;

    } catch (error) {
      this.logger.error(`Contract invocation failed: ${error}`);
      const receipt = this.createReceipt(
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      this.state.transactionHistory.push(receipt);
      return receipt;
    }
  }

  /**
   * Read contract state (read operation)
   */
  async readContract(options: ContractReadOptions): Promise<any> {
    this.logger.debug(
      `Reading contract ${options.contractId}: ${options.method}(${JSON.stringify(options.args)})`
    );

    if (!this.state.contractData.has(options.contractId)) {
      throw new Error(`Contract ${options.contractId} not found`);
    }

    const contractData = this.state.contractData.get(options.contractId)!;

    // Handle specific read methods
    const method = options.method;
    if (method === 'get_balance') {
      return this.handleGetBalance(contractData, options.args);
    } else if (method === 'get_batch') {
      return this.handleGetBatch(contractData, options.args);
    } else {
      // Generic read
      const key = `${method}-${JSON.stringify(options.args)}`;
      return contractData.get(key) || null;
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance(address: string): Promise<AccountBalance> {
    if (this.state.accounts.has(address)) {
      return this.state.accounts.get(address)!;
    }

    // Return default balance for unknown accounts
    return {
      address,
      balances: {
        native: '0',
        tokens: {},
      },
    };
  }

  /**
   * Get the current ledger sequence
   */
  async getCurrentLedger(): Promise<number> {
    return this.ledgerCounter;
  }

  /**
   * Get transaction receipt by hash
   */
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const tx = this.state.transactionHistory.find(t => t.txHash === txHash);
    return tx || null;
  }

  /**
   * Check if the provider is healthy
   */
  async isHealthy(): Promise<boolean> {
    return true;
  }

  /**
   * Get the provider type
   */
  getProviderType(): 'real' | 'mock' {
    return 'mock';
  }

  /**
   * Reset all state (for test cleanup)
   */
  reset(): void {
    this.state = {
      accounts: new Map(),
      contractData: new Map(),
      transactionHistory: [],
      currentLedger: 1000000,
    };
    this.ledgerCounter = 1000000;
    this.txCounter = 0;
    this.logger.log('Mock provider state reset');
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private createReceipt(
    status: 'success' | 'failed',
    error?: string,
    result?: any
  ): TransactionReceipt {
    this.ledgerCounter += 1;
    const txHash = `0x${String(this.txCounter).padStart(64, '0')}`;
    return {
      txHash,
      status,
      error,
      events: result ? [{ type: 'contract_event', data: result }] : [],
      ledger: this.ledgerCounter,
      ledgerClosedAt: new Date().toISOString(),
    };
  }

  private shouldSimulateError(): boolean {
    return Math.random() < this.errorConfig.errorRate;
  }

  private simulateErrorResponse(options: ContractCallOptions): TransactionReceipt {
    const errorType = this.errorConfig.errorTypes.length > 0
      ? this.errorConfig.errorTypes[Math.floor(Math.random() * this.errorConfig.errorTypes.length)]
      : 'NETWORK_ERROR';

    const errorMessages: Record<string, string> = {
      INSUFFICIENT_BALANCE: 'Insufficient balance for transaction',
      INVALID_CONTRACT: 'Invalid contract ID',
      OVERLAPPING_SERIAL: 'Serial number already used',
      NETWORK_ERROR: 'Network error simulating',
    };

    return this.createReceipt(
      'failed',
      errorMessages[errorType] || 'Unknown error',
      { error: errorType }
    );
  }

  private handleMintCredits(contractData: Map<string, any>, args: any[]): any {
    const [projectId, amount, serialStart, serialEnd] = args;
    const batchId = `BATCH-${Date.now()}`;
    
    const batchData = {
      batchId,
      projectId,
      amount: Number(amount),
      serialStart,
      serialEnd,
      status: 'Active',
      mintedAt: new Date().toISOString(),
    };

    contractData.set(`batch_${batchId}`, batchData);
    contractData.set(`serial_${serialStart}_${serialEnd}`, { batchId, used: false });

    // Update project balance
    const projectBalance = this.getOrCreateProjectBalance(contractData, projectId);
    projectBalance.total += Number(amount);
    projectBalance.available += Number(amount);

    return { batchId, ...batchData };
  }

  private handleRetireCredits(contractData: Map<string, any>, args: any[]): any {
    const [serialStart, serialEnd, beneficiary] = args;
    
    // Check if serial numbers are available
    const serialKey = `serial_${serialStart}_${serialEnd}`;
    if (contractData.has(serialKey)) {
      const serialData = contractData.get(serialKey);
      if (serialData.used) {
        throw new Error('OVERLAPPING_SERIAL: Serial numbers already used');
      }
    }

    const retirementId = `RET-${Date.now()}`;
    const retirementData = {
      retirementId,
      serialStart,
      serialEnd,
      beneficiary,
      retiredAt: new Date().toISOString(),
      status: 'Completed',
    };

    contractData.set(`retirement_${retirementId}`, retirementData);
    if (contractData.has(serialKey)) {
      contractData.get(serialKey).used = true;
    } else {
      contractData.set(serialKey, { used: true, retirementId });
    }

    return { retirementId, ...retirementData };
  }

  private handleTransferCredits(contractData: Map<string, any>, args: any[]): any {
    const [from, to, amount] = args;
    // Simplified transfer logic
    return { from, to, amount: Number(amount), transferredAt: new Date().toISOString() };
  }

  private handleGetBalance(contractData: Map<string, any>, args: any[]): any {
    const [address] = args;
    const balance = this.state.accounts.get(address);
    return balance || { address, balance: '0' };
  }

  private handleGetBatch(contractData: Map<string, any>, args: any[]): any {
    const [batchId] = args;
    return contractData.get(`batch_${batchId}`) || null;
  }

  private getOrCreateProjectBalance(
    contractData: Map<string, any>,
    projectId: string
  ): { total: number; available: number; retired: number } {
    const key = `project_balance_${projectId}`;
    if (!contractData.has(key)) {
      contractData.set(key, { total: 0, available: 0, retired: 0 });
    }
    return contractData.get(key);
  }
}
