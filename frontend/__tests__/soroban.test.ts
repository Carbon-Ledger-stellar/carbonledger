// Jest hoists jest.mock() calls above variable declarations.
// We use a module-level object as an indirection so the closures inside
// jest.mock factory always reference the same mutable object regardless of
// when the factory executes.
const mocks = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
  getEvents: jest.fn(),
  fromXDR: jest.fn(),
  isSimulationError: jest.fn(() => false),
  isSimulationSuccess: jest.fn(() => true),
};

const mockTx = { sign: jest.fn() };

function MockTransactionBuilder(this: any) {
  return {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue(mockTx),
  };
}
(MockTransactionBuilder as any).fromXDR = (...args: any[]) => mocks.fromXDR(...args);

// Mock carbon-error-codes to avoid Babel issues with unicode characters in its comments
// and to keep the soroban unit tests self-contained.
jest.mock('../lib/carbon-error-codes', () => ({
  getCarbonErrorPlainMessage: (code: number) => {
    const msgs: Record<number, string> = {
      4:  'Insufficient credits. You do not have enough credits in this batch to complete this action.',
      5:  'These credits have already been retired and cannot be retired again.',
      10: 'Listing not found.',
      11: 'Insufficient liquidity in this listing.',
    };
    return msgs[code] ?? `Contract error ${code}. Please contact support.`;
  },
  getCarbonErrorEntry: () => undefined,
  CARBON_ERROR_MESSAGES: {},
}));

// jest.mock is hoisted — the factory must only reference `mocks` (declared with const at
// the top of the file, which is accessible because it's hoisted too as a module-level binding).
jest.mock('@stellar/stellar-sdk', () => {
  const m = {
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: (...a: any[]) => mocks.getAccount(...a),
        simulateTransaction: (...a: any[]) => mocks.simulateTransaction(...a),
        sendTransaction: (...a: any[]) => mocks.sendTransaction(...a),
        getTransaction: (...a: any[]) => mocks.getTransaction(...a),
        getEvents: (...a: any[]) => mocks.getEvents(...a),
      })),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
        // Mirrors the real SDK: a response is an error if it has an `error` string field.
        isSimulationError: (r: any) => typeof r?.error === 'string',
        isSimulationSuccess: (r: any) => !r?.error && r?.result !== undefined,
      },
    },
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({})),
    },
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({})),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
        isSimulationError: jest.fn(() => false),
      },
    },
    TransactionBuilder: MockTransactionBuilder,
    assembleTransaction: jest.fn(() => ({
      build: jest.fn(() => ({ toXDR: () => 'unsigned-xdr' })),
    })),
    Networks: {
      PUBLIC: 'Public Global Stellar Network',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    BASE_FEE: '100',
    xdr: {
      ScVal: {},
      HostFunction: { hostFunctionTypeInvokeContract: jest.fn(() => ({})) },
      InvokeContractArgs: jest.fn(),
    },
    scValToNative: jest.fn((v: any) => ({ parsed: true, raw: v })),
    nativeToScVal: jest.fn((v: any) => v),
    Address: Object.assign(
      jest.fn().mockImplementation(() => ({ toScAddress: jest.fn(), toScVal: jest.fn() })),
      { fromString: jest.fn().mockReturnValue({ toScAddress: jest.fn(), toScVal: jest.fn() }) },
    ),
    Keypair: {
      random: jest.fn().mockReturnValue({ publicKey: () => 'GPUBKEY', secret: () => 'SSECRET' }),
    },
    Asset: { native: jest.fn() },
    Operation: {
      invokeHostFunction: jest.fn(() => ({})),
    },
  };
  return m;
});

import {
  parseCarbonCredit,
  parseRetirementCertificate,
  parseMarketListing,
  simulateContract,
  invokeContract,
  getContractEvents,
  describeSimulationError,
  buildPreviewStateFromSimulation,
  simulatePurchasePreview,
  simulateRetirementPreview,
  simulateBulkPurchasePreview,
} from '../lib/soroban';
import { scValToNative } from '@stellar/stellar-sdk';

