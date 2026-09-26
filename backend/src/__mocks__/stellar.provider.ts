/**
 * Jest manual mock for `@stellar/stellar-sdk`.
 *
 * Backend tests must never depend on a live Soroban RPC / Horizon connection
 * (local sandbox, Standalone Network, or testnet). This module intercepts the
 * SDK when `NODE_ENV === 'test'` — it is wired in `src/jest.setup.ts` via
 * `jest.mock('@stellar/stellar-sdk', () => require('./__mocks__/stellar.provider'))`
 * so every unit/integration test that imports `@stellar/stellar-sdk` gets this
 * in-memory implementation instead of touching the network.
 *
 * It keeps a simulated blockchain state (minted batches, balances, retirement
 * certificates) in local memory and returns transaction hashes / receipt
 * structures shaped like real Soroban responses for `mint_credits`,
 * `retire_credits` and `transfer_credits` calls, so higher-level code
 * (indexers, health checks, contract clients) can be exercised without a
 * network dependency.
 *
 * Closes #909
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MockBatch {
  batchId: string;
  projectId: string;
  amount: number;
  serialStart: string;
  serialEnd: string;
  status: 'Active' | 'Retired' | 'PartiallyRetired';
  mintedAt: string;
}

export interface MockCertificate {
  retirementId: string;
  batchId: string;
  amount: number;
  beneficiary: string;
  serialStart: string;
  serialEnd: string;
  retiredAt: string;
}

interface StellarMockState {
  ledger: number;
  batches: Map<string, MockBatch>;
  balances: Map<string, number>;
  certificates: Map<string, MockCertificate>;
  transactions: Map<string, any>;
}

function freshState(): StellarMockState {
  return {
    ledger: 1_000_000,
    batches: new Map(),
    balances: new Map(),
    certificates: new Map(),
    transactions: new Map(),
  };
}

let state = freshState();
let txCounter = 0;

/** Reset all in-memory mock state. Call from `beforeEach`/`afterEach` in tests. */
export function resetStellarMockState(): void {
  state = freshState();
  txCounter = 0;
}

/** Inspect the current in-memory mock state (read-only use in assertions). */
export function getStellarMockState(): Readonly<StellarMockState> {
  return state;
}

function nextTxHash(): string {
  txCounter += 1;
  return `0xmock${String(txCounter).padStart(60, '0')}`;
}

function buildReceipt(status: 'success' | 'failed', resultValue: any, errorMessage?: string) {
  state.ledger += 1;
  const txHash = nextTxHash();
  const receipt = {
    txHash,
    status,
    ledger: state.ledger,
    ledgerClosedAt: new Date().toISOString(),
    resultValue,
    error: errorMessage,
  };
  state.transactions.set(txHash, receipt);
  return receipt;
}

/**
 * Simulates the three contract methods the retirements/credits flow relies
 * on. Mirrors what the real `carbon_credit` Soroban contract does, but
 * synchronously and in memory.
 */
function invokeMockContract(method: string, args: any[]) {
  switch (method) {
    case 'mint_credits': {
      const [batchId, projectId, amount, serialStart, serialEnd] = args;
      const batch: MockBatch = {
        batchId,
        projectId,
        amount: Number(amount),
        serialStart,
        serialEnd,
        status: 'Active',
        mintedAt: new Date().toISOString(),
      };
      state.batches.set(batchId, batch);
      state.balances.set(batchId, (state.balances.get(batchId) ?? 0) + Number(amount));
      return buildReceipt('success', batch);
    }

    case 'retire_credits': {
      const [batchId, amount, beneficiary] = args;
      const batch = state.batches.get(batchId);
      if (!batch) {
        return buildReceipt('failed', null, `Batch ${batchId} not found`);
      }
      const available = state.balances.get(batchId) ?? 0;
      if (Number(amount) > available) {
        return buildReceipt('failed', null, 'INSUFFICIENT_BALANCE');
      }

      state.balances.set(batchId, available - Number(amount));
      const retirementId = `RET-${txCounter + 1}`;
      const certificate: MockCertificate = {
        retirementId,
        batchId,
        amount: Number(amount),
        beneficiary,
        serialStart: batch.serialStart,
        serialEnd: batch.serialEnd,
        retiredAt: new Date().toISOString(),
      };
      state.certificates.set(retirementId, certificate);
      batch.status = state.balances.get(batchId) === 0 ? 'Retired' : 'PartiallyRetired';
      return buildReceipt('success', certificate);
    }

    case 'transfer_credits': {
      const [batchId, , , amount] = args;
      const available = state.balances.get(batchId) ?? 0;
      if (Number(amount) > available) {
        return buildReceipt('failed', null, 'INSUFFICIENT_BALANCE');
      }
      return buildReceipt('success', { batchId, amount: Number(amount) });
    }

    default:
      return buildReceipt('success', { method, args });
  }
}

// ─── SorobanRpc.Server mock ──────────────────────────────────────────────

function makeSorobanServer() {
  return {
    getLatestLedger: jest.fn().mockImplementation(async () => ({ sequence: state.ledger })),
    getEvents: jest.fn().mockImplementation(async () => ({ events: [], latestLedger: state.ledger })),
    getHealth: jest.fn().mockImplementation(async () => ({ status: 'healthy' })),
    getTransaction: jest.fn().mockImplementation(async (hash: string) => {
      const tx = state.transactions.get(hash);
      return tx
        ? { status: tx.status === 'success' ? 'SUCCESS' : 'FAILED', ...tx }
        : { status: 'NOT_FOUND' };
    }),
    simulateTransaction: jest.fn().mockImplementation(async (tx: any) => ({
      result: tx,
      latestLedger: state.ledger,
    })),
    sendTransaction: jest.fn().mockImplementation(async () => {
      const receipt = buildReceipt('success', null);
      return { hash: receipt.txHash, status: 'PENDING' };
    }),
    getContractData: jest.fn().mockImplementation(async (batchId: string) => state.batches.get(batchId) ?? null),
    // Test helper — not part of the real SDK surface, exposed for convenience.
    __invokeMockContract: invokeMockContract,
  };
}

function makeHorizonServer() {
  return {
    root: jest.fn().mockResolvedValue({}),
    loadAccount: jest.fn().mockImplementation(async (publicKey: string) => ({
      accountId: () => publicKey,
      sequenceNumber: () => '1',
      balances: [{ asset_type: 'native', balance: '10000' }],
    })),
  };
}

const actual = jest.requireActual('@stellar/stellar-sdk');

/**
 * The drop-in replacement for `@stellar/stellar-sdk`'s exports. Wired up in
 * `src/jest.setup.ts` via:
 *
 *   jest.mock('@stellar/stellar-sdk', () => require('./__mocks__/stellar.provider').stellarSdkMock);
 */
export const stellarSdkMock = {
  ...actual,
  Server: jest.fn().mockImplementation(() => makeHorizonServer()),
  SorobanRpc: {
    ...actual.SorobanRpc,
    Server: jest.fn().mockImplementation(() => makeSorobanServer()),
  },
};

/** Directly invoke the simulated contract (used by tests that want to seed/inspect state). */
export const invokeStellarMockContract = invokeMockContract;