// ── Shared setup ────────────────────────────────────────────────────────────

const SUCCESS_SIM = { result: {}, minResourceFee: '5000' };
const ERROR_SIM   = { error: 'ContractError: 4 insufficient credits' };

beforeEach(() => {
  jest.clearAllMocks();
  // Restore defaults after clearAllMocks resets implementations
  mocks.isSimulationError.mockReturnValue(false);
  mocks.isSimulationSuccess.mockReturnValue(true);
  mocks.getAccount.mockResolvedValue({ id: 'GTEST' });
  mocks.simulateTransaction.mockResolvedValue(SUCCESS_SIM);
  mocks.fromXDR.mockReturnValue(mockTx);
  mocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'txhash123' });
  mocks.getTransaction.mockResolvedValue({ status: 'SUCCESS' });
  mocks.getEvents.mockResolvedValue({ events: [{ id: 'evt1' }] });
});

// ── parseCarbonCredit ───────────────────────────────────────────────────────

describe('parseCarbonCredit', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseCarbonCredit(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

// ── parseRetirementCertificate ──────────────────────────────────────────────

describe('parseRetirementCertificate', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseRetirementCertificate(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

// ── parseMarketListing ──────────────────────────────────────────────────────

describe('parseMarketListing', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseMarketListing(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

// ── simulateContract ────────────────────────────────────────────────────────

describe('simulateContract', () => {
  it('calls sorobanServer.simulateTransaction with correct args', async () => {
    const params = {
      contractId: 'CTEST',
      method: 'get_project',
      args: [],
      sourcePublicKey: 'GTEST',
    };
    const result = await simulateContract(params);
    expect(mocks.getAccount).toHaveBeenCalledWith('GTEST');
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual(SUCCESS_SIM);
  });
});

// ── invokeContract ──────────────────────────────────────────────────────────

describe('invokeContract', () => {
  it('returns hash on SUCCESS', async () => {
    const hash = await invokeContract(
      { contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' },
      'signedXDR',
    );
    expect(hash).toBe('txhash123');
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws on ERROR status', async () => {
    mocks.sendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: 'bad' });
    await expect(
      invokeContract({ contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' }, 'xdr'),
    ).rejects.toThrow('Contract invocation failed');
  });

  it('throws on FAILED transaction', async () => {
    mocks.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });
    mocks.getTransaction.mockResolvedValue({ status: 'FAILED' });
    await expect(
      invokeContract({ contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' }, 'xdr'),
    ).rejects.toThrow('Transaction failed on-chain');
  });
});

// ── getContractEvents ───────────────────────────────────────────────────────

describe('getContractEvents', () => {
  it('returns events array', async () => {
    const events = await getContractEvents('CONTRACT_ID', 1000);
    expect(mocks.getEvents).toHaveBeenCalledWith({
      startLedger: 1000,
      filters: [{ type: 'contract', contractIds: ['CONTRACT_ID'] }],
    });
    expect(events).toEqual([{ id: 'evt1' }]);
  });
});

// ── describeSimulationError ─────────────────────────────────────────────────

describe('describeSimulationError', () => {
  it('uses canonical CarbonError code 4 (InsufficientCredits) from "Error(Contract, #4)" format', () => {
    const msg = describeSimulationError('Error(Contract, #4)');
    expect(msg.toLowerCase()).toContain('insufficient');
  });

  it('uses canonical CarbonError code 4 from "ContractError: 4" format', () => {
    const msg = describeSimulationError('ContractError: 4');
    expect(msg.toLowerCase()).toContain('insufficient');
  });

  it('uses canonical CarbonError code 10 (ListingNotFound)', () => {
    const msg = describeSimulationError('ContractError: 10');
    expect(msg.toLowerCase()).toContain('listing');
  });

  it('uses canonical CarbonError code 5 (AlreadyRetired)', () => {
    const msg = describeSimulationError(new Error('ContractError: 5 alreadyretired'));
    expect(msg.toLowerCase()).toContain('retired');
  });

  it('uses canonical CarbonError code 11 (InsufficientLiquidity)', () => {
    const msg = describeSimulationError('Error(Contract, #11)');
    expect(msg.toLowerCase()).toContain('liquidity');
  });

  it('falls back to keyword match for "already retired" without a code', () => {
    const msg = describeSimulationError(new Error('already retired'));
    expect(msg.toLowerCase()).toContain('retired');
  });

  it('falls back to keyword match for network errors', () => {
    const msg = describeSimulationError('network timeout rpc error');
    expect(msg.toLowerCase()).toContain('network');
  });

  it('returns a generic message for unknown errors', () => {
    const msg = describeSimulationError(new Error('some random error'));
    expect(msg).toContain('verify');
  });

  it('handles non-Error objects gracefully', () => {
    const msg = describeSimulationError({ message: 'weird' });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ── buildPreviewStateFromSimulation ─────────────────────────────────────────

describe('buildPreviewStateFromSimulation', () => {
  it('builds a ready PreviewState from a successful simulation', () => {
    const sim = { result: {}, minResourceFee: '100000' };
    const state = buildPreviewStateFromSimulation(sim as any, {
      debitLabel: 'USDC debit',
      creditLabel: 'Credits received',
      debitValue: '$10.00 USDC',
      creditValue: '5 tonnes',
    });
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeUndefined();
    expect(state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'USDC debit', value: '$10.00 USDC' }),
        expect.objectContaining({ label: 'Credits received', value: '5 tonnes' }),
      ]),
    );
  });

  it('includes an estimated network fee in the effects', () => {
    const sim = { result: {}, minResourceFee: '500000' };
    const state = buildPreviewStateFromSimulation(sim as any, {
      debitLabel: 'USDC debit',
      creditLabel: 'Credits received',
      debitValue: '$5.00',
      creditValue: '2 credits',
    });
    expect(state.effects.some((e) => e.label.toLowerCase().includes('fee'))).toBe(true);
    expect(state.feeEstimate).toBeDefined();
  });

  it('returns an error PreviewState when simulation has an error field', () => {
    const sim = { error: 'ContractError: 4 insufficient credits' };
    const state = buildPreviewStateFromSimulation(sim as any, {
      debitLabel: 'USDC debit',
      creditLabel: 'Credits received',
      debitValue: '$10.00 USDC',
      creditValue: '5 tonnes',
    });
    expect(state.ready).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeDefined();
    expect(state.effects).toHaveLength(0);
    // Error message should be plain language, not raw code
    expect(state.error).not.toMatch(/ContractError/i);
    expect(state.error!.toLowerCase()).toContain('insufficient');
  });

  it('uses a custom feeLabel when provided', () => {
    const sim = { result: {}, minResourceFee: '0' };
    const state = buildPreviewStateFromSimulation(sim as any, {
      debitLabel: 'USDC debit',
      creditLabel: 'Credits retired',
      debitValue: '$0.00',
      creditValue: '3 credits',
      feeLabel: '~0.00100 XLM',
    });
    expect(state.feeEstimate).toBe('~0.00100 XLM');
  });
});

// ── simulatePurchasePreview ─────────────────────────────────────────────────

describe('simulatePurchasePreview', () => {
  it('returns a ready PreviewState on successful simulation', async () => {
    const state = await simulatePurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      listingId: 'listing-1',
      amount: 10,
      pricePerCredit: '10000000', // 1 USDC in stroops
    });
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
    // Should include a USDC debit effect
    expect(state.effects.some((e) => e.label === 'USDC debit')).toBe(true);
    // Should include a credits received effect
    expect(state.effects.some((e) => e.label === 'Credits received')).toBe(true);
  });

  it('surfaces plural credit count correctly', async () => {
    const state = await simulatePurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      listingId: 'listing-1',
      amount: 5,
      pricePerCredit: '10000000',
    });
    const creditEffect = state.effects.find((e) => e.label === 'Credits received');
    expect(creditEffect?.value).toContain('credits');
  });

  it('returns an error PreviewState when simulation returns an error', async () => {
    mocks.simulateTransaction.mockResolvedValue(ERROR_SIM);
    const state = await simulatePurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      listingId: 'listing-1',
      amount: 10,
      pricePerCredit: '10000000',
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
    expect(state.error).not.toMatch(/ContractError/i);
  });

  it('returns an error PreviewState when simulateContract throws', async () => {
    mocks.simulateTransaction.mockRejectedValue(new Error('network error rpc'));
    const state = await simulatePurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      listingId: 'listing-1',
      amount: 10,
      pricePerCredit: '10000000',
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
    expect(state.error!.toLowerCase()).toContain('network');
  });
});

// ── simulateRetirementPreview ───────────────────────────────────────────────

describe('simulateRetirementPreview', () => {
  it('returns a ready PreviewState on successful simulation', async () => {
    const state = await simulateRetirementPreview({
      contractId: 'CCREDIT',
      sourcePublicKey: 'GHOLDER',
      batchId: 'batch-1',
      amount: 3,
      beneficiary: 'Acme Corp',
      reason: 'Scope 1 emissions 2025',
    });
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.effects.some((e) => e.label === 'Credits retired')).toBe(true);
    expect(state.effects.some((e) => e.label === 'USDC debit')).toBe(true);
  });

  it('returns an error PreviewState when simulation returns an error', async () => {
    mocks.simulateTransaction.mockResolvedValue({ error: 'ContractError: 5' });
    const state = await simulateRetirementPreview({
      contractId: 'CCREDIT',
      sourcePublicKey: 'GHOLDER',
      batchId: 'batch-1',
      amount: 3,
      beneficiary: 'Acme Corp',
      reason: 'ESG offset',
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
    // AlreadyRetired (code 5) should produce a human-readable message
    expect(state.error!.toLowerCase()).toContain('retired');
  });

  it('returns an error PreviewState when simulateContract throws', async () => {
    mocks.simulateTransaction.mockRejectedValue(new Error('rpc failure'));
    const state = await simulateRetirementPreview({
      contractId: 'CCREDIT',
      sourcePublicKey: 'GHOLDER',
      batchId: 'batch-1',
      amount: 3,
      beneficiary: 'Acme',
      reason: 'test',
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
  });
});

// ── simulateBulkPurchasePreview ─────────────────────────────────────────────

describe('simulateBulkPurchasePreview', () => {
  const items = [
    { listingId: 'listing-1', amount: 5, pricePerCredit: '10000000' },
    { listingId: 'listing-2', amount: 3, pricePerCredit: '20000000' },
  ];

  it('returns a ready PreviewState on successful simulation', async () => {
    const state = await simulateBulkPurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      items,
    });
    expect(mocks.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.effects.some((e) => e.label === 'USDC debit')).toBe(true);
    // Credits received effect should mention the combined amount and listing count
    const creditEffect = state.effects.find((e) => e.label === 'Credits received');
    expect(creditEffect?.value).toContain('listings');
  });

  it('returns an error PreviewState when simulation returns an error', async () => {
    mocks.simulateTransaction.mockResolvedValue({ error: 'ContractError: 11' });
    const state = await simulateBulkPurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      items,
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
    // InsufficientLiquidity (code 11) → plain language
    expect(state.error!.toLowerCase()).toContain('liquidity');
  });

  it('returns an error PreviewState when simulateContract throws', async () => {
    mocks.simulateTransaction.mockRejectedValue(new Error('timeout'));
    const state = await simulateBulkPurchasePreview({
      contractId: 'CMARKET',
      sourcePublicKey: 'GBUYER',
      items,
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBeDefined();
  });
});
